# Supabase Cron 替代 Vercel Cron

本文记录 HomeTree / FamilyChat 的计划任务迁移方案。目标是让定时任务在 Supabase 侧执行，不再通过 Vercel Cron 调用 Next.js API Route，从而避免触发 Vercel Cron 相关计费。

## 任务边界

- Vercel Cron 配置已从 `vercel.json` 移除。
- Next.js API Route 保留为手动兜底入口，不作为计划任务入口。
- Supabase Cron 只调用 Supabase Edge Function，不调用 `https://<vercel-domain>/api/*`。
- Push payload 仍只能包含安全摘要，不能包含消息正文、媒体 URL、坐标、family code、member token 或 Auth token。

## Edge Functions

新增两个 Supabase Edge Function：

- `schedule-reminders`
  - `?mode=flush`：处理到期日程提醒。
  - `?mode=retry`：重试失败的日程提醒。
- `message-push`
  - `?mode=flush`：补偿发送未通知的消息 Push。
  - `?mode=retry`：重试失败的消息 Push。

两个函数都会使用 `SUPABASE_SERVICE_ROLE_KEY` 访问数据库，并使用 VAPID 私钥发送 Web Push。VAPID 私钥只允许配置在服务端环境或 Supabase Function Secret 中。

迁移期间，Next.js API Route 与 Supabase Edge Function 会各自保留一份发送逻辑。后续如果 Edge Function 线上验证稳定，可以删除或降级 Next.js 的手动兜底入口，避免两套逻辑长期漂移。

## Function Secrets

在 Supabase 项目中配置 Edge Function Secrets：

```bash
supabase secrets set SUPABASE_SERVICE_ROLE_KEY="<service-role-key>"
supabase secrets set NEXT_PUBLIC_VAPID_PUBLIC_KEY="<vapid-public-key>"
supabase secrets set VAPID_PRIVATE_KEY="<vapid-private-key>"
supabase secrets set VAPID_SUBJECT="mailto:<admin@example.com>"
supabase secrets set SCHEDULE_REMINDER_SECRET="<schedule-reminder-secret>"
supabase secrets set PUSH_FLUSH_SECRET="<push-flush-secret>"
```

如果是自托管或非标准环境，还需要配置：

```bash
supabase secrets set SUPABASE_URL="https://<project-ref>.supabase.co"
```

## Deploy

```bash
supabase functions deploy schedule-reminders
supabase functions deploy message-push
```

默认保留 Supabase Edge Function 的 JWT 校验。Cron 调用时使用 publishable/anon key 通过网关校验，再用 `x-cron-secret` 做业务级保护。

## Vault Secrets

Supabase Cron SQL 中不要明文写密钥。先把调用需要的值放入 Supabase Vault：

```sql
select vault.create_secret('https://<project-ref>.supabase.co', 'project_url');
select vault.create_secret('<publishable-or-anon-key>', 'publishable_key');
select vault.create_secret('<same-value-as-SCHEDULE_REMINDER_SECRET>', 'schedule_reminder_secret');
select vault.create_secret('<same-value-as-PUSH_FLUSH_SECRET>', 'push_flush_secret');
```

## Cron SQL

确保项目启用 `pg_cron` 与 `pg_net`。Supabase 官方文档推荐用 `pg_cron + pg_net` 调用 Edge Functions，并用 Vault 存储调用密钥。

```sql
create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;
```

日程提醒 flush，每分钟：

```sql
select cron.schedule(
  'hometree-schedule-reminders-flush',
  '* * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
      || '/functions/v1/schedule-reminders?mode=flush',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'publishable_key'),
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'schedule_reminder_secret')
    ),
    body := '{}'::jsonb
  ) as request_id;
  $$
);
```

日程提醒 retry，每 5 分钟：

```sql
select cron.schedule(
  'hometree-schedule-reminders-retry',
  '*/5 * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
      || '/functions/v1/schedule-reminders?mode=retry',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'publishable_key'),
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'schedule_reminder_secret')
    ),
    body := '{}'::jsonb
  ) as request_id;
  $$
);
```

消息 Push flush，每分钟：

```sql
select cron.schedule(
  'hometree-message-push-flush',
  '* * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
      || '/functions/v1/message-push?mode=flush',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'publishable_key'),
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'push_flush_secret')
    ),
    body := '{}'::jsonb
  ) as request_id;
  $$
);
```

消息 Push retry，每 5 分钟：

```sql
select cron.schedule(
  'hometree-message-push-retry',
  '*/5 * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
      || '/functions/v1/message-push?mode=retry',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'publishable_key'),
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'push_flush_secret')
    ),
    body := '{}'::jsonb
  ) as request_id;
  $$
);
```

## 验证

函数入口烟测。如果返回 `cron_secret_not_configured`，说明函数已部署且 JWT 网关可达，但 Function Secrets 还没有配置完整；此时不要创建 Cron job。

```bash
curl -i \
  -X POST \
  "$SUPABASE_URL/functions/v1/schedule-reminders?mode=flush" \
  -H "Authorization: Bearer $SUPABASE_ANON_KEY" \
  -H "apikey: $SUPABASE_ANON_KEY" \
  -H "Content-Type: application/json" \
  --data '{}'
```

查看 Cron 配置：

```sql
select jobid, jobname, schedule, active
from cron.job
where jobname like 'hometree-%'
order by jobname;
```

查看最近执行结果：

```sql
select jobid, status, return_message, start_time, end_time
from cron.job_run_details
where jobid in (
  select jobid from cron.job where jobname like 'hometree-%'
)
order by start_time desc
limit 20;
```

验证 Vercel 不再承接计划任务：

- `vercel.json` 不应包含 `crons`。
- Supabase Cron 的 URL 不应指向 Vercel 域名。
- Vercel Functions 日志中不应按分钟出现 `/api/schedule/flush-reminders` 或 `/api/schedule/retry-reminders`。

## 回滚

如 Supabase Cron 或 Edge Function 暂时不可用，可以临时恢复 `vercel.json` 的旧 `crons` 配置，或手动调用现有 Next.js API Route。恢复前必须确认这会重新触发 Vercel Cron/Function 计费。

旧计划任务名可用以下 SQL 停用：

```sql
select cron.unschedule('hometree-schedule-reminders-flush');
select cron.unschedule('hometree-schedule-reminders-retry');
select cron.unschedule('hometree-message-push-flush');
select cron.unschedule('hometree-message-push-retry');
```

## 参考

- Supabase Scheduling Edge Functions: https://supabase.com/docs/guides/functions/schedule-functions
- Supabase Cron: https://supabase.com/docs/guides/cron
- Supabase pg_net: https://supabase.com/docs/guides/database/extensions/pg_net
- Supabase Vault: https://supabase.com/docs/guides/database/vault
