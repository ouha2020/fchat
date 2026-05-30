import { createClient } from "npm:@supabase/supabase-js@2";

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

export function getServiceClient() {
  const url =
    Deno.env.get("SUPABASE_URL") ?? Deno.env.get("NEXT_PUBLIC_SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!url || !serviceRoleKey) {
    throw new Error("supabase_service_not_configured");
  }

  return createClient(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

export function requireCronSecret(
  request: Request,
  secretNames: string[],
): Response | null {
  const expectedSecret = secretNames
    .map((name) => Deno.env.get(name))
    .find((value): value is string => Boolean(value));

  if (!expectedSecret) {
    return jsonResponse({ ok: false, error: "cron_secret_not_configured" }, 503);
  }

  const headerSecret = request.headers.get("x-cron-secret");
  const bearer = request.headers.get("authorization") ?? "";
  const bearerSecret = bearer.startsWith("Bearer ")
    ? bearer.slice("Bearer ".length)
    : "";

  if (headerSecret !== expectedSecret && bearerSecret !== expectedSecret) {
    return jsonResponse({ ok: false, error: "unauthorized" }, 401);
  }

  return null;
}

export async function readMode(
  request: Request,
  allowedModes: readonly string[],
  fallback: string,
): Promise<string> {
  const urlMode = new URL(request.url).searchParams.get("mode");
  if (urlMode && allowedModes.includes(urlMode)) return urlMode;

  if (request.method !== "GET") {
    try {
      const body = await request.clone().json();
      const bodyMode = (body as { mode?: unknown } | null)?.mode;
      if (typeof bodyMode === "string" && allowedModes.includes(bodyMode)) {
        return bodyMode;
      }
    } catch {
      // Empty or invalid JSON falls back to the default mode.
    }
  }

  return fallback;
}

export function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

export function isPresent<T>(value: T | null | undefined): value is T {
  return value != null;
}
