// ============================================================================
// Edge Function: process-withdrawal
//
// Admin nağdlaşdırma sorğusunu emala salır:
//   1. Caller-i admin kimi yoxlayır
//   2. Epoint payout API çağırır → pul provayder kartına/IBAN-a köçürülür
//   3. Uğurlu olarsa `admin_process_withdrawal` RPC çağırır → status='processed'
//   4. Uğursuz olarsa səhv qaytarır (admin manual rədd edə bilər)
//
// Action növləri:
//   action='payout'  → Epoint payout API çağırış + status='processed'
//   action='manual'  → Heç bir bank çağırışı, sadəcə status='processed' (admin
//                      pulu özü göndərmiş olduğunu işarələyir)
//   action='reject'  → status='rejected', provider-ə refund
// ============================================================================

import { createClient } from "npm:@supabase/supabase-js@2";

interface RequestBody {
  withdrawal_id: string;
  action: "payout" | "manual" | "reject";
  notes?: string;
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

Deno.serve(async (req) => {
  const cors = corsHeaders(req.headers.get("Origin"));
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
      return json({ error: "Server misconfigured" }, 500, cors);
    }

    const auth = req.headers.get("Authorization");
    if (!auth) return json({ error: "Missing Authorization" }, 401, cors);

    // 1. Auth + admin check
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: auth } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) return json({ error: "Invalid token" }, 401, cors);
    const adminId = userData.user.id;

    const admin = createClient(supabaseUrl, serviceRole);
    const { data: profile } = await admin
      .from("profiles")
      .select("role")
      .eq("id", adminId)
      .single();
    if (!profile || !["admin", "master", "superadmin"].includes(String(profile.role).toLowerCase())) {
      return json({ error: "Forbidden — admin only" }, 403, cors);
    }

    // 2. Parse body
    let body: RequestBody;
    try {
      body = (await req.json()) as RequestBody;
    } catch {
      return json({ error: "Invalid JSON" }, 400, cors);
    }
    if (!body.withdrawal_id || !body.action) {
      return json({ error: "Missing withdrawal_id or action" }, 400, cors);
    }

    // 3. Fetch withdrawal
    const { data: wd, error: wdErr } = await admin
      .from("withdrawals")
      .select("*")
      .eq("id", body.withdrawal_id)
      .single();
    if (wdErr || !wd) return json({ error: "Withdrawal not found" }, 404, cors);
    if (wd.status !== "pending") {
      return json({ error: `Withdrawal already ${wd.status}` }, 400, cors);
    }

    // ── REJECT ────────────────────────────────────────────────────────
    if (body.action === "reject") {
      const userJwtAdmin = createClient(supabaseUrl, anonKey, {
        global: { headers: { Authorization: auth } },
      });
      const { error: rpcErr } = await userJwtAdmin.rpc("admin_process_withdrawal", {
        p_id: body.withdrawal_id,
        p_status: "rejected",
        p_admin_notes: body.notes ?? null,
        p_external_id: null,
      });
      if (rpcErr) return json({ error: rpcErr.message }, 400, cors);
      return json({ ok: true, status: "rejected" }, 200, cors);
    }

    // ── MANUAL processed (admin pulu özü göndərib) ────────────────────
    if (body.action === "manual") {
      const userJwtAdmin = createClient(supabaseUrl, anonKey, {
        global: { headers: { Authorization: auth } },
      });
      const { error: rpcErr } = await userJwtAdmin.rpc("admin_process_withdrawal", {
        p_id: body.withdrawal_id,
        p_status: "processed",
        p_admin_notes: body.notes ?? "Manual transfer by admin",
        p_external_id: null,
      });
      if (rpcErr) return json({ error: rpcErr.message }, 400, cors);
      return json({ ok: true, status: "processed", mode: "manual" }, 200, cors);
    }

    // ── PAYOUT via Epoint execute-pay ────────────────────────────────
    // Epoint sənədi səh. 10:
    //   POST /api/1/execute-pay
    //   public_key, language, card_uid, order_id, amount, currency, description
    //
    // Yalnız `refund=1` ilə qeydiyyat olunan karta payout göndərə bilir.
    // ──────────────────────────────────────────────────────────────────
    if (body.action === "payout") {
      const epointPublic = Deno.env.get("EPOINT_PUBLIC_KEY");
      const epointPrivate = Deno.env.get("EPOINT_PRIVATE_KEY");
      if (!epointPublic || !epointPrivate) {
        return json({ error: "Epoint açarları konfiqurasiya olunmayıb" }, 500, cors);
      }

      const { data: provider } = await admin
        .from("profiles")
        .select("epoint_card_uid")
        .eq("id", wd.provider_id)
        .single();
      const cardUid = provider?.epoint_card_uid as string | undefined;

      if (!cardUid) {
        return json(
          {
            error:
              "Provayder Epoint-də kartını qeydiyyatdan keçirməyib. Manual emala salın və ya provayderdən kartını qeydiyyatdan keçirməsini xahiş edin.",
            requires_card_registration: true,
          },
          400,
          cors,
        );
      }

      // Sənəddə amount tip `Ədəd` görünür, amma diğər endpointlərdə dəyər
      // string kimi göndərilir. Hər ehtimala qarşı string-ə çeviririk.
      const payoutBody: Record<string, string> = {
        public_key: epointPublic,
        language: "az",
        card_uid: String(cardUid),
        order_id: String(wd.id),
        amount: Number(wd.net_amount).toFixed(2),
        currency: "AZN",
        description: `Withdrawal ${String(wd.id).slice(0, 8)}`,
      };

      const dataB64 = base64Encode(
        new TextEncoder().encode(JSON.stringify(payoutBody)),
      );
      const sigSource = `${epointPrivate}${dataB64}${epointPrivate}`;
      const sigBuf = await crypto.subtle.digest(
        "SHA-1",
        new TextEncoder().encode(sigSource),
      );
      const signature = base64Encode(new Uint8Array(sigBuf));

      const epointResp = await fetch("https://epoint.az/api/1/execute-pay", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ data: dataB64, signature }),
      });
      const epointJson = await epointResp.json().catch(() => ({}));

      if (!epointResp.ok || epointJson?.status !== "success") {
        return json(
          {
            error: "Epoint payout failed",
            epoint: epointJson,
          },
          502,
          cors,
        );
      }

      const externalId = String(
        epointJson.transaction ?? epointJson.transaction_id ?? "",
      );

      const userJwtAdmin = createClient(supabaseUrl, anonKey, {
        global: { headers: { Authorization: auth } },
      });
      const { error: rpcErr } = await userJwtAdmin.rpc("admin_process_withdrawal", {
        p_id: body.withdrawal_id,
        p_status: "processed",
        p_admin_notes: body.notes ?? `Epoint payout: ${externalId}`,
        p_external_id: externalId,
      });
      if (rpcErr) {
        return json(
          {
            error: "Payout succeeded but DB update failed",
            details: rpcErr.message,
            external_id: externalId,
          },
          500,
          cors,
        );
      }

      return json(
        { ok: true, status: "processed", mode: "epoint", external_id: externalId },
        200,
        cors,
      );
    }

    return json({ error: "Unknown action" }, 400, cors);
  } catch (e) {
    console.error("process-withdrawal fatal:", e);
    return json(
      { error: "Internal error", details: e instanceof Error ? e.message : String(e) },
      500,
      cors,
    );
  }
});
