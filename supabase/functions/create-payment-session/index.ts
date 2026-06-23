// ============================================================================
// Edge Function: create-payment-session
//
// Epoint sənədinə (Epoint-API-AZ.pdf) sıxı uyğun yazılıb.
// Üç endpoint istifadə olunur:
//
//   /api/1/request           — ödəniş sessiyası (balance_topup / service_payment
//                              / service_promotion)
//   /api/1/card-registration — kart qeydiyyatı (refund=1 → payout üçün)
//
// IMPORTANT: Epoint bütün sahələri JSON-da STRING kimi gözləyir (sənəddə
// nümunələrdə `amount: "30.75"` yazılır). Number göndərsək Epoint bəzən
// fail edir. Ona görə bütün sahələri string-ə çeviririk.
// ============================================================================

import { createClient } from "npm:@supabase/supabase-js@2";

interface RequestBody {
  amount?: number;
  currency?: string;
  description?: string;
  return_url?: string;
  purpose?:
    | "balance_topup"
    | "service_promotion"
    | "service_payment"
    | "card_registration";
  service_id?: string;
  promotion_type?: "vip" | "premium";
  promotion_duration?: number;
  offer_id?: string;
  // Hansı Epoint hesabından istifadə olunsun. Mobil app "mobile" göndərir.
  // Göndərilmirsə, return_url sxemindən (ellitbooking://) avtomatik aşkarlanır.
  channel?: "web" | "mobile";
}

/**
 * İki Epoint hesabı dəstəyi.
 *
 * - Web (ellit.az):  EPOINT_PUBLIC_KEY / EPOINT_PRIVATE_KEY
 * - Mobil app:       EPOINT_PUBLIC_KEY_MOBILE / EPOINT_PRIVATE_KEY_MOBILE
 *
 * Mobil açarlar qoyulmayıbsa, web açarlarına geri qayıdır (tək hesab
 * konfiqurasiyası sınmasın). Webhook hər iki private key-i sınadığı üçün
 * callback istənilən hesabdan gəlsə də imza doğru yoxlanır.
 */
function resolveEpointCreds(
  body: RequestBody,
): { publicKey?: string; privateKey?: string; account: "web" | "mobile" } {
  const ret = body.return_url ?? "";
  const isMobile = body.channel === "mobile" || ret.startsWith("ellitbooking://");
  if (isMobile) {
    return {
      publicKey:
        Deno.env.get("EPOINT_PUBLIC_KEY_MOBILE") ?? Deno.env.get("EPOINT_PUBLIC_KEY"),
      privateKey:
        Deno.env.get("EPOINT_PRIVATE_KEY_MOBILE") ?? Deno.env.get("EPOINT_PRIVATE_KEY"),
      account: "mobile",
    };
  }
  return {
    publicKey: Deno.env.get("EPOINT_PUBLIC_KEY"),
    privateKey: Deno.env.get("EPOINT_PRIVATE_KEY"),
    account: "web",
  };
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

function base64Encode(bytes: Uint8Array): string {
  let str = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    str += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(str);
}

/**
 * Epoint sənədinə görə signature yaratma:
 *   signature = base64_encode( sha1( private_key + data + private_key, 1 ) )
 * Burada `1` raw binary output deməkdir (hex string deyil).
 */
async function epointSign(dataB64: string, privateKey: string): Promise<string> {
  const sigSource = `${privateKey}${dataB64}${privateKey}`;
  const sigBuf = await crypto.subtle.digest(
    "SHA-1",
    new TextEncoder().encode(sigSource),
  );
  return base64Encode(new Uint8Array(sigBuf));
}

/**
 * `data` parametri = base64( JSON.stringify(payload) )
 */
function epointEncode(payload: Record<string, string>): string {
  return base64Encode(new TextEncoder().encode(JSON.stringify(payload)));
}

/** Bütün dəyərləri string-ə çevirir (Epoint format) */
function stringifyAll(obj: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v == null) continue;
    out[k] = String(v);
  }
  return out;
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
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    if (!supabaseUrl || !serviceRole || !anonKey) {
      return json({ error: "Server misconfigured (missing Supabase env)" }, 500, cors);
    }

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

    let body: RequestBody;
    try {
      body = (await req.json()) as RequestBody;
    } catch {
      return json({ error: "Invalid JSON" }, 400, cors);
    }

    const purpose = body.purpose ?? "balance_topup";
    const currency = (body.currency ?? "AZN").toUpperCase();
    const adminClient = createClient(supabaseUrl, serviceRole);

    const epointCreds = resolveEpointCreds(body);
    const epointPublic = epointCreds.publicKey;
    const epointPrivate = epointCreds.privateKey;
    const defaultReturnUrl =
      body.return_url ??
      Deno.env.get("PAYMENT_RETURN_URL") ??
      `${supabaseUrl}/functions/v1/payment-webhook?fallback=1`;

    // ──────────────────────────────────────────────────────────────────
    //   CARD REGISTRATION (refund kartı = payout üçün)
    //   Epoint sənədi səh. 8-9
    // ──────────────────────────────────────────────────────────────────
    if (purpose === "card_registration") {
      if (!epointPublic || !epointPrivate) {
        return json({ error: "Epoint açarları konfiqurasiya olunmayıb" }, 500, cors);
      }

      // payments cədvəlində placeholder (amount=0) — webhook qaytanda
      // status update etmək üçün lazımdır. user_id mənbəyimiz budur.
      const { data: payment, error: insErr } = await adminClient
        .from("payments")
        .insert({
          user_id: user.id,
          amount: 0,
          currency: "AZN",
          status: "pending",
          provider: "epoint",
          description: "Card registration for payouts",
          metadata: {
            purpose: "card_registration",
            return_url: body.return_url ?? null,
            epoint_account: epointCreds.account,
          },
        })
        .select()
        .single();
      if (insErr || !payment) {
        return json(
          { error: "Failed to create registration row", details: insErr?.message },
          500,
          cors,
        );
      }

      const urlWithId = appendQuery(defaultReturnUrl, {
        id: String(payment.id),
        kind: "card_registration",
      });

      // Epoint sənədinə görə yalnız bu sahələr (səh. 8):
      //   public_key, language, refund, description,
      //   success_redirect_url, error_redirect_url
      // order_id qəsdən YOX — sənəddə yer almır.
      //
      // user_id-i description-da gizli "uid:" prefiksi ilə daşıyırıq,
      // webhook onu parse edib payment row-u tapacaq.
      const cardBody = stringifyAll({
        public_key: epointPublic,
        language: "az",
        refund: 1,
        description: `Ellit payout card | uid:${user.id} | pid:${payment.id}`,
        success_redirect_url: urlWithId,
        error_redirect_url: appendQuery(urlWithId, { status: "failed" }),
      });

      const dataB64 = epointEncode(cardBody);
      const signature = await epointSign(dataB64, epointPrivate);

      const epResp = await fetch("https://epoint.az/api/1/card-registration", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ data: dataB64, signature }),
      });
      const epJson = await epResp.json().catch(() => ({}));

      if (!epResp.ok || epJson?.status !== "success") {
        await adminClient.from("payments").update({
          status: "failed",
          metadata: {
            ...(payment.metadata as object),
            epoint_error: epJson,
            request: cardBody,
          },
        }).eq("id", payment.id);
        return json(
          {
            error: "Gateway error (card-registration)",
            epoint: epJson,
          },
          502,
          cors,
        );
      }

      return json(
        {
          payment_id: payment.id,
          redirect_url: epJson.redirect_url,
          transaction_id: epJson.transaction ?? null,
        },
        200,
        cors,
      );
    }

    // ──────────────────────────────────────────────────────────────────
    //   PAYMENT (balance_topup / service_payment / service_promotion)
    //   Epoint sənədi səh. 2-3
    // ──────────────────────────────────────────────────────────────────
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
          epoint_account: epointCreds.account,
        },
      })
      .select()
      .single();
    if (insErr || !payment) {
      return json({ error: "Failed to create payment row", details: insErr?.message }, 500, cors);
    }

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

    const urlWithId = appendQuery(defaultReturnUrl, { id: String(payment.id) });

    // Epoint sənədi səh. 2-3: bu sahələr istifadə olunur
    // public_key, amount, currency, language, order_id, description,
    // success_redirect_url, error_redirect_url
    const epointBody = stringifyAll({
      public_key: epointPublic,
      amount: amount.toFixed(2),
      currency,
      language: "az",
      order_id: payment.id,
      description,
      success_redirect_url: urlWithId,
      error_redirect_url: appendQuery(urlWithId, { status: "failed" }),
    });

    const dataB64 = epointEncode(epointBody);
    const signature = await epointSign(dataB64, epointPrivate);

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
            epoint_error: { code: epointJson?.code ?? null, message: epointJson?.message ?? null },
            request: epointBody,
          },
        })
        .eq("id", payment.id);
      return json({ error: "Gateway error", epoint: epointJson }, 502, cors);
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
    console.error("create-payment-session fatal:", e);
    return json(
      { error: "Internal error", details: e instanceof Error ? e.message : String(e) },
      500,
      cors,
    );
  }
});

// ─── Helpers ────────────────────────────────────────────────────────────
function appendQuery(url: string, params: Record<string, string>): string {
  try {
    const u = new URL(url);
    for (const [k, v] of Object.entries(params)) {
      u.searchParams.set(k, v);
    }
    return u.toString();
  } catch {
    let result = url;
    for (const [k, v] of Object.entries(params)) {
      const sep = result.includes("?") ? "&" : "?";
      result = `${result}${sep}${encodeURIComponent(k)}=${encodeURIComponent(v)}`;
    }
    return result;
  }
}
