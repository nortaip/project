
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { encode as base64Encode } from "https://deno.land/std@0.224.0/encoding/base64.ts";

interface RequestBody {
  amount: number;
  currency?: string;
  description?: string;
  return_url?: string;     // mobile-də custom scheme override
  purpose?: "balance_topup" | "service_promotion";
  /**
   * service_promotion üçün metadata. Server tərəfdə bu field-lər
   * payments.metadata-ya yazılır və webhook tamamlandıqda istifadə olunur.
   */
  service_id?: string;
  promotion_type?: "vip" | "premium";
  promotion_duration?: number;
}

const ALLOWED_ORIGINS = new Set([
  "https://ellit.az",
  "https://www.ellit.az",
  "http://localhost:5173",
  "http://localhost:3000",
]);

function corsHeaders(origin: string | null): Record<string, string> {
  const allow = origin && ALLOWED_ORIGINS.has(origin) ? origin : "https://ellit.az";
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

/**
 * service_promotion ödənişlərində server-side qiymət hesablanır.
 * Client price göndərə bilməz — formanın seçimləri buradan validate olunur.
 */
const PROMOTION_PRICE: Record<string, Record<number, number>> = {
  vip:     { 5: 5,  10: 10, 30: 25 },
  premium: { 5: 10, 15: 30, 30: 45 },
};

Deno.serve(async (req) => {
  const cors = corsHeaders(req.headers.get("Origin"));
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: cors });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405, cors);
  }

  // ── 1. Auth: JWT-dən user_id çıxar ───────────────────────────────────
  const auth = req.headers.get("Authorization");
  if (!auth) return json({ error: "Missing Authorization" }, 401, cors);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: auth } },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData?.user) {
    return json({ error: "Invalid token" }, 401, cors);
  }
  const user = userData.user;

  // ── 2. Body validate ─────────────────────────────────────────────────
  let body: RequestBody;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400, cors);
  }

  const purpose = body.purpose ?? "balance_topup";
  const currency = (body.currency ?? "AZN").toUpperCase();

  // Server-side qiymət hesablama (client trust etmirik) ────────────────
  let amount: number;
  let description: string;
  if (purpose === "service_promotion") {
    if (!body.service_id || !body.promotion_type || !body.promotion_duration) {
      return json({ error: "Missing service_id / promotion_type / promotion_duration" }, 400, cors);
    }
    const tier = PROMOTION_PRICE[body.promotion_type];
    const price = tier?.[body.promotion_duration];
    if (!price) {
      return json({ error: "Invalid promotion tier/duration" }, 400, cors);
    }
    amount = price;
    description = `${body.promotion_type.toUpperCase()} promotion (${body.promotion_duration} gün)`;

    // service-in sahibinin user olduğunu yoxla
    const adminCheck = createClient(supabaseUrl, serviceRole);
    const { data: svc, error: svcErr } = await adminCheck
      .from("services")
      .select("id, provider_id")
      .eq("id", body.service_id)
      .single();
    if (svcErr || !svc) {
      return json({ error: "Service not found" }, 404, cors);
    }
    if (svc.provider_id !== user.id) {
      return json({ error: "Forbidden — not service owner" }, 403, cors);
    }
  } else {
    amount = Number(body.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      return json({ error: "Invalid amount" }, 400, cors);
    }
    if (amount > 10_000) {
      return json({ error: "Amount exceeds limit (10000 AZN)" }, 400, cors);
    }
    description = body.description ?? "Balance top-up";
  }

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
      description,
      metadata: {
        purpose,
        service_id: body.service_id ?? null,
        promotion_type: body.promotion_type ?? null,
        promotion_duration: body.promotion_duration ?? null,
        return_url: body.return_url ?? null,
        client_ip: req.headers.get("x-forwarded-for") ?? null,
        user_agent: req.headers.get("user-agent") ?? null,
      },
    })
    .select()
    .single();
  if (insErr || !payment) {
    return json({ error: "Failed to create payment row", details: insErr?.message }, 500, cors);
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
    }, 200, cors);
  }

  const epointBody = {
    public_key: epointPublic,
    amount: amount.toFixed(2),
    currency,
    language: "az",
    order_id: payment.id,
    description,
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
        metadata: { ...(payment.metadata as object), epoint_error: { code: epointJson?.code ?? null } },
      })
      .eq("id", payment.id);
    return json({ error: "Gateway error" }, 502, cors);
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
  }, 200, cors);
});

function json(payload: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...headers, "Content-Type": "application/json" },
  });
}
