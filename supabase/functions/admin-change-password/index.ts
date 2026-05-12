// ============================================================================
// Edge Function: admin-change-password
//
// Admin başqa istifadəçinin parolunu dəyişir.
//
// Auth:
//   - Caller JWT-si olmalıdır
//   - Caller-in profiles.role-u 'admin'/'master'/'superadmin' olmalıdır
//
// Body: { user_id: string, new_password: string }
//
// Audit: hər çağırış audit_log-a yazılır
// ============================================================================

import { createClient } from "npm:@supabase/supabase-js@2";

const ALLOWED_ORIGINS = new Set([
  "https://ellit.az",
  "https://www.ellit.az",
  "http://localhost:5173",
  "http://localhost:3000",
]);

function cors(origin: string | null): Record<string, string> {
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

Deno.serve(async (req) => {
  const headers = cors(req.headers.get("Origin"));
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405, headers);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    if (!supabaseUrl || !serviceRole || !anonKey) {
      return json({ error: "Server misconfigured" }, 500, headers);
    }

    const auth = req.headers.get("Authorization");
    if (!auth) return json({ error: "Missing Authorization" }, 401, headers);

    // 1) Caller-i identify et
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: auth } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) {
      return json({ error: "Invalid token" }, 401, headers);
    }
    const callerId = userData.user.id;

    // 2) Caller admin?
    const admin = createClient(supabaseUrl, serviceRole);
    const { data: profile } = await admin
      .from("profiles")
      .select("role")
      .eq("id", callerId)
      .single();
    const role = String(profile?.role ?? "").toLowerCase();
    if (!["admin", "master", "superadmin"].includes(role)) {
      return json({ error: "Yalnız admin üçün!" }, 403, headers);
    }

    // 3) Body
    let body: { user_id?: string; new_password?: string };
    try {
      body = await req.json();
    } catch {
      return json({ error: "Invalid JSON" }, 400, headers);
    }
    if (!body.user_id || !body.new_password) {
      return json({ error: "Missing user_id or new_password" }, 400, headers);
    }
    if (body.new_password.length < 6) {
      return json({ error: "Parol minimum 6 simvol olmalıdır" }, 400, headers);
    }

    // 4) Parol dəyiş
    const { error: updErr } = await admin.auth.admin.updateUserById(body.user_id, {
      password: body.new_password,
    });
    if (updErr) {
      return json({ error: updErr.message }, 400, headers);
    }

    // 5) Audit
    try {
      await admin.from("audit_log").insert({
        actor: callerId,
        action: "admin_password_reset",
        target_type: "user",
        target_id: body.user_id,
        payload: {
          method: "admin-change-password",
        },
      });
    } catch {
      // audit fail-i bloklamasın
    }

    return json({ ok: true }, 200, headers);
  } catch (e) {
    console.error("admin-change-password fatal:", e);
    return json(
      { error: "Internal error", details: e instanceof Error ? e.message : String(e) },
      500,
      headers,
    );
  }
});
