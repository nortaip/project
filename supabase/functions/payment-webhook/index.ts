// ============================================================================
// Edge Function: payment-webhook
//
// Bank gateway-i (Epoint) ödəniş tamamlandıqdan sonra bu URL-i çağırır.
//   1. Signature-i yoxlayır (Epoint private key ilə HMAC)
//   2. payments cədvəlində status update edir
//   3. purpose-a görə müvafiq RPC çağırır:
//        balance_topup     → credit_balance
//        service_payment   → lock_offer_payment (escrow)
//        service_promotion → apply_service_promotion
//
// IMPORTANT: `--no-verify-jwt` ilə deploy olunur. Bank JWT göndərmir.
//
// Secrets:
//   EPOINT_PRIVATE_KEY
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
// ============================================================================

import { createClient } from "npm:@supabase/supabase-js@2";

interface EpointPayload {
  order_id: string;
  status: "success" | "failed" | "cancelled";
  amount?: string | number;
  transaction?: string;
  message?: string;
  code?: string;
}

const cors = {
  "Access-Control-Allow-Origin": "https://epoint.az",
  "Access-Control-Allow-Headers": "content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

function base64DecodeToString(b64: string): string {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

function base64Encode(bytes: Uint8Array): string {
  let str = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    str += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(str);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cors });
  }
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  try {
    const epointPrivate = Deno.env.get("EPOINT_PRIVATE_KEY");
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!epointPrivate || !supabaseUrl || !serviceRole) {
      return new Response("Server misconfigured", { status: 500 });
    }

    // ── 1. Body parse (form-urlencoded / JSON) ─────────────────────────
    let dataB64: string | null = null;
    let signature: string | null = null;

    const contentType = req.headers.get("content-type") ?? "";
    if (contentType.includes("application/x-www-form-urlencoded")) {
      const form = await req.formData();
      dataB64 = form.get("data")?.toString() ?? null;
      signature = form.get("signature")?.toString() ?? null;
    } else if (contentType.includes("application/json")) {
      const body = await req.json();
      dataB64 = body.data ?? null;
      signature = body.signature ?? null;
    }

    if (!dataB64 || !signature) {
      return new Response("Missing data or signature", { status: 400 });
    }

    // ── 2. Signature yoxla ─────────────────────────────────────────────
    const sigSource = `${epointPrivate}${dataB64}${epointPrivate}`;
    const sigBuf = await crypto.subtle.digest(
      "SHA-1",
      new TextEncoder().encode(sigSource),
    );
    const expectedSig = base64Encode(new Uint8Array(sigBuf));
    if (expectedSig !== signature) {
      return new Response("Invalid signature", { status: 401 });
    }

    // ── 3. Payload decode ──────────────────────────────────────────────
    let payload: EpointPayload;
    try {
      payload = JSON.parse(base64DecodeToString(dataB64));
    } catch {
      return new Response("Invalid payload", { status: 400 });
    }

    if (!payload.order_id) {
      return new Response("Missing order_id", { status: 400 });
    }

    const supabase = createClient(supabaseUrl, serviceRole);

    const { data: payment, error: fetchErr } = await supabase
      .from("payments")
      .select("*")
      .eq("id", payload.order_id)
      .single();

    if (fetchErr || !payment) {
      return new Response("Payment not found", { status: 404 });
    }

    // Idempotency
    if (payment.status === "completed") {
      return new Response(JSON.stringify({ ok: true, idempotent: true }), {
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    // ── 4. Defense-in-depth: məbləğ uyğunluğu ─────────────────────────
    if (payload.amount !== undefined) {
      const payloadAmt = Number(payload.amount);
      if (
        !Number.isFinite(payloadAmt) ||
        Math.abs(payloadAmt - Number(payment.amount)) > 0.01
      ) {
        await supabase
          .from("payments")
          .update({
            status: "failed",
            metadata: {
              ...(payment.metadata as object),
              mismatch: { expected: payment.amount, received: payload.amount },
            },
          })
          .eq("id", payment.id);
        return new Response("Amount mismatch", { status: 400 });
      }
    }

    // ── 5. Statusa görə əməl et ────────────────────────────────────────
    if (payload.status === "success") {
      const meta = (payment.metadata ?? {}) as Record<string, unknown>;
      const purpose = (meta.purpose as string | undefined) ?? "balance_topup";

      let postErr: { message: string } | null = null;

      if (purpose === "service_promotion") {
        const { error } = await supabase.rpc("apply_service_promotion", {
          p_service_id: meta.service_id ?? null,
          p_promotion_type: meta.promotion_type ?? null,
          p_promotion_days: meta.promotion_duration ?? null,
          p_payment_id: payment.id,
        });
        postErr = error;
      } else if (purpose === "service_payment") {
        const { error } = await supabase.rpc("lock_offer_payment", {
          p_offer_id: meta.offer_id ?? null,
          p_amount: payment.amount,
          p_payment_id: payment.id,
        });
        postErr = error;
      } else {
        const { error } = await supabase.rpc("credit_balance", {
          p_user_id: payment.user_id,
          p_amount: payment.amount,
          p_payment_id: payment.id,
          p_reason: payment.description ?? "Balance top-up",
        });
        postErr = error;
      }

      if (postErr) {
        await supabase
          .from("payments")
          .update({
            status: "failed",
            metadata: { ...meta, post_error: postErr.message },
          })
          .eq("id", payment.id);
        return new Response(`Post-payment action failed: ${postErr.message}`, {
          status: 500,
        });
      }

      await supabase
        .from("payments")
        .update({
          status: "completed",
          completed_at: new Date().toISOString(),
          metadata: { ...meta, epoint_payload: payload },
        })
        .eq("id", payment.id);

      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...cors, "Content-Type": "application/json" },
      });
    } else {
      await supabase
        .from("payments")
        .update({
          status: payload.status === "cancelled" ? "cancelled" : "failed",
          metadata: { ...(payment.metadata as object), epoint_payload: payload },
        })
        .eq("id", payment.id);

      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }
  } catch (e) {
    console.error("payment-webhook fatal:", e);
    return new Response(
      `Internal error: ${e instanceof Error ? e.message : String(e)}`,
      { status: 500 },
    );
  }
});
