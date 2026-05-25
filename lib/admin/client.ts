"use client";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let cached: SupabaseClient | null = null;

function readKey(): string | undefined {
  return (
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
}

export function getAdminSupabase(): SupabaseClient {
  if (cached) return cached;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = readKey();
  if (!url || !key) throw new Error("supabase_not_configured");

  cached = createClient(url, key, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storageKey: "family-chat:admin-auth",
    },
  });
  return cached;
}

export async function adminFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const { data, error } = await getAdminSupabase().auth.getSession();
  if (error) throw new Error("admin_session_error");
  const token = data.session?.access_token;
  if (!token) throw new Error("admin_unauthorized");

  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(path, { ...init, headers });
  const payload = (await response.json().catch(() => null)) as
    | (T & { error?: string })
    | null;
  if (!response.ok) {
    throw new Error(payload?.error ?? "admin_request_failed");
  }
  return (payload ?? {}) as T;
}
