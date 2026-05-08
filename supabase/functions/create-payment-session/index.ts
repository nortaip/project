// ============================================================================
// Edge Function: create-payment-session
//
// İstifadəçi balansa pul yükləmək istəyəndə çağrılır. JWT əsaslıdır —
// həm web (React) həm mobile (Flutter) eyni endpoint istifadə edir.
//
// Axın:
//   1. Client: POST /functions/v1/create-payment-session  { amount: 50, currency: 'AZN' }
//   2. Function: JWT-dən user_id çıxarır
//   3. payments cədvəlinə pending row insert (service_role ilə)
//   4. Bank gateway (Epoint) sessiyası yaradır
//   5. redirect_url qaytarır → client istifadəçini banka yönləndirir
//   6. Bank ödənişdən sonra payment-webhook-u çağırır
//
// Tələb olunan secrets (Supabase Dashboard → Project Settings → Edge Functions → Secrets):
//   EPOINT_PUBLIC_KEY    — Epoint merchant public key
//   EPOINT_PRIVATE_KEY   — Epoint merchant private key (signature üçün)
//   PAYMENT_RETURN_URL   — uğurdan sonra istifadəçi geri qayıdacaq URL
//                          web:    https://ellit.az/payment/result
//                          mobile: ellitbooking://payment/result
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { encode as base64Encode } from "https://deno.land/std@0.224.0/encoding/base64.ts";

interface RequestBody {
  amount: number;
  currency?: string;
  description?: string;
  return_url?: string;     // mobile-də custom scheme override
}

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: cors });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  // ── 1. Auth: JWT-dən user_id çıxar ───────────────────────────────────
  const auth = req.headers.get("Authorization");
  if (!auth) return json({ error: "Missing Authorization" }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: auth } },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData?.user) {
    return json({ error: "Invalid token" }, 401);
  }
  const user = userData.user;

  // ── 2. Body validate ─────────────────────────────────────────────────
  let body: RequestBody;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const amount = Number(body.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    return json({ error: "Invalid amount" }, 400);
  }
  if (amount > 10_000) {
    return json({ error: "Amount exceeds limit (10000 AZN)" }, 400);
  }
  const currency = (body.currency ?? "AZN").toUpperCase();

  // ── 3. payments-ə pending row insert (service_role ilə) ──────────────
  const adminClient = createClient(supabaseUrl, serviceRole);
  const { data: payment, error: insErr } = await adminClient
    .from("payments")
    .insert({
      user_id: user.id,
      amount,
      currency,
      status: "pending",
      provider: "epoint",
      description: body.description ?? "Balance top-up",
      metadata: {
        return_url: body.return_url ?? null,
        client_ip: req.headers.get("x-forwarded-for") ?? null,
        user_agent: req.headers.get("user-agent") ?? null,
      },
    })
    .select()
    .single();
  if (insErr || !payment) {
    return json({ error: "Failed to create payment row", details: insErr?.message }, 500);
  }

  // ── 4. Epoint sessiyası yarat ────────────────────────────────────────
  const epointPublic = Deno.env.get("EPOINT_PUBLIC_KEY");
  const epointPrivate = Deno.env.get("EPOINT_PRIVATE_KEY");
  const returnUrl =
    body.return_url ??
    Deno.env.get("PAYMENT_RETURN_URL") ??
    `${supabaseUrl}/functions/v1/payment-webhook?fallback=1`;

  if (!epointPublic || !epointPrivate) {
    // ⚠ Dev/test rejimi — bank inteqrasiyası hələ qoşulmayıb.
    // Real Epoint key qoyulanda bu blok skip olunacaq.
    return json({
      payment_id: payment.id,
      redirect_url: null,
      mode: "test",
      message: "Payment gateway not configured. Set EPOINT_PUBLIC_KEY / EPOINT_PRIVATE_KEY secrets.",
    });
  }

  const epointBody = {
    public_key: epointPublic,
    amount: amount.toFixed(2),
    currency,
    language: "az",
    order_id: payment.id,
    description: body.description ?? "Balance top-up",
    success_redirect_url: returnUrl,
    error_redirect_url: returnUrl,
  };

  const dataB64 = base64Encode(new TextEncoder().encode(JSON.stringify(epointBody)));
  const signatureSource = `${epointPrivate}${dataB64}${epointPrivate}`;
  const signatureBuf = await crypto.subtle.digest(
    "SHA-1",
    new TextEncoder().encode(signatureSource),
  );
  const signature = base64Encode(new Uint8Array(signatureBuf));

  const epointResp = await fetch("https://epoint.az/api/1/request", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ data: dataB64, signature }),
  });
  const epointJson = await epointResp.json().catch(() => ({}));

  if (!epointResp.ok || epointJson?.status !== "success") {
    await adminClient
      .from("payments")
      .update({
        status: "failed",
        metadata: { ...(payment.metadata as object), epoint_error: epointJson },
      })
      .eq("id", payment.id);
    return json({ error: "Gateway error", details: epointJson }, 502);
  }

  // External_id-ni saxla
  await adminClient
    .from("payments")
    .update({ external_id: epointJson.transaction ?? null })
    .eq("id", payment.id);

  return json({
    payment_id: payment.id,
    redirect_url: epointJson.redirect_url,
    transaction_id: epointJson.transaction,
  });
});

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}
