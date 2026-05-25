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

- [ ] P1：把按钮、输入、标签、状态提示的使用规则补齐到 `DESIGN_SYSTEM.md`。
- [ ] P1：梳理 `app/globals.css` 中已有语义类，按 keep / narrow scope / extraction candidate / deprecation plan 分类。
- [ ] P1：定义 Dialog、Sheet、Toast、Action Menu 的层级、visual viewport、dismiss layer、safe-area 和焦点策略。
- [ ] P2：定义图标资产规则，决定是否继续使用 `public/ui-icons` 或引入统一图标库。
- [ ] P2：定义颜色使用矩阵，明确 schedule tone 中 `fuchsia` / `cyan` 是否纳入系统色，避免页面漂移为单一蓝紫色或企业后台风。
- [ ] P2：定义 `info-note`、`warning-note`、tone chip / status badge 的语义和长文本策略。
- [ ] P3：整理动效准则，统一 `native-press`、toast/dialog 入场、重要高亮、mood-tree 动效边界。

## Phase 3 — 组件任务

- [ ] P1：按钮组件/语义类审计，确保主要、次要、危险、图标按钮触控区和 disabled 态一致。
- [ ] P1：表单控件审计，确保 label、错误提示、loading、长文案在移动端稳定。
- [ ] P1：Dialog 局部修复，确保移动端 max-height、内部滚动、footer 换行、键盘、焦点、底部安全区稳定。
- [ ] P1：Toast 审计，确保不会遮挡聊天输入栏、sheet 和关键底部操作，并定义 safe-area 偏移。
- [ ] P1：ChatInput 局部 UI 审计，只处理可视层和弹层高度/360px compact，不改变发送、录音、上传、位置、悄悄话逻辑。
- [ ] P1：ChatMessage 局部 UI 审计，只处理气泡、长文本、媒体展示、操作入口和 action menu viewport clamp，不改变消息可见性。
- [ ] P2：ImportantNoticeBar 审计，确保展开态、长标题、已读状态和移除按钮稳定。
- [ ] P2：RoleSelect / RoleBadge 审计，确保角色视觉一致、移动端触控友好，并补齐 selected state 语义。
- [ ] P1：AssistantActionCard / KeeperRequestSheet 审计，确保 action row 可换行/截断、sheet safe-area 稳定，且不会变成泛 AI 卡片堆叠风。
- [ ] P2：AudioBubble 审计，确保播放态、已播放态、重要高亮与屏幕阅读体验清晰。

## Phase 4 — 页面任务

- [ ] P0：`/chat` 回归审计：动态视口、输入栏、Realtime 补偿、消息定位、悄悄话、Push 点击回流和连续两个 `mid` 通知点击。
- [ ] P0：`/schedule` 回归审计：月/周/日切换、详情面板键盘、评论输入、负责人响应、提醒状态和私密可见性文案。
- [ ] P1：`/settings` 审计：Push 开关、家庭管理、owner 敏感操作、健康入口的视觉层级，以及长值 Row / DiagRow 收缩策略。
- [ ] P1：`/me` 审计：头像、个人看板、今日事项、长昵称和空态。
- [ ] P1：`/members` 审计：成员列表、角色、移除/守护入口、长昵称。
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
