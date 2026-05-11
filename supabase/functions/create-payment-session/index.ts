// ============================================================================
// Edge Function: create-payment-session
//
// Customer / provider kart ödənişi başladıqda Epoint sessiyası açır və
// `payments` cədvəlində `pending` row yaradır. `purpose`-a görə davranış:
//
//   balance_topup     — webhook `credit_balance` çağırır
//   service_payment   — webhook `lock_offer_payment` çağırır (escrow)
//   service_promotion — webhook `apply_service_promotion` çağırır
//
// IMPORTANT: `verify_jwt = false` ilə deploy olunur (config.toml-da yazılıb)
// çünki OPTIONS preflight Authorization header daşımır. JWT-ni biz manual
// yoxlayırıq.
// ============================================================================

import { createClient } from "npm:@supabase/supabase-js@2";

interface RequestBody {
  amount?: number;
  currency?: string;
  description?: string;
  return_url?: string;
  purpose?: "balance_topup" | "service_promotion" | "service_payment";
  service_id?: string;
  promotion_type?: "vip" | "premium";
  promotion_duration?: number;
  offer_id?: string;
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
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}

const PROMOTION_PRICE: Record<string, Record<number, number>> = {
  vip: { 5: 5, 10: 10, 30: 25 },
  premium: { 5: 10, 15: 30, 30: 45 },
};

function json(payload: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...headers, "Content-Type": "application/json" },
  });
}

// Base64 encode using Web Standard APIs (no external dep)
function base64Encode(bytes: Uint8Array): string {
  let str = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    str += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(str);
}

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin");
  const cors = corsHeaders(origin);

  // ── 0. OPTIONS preflight: ən birinci, heç bir DB / auth toxunmadan ────
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cors });
  }

  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405, cors);
  }

  try {
    // ── 1. ENV oxu ─────────────────────────────────────────────────────
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    if (!supabaseUrl || !serviceRole || !anonKey) {
      return json({ error: "Server misconfigured (missing Supabase env)" }, 500, cors);
    }

    // ── 2. Auth: JWT-dən user_id çıxar ────────────────────────────────
    const auth = req.headers.get("Authorization");
    if (!auth) return json({ error: "Missing Authorization" }, 401, cors);

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: auth } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) {
      return json({ error: "Invalid token" }, 401, cors);
    }
    const user = userData.user;

    // ── 3. Body parse ──────────────────────────────────────────────────
    let body: RequestBody;
    try {
      body = (await req.json()) as RequestBody;
    } catch {
      return json({ error: "Invalid JSON" }, 400, cors);
    }

    const purpose = body.purpose ?? "balance_topup";
    const currency = (body.currency ?? "AZN").toUpperCase();

    // ── 4. Məbləği server-tərəfində hesabla ──────────────────────────
    const adminClient = createClient(supabaseUrl, serviceRole);
    let amount: number;
    let description: string;

    if (purpose === "service_promotion") {
      if (!body.service_id || !body.promotion_type || !body.promotion_duration) {
        return json(
          { error: "Missing service_id / promotion_type / promotion_duration" },
          400,
          cors,
        );
      }
      const tier = PROMOTION_PRICE[body.promotion_type];
      const price = tier?.[body.promotion_duration];
      if (!price) {
        return json({ error: "Invalid promotion tier/duration" }, 400, cors);
      }
      amount = price;
      description = `${body.promotion_type.toUpperCase()} promotion (${body.promotion_duration} gün)`;

      const { data: svc, error: svcErr } = await adminClient
        .from("services")
        .select("id, provider_id")
        .eq("id", body.service_id)
        .single();
      if (svcErr || !svc) return json({ error: "Service not found" }, 404, cors);
      if (svc.provider_id !== user.id) {
        return json({ error: "Forbidden — not service owner" }, 403, cors);
      }
    } else if (purpose === "service_payment") {
      if (!body.offer_id) {
        return json({ error: "Missing offer_id for service_payment" }, 400, cors);
      }
      const { data: offer, error: offerErr } = await adminClient
        .from("opportunities_offers")
        .select("id, offer_amount, opportunity_id, status")
        .eq("id", body.offer_id)
        .single();
      if (offerErr || !offer) return json({ error: "Offer not found" }, 404, cors);
      if (offer.status === "completed" || offer.status === "rejected") {
        return json({ error: "Offer is not payable" }, 400, cors);
      }
      const { data: opp } = await adminClient
        .from("opportunities")
        .select("created_by")
        .eq("id", offer.opportunity_id)
        .single();
      if (!opp || opp.created_by !== user.id) {
        return json({ error: "Forbidden — not opportunity owner" }, 403, cors);
      }
      amount = Number(offer.offer_amount);
      description =
        body.description ?? `Sifariş ödənişi (offer ${body.offer_id.slice(0, 8)})`;
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

    // ── 5. payments-ə pending row insert ─────────────────────────────
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
          offer_id: body.offer_id ?? null,
          return_url: body.return_url ?? null,
          client_ip: req.headers.get("x-forwarded-for") ?? null,
          user_agent: req.headers.get("user-agent") ?? null,
        },
      })
      .select()
      .single();
    if (insErr || !payment) {
      return json(
        { error: "Failed to create payment row", details: insErr?.message },
        500,
        cors,
      );
    }

    // ── 6. Epoint sessiyası ────────────────────────────────────────────
    const epointPublic = Deno.env.get("EPOINT_PUBLIC_KEY");
    const epointPrivate = Deno.env.get("EPOINT_PRIVATE_KEY");
    const returnUrl =
      body.return_url ??
      Deno.env.get("PAYMENT_RETURN_URL") ??
      `${supabaseUrl}/functions/v1/payment-webhook?fallback=1`;

    if (!epointPublic || !epointPrivate) {
      return json(
        {
          payment_id: payment.id,
          redirect_url: null,
          mode: "test",
          message:
            "Payment gateway not configured. Set EPOINT_PUBLIC_KEY / EPOINT_PRIVATE_KEY secrets.",
        },
        200,
        cors,
      );
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
          metadata: {
            ...(payment.metadata as object),
            epoint_error: { code: epointJson?.code ?? null },
          },
        })
        .eq("id", payment.id);
      return json({ error: "Gateway error" }, 502, cors);
    }

    await adminClient
      .from("payments")
      .update({ external_id: epointJson.transaction ?? null })
      .eq("id", payment.id);

    return json(
      {
        payment_id: payment.id,
        redirect_url: epointJson.redirect_url,
        transaction_id: epointJson.transaction,
      },
      200,
      cors,
    );
  } catch (e) {
    // Heç bir halda 503 qaytarmayaq — function özü işləyir, problem business logic-də idi
    console.error("create-payment-session fatal:", e);
    return json(
      { error: "Internal error", details: e instanceof Error ? e.message : String(e) },
      500,
      cors,
    );
  }
});
