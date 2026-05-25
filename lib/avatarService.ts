import type { LocalSession } from "@/lib/authLocal";
import { getSupabase } from "@/lib/supabaseClient";

export async function uploadAvatar(
  session: LocalSession,
  file: File,
): Promise<string> {
  const form = new FormData();
  form.set("memberId", session.member_id);
  form.set("memberToken", session.member_token);
  form.set("file", file);

  const res = await fetch("/api/upload/avatar", {
    method: "POST",
    body: form,
  });
  const payload = (await res.json().catch(() => null)) as
    | { url?: string; error?: string }
    | null;
  if (!res.ok || !payload?.url) {
    throw new Error(payload?.error ?? "avatar_upload_failed");
  }
  return payload.url;
}

export async function updateMemberAvatar(
  session: LocalSession,
  avatarUrl: string | null,
): Promise<string | null> {
  const sb = getSupabase();
  const { data, error } = await sb.rpc("update_member_avatar", {
    p_member_id: session.member_id,
    p_member_token: session.member_token,
    p_avatar_url: avatarUrl,
  });
  if (error) throw error;
  return typeof data === "string" && data.length > 0 ? data : null;
}
