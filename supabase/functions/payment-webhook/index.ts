// ============================================================================
// Edge Function: payment-webhook
//
// Bank gateway-i (Epoint) ödəniş tamamlandıqdan sonra bu URL-i çağırır.
// Funksiya:
//   1. Signature-i yoxlayır (Epoint private key ilə HMAC)
//   2. payments cədvəlində status update edir
//   3. Uğurlu olarsa credit_balance() funksiyası ilə balansa kredit edir
//   4. transactions cədvəlinə audit row əlavə olunur (credit_balance içində)
//
// IMPORTANT: Bu function `--no-verify-jwt` ilə deploy olunmalıdır
// (Dashboard → Edge Functions → send-fcm kimi). Çünki bank gateway JWT göndərmir.
//
// Tələb olunan secrets:
//   EPOINT_PRIVATE_KEY    — signature yoxlama üçün
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { decode as base64Decode } from "https://deno.land/std@0.224.0/encoding/base64.ts";

interface EpointPayload {
  order_id: string;
  status: "success" | "failed" | "cancelled";
  amount?: string | number;
  transaction?: string;
  message?: string;
  code?: string;
}

// Webhook server-to-server-dir, browser CORS preflight göndərmir; geniş açmırıq.
const cors = {
  "Access-Control-Allow-Origin": "https://epoint.az",
  "Access-Control-Allow-Headers": "content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: cors });
  }
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const epointPrivate = Deno.env.get("EPOINT_PRIVATE_KEY");
  if (!epointPrivate) {
    return new Response("Server misconfigured", { status: 500 });
  }

  // ── 1. Body parse — Epoint formData göndərir ──────────────────────────
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

  // ── 2. Signature yoxla ────────────────────────────────────────────────
  const sigSource = `${epointPrivate}${dataB64}${epointPrivate}`;
  const sigBuf = await crypto.subtle.digest(
    "SHA-1",
    new TextEncoder().encode(sigSource),
  );
  const expectedSig = btoa(
    String.fromCharCode(...new Uint8Array(sigBuf)),
  );
  if (expectedSig !== signature) {
    return new Response("Invalid signature", { status: 401 });
  }

  // ── 3. Payload decode ─────────────────────────────────────────────────
  let payload: EpointPayload;
  try {
    const decoded = new TextDecoder().decode(base64Decode(dataB64));
    payload = JSON.parse(decoded);
  } catch {
    return new Response("Invalid payload", { status: 400 });
  }

  if (!payload.order_id) {
    return new Response("Missing order_id", { status: 400 });
  }

  // ── 4. payments cədvəlində row tap ────────────────────────────────────
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data: payment, error: fetchErr } = await supabase
    .from("payments")
    .select("*")
    .eq("id", payload.order_id)
    .single();

  if (fetchErr || !payment) {
    return new Response("Payment not found", { status: 404 });
  }

  // Idempotency — artıq emal olunubsa, OK qaytar
  if (payment.status === "completed") {
    return new Response(JSON.stringify({ ok: true, idempotent: true }), {
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  // ── 4b. Defense-in-depth: payload.amount === payment.amount yoxla ──
  // Bank tərəfdə nəyəsə dəyişiklik olarsa (məs. partial refund), uyğunsuzluğu
  // şübhəli sayırıq və failed kimi qeyd edirik.
  if (payload.amount !== undefined) {
    const payloadAmt = Number(payload.amount);
    if (!Number.isFinite(payloadAmt) || Math.abs(payloadAmt - Number(payment.amount)) > 0.01) {
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

  // ── 5. Statusa görə əməl et ──────────────────────────────────────────
  if (payload.status === "success") {
    const meta = (payment.metadata ?? {}) as Record<string, unknown>;
    const purpose = (meta.purpose as string | undefined) ?? "balance_topup";

    let postErr: { message: string } | null = null;

    if (purpose === "service_promotion") {
      // Service promotion — apply_service_promotion RPC çağır
      const { error } = await supabase.rpc("apply_service_promotion", {
        p_service_id:        meta.service_id ?? null,
        p_promotion_type:    meta.promotion_type ?? null,
        p_promotion_days:    meta.promotion_duration ?? null,
        p_payment_id:        payment.id,
      });
      postErr = error;
    } else {
      // Default: balance top-up
      const { error } = await supabase.rpc("credit_balance", {
        p_user_id:    payment.user_id,
        p_amount:     payment.amount,
        p_payment_id: payment.id,
        p_reason:     payment.description ?? "Balance top-up",
      });
      postErr = error;
    }

    if (postErr) {
      // Crediting/promotion failed — payment-ı failed olaraq qeyd et, manual reconcile lazımdır
      await supabase
        .from("payments")
        .update({
          status: "failed",
          metadata: {
            ...meta,
            post_error: postErr.message,
          },
        })
        .eq("id", payment.id);
      return new Response(`Post-payment action failed: ${postErr.message}`, { status: 500 });
    }

    await supabase
      .from("payments")
      .update({
        status:       "completed",
        completed_at: new Date().toISOString(),
        metadata: {
          ...meta,
          epoint_payload: payload,
        },
      })
      .eq("id", payment.id);

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...cors, "Content-Type": "application/json" },
    });
  } else {
    // failed / cancelled
    await supabase
      .from("payments")
      .update({
        status: payload.status === "cancelled" ? "cancelled" : "failed",
        metadata: {
          ...(payment.metadata as object),
          epoint_payload: payload,
        },
      })
      .eq("id", payment.id);

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }
});
