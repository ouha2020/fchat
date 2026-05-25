# W6 Phase 1 Schedule Layering Audit

日期：2026-05-25 JST
Worker：W6
模式：只读审计，报告文件除外

## Scope / Files Reviewed

- 治理上下文：`AGENTS.md`, `UI_RULES.md`, `DESIGN_SYSTEM.md`, `TASKS_UI.md`, `CODEX_UI_LOOP.md`, `PHASE_STATUS.md`, `docs/iteration-log/_latest.md`, `docs/agent-reports/README.md`
- 页面与样式：`app/schedule/page.tsx`, `app/globals.css`, `app/layout.tsx`
- 日程客户端与类型：`lib/scheduleService.ts`, `types/schedule.ts`
- 日程 API / Push 边界：`app/api/schedule/collaboration-notify/route.ts`, `lib/scheduleCollaborationPushServer.ts`
- 数据库/RPC 静态边界：`supabase/schema.sql` 中 schedule list/search/get/create/update/delete/status、context event、Realtime event、reminder status/snooze/rules 相关定义

未运行本地浏览器或真机验证；本报告为静态代码审计结果。

## Findings

### P0

未发现已确认的 P0。静态阅读下，日程列表、搜索、详情、评论、负责人响应、提醒状态和 Realtime 信号都经过 RPC 或服务端路径；私密日程内容没有明显通过前端过滤替代数据库权限的情况。

### P1

1. 详情面板的评论输入与编辑保存按钮存在键盘遮挡风险。
   证据：详情层使用 `fixed inset-0 z-50` 和 `h-[92dvh] max-h-[92dvh]`（`app/schedule/page.tsx:1630`-`1631`），评论 composer 在面板内部底部（`app/schedule/page.tsx:2027`-`2094`），编辑保存按钮在可滚动编辑区末尾（`app/schedule/page.tsx:1655`-`1688`）。当前只处理 `env(safe-area-inset-bottom)`，没有看到 visual viewport、键盘高度、focus scrollIntoView 或 sticky footer 的专门处理。iOS/Android PWA 键盘弹出时，私聊对象选择、评论文本框、发送按钮、拒绝理由输入和编辑保存按钮可能被键盘覆盖。若真机复现会升级为 P0。

2. 详情面板是视觉 modal/sheet，但缺少 modal 语义和焦点边界。
   证据：面板外层为固定遮罩（`app/schedule/page.tsx:1630`），关闭按钮在 `app/schedule/page.tsx:1642`，但未见 `role="dialog"`、`aria-modal`、可读标题绑定、初始焦点、焦点困在面板内、关闭后焦点恢复或 Escape 关闭。背景中的日程卡、筛选和切换按钮仍可能被键盘焦点访问，移动端读屏和硬件键盘会有层级错乱风险。

3. 日程卡和月视图日期格把“打开详情”的 role button 与内部按钮混放，交互语义容易冲突。
   证据：`ScheduleCard` 整个 `article` 是 `role="button"`/`tabIndex=0`（`app/schedule/page.tsx:1361`-`1373`），内部又有完成/删除按钮（`app/schedule/page.tsx:1451` 起）。月视图日期格是 `role="button"`（`app/schedule/page.tsx:3059`-`3086`），内部又放日程 chip 按钮（`app/schedule/page.tsx:3146`-`3153`）。点击传播已经局部处理，但读屏和键盘用户会遇到嵌套交互目标，容易误触打开详情或无法清楚区分“打开/完成/删除”。

### P2

1. 私密日程的评论可见性文案存在隐私边界歧义。
   证据：打开任何详情时默认 `contextVisibility` 重置为 `"family"`（`app/schedule/page.tsx:480`-`482`），评论区仍展示公开/私密切换（`app/schedule/page.tsx:2028`-`2057`）。数据库层在私密日程上会把 “family” context event 只投递给 `schedule_item_is_visible_to_member` 的成员，也就是创建者/负责人（`supabase/schema.sql:9615`-`9622`，可见性函数在 `supabase/schema.sql:8495`-`8506`），所以静态上未见全家泄漏；但 UI 文案可能让用户误以为私密日程评论会变成全家公开，或反过来以为“公开”就是全家可见。

2. 展开提醒状态后，详情内容区可能被上方 shrink 区域挤压。
   证据：提醒状态是 `details` 且展开内容最高 `28dvh`（`app/schedule/page.tsx:1744`-`1834`），对话区是剩余空间内的 `flex-1`（`app/schedule/page.tsx:1836`-`2095`），底部编辑/完成/删除操作又是 `shrink-0`（`app/schedule/page.tsx:2111`-`2137`）。长标题、长备注、展开提醒状态、负责人响应卡和键盘同时出现时，评论列表和输入区可能被压到很小，影响协作闭环。

3. 紧凑场景的私密状态对读屏不可见。
   证据：`MyTodaySection` 中私密项仅追加 `LockBadge`（`app/schedule/page.tsx:2752`-`2754`），月视图 chip 仅追加 `MiniLockBadge`（`app/schedule/page.tsx:3155`），锁图标 SVG 为 `aria-hidden`（`app/schedule/page.tsx:3164`-`3166`, `3183`-`3185`）。列表主卡有文字可见性标签，但这些紧凑入口没有等价的 `sr-only` 文本。

4. 负责人拒绝原因在家庭日程中会成为家庭可见内容，UI 未提示范围。
   证据：负责人响应表单允许填写拒绝理由（`app/schedule/page.tsx:1866`-`1899`），RPC 会把 declined note 写入时间线文本（`supabase/schema.sql:9900`-`9912`）。对家庭日程这是 family-visible；静态上符合现有可见性模型，但 UI 没有提醒“拒绝理由会被可见成员看到”，容易产生轻微隐私预期偏差。

### P3

1. 筛选展开按钮只有 `aria-expanded`，没有明确 `aria-controls` 指向筛选区域（`app/schedule/page.tsx:2594`-`2608`）。这不是阻断问题，但后续做 a11y 清理时可以一起补。

2. 详情关闭按钮使用 `commonCancel` 文案（`app/schedule/page.tsx:1642`-`1644`）。功能可用，但作为 sheet 关闭入口，后续可统一成更明确的“关闭”语义或 aria-label。

## Security / Architecture Notes

- 日程客户端读写均通过 `lib/scheduleService.ts` 的 RPC 调用，并传递 `member_id + member_token`，例如 list/search/get/create/update/delete/context/reminder/response 都在 `lib/scheduleService.ts:41`-`429`。
- `list_schedule_items_for_member` 与 `search_schedule_items_for_member` 在 SQL 层限制 family、未删除、时间范围和 `family OR creator OR assignee` 可见性（`supabase/schema.sql:8264`-`8336`, `6930`-`7060`）。
- `get_schedule_item_for_member` 同样在 SQL 层限制 family 和私密可见性（`supabase/schema.sql:7220`-`7284`）。静态上，管理员不会仅凭 admin 身份读取别人私密日程。
- 更新/删除/提醒规则修改允许创建者、负责人或 family 日程管理员；私密日程不会给管理员额外权限（`supabase/schema.sql:9130`-`9136`, `9349`-`9355`, `11025`-`11030`）。
- context event 通过 `family_context_event_recipients` 投递；私密 context event 只给发送者与接收者，非私密 context event 也只给能看到该日程的成员（`supabase/schema.sql:9605`-`9623`）。
- Realtime 事件只包含轻量 schedule signal，按可见成员插入 `family_schedule_events`（`supabase/schema.sql:8528`-`8538`, `9632`-`9637`），前端收到后再 RPC 拉详情（`app/schedule/page.tsx:653`-`659`）。
- 提醒状态 RPC 对成员明细做了收敛：当前成员总能看到自己的 delivery；创建者或 family 日程管理员可看 family 日程成员 delivery；私密日程管理员不会默认看到成员明细（`supabase/schema.sql:10717`-`10724`, `10753`-`10785`）。
- 协作 Push 路径使用 POST body 传 member token 并先通过 `get_schedule_item_for_member` 校验可见性（`app/api/schedule/collaboration-notify/route.ts:25`-`47`, `lib/scheduleCollaborationPushServer.ts:127`-`137`）。Push payload 是泛化文案和 `/schedule?item=<id>`，未包含标题、备注、评论正文、坐标或媒体 URL（`lib/scheduleCollaborationPushServer.ts:76`-`86`）。仍建议手动验证服务端日志不会记录 body 中的 token。

## Minimal Next Tasks

1. 做一个最小 UI 任务：`/schedule` 详情 sheet 键盘与 modal a11y 修复。范围只碰详情层，目标是键盘弹出时 comment composer、私聊对象选择、拒绝理由、编辑保存按钮仍可见，并补齐 dialog 语义、焦点进入/恢复和 Escape/遮罩关闭策略。
2. 做一个最小 UI 文案任务：私密日程详情中的评论可见性改成不误导的参与者语义，例如私密日程下把 “公开” 显示为“创建者和负责人可见”，并保持 RPC 规则不变。
3. 拆分日程卡与月视图日期格的交互目标：避免 `role=button` 容器中嵌套按钮，把“打开详情”和“完成/删除/chip 打开”变成明确、可聚焦的独立目标。
4. 给 `LockBadge` / `MiniLockBadge` 的紧凑入口增加屏幕阅读器文本或 aria-label，保证私密状态不只靠颜色/图标。
5. 在正式实现前补一份手动回归脚本，覆盖 360/390/430 宽度、iOS/Android PWA 键盘、私密日程 A/B/C/admin 可见性、提醒状态展开、负责人响应和评论发送。

## Manual Validation Suggestions

- 360px、390px、430px：月/周/日切换、筛选展开/清空、长标题/长昵称/长备注、月视图 7 列无横向滚动。
- 详情 panel：打开长内容日程，展开备注和提醒状态，滚动对话，输入评论，切换私密对象，确认发送按钮不被键盘遮挡。
- 编辑模式：标题、日期、时间、负责人、提醒 chip、重复规则、长备注输入时，保存/取消按钮在键盘弹出后仍可触达。
- 负责人响应：负责人账号打开日程，接受、拒绝、填写 300 字拒绝理由；非负责人账号不应看到响应操作。
- 私密边界：A 创建私密日程指派 B；A/B 可在 list/search/get/context/reminder 中看到，C 和非相关 admin 不可见；`/schedule?item=<id>` 直达应显示不可用，不泄露标题/备注。
- 提醒状态：family 日程创建者/admin 可看到聚合成员投递状态；私密日程非参与 admin 不可见；Push 通知不包含标题、备注、评论、位置或媒体 URL。
- Realtime/PWA：私密日程评论、负责人响应、提醒状态变化只唤醒可见成员，收到信号后仍通过 RPC 拉完整详情。

## Validation Performed

- 静态阅读：完成。
- `git diff --check`：passed，退出码 0；仅输出既有 tracked 文件的 LF/CRLF 工作区提示，未发现 whitespace error。
- 报告文件尾随空白检查：passed。
- 未运行 `npm run lint`、`npm run typecheck`、`npm run build`：本任务为 report-only，未改代码。
- 未做浏览器/真机验证：本轮只读审计，已在上方列出建议手动验证步骤。

## File Modification Statement

本轮只新增/修改指定报告文件：`docs/agent-reports/20260525-phase1-schedule-layering.md`。未修改 `app/schedule/page.tsx`、`lib/scheduleService.ts`、schedule-related services、`TASKS_UI.md`、`PHASE_STATUS.md`、`docs/iteration-log/_latest.md`，也未修改任何报告之外的文件。
