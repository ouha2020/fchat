# AGENTS.md — HomeTree / FamilyChat

这份文件是 Codex / AI 工程代理在本仓库工作的项目治理规则。所有任务都必须优先遵守这里的架构、安全、UI、验证和发布约束。

## 项目定位

HomeTree / FamilyChat 是一个移动端优先的家庭沟通 Web/PWA 应用。

核心能力包括：

- 家庭聊天
- 文字、语音、图片、位置消息
- 悄悄话
- 家庭日程、提醒、协作评论
- 个人页
- 家庭成员管理
- PWA Push 通知
- 家庭管理后台与系统健康检查

产品体验参考：

- LINE
- iMessage
- Zenly

视觉方向：

- 日本极简
- 原生 App 感
- 温暖、干净、有家庭感
- 移动端单手操作友好

禁止把产品做成：

- 通用 SaaS 后台
- 企业管理系统
- 大面积 dashboard
- AI 感很强的堆叠卡片
- 过度渐变、过度阴影、过度装饰

## 技术栈

- Next.js 14 App Router
- TypeScript
- React 18
- Tailwind CSS
- Supabase Auth
- Supabase PostgreSQL
- RLS
- SECURITY DEFINER RPC
- Supabase Realtime
- PWA / Service Worker / Web Push
- Vercel

## 常用命令

```bash
npm install
npm run dev          # localhost:3000，需要 .env.local
npm run lint         # next lint
npm run typecheck    # tsc --noEmit
npm run build        # production build
git diff --check
```

当前项目没有自动化 `npm run test` 脚本。验证以 `lint`、`typecheck`、`build`、`git diff --check` 和本地/真机手动回归为主。

## 环境变量

`.env.local` 至少需要：

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` 或 `NEXT_PUBLIC_SUPABASE_ANON_KEY`

服务端能力按功能需要使用：

- `SUPABASE_SERVICE_ROLE_KEY`
- `RESEND_API_KEY`
- `EMAIL_FROM`
- `NEXT_PUBLIC_VAPID_PUBLIC_KEY`
- `VAPID_PRIVATE_KEY`
- `VAPID_SUBJECT`
- `PUSH_FLUSH_SECRET`
- `SCHEDULE_REMINDER_SECRET` 或 `CRON_SECRET`
- `SYSTEM_HEALTH_SECRET`

禁止把 service role key、member token、Auth token、password hash、admin hash 写入前端、URL、日志或 Push payload。

## 分支与部署

- 默认开发分支：`Codex/family-chat-webapp-AYGTc`。
- 不要直接推送到 `main`。
- `main` 连接 Vercel 自动部署。
- Vercel 费用保护：不要主动执行或触发任何可能产生 Vercel 计费的操作。包括但不限于 `vercel deploy`、`vercel --prod`、`vercel promote`、`vercel rollback`、调用 Vercel CLI/API 检查或操作部署、推送会触发 Vercel Preview 的分支、创建会触发 Preview 的 PR、合并到会触发 Production Deployment 的 `main`。
- 即使用户说“提交”“推送”“合并”“提交到主分支”，也不能默认允许触发 Vercel。必须在执行前明确提示“这可能触发 Vercel 自动部署/计费”，并获得用户明确确认后才可以继续。
- 如只需要保存代码，优先本地 commit 或推送到确认不会触发 Vercel 的目标；无法确认是否会触发 Vercel 时，停下来询问用户。
- 发布数据库相关改动时，顺序必须是：
  1. 写入 migration 和 `supabase/schema.sql`
  2. 在 Supabase 生产库执行 migration
  3. 用 `/admin/system-health` 或 SQL 对账
  4. 再合并/发布前端

## 身份模型

本项目是混合身份模型。

创建家庭者：

- 使用 Supabase Auth 邮箱注册/登录。
- 家庭 owner 绑定 `families.owner_user_id`。
- 创建家庭、找回家庭代码、owner 级敏感操作依赖 Supabase Auth 身份。

普通家庭成员：

- 不强制注册。
- 通过家庭代码加入家庭。
- 使用本地 `member_id + member_token` 维持身份。
- 本地 session 保存在 `localStorage["family-chat:session"]`。
- `member_token` 原文只保存在浏览器，数据库只保存 hash。

所有家庭数据访问：

- 必须校验 `member_id + member_token`。
- 必须确认成员属于对应 family 且状态有效。
- 被移除成员不能继续读取或操作家庭数据。

## 数据库与权限

所有敏感读写都必须通过 RPC 或服务端 API 完成。不要只依赖前端隐藏。

新增或修改 RPC 时必须：

- 使用 `SECURITY DEFINER`。
- 设置 `set search_path = public, extensions`。
- PL/pgSQL 中如果返回列名和表字段同名，使用 `#variable_conflict use_column`。
- 对需要前端调用的函数执行 `grant execute on function ... to anon, authenticated;`。
- 修改函数参数后同步更新 grant 签名。
- 不在 RPC 中绕过 family membership、member token、admin role、owner 身份校验。

数据库变更必须双写：

- 新增 `supabase/migrations/<date>_<name>.sql`
- 同步更新 `supabase/schema.sql`

生产库不能只改代码不执行 migration。遇到线上“代码有、库没有”的问题，先检查 `/admin/system-health`。

## 消息系统规则

不要重写聊天系统。普通群聊、图片、语音、位置、悄悄话都必须保持兼容。

当前消息架构要点：

- `messages` 保存消息主体。
- `message_recipients` 是消息可见性的数据库来源。
- 群聊消息给当前家庭 active 成员生成 recipient。
- 悄悄话只给发送者和接收者生成 recipient。
- 管理员默认不能读取别人之间的悄悄话。
- `family_seq` 是家庭内递增序号，用于弱网、漏 Realtime 后的增量补偿同步。
- `message_realtime_events` 只作为轻量同步信号，不承载正文、媒体 URL、坐标。
- 前端收到 Realtime event 后必须再通过 RPC 拉完整消息。
- Push 目标必须来自 `message_recipients`，并排除发送者。

Push payload 禁止包含：

- 消息正文
- 图片 URL
- 语音 URL
- 坐标
- family code
- member token
- Auth token

React 18 注意事项：

- 不要在 `setState` updater 内依赖同步副作用。
- Realtime 回调中的副作用必须放在 updater 外部，并用 `useRef` Set 去重。

## 日程系统规则

不要重写日程系统。日程、重复、提醒、协作、评论、活动记录必须保持现有闭环。

当前日程规则：

- 日程读取和操作必须走 RPC。
- 私人日程只有创建者和负责人可见。
- 管理员不能默认查看别人私人日程。
- 评论、负责人确认/拒绝、活动记录必须通过 RPC 校验权限。
- 提醒投递以 `family_schedule_reminder_deliveries` 为成员级投递来源。
- 提醒 Push 只发送安全摘要，不包含标题、备注、评论、位置或媒体 URL。
- 日程 Realtime event 只作为轻量信号，详情内容仍需 RPC 拉取。

## PWA / Push 规则

Push 是提醒信号，不是数据传输层。

必须：

- 前台可见时尽量不弹系统通知。
- 后台通知使用安全摘要。
- 点击消息通知定位到 `/chat?mid=<messageId>`。
- 点击日程提醒定位到 `/schedule?item=<itemId>`。
- 404/410 Push subscription 必须禁用。
- Push 失败不能影响消息发送或日程主操作。
- 补偿和重试任务必须有服务端 secret 保护。

Service Worker 相关改动必须同时检查：

- `public/sw.js`
- `components/ServiceWorkerRegister.tsx`
- Push API route
- 前后台 presence
- Android / iOS PWA 行为差异

## Storage 规则

当前图片、语音、头像使用现有 public bucket。

重要安全边界：

- 无关成员不能通过消息/RPC拿到媒体 URL。
- 但 public bucket 的 URL 一旦外泄，本阶段不保证外部不可访问。
- 不要把 Storage URL 当成强私密边界。

上传相关改动必须校验：

- 文件类型
- 文件大小
- 成员身份
- family 路径隔离
- 错误提示不要暴露底层敏感信息

## UI / UX 规则

所有 UI 默认 mobile first。

必须：

- 保持原生 App 感。
- 使用舒适的触控区域。
- 兼容 bottom safe area。
- 兼容键盘弹出。
- 重要操作清晰但不后台化。
- 长昵称、长标题、长备注必须截断或换行，不能撑破布局。
- icon-only 按钮必须有 `aria-label` 或 `title`。

聊天页特别规则：

- 使用 `100dvh` / dynamic viewport。
- 不要把聊天页改回 `h-screen`。
- 不要破坏底部输入栏、录音、工具栏、悄悄话提示条。
- iOS 输入文字和语音录制时不能明显晃动。

日程页特别规则：

- 月 / 周 / 日切换要稳定。
- 详情抽屉不能被键盘严重遮挡。
- 评论输入、提醒状态、负责人状态要清晰。
- 不要做复杂企业日历后台风。

## UI 重构治理

UI 重构必须先遵守本文件，再读取并执行以下治理文档：

- `UI_RULES.md`：移动端 UI/UX 不变量、禁止项、可访问性与安全边界。
- `DESIGN_SYSTEM.md`：当前设计系统基线、组件语义、样式来源与演进约束。
- `TASKS_UI.md`：分阶段 UI 任务池、优先级规则、组件/页面/a11y/performance/validation 任务。
- `CODEX_UI_LOOP.md`：每轮 UI 工作的 audit → select → implement → validate → review → record → continue 流程。
- `docs/iteration-log/_template.md`：单轮迭代记录模板。
- `docs/iteration-log/_latest.md`：最近一次 UI 审计或迭代记录。

治理阶段只允许更新文档，不要顺手改页面、组件、业务逻辑、权限、数据库、Push 或 Service Worker。正式 UI 迭代必须从 `TASKS_UI.md` 选择一个最小任务，并在完成后更新 `docs/iteration-log/_latest.md`。

## 开发工作流

每次任务必须：

1. 阅读相关文件。
2. 理解当前数据流和权限边界。
3. 分析风险。
4. 输出或形成最小修改方案。
5. 只修改必要部分。
6. 自动修复类型、构建、lint 问题。
7. 做功能回归。
8. 做 UX review。
9. 做 security review。

禁止：

- 不读代码直接生成。
- 重写整个模块。
- 顺手重构无关代码。
- 替换聊天、日程、Push、Realtime、Storage 架构。
- 只做前端权限过滤。
- 把敏感信息放到 URL、日志、Push payload。

## 验证要求

代码改动默认执行：

```bash
npm run lint
npm run typecheck
npm run build
git diff --check
```

只改文档时至少执行：

```bash
git diff --check
```

UI 改动必须检查：

- 360px
- 390px
- 430px
- 无横向滚动
- 按钮文字不溢出
- 抽屉/弹窗不超屏
- 键盘弹出后关键操作仍可用

数据库改动必须检查：

- migration 已应用
- `supabase/schema.sql` 已同步
- 生产库字段/RPC/policy/grant 已对账
- `/admin/system-health` 没有新增缺失项

## 重点文件地图

- `app/chat/page.tsx`：聊天主流程、会话恢复、Realtime、Push、缓存、输入栏、乐观更新。
- `components/ChatInput.tsx`：文字、图片、语音、位置、悄悄话输入。
- `components/ChatMessage.tsx`：消息气泡、撤回、媒体展示。
- `lib/messageService.ts`：消息 RPC、上传入口、投递/已读上报。
- `lib/messageSync.ts`：缓存、seq/delta 同步、Realtime 批量合并。
- `lib/messageCache.ts`：本地消息缓存。
- `public/sw.js`：Service Worker、Push、通知点击。
- `lib/pushMessageServer.ts`：消息 Push、补偿、重试、审计。
- `app/schedule/page.tsx`：日程页、详情、筛选、月/周/日视图。
- `lib/scheduleService.ts`：日程 RPC 客户端。
- `lib/scheduleReminderServer.ts`：日程提醒 flush/retry。
- `app/me/page.tsx`：个人页。
- `app/settings/page.tsx`：设置、Push、管理员操作、健康入口。
- `app/admin/system-health/page.tsx`：系统健康检查 UI。
- `lib/admin/systemHealth.ts`：系统健康检查 catalog。
- `supabase/schema.sql`：canonical schema、RPC、RLS、触发器、publication、bucket 策略。
- `supabase/migrations/`：生产库增量迁移。
- `lib/authLocal.ts`：匿名成员本地 session。
- `lib/supabaseAuthClient.ts`：Supabase Auth 客户端。
- `lib/supabaseAdmin.ts`：service role 服务端客户端。

## 输出要求

完成任务后必须用中文输出：

- 修改内容
- 修改文件
- migration / API / RPC 影响
- 验证结果
- 风险点
- 下一步建议

如果某项验证无法本地完成，必须明确说明原因和需要的手动验证步骤。
