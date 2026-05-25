// ============================================================================
// Edge Function: verify-payment
//
// Webhook callback gəlməsə də ödənişin statusunu Epoint-dən birbaşa
// soruşmaq + balansa credit etmək üçün fallback mexanizm.
//
// Epoint sənədi (Epoint-API-AZ.pdf, səh. 8):
//   POST https://epoint.az/api/1/get-status
//   body: { data: base64(json), signature: sha1(privatekey+data+privatekey) }
//   json: { public_key, transaction }
//   response: { status, code, transaction, amount, ... }
//
// İstifadə (app tərəfindən):
//   POST .../functions/v1/verify-payment
//   body: { payment_id: '...' }
//
// Logic:
//   1. payments.id ilə row tap, external_id (Epoint transaction) götür
//   2. Epoint get-status soruşur
//   3. status === 'success' isə:
//      - credit_balance / lock_offer_payment / apply_service_promotion
//        purpose-a görə RPC çağır
//      - payments status = 'completed'
//   4. Cavab qaytar (yeni balans, status)
// ============================================================================

import { createClient } from "npm:@supabase/supabase-js@2";

const ALLOWED_ORIGINS = new Set([
  "https://ellit.az",
  "https://www.ellit.az",
  "http://localhost:5173",
  "http://localhost:3000",
]);

function corsHeaders(origin: string | null): Record<string, string> {
  const allow = origin && ALLOWED_ORIGINS.has(origin) ? origin : "*";
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

function json(payload: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...headers, "Content-Type": "application/json" },
  });
}

function base64Encode(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(s);
}

async function epointSign(dataB64: string, privateKey: string): Promise<string> {
  const buf = await crypto.subtle.digest(
    "SHA-1",
    new TextEncoder().encode(`${privateKey}${dataB64}${privateKey}`),
  );
  return base64Encode(new Uint8Array(buf));
}

function epointEncode(payload: Record<string, string>): string {
  return base64Encode(new TextEncoder().encode(JSON.stringify(payload)));
}

interface EpointStatusResponse {
  status?: string;        // 'new' | 'success' | 'returned' | 'error' | 'server_error'
  code?: string;
  transaction?: string;
  bank_transaction?: string;
  bank_response?: string;
  operation_code?: string;
  rrn?: string;
  card_name?: string;
  card_mask?: string;
  amount?: string | number;
  message?: string;
}

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin");
  const cors = corsHeaders(origin);

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cors });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405, cors);
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const epointPublicWeb = Deno.env.get("EPOINT_PUBLIC_KEY");
    const epointPrivateWeb = Deno.env.get("EPOINT_PRIVATE_KEY");
    const epointPublicMobile = Deno.env.get("EPOINT_MOBILE_PUBLIC_KEY");
    const epointPrivateMobile = Deno.env.get("EPOINT_MOBILE_PRIVATE_KEY");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");

    if (!supabaseUrl || !serviceRole || !anonKey ||
        (!epointPublicWeb && !epointPublicMobile) ||
        (!epointPrivateWeb && !epointPrivateMobile)) {
      return json({ error: "Server misconfigured" }, 500, cors);
    }

    // Caller (auth-required)
    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData } = await userClient.auth.getUser();
    const caller = userData?.user;
    if (!caller) return json({ error: "NOT_AUTHENTICATED" }, 401, cors);

    const body = await req.json().catch(() => ({}));
    const paymentId = body?.payment_id;
    if (!paymentId) return json({ error: "MISSING_PAYMENT_ID" }, 400, cors);

    const admin = createClient(supabaseUrl, serviceRole);

    // Payment row
    const { data: payment, error: pErr } = await admin
      .from("payments")
      .select("*")
      .eq("id", paymentId)
      .single();

    if (pErr || !payment) return json({ error: "PAYMENT_NOT_FOUND" }, 404, cors);

    // Authorization — yalnız ödənişi yaradan user (admin də olar)
    if (payment.user_id !== caller.id) {
      // role yoxla
      const { data: profile } = await admin
        .from("profiles")
        .select("role")
        .eq("id", caller.id)
        .maybeSingle();
      const role = String(profile?.role ?? "").toLowerCase();
      if (role !== "admin" && role !== "support") {
        return json({ error: "NOT_AUTHORIZED" }, 403, cors);
      }
    }

    // Idempotency — artıq tamamlanıbsa, payment_id+status qaytar
    if (payment.status === "completed") {
      return json({ ok: true, status: "completed", already_completed: true }, 200, cors);
    }

    const transactionId = payment.external_id;
    if (!transactionId) {
      return json({ ok: false, error: "NO_TRANSACTION_ID", payment_status: payment.status }, 200, cors);
    }

    // Platform-a görə açar cütünü seç (metadata-da yazılır create-payment-session-də)
    const paymentMeta = (payment.metadata ?? {}) as Record<string, unknown>;
    const paymentPlatform = paymentMeta.platform === "mobile" ? "mobile" : "web";
    const epointPublic = paymentPlatform === "mobile"
      ? (epointPublicMobile ?? epointPublicWeb)
      : (epointPublicWeb ?? epointPublicMobile);
    const epointPrivate = paymentPlatform === "mobile"
      ? (epointPrivateMobile ?? epointPrivateWeb)
      : (epointPrivateWeb ?? epointPrivateMobile);
    if (!epointPublic || !epointPrivate) {
      return json({ error: "Server misconfigured (no key for platform)" }, 500, cors);
    }

    // Epoint get-status
    const epointBody = {
      public_key: epointPublic,
      transaction: String(transactionId),
    };
    const dataB64 = epointEncode(epointBody);
    const signature = await epointSign(dataB64, epointPrivate);

    const epointResp = await fetch("https://epoint.az/api/1/get-status", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ data: dataB64, signature }),
    });

    const epointJson: EpointStatusResponse = await epointResp.json().catch(() => ({}));

    if (!epointResp.ok) {
      return json({ ok: false, error: "EPOINT_HTTP_ERROR", status: epointResp.status, epoint: epointJson }, 200, cors);
    }

    // Status haqqında qərar
    const epStatus = String(epointJson.status ?? "").toLowerCase();

    if (epStatus !== "success") {
      // failed / new / error / returned
      if (epStatus === "error" || epStatus === "returned" || epStatus === "server_error") {
        await admin
          .from("payments")
          .update({
            status: epStatus === "returned" ? "refunded" : "failed",
            metadata: {
              ...(payment.metadata as object),
              epoint_status_check: epointJson,
              checked_at: new Date().toISOString(),
            },
          })
          .eq("id", payment.id);
      }
      return json({
        ok: false,
        epoint_status: epStatus,
        message: epointJson.message ?? null,
        payment_status: payment.status,
      }, 200, cors);
    }

    // Məbləğ uyğunluğu (defense-in-depth)
    if (epointJson.amount !== undefined && epointJson.amount !== null) {
      const epAmount = Number(epointJson.amount);
      if (Number.isFinite(epAmount) && Math.abs(epAmount - Number(payment.amount)) > 0.01) {
        await admin
          .from("payments")
          .update({
            status: "failed",
            metadata: {
              ...(payment.metadata as object),
              amount_mismatch: { expected: payment.amount, received: epointJson.amount },
            },
          })
          .eq("id", payment.id);
        return json({ ok: false, error: "AMOUNT_MISMATCH" }, 200, cors);
      }
    }

    // Purpose-a görə RPC seç
    const meta = (payment.metadata ?? {}) as Record<string, unknown>;
    const purpose = (meta.purpose as string | undefined) ?? "balance_topup";

    let rpcErr: { message: string } | null = null;

    if (purpose === "service_promotion") {
      const { error } = await admin.rpc("apply_service_promotion", {
        p_service_id: meta.service_id ?? null,
        p_promotion_type: meta.promotion_type ?? null,
        p_promotion_days: meta.promotion_duration ?? null,
        p_payment_id: payment.id,
      });
      rpcErr = error;
    } else if (purpose === "service_payment") {
      const { error } = await admin.rpc("lock_offer_payment", {
        p_offer_id: meta.offer_id ?? null,
        p_amount: payment.amount,
        p_payment_id: payment.id,
      });
      rpcErr = error;
    } else {
      // balance_topup (default)
      const { error } = await admin.rpc("credit_balance", {
        p_user_id: payment.user_id,
        p_amount: payment.amount,
        p_payment_id: payment.id,
        p_reason: payment.description ?? "Balance top-up (recovered)",
      });
      rpcErr = error;
    }

    if (rpcErr) {
      await admin
        .from("payments")
        .update({
          status: "failed",
          metadata: { ...meta, recovery_error: rpcErr.message },
        })
        .eq("id", payment.id);
      return json({ ok: false, error: "RPC_FAILED", details: rpcErr.message }, 200, cors);
    }

    // Payment-i tamamla
    await admin
      .from("payments")
      .update({
        status: "completed",
        completed_at: new Date().toISOString(),
        metadata: {
          ...meta,
          recovered_via: "verify-payment",
          epoint_status_check: epointJson,
        },
      })
      .eq("id", payment.id);

    // Yeni balans
    const { data: prof } = await admin
      .from("profiles")
      .select("balance")
      .eq("id", payment.user_id)
      .maybeSingle();

    return json({
      ok: true,
      status: "completed",
      credited_amount: Number(payment.amount),
      new_balance: prof?.balance ?? null,
      purpose,
    }, 200, cors);
  } catch (e) {
    console.error("verify-payment fatal:", e);
    return json(
      { error: "Internal error", details: e instanceof Error ? e.message : String(e) },
      500,
    );
  }
});
