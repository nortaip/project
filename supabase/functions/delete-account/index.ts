// ============================================================================
// Edge Function: delete-account
//
// İstifadəçi öz hesabını tam silmək üçün çağırır (Apple Guideline 5.1.1(v)).
// Service role ilə auth.admin.deleteUser() çağırılır → FK CASCADE
// (notifications, disputes, kyc, payments və s.) qalan datanı təmizləyir.
//
// Auth:
//   - Caller-in JWT-si olmalıdır (Authorization header).
//   - Yalnız öz hesabını silə bilir (admin tərəfindən deyil).
//
// Body: {} (boş — caller user_id JWT-dən götürülür)
//
// Response: { ok: true } və ya { error: '...' }
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
      return json({ error: "Server misconfigured" }, 500, cors);
    }

    const auth = req.headers.get("Authorization");
    if (!auth) return json({ error: "MISSING_AUTHORIZATION" }, 401, cors);

    // Caller-i JWT-dən identify et
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: auth } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) {
      return json({ error: "INVALID_TOKEN" }, 401, cors);
    }
    const userId = userData.user.id;

    const admin = createClient(supabaseUrl, serviceRole);

    // Tam silinmədən əvvəl açıq kilidlər/aktiv əməliyyatlar varsa, blok et.
    // (Aktiv offer və ya pending withdrawal varsa silmək təhlükəlidir.)
    const { count: activeOffers } = await admin
      .from("opportunities_offers")
      .select("id", { count: "exact", head: true })
      .eq("provider_id", userId)
      .in("status", ["accepted", "in_progress"]);

    if ((activeOffers ?? 0) > 0) {
      return json(
        { error: "HAS_ACTIVE_OFFERS", message: "Aktiv sifarişlərini tamamla və ya ləğv et, sonra hesabı sil." },
        409,
        cors,
      );
    }

    const { count: pendingWithdrawals } = await admin
      .from("withdrawal_requests")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .in("status", ["pending", "processing"]);

    if ((pendingWithdrawals ?? 0) > 0) {
      return json(
        { error: "HAS_PENDING_WITHDRAWALS", message: "Pending withdrawal əməliyyatı var. Tamamlanmasını gözlə." },
        409,
        cors,
      );
    }

    // auth.users-i sil → ON DELETE CASCADE bağlı cədvəlləri təmizləyir.
    // (profiles, notifications, disputes, kyc_submissions, payments, və s.)
    const { error: deleteErr } = await admin.auth.admin.deleteUser(userId);
    if (deleteErr) {
      console.error("delete-account: admin.deleteUser failed:", deleteErr);
      return json({ error: "DELETE_FAILED", details: deleteErr.message }, 500, cors);
    }

    return json({ ok: true }, 200, cors);
  } catch (e) {
    console.error("delete-account fatal:", e);
    return json(
      { error: "INTERNAL_ERROR", details: e instanceof Error ? e.message : String(e) },
      500,
      cors,
    );
  }
});
