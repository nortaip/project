// ============================================================================
// Edge Function: payment-webhook
//
// Epoint sənədinə uyğun (Epoint-API-AZ.pdf):
//
//   1. Signature yoxlama:
//        signature = base64_encode(sha1(private_key + data + private_key, 1))
//   2. Data decode: result = json_decode(base64_decode(data))
//   3. İki callback növü:
//        a) Payment callback (səh. 4-5):  order_id, status, code, transaction,
//           bank_transaction, operation_code (100 = payment), rrn, card_name,
//           card_mask, amount
//        b) Card registration callback (səh. 9): status, code, card_id,
//           bank_transaction, operation_code (001 = registration), rrn,
//           card_mask  — order_id YOXDUR! description-dan parse edirik
//
// IMPORTANT: `--no-verify-jwt` ilə deploy olunur. Bank JWT göndərmir.
//
// Secrets: EPOINT_PRIVATE_KEY (web), EPOINT_MOBILE_PRIVATE_KEY (mobil — optional),
//          SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//
// Webhook URL hər iki cabinet (web + mobil) üçün eynidir. Hansı cabinet-dən
// callback gəldiyini ayırd etmək üçün signature-i HƏR İKİ private_key ilə
// yoxlayırıq — uyğun gələn açar callback-in mənbəyini göstərir.
// ============================================================================

import { createClient } from "npm:@supabase/supabase-js@2";

interface EpointPayload {
  // Common
  status?: "success" | "failed" | "cancelled" | string;
  code?: string;
  transaction?: string;
  bank_transaction?: string;
  operation_code?: string;  // "001" = card registration, "100" = payment, "200" = card-reg + first payment
  rrn?: string;
  card_mask?: string;
  card_name?: string;
  message?: string;
  // Payment-specific
  order_id?: string;
  amount?: string | number;
  // Card-registration specific
  card_id?: string;
  // description (varsa) — bizim göndərdiyimiz string echo olunur
  description?: string;
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

async function epointSign(dataB64: string, privateKey: string): Promise<string> {
  const sigBuf = await crypto.subtle.digest(
    "SHA-1",
    new TextEncoder().encode(`${privateKey}${dataB64}${privateKey}`),
  );
  return base64Encode(new Uint8Array(sigBuf));
}

/**
 * description-dan `pid:<uuid>` və `uid:<uuid>` çıxarır.
 * Format: "Ellit payout card | uid:abc-123 | pid:xyz-456"
 */
function parseDescriptionTags(desc: string): { uid?: string; pid?: string } {
  const out: { uid?: string; pid?: string } = {};
  const uidMatch = desc.match(/uid:([a-f0-9-]+)/i);
  const pidMatch = desc.match(/pid:([a-f0-9-]+)/i);
  if (uidMatch) out.uid = uidMatch[1];
  if (pidMatch) out.pid = pidMatch[1];
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cors });
  }
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  try {
    const epointPrivateWeb = Deno.env.get("EPOINT_PRIVATE_KEY");
    const epointPrivateMobile = Deno.env.get("EPOINT_MOBILE_PRIVATE_KEY");
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if ((!epointPrivateWeb && !epointPrivateMobile) || !supabaseUrl || !serviceRole) {
      return new Response("Server misconfigured", { status: 500 });
    }

    // ── 1. Body parse (form-urlencoded / JSON) ───────────────────────
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

    // ── 2. Signature yoxla — web və mobil açarlarının hər ikisini sına ─
    let matchedPlatform: "web" | "mobile" | null = null;
    if (epointPrivateWeb) {
      const sigWeb = await epointSign(dataB64, epointPrivateWeb);
      if (sigWeb === signature) matchedPlatform = "web";
    }
    if (!matchedPlatform && epointPrivateMobile) {
      const sigMobile = await epointSign(dataB64, epointPrivateMobile);
      if (sigMobile === signature) matchedPlatform = "mobile";
    }
    if (!matchedPlatform) {
      return new Response("Invalid signature", { status: 401 });
    }

    // ── 3. Payload decode ────────────────────────────────────────────
    let payload: EpointPayload;
    try {
      payload = JSON.parse(base64DecodeToString(dataB64));
    } catch {
      return new Response("Invalid payload", { status: 400 });
    }

    const supabase = createClient(supabaseUrl, serviceRole);

    // ──────────────────────────────────────────────────────────────────
    //   CARD REGISTRATION CALLBACK
    //   operation_code === "001"  (sənəd səh. 9)
    //   order_id yox, ama bizim description-da pid: var
    // ──────────────────────────────────────────────────────────────────
    const isCardRegistration =
      String(payload.operation_code) === "001" ||
      // Backup detection: card_id var və amount yoxdur
      (!!payload.card_id && payload.amount == null);

    if (isCardRegistration) {
      const tags = parseDescriptionTags(payload.description ?? "");
      const paymentId = tags.pid;
      const userId = tags.uid;

      if (!paymentId && !userId) {
        return new Response("Cannot resolve card registration (no pid/uid in description)", {
          status: 400,
        });
      }

      // payment row tap
      let paymentRow: { id: string; user_id: string; metadata: Record<string, unknown> | null; status: string } | null = null;
      if (paymentId) {
        const { data } = await supabase
          .from("payments")
          .select("id, user_id, metadata, status")
          .eq("id", paymentId)
          .single();
        paymentRow = data;
      }

      // Fallback: pid uyğun gəlmirsə, uid-ə görə son pending card_registration row tap
      if (!paymentRow && userId) {
        const { data } = await supabase
          .from("payments")
          .select("id, user_id, metadata, status")
          .eq("user_id", userId)
          .eq("status", "pending")
          .contains("metadata", { purpose: "card_registration" })
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        paymentRow = data;
      }

      if (!paymentRow) {
        return new Response("Card registration payment row not found", { status: 404 });
      }

      // Idempotency
      if (paymentRow.status === "completed") {
        return new Response(JSON.stringify({ ok: true, idempotent: true }), {
          headers: { ...cors, "Content-Type": "application/json" },
        });
      }

      const meta = (paymentRow.metadata ?? {}) as Record<string, unknown>;

      if (payload.status === "success" && payload.card_id) {
        const { error: updErr } = await supabase
          .from("profiles")
          .update({
            epoint_card_uid: String(payload.card_id),
            ...(payload.card_mask
              ? { epoint_card_mask: String(payload.card_mask) }
              : {}),
          })
          .eq("id", paymentRow.user_id);

        if (updErr) {
          await supabase.from("payments").update({
            status: "failed",
            metadata: { ...meta, post_error: updErr.message, epoint_payload: payload },
          }).eq("id", paymentRow.id);
          return new Response(`Profile update failed: ${updErr.message}`, { status: 500 });
        }

        await supabase.from("payments").update({
          status: "completed",
          completed_at: new Date().toISOString(),
          metadata: { ...meta, epoint_payload: payload },
        }).eq("id", paymentRow.id);

        return new Response(JSON.stringify({ ok: true, card_registered: true }), {
          headers: { ...cors, "Content-Type": "application/json" },
        });
      }

      // Failure / cancelled
      await supabase.from("payments").update({
        status: payload.status === "cancelled" ? "cancelled" : "failed",
        metadata: { ...meta, epoint_payload: payload },
      }).eq("id", paymentRow.id);

      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    // ──────────────────────────────────────────────────────────────────
    //   PAYMENT CALLBACK
    //   order_id ilə tapırıq (sənəd səh. 5)
    // ──────────────────────────────────────────────────────────────────
    if (!payload.order_id) {
      return new Response("Missing order_id", { status: 400 });
    }

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

    // Məbləğ uyğunluğu (defense-in-depth)
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
