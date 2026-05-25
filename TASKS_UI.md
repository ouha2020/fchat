# TASKS_UI.md — UI Refactor 任务池

本文档是 UI 重构的任务来源。每轮只能选择一个足够小的任务，按 `CODEX_UI_LOOP.md` 执行，并在 `docs/iteration-log/_latest.md` 记录。

## 任务优先级规则

- P0：会造成用户无法使用、权限/隐私误导、消息/日程关键路径破坏、移动端横向滚动、输入栏/抽屉遮挡、关键按钮不可点击、明显 a11y 失败的问题。
- P1：高频页面的布局不稳定、组件样式漂移、长文本溢出、重复样式导致维护风险、明显触控不适。
- P2：中频页面一致性、空态/加载/错误态完善、视觉层级打磨、减少局部 Tailwind 重复。
- P3：低风险 polish、动效微调、图标资产整理、非关键页面美化。
- 安全、权限、数据库、Push payload、Service Worker、RPC 行为相关问题优先回到 `AGENTS.md`，不能当作普通 UI polish 处理。

## Phase 0 — 治理与基线

- [x] 创建 UI 治理文档：`UI_RULES.md`、`DESIGN_SYSTEM.md`、`TASKS_UI.md`、`CODEX_UI_LOOP.md`。
- [x] 创建迭代日志模板和最新基线：`docs/iteration-log/_template.md`、`docs/iteration-log/_latest.md`。
- [x] 记录框架、包管理器、路由、组件、样式系统和验证脚本。
- [ ] 后续每轮 UI 任务前先读本文件和最近迭代日志。

## Phase 1 — 全量 UI 审计

- [x] P1：建立页面清单，标注每个页面的关键用户路径、数据依赖和手动验证点。报告：`docs/agent-reports/20260525-phase1-page-inventory.md`。
- [x] P1：建立组件清单，标注展示组件、交互组件、业务敏感组件、PWA/Push 支撑组件。报告：`docs/agent-reports/20260525-phase1-component-inventory.md`。
- [x] P1：审计现有全局语义类和页面内重复 Tailwind 片段，找出可抽取候选。报告：`docs/agent-reports/20260525-phase1-style-semantics.md`。
- [x] P1：审计 360px、390px、430px 移动宽度下的横向滚动、文字溢出、按钮拥挤。报告：`docs/agent-reports/20260525-phase1-mobile-widths.md`。
- [x] P1：审计聊天页键盘、录音、工具栏、悄悄话、重要通知、消息操作菜单的层级关系。报告：`docs/agent-reports/20260525-phase1-chat-layering.md`。
- [x] P1：审计日程页详情面板、筛选、月/周/日切换、评论输入和提醒状态。报告：`docs/agent-reports/20260525-phase1-schedule-layering.md`。

## Phase 2 — 设计系统基础任务

- [x] P1：把按钮、输入、标签、状态提示的使用规则补齐到 `DESIGN_SYSTEM.md`。完成：`DESIGN_SYSTEM.md` Phase 2 设计系统规则补齐。
- [x] P1：梳理 `app/globals.css` 中已有语义类，按 keep / narrow scope / extraction candidate / deprecation plan 分类。完成：`DESIGN_SYSTEM.md` app/globals.css 语义类分类。
- [x] P1：定义 Dialog、Sheet、Toast、Action Menu 的层级、visual viewport、dismiss layer、safe-area 和焦点策略。完成：`DESIGN_SYSTEM.md` 浮层层级与视口策略。
- [x] P2：定义图标资产规则，决定是否继续使用 `public/ui-icons` 或引入统一图标库。完成：`DESIGN_SYSTEM.md` 图标资产规则，当前继续使用 `public/ui-icons`，图标库作为后续独立评估。
- [x] P2：定义颜色使用矩阵，明确 schedule tone 中 `fuchsia` / `cyan` 是否纳入系统色，避免页面漂移为单一蓝紫色或企业后台风。完成：`DESIGN_SYSTEM.md` 颜色使用矩阵；`fuchsia` / `cyan` 仅限 `/schedule` 类型 tone，不纳入全局状态色。
- [x] P2：定义 `info-note`、`warning-note`、tone chip / status badge 的语义和长文本策略，并完成低风险基础实现。完成：`DESIGN_SYSTEM.md` 语义规则、`app/globals.css` 语义类、账号/设置低风险提示替换。
- [ ] P3：整理动效准则，统一 `native-press`、toast/dialog 入场、重要高亮、mood-tree 动效边界。

## Phase 3 — 组件任务

- [x] P1：按钮组件/语义类审计，确保主要、次要、危险、图标按钮触控区和 disabled 态一致。完成：修复 `app/globals.css` 中按钮 size modifier 顺序，确保 `components/ui/Button.tsx` 的 variant + size 组合生效；lint/typecheck/build/diff 和 `/join` 360px/390px/430px 烟测通过。
- [x] P1：表单控件审计，确保 label、错误提示、loading、长文案在移动端稳定。完成：强化 `field` / `label` / `field-hint` / `field-error-text` 的收缩与断行规则，并为 `components/ui/TextField.tsx` 错误文本补充 `aria-errormessage`；lint/typecheck/build/diff 和 `/forgot-password` 360px/390px/430px 烟测通过。
- [x] P1：Dialog 局部修复，确保移动端 max-height、内部滚动、footer 换行、键盘、焦点、底部安全区稳定。完成：抽取 `dialog-panel` / `dialog-actions`，补充 modal role/label、初始焦点和焦点恢复；lint/typecheck/build/diff 和临时本地 smoke route 的 360px/390px/430px Dialog 验证通过，临时路由已删除。
- [x] P1：Toast 审计，确保不会遮挡聊天输入栏、sheet 和关键底部操作，并定义 safe-area 偏移。完成：抽取 `toast-viewport` / `toast-bar` 语义，移动端 bottom offset 叠加 safe-area，Toast 可点击关闭且长文案断行；lint/typecheck/build/diff 和临时本地 smoke route 的 360px/390px/430px Toast 避让验证通过，临时路由已删除。
- [x] P1：ChatInput 局部 UI 审计，只处理可视层和弹层高度/360px compact，不改变发送、录音、上传、位置、悄悄话逻辑。完成：更多操作和悄悄话选择器按输入栏上方剩余 visual viewport 动态设置最大高度；抽取 `chat-input-actions-popover` / `chat-input-whisper-popover` / `chat-input-whisper-list`；补齐 `aria-controls`、dialog/menu focus；lint/typecheck/build/diff 与临时本地 smoke route 的 360px/390px/430px、360px 高度压缩验证通过，临时路由已删除。
- [ ] P1：ChatMessage 局部 UI 审计，只处理气泡、长文本、媒体展示和操作入口；action menu viewport clamp 已在 Phase 4 单点任务完成，不改变消息可见性。
- [x] P2：ImportantNoticeBar 审计，确保展开态、长标题、已读状态和移除按钮稳定。完成：`docs/agent-reports/20260525-phase3-important-notice-bar-orchestrator.md`；`ImportantNoticeBar` 增加 `aria-controls`、展开/收起可读 label、`role=list/listitem`、可聚焦 row ring、`32dvh` 展开列表高度、长预览/已读状态单行截断与 `title` 全量信息；移除按钮改为 `aria-hidden` SVG 并保留 `aria-label` / `title`；临时 `/important-notice-smoke` 在 360px/390px/430px 验证无横向溢出、3 个 listitem、移除按钮 40px、选择/移除交互可用、console 无错误；未改重要通知 RPC、消息可见性、Push、Service Worker、Realtime、Storage、权限或数据库；临时 smoke route 已删除。
- [x] P2：RoleSelect / RoleBadge 审计，确保角色视觉一致、移动端触控友好，并补齐 selected state 语义。完成：`docs/agent-reports/20260525-phase3-role-select-badge-orchestrator.md`；`RoleSelect` 增加 `radiogroup` / `radio` / `aria-checked`，选中态增加可见 check 标记并保留 focus ring，360px 图标尺寸收紧；`RoleBadge` 接入 `tone-chip` 语义和 title；临时 `/role-select-smoke` 在 360px/390px/430px 验证无横向溢出、3 个 radio、1 个 checked、1 个 check 标记、3 个 badge；未改 role 值、join/create-family 提交逻辑、权限、RPC、API 或数据库；临时 smoke route 已删除。
- [x] P1：AssistantActionCard / KeeperRequestSheet 审计，确保 action row 可换行/截断、sheet safe-area 稳定，且不会变成泛 AI 卡片堆叠风。完成：抽取 `assistant-action-row` / `assistant-action-button` 和 `sheet-backdrop` / `sheet-panel` / `sheet-body-safe` / `sheet-actions`；lint/typecheck/build/diff 和临时本地 smoke route 的 360px/390px/430px action row + sheet 验证通过，临时路由已删除。
- [x] P2：AudioBubble 审计，确保播放态、已播放态、重要高亮与屏幕阅读体验清晰。完成：`docs/agent-reports/20260525-phase3-audio-bubble-orchestrator.md`；`AudioBubble` 增加本地化播放/暂停/未播放文案、`aria-label`、`aria-pressed`、`title`、未播放 `sr-only` 状态、focus-visible ring，并将装饰性播放图标和波形设为 `aria-hidden`；临时 `/audio-bubble-smoke` 在 360px/390px/430px 验证无横向溢出、2 个按钮具备可读标签和 pressed 状态、未播放文本可被读屏获取、重要高亮存在、按钮高度 48px；未改音频上传、消息发送、媒体 URL、RPC、Push、Service Worker、Realtime、Storage、权限或数据库；临时 smoke route 已删除。

## Phase 4 — 页面任务

- [x] P1：`/chat` read-only 回归审计与最小 `mid` guard 修复。完成：`docs/agent-reports/20260525-phase4-chat-regression-orchestrator.md`；将 `/chat?mid=` 通知定位 guard 从一次性 boolean 改为按 message id 去重，允许同一 mounted chat page 继续处理后续不同通知目标；未改 Service Worker、Push payload、RPC、Realtime、Storage 或数据库。
- [ ] P1：真机/PWA 手动验证连续两个不同 `mid` 通知点击，确认每次都能滚动并高亮目标消息；覆盖 iOS/Android 可用设备、前台/后台/已打开 chat client。
- [x] P2：`ChatInput` 录音中 visual viewport / orientation 变化专项审计。完成：`docs/agent-reports/20260525-phase4-chatinput-recording-viewport.md`；采用隐私取消策略而不是静默重算 release/cancel safe rect；录音中 visual viewport `resize` / `scroll`、窗口 `resize` 和 `orientationchange` 会取消录音并展示隐私提示；未改录音服务、上传、发送、RPC、Push、Service Worker 或数据库；更新三语提示文案并用临时 route 验证 360px/390px/430px 授权 Dialog 无横向溢出，临时 route 已删除。
- [x] P2：`ChatMessage` 长文本/长地址/媒体/悄悄话 bubble smoke。完成：`docs/agent-reports/20260525-phase4-chatmessage-bubble-smoke.md`；临时 route 渲染真实 `ChatMessage` 覆盖长昵称、长无空格文本、长地址、图片、语音、悄悄话、删除和系统消息；360px/390px/430px 浏览器 smoke 未复现横向溢出，因此未改永久 `ChatMessage` 代码；临时 route 已删除。
- [ ] P0：`/chat` 回归审计：动态视口、输入栏、Realtime 补偿、消息定位、悄悄话、Push 点击回流和连续两个 `mid` 通知点击。
- [x] P1：`/chat` 消息 action menu viewport clamp。完成：菜单保留原始触发点并按实际 DOM 尺寸、`window.visualViewport` 和底部 composer 边界重算位置；dismiss/menu 层级沉淀为 `chat-action-dismiss-layer` / `chat-action-menu`；补齐 `role="menu"` / `menuitem`、Escape 关闭和焦点恢复；lint/typecheck/build/diff 与临时本地 smoke route 的 360px/390px/430px 验证通过，临时路由已删除。
- [ ] P0：`/schedule` 回归审计：月/周/日切换、详情面板键盘、评论输入、负责人响应、提醒状态和私密可见性文案。进展：`docs/agent-reports/20260525-phase4-schedule-regression-orchestrator.md`；已补 `ScheduleDetailPanel` modal 语义、初始焦点、焦点恢复、Tab 焦点圈、Escape 行为、visual viewport 高度跟随，并用临时 fixture 验证 360px/390px/430px 宽、520px 压缩高度下拒绝原因、评论输入/发送和编辑保存可触达；临时 fixture 已删除；未改日程 RPC、权限、Push、Service Worker、Realtime 或数据库；真实 360px/390px/430px 软键盘、私密可见性矩阵和提醒 Push 回流仍需验证后才能关闭本 P0 项。
- [x] P1：`/settings` 审计：Push 开关、家庭管理、owner 敏感操作、健康入口的视觉层级，以及长值 Row / DiagRow 收缩策略。完成：`docs/agent-reports/20260525-phase4-settings-orchestrator.md`；新增 `settings-row-*`、`settings-family-code-*`、`settings-action-grid` 语义，设置页长家庭名、长家庭代码、Push 诊断值、按钮组和提醒健康入口在 360px/390px/430px smoke 中无横向溢出；未改 Push、API、RPC、Service Worker、权限或数据库逻辑；临时 smoke route 已删除。
- [x] P1：`/me` 审计：头像、个人看板、今日事项、长昵称和空态。完成：`docs/agent-reports/20260525-phase4-me-orchestrator.md`；页面头部、身份卡、头像操作、个人看板标题、事项卡片 meta chip、空态和私密锁标识完成最小布局/a11y 修复；临时 `/me-layout-smoke` 在 360px/390px/430px 验证无横向溢出，私密锁有屏幕阅读器标签，最小交互目标 36px；未改 avatar 上传、个人看板 RPC、日程跳转、Push、Service Worker、权限或数据库逻辑；临时 smoke route 已删除。
- [x] P1：`/members` 审计：成员列表、角色、移除/守护入口、长昵称。完成：`docs/agent-reports/20260525-phase4-members-orchestrator.md`；成员行拆为身份区和操作区，360px/390px 保持上下布局、430px 起回到左右布局；长昵称、管家名、最近活跃文案和 badge 可收缩/换行；移除按钮提升到 `min-h-10`，守护/悄悄话入口保留可读标签；临时 `/members-layout-smoke` 在 360px/390px/430px 验证无横向溢出；未改成员 RPC、移除 API、owner Auth、Realtime、Push、Service Worker、权限或数据库逻辑；临时 smoke route 已删除。
- [ ] P2：账号与家庭流程页面审计：`/`、`/verify-family-code`、`/create-family`、`/join`、`/login`、`/register`、`/forgot-password`、`/reset-password`。
- [ ] P2：`/admin/system-health` 审计：保持运维清晰，summary 在 360px 不拥挤，但不要扩展为大面积企业 dashboard。
- [ ] P3：`/offline`、`/image-preview`、`/mood-tree` 审计：完善边界状态、图片预览顶部按钮换行和视觉一致性。

## Phase 5 — A11y 任务

- [ ] P0：补齐所有 icon-only 按钮的 `aria-label` 或 `title`。
- [ ] P1：确认表单控件有 label，搜索/筛选控件有屏幕阅读名称。
- [ ] P1：确认 Dialog/Sheet 可用键盘完成，危险操作有确认，并补齐 modal 语义、焦点进入/恢复和 Escape 行为。
- [ ] P1：确认消息 action menu 有合理 role、Escape 关闭、焦点返回和 dismiss layer。
- [ ] P1：确认焦点态可见，`focus-visible` 没有被覆盖。
- [ ] P2：确认状态不只依赖颜色表达，尤其是私密日程紧凑锁标识和 RoleSelect selected state。
- [ ] P2：确认动效尊重 `prefers-reduced-motion`。

## Phase 6 — Performance 任务

- [ ] P1：聊天页 UI 改造后检查首屏渲染、滚动流畅度、长列表更新抖动。
- [ ] P1：日程页 UI 改造后检查月视图、筛选、详情面板打开性能。
- [ ] P2：审计图片和头像尺寸，避免布局跳动和过大资源。
- [ ] P2：审计动画和阴影，避免移动端 GPU/合成层负担过高。
- [ ] P2：检查是否有可拆分的重组件，但不得破坏实时状态或交互时序。

## Phase 7 — Validation 任务

- [ ] P0：每个 UI 代码任务运行 `npm run lint`。
- [ ] P0：每个 UI 代码任务运行 `npm run typecheck`。
- [ ] P0：每个 UI 代码任务运行 `npm run build`。
- [ ] P0：每个任务运行 `git diff --check`。
- [ ] P1：手动检查 360px、390px、430px，无横向滚动、无文字溢出、关键按钮可触达。
- [ ] P1：聊天相关改动手动回归消息发送、图片、语音、位置、悄悄话、通知点击。
- [ ] P1：日程相关改动手动回归新增、编辑、删除、筛选、评论、负责人响应、提醒状态。
- [ ] P1：浏览器/真机补测 W4 未完成的 360px、390px、430px 宽度检查；本轮 in-app Browser 被 `net::ERR_BLOCKED_BY_CLIENT` 阻断。
- [ ] P2：记录缺失的自动化脚本：当前没有 `test`、`test:e2e`、`test:lhci`。
