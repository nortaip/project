// ============================================================================
// send-push-notification — FCM HTTP v1 push gönderici
// ============================================================================
// Notifications cədvəlinə insert olunan kimi DB trigger bu funksiyanı çağırır.
// Funksiya user_devices-dən platforma görə FCM token-ləri çəkir və
// uyğun Firebase projektinə push göndərir.
//
// İki Firebase project dəstəklənir:
//   • Android tokens  → ellit-d79fa  (FCM_SA_ANDROID secret)
//   • iOS tokens      → ellit-ios    (FCM_SA_IOS secret)
//
// Secrets (Supabase Dashboard → Project Settings → Edge Functions → Secrets):
//   FCM_SA_ANDROID — Android service account JSON (tam fayl məzmunu)
//   FCM_SA_IOS     — iOS service account JSON     (tam fayl məzmunu)
//
// Input payload (ikisindən biri):
//   { notification_id: "uuid" }  → DB-dən oxuyur
//   { user_id: "uuid", title: "...", body: "...", data?: {...} }
//
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

interface ServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string;
  token_uri: string;
}

interface PushPayload {
  title: string;
  body: string;
  data?: Record<string, string>;
}

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const SA_ANDROID: ServiceAccount | null = (() => {
  const raw = Deno.env.get("FCM_SA_ANDROID");
  return raw ? JSON.parse(raw) : null;
})();

const SA_IOS: ServiceAccount | null = (() => {
  const raw = Deno.env.get("FCM_SA_IOS");
  return raw ? JSON.parse(raw) : null;
})();

// Hər service account üçün access_token cache (1 saatlıq TTL)
interface CachedToken { token: string; expiresAt: number; }
const tokenCache = new Map<string, CachedToken>();

/**
 * Google OAuth2 access_token al — Service Account JWT vasitəsilə.
 * FCM HTTP v1 API üçün lazımdır.
 */
async function getAccessToken(sa: ServiceAccount): Promise<string> {
  const cached = tokenCache.get(sa.project_id);
  const now = Math.floor(Date.now() / 1000);
  if (cached && cached.expiresAt > now + 60) {
    return cached.token;
  }

  // 1. JWT başlığı və payload
  const header = { alg: "RS256", typ: "JWT" };
  const payload = {
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: sa.token_uri ?? "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  };

  const encoder = new TextEncoder();
  const toB64Url = (data: string | Uint8Array) => {
    const bytes = typeof data === "string" ? encoder.encode(data) : data;
    let b64 = btoa(String.fromCharCode(...bytes));
    return b64.replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  };

  const headerB64 = toB64Url(JSON.stringify(header));
  const payloadB64 = toB64Url(JSON.stringify(payload));
  const signInput = `${headerB64}.${payloadB64}`;

  // 2. Private key import et
  const pemContents = sa.private_key
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s+/g, "");
  const binaryDer = Uint8Array.from(atob(pemContents), (c) => c.charCodeAt(0));
  const privateKey = await crypto.subtle.importKey(
    "pkcs8",
    binaryDer,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );

  // 3. JWT-ni imzala
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    privateKey,
    encoder.encode(signInput),
  );
  const sigB64 = toB64Url(new Uint8Array(signature));
  const jwt = `${signInput}.${sigB64}`;

  // 4. Google OAuth2 token endpoint
  const res = await fetch(payload.aud, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(`OAuth2 token alınmadı: ${JSON.stringify(data)}`);
  }
  tokenCache.set(sa.project_id, {
    token: data.access_token,
    expiresAt: now + (data.expires_in ?? 3600),
  });
  return data.access_token;
}

/**
 * FCM HTTP v1 API ilə tək cihaza push göndər.
 */
async function sendFCM(
  sa: ServiceAccount,
  token: string,
  payload: PushPayload,
): Promise<{ ok: boolean; response: unknown }> {
  const accessToken = await getAccessToken(sa);
  const url =
    `https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`;

  // Data sahələri yalnız string ola bilər
  const dataObj: Record<string, string> = {};
  if (payload.data) {
    for (const [k, v] of Object.entries(payload.data)) {
      dataObj[k] = v == null ? "" : String(v);
    }
  }

  const message = {
    message: {
      token,
      notification: {
        title: payload.title,
        body: payload.body,
      },
      data: dataObj,
      android: {
        priority: "HIGH" as const,
        notification: {
          sound: "default",
          channel_id: "ellit_default",
        },
      },
      apns: {
        headers: { "apns-priority": "10" },
        payload: {
          aps: {
            sound: "default",
            "content-available": 1,
          },
        },
      },
    },
  };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(message),
  });
  const responseBody = await res.json().catch(() => null);
  return { ok: res.ok, response: responseBody };
}

// ──────────────────────────────────────────────────────────────────────
// Main handler
// ──────────────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "authorization, content-type",
      },
    });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const body = await req.json();
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE, {
      auth: { persistSession: false },
    });

    let targetUserId: string | null = body.user_id ?? null;
    let title: string = body.title ?? "";
    let pushBody: string = body.body ?? "";
    let data: Record<string, string> = body.data ?? {};

    // notification_id verilibsə, DB-dən oxu
    if (body.notification_id) {
      const { data: notif, error: notifErr } = await supabase
        .from("notifications")
        .select("user_id, title, body, type, related_id")
        .eq("id", body.notification_id)
        .single();
      if (notifErr || !notif) {
        return new Response(
          JSON.stringify({ error: "Notification not found", details: notifErr?.message }),
          { status: 404, headers: { "Content-Type": "application/json" } },
        );
      }
      targetUserId = notif.user_id;
      title = notif.title;
      pushBody = notif.body;
      data = {
        type: notif.type ?? "",
        related_id: notif.related_id ?? "",
        notification_id: body.notification_id,
      };
    }

    if (!targetUserId || !title) {
      return new Response(
        JSON.stringify({ error: "user_id və title məcburidir" }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }

    // İstifadəçinin cihaz tokenlərini al
    const { data: devices, error: devErr, status: devStatus } = await supabase
      .from("user_devices")
      .select("fcm_token, platform, user_id")
      .eq("user_id", targetUserId);

    if (devErr) {
      return new Response(
        JSON.stringify({
          error: "user_devices oxunmadı",
          details: devErr.message,
          code: devErr.code,
          hint: devErr.hint,
          target_user_id: targetUserId,
        }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      );
    }

    // DEBUG: əgər boşdursa, ümumi say və service_role mövcudluğunu qaytar
    if (!devices || devices.length === 0) {
      const { count: totalCount } = await supabase
        .from("user_devices")
        .select("*", { count: "exact", head: true });

      return new Response(
        JSON.stringify({
          sent: 0,
          skipped: "no_devices",
          debug: {
            target_user_id: targetUserId,
            target_user_id_length: targetUserId?.length,
            status_code: devStatus,
            total_devices_in_table: totalCount,
            has_service_role_env: !!SUPABASE_SERVICE_ROLE,
            service_role_length: SUPABASE_SERVICE_ROLE?.length ?? 0,
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    // Hər cihaza paralel göndər
    const results = await Promise.all(devices.map(async (d) => {
      try {
        const platform = (d.platform ?? "").toLowerCase();
        const sa = platform === "ios" ? SA_IOS : SA_ANDROID;
        if (!sa) {
          return {
            platform,
            ok: false,
            error: `Service account konfiqurasiya edilməyib: ${platform}`,
          };
        }
        const result = await sendFCM(sa, d.fcm_token, { title, body: pushBody, data });

        // Yanlış token-ləri DB-dən sil (UNREGISTERED / INVALID_ARGUMENT)
        if (!result.ok) {
          const respStr = JSON.stringify(result.response ?? {});
          if (
            respStr.includes("UNREGISTERED") ||
            respStr.includes("registration-token-not-registered") ||
            respStr.includes("INVALID_ARGUMENT")
          ) {
            await supabase
              .from("user_devices")
              .delete()
              .eq("user_id", targetUserId!)
              .eq("fcm_token", d.fcm_token);
          }
        }

        return { platform, ok: result.ok, response: result.response };
      } catch (err) {
        return { platform: d.platform, ok: false, error: (err as Error).message };
      }
    }));

    const sentCount = results.filter((r) => r.ok).length;
    return new Response(
      JSON.stringify({ sent: sentCount, total: results.length, results }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
      },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
});
