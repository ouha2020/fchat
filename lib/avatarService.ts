import type { LocalSession } from "@/lib/authLocal";
import { getSupabase } from "@/lib/supabaseClient";
import { uploadMediaViaApi } from "@/lib/uploadClient";

export async function uploadAvatar(
  session: LocalSession,
  file: File,
  signal?: AbortSignal,
): Promise<string> {
  const form = new FormData();
  form.set("memberId", session.member_id);
  form.set("memberToken", session.member_token);
  form.set("file", file);

  return uploadMediaViaApi("/api/upload/avatar", form, { signal });
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
