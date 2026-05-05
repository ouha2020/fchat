-- 修复：新加入的成员发的消息显示为「未知成员」。
-- 原因：family_members 表没有加入 supabase_realtime 发布，
-- 已经在聊天室里的人收不到成员变更广播，本地 memberMap 未更新。

do $$
begin
  if not exists (
    select 1
      from pg_publication_tables
     where pubname = 'supabase_realtime'
       and tablename = 'family_members'
  ) then
    execute 'alter publication supabase_realtime add table family_members';
  end if;
end
$$;
