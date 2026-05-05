-- 修复：在 Supabase 上 pgcrypto 装在 `extensions` schema，
-- 而 SECURITY DEFINER 函数把 search_path 锁在 public，
-- 导致 gen_random_bytes / digest 找不到。
-- 给所有相关函数加上 extensions 到 search_path。

alter function public.hash_secret(text)
  set search_path = public, extensions;

alter function public.create_family(text, text, text, text)
  set search_path = public, extensions;

alter function public.join_family(text, text, text)
  set search_path = public, extensions;

alter function public.validate_member(uuid, text)
  set search_path = public, extensions;

alter function public.send_message(uuid, text, text, text, text, double precision, double precision, text, text)
  set search_path = public, extensions;

alter function public.require_admin(uuid, text, text)
  set search_path = public, extensions;

alter function public.update_family_name(uuid, text, text, text)
  set search_path = public, extensions;

alter function public.reset_family_code(uuid, text, text)
  set search_path = public, extensions;

alter function public.set_join_enabled(uuid, text, text, boolean)
  set search_path = public, extensions;

alter function public.remove_member(uuid, text, text, uuid)
  set search_path = public, extensions;

alter function public.leave_family(uuid, text)
  set search_path = public, extensions;
