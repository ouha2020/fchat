# UI Iteration Log - Phase 3 ImportantNoticeBar

## 基本信息

- 日期：2026-05-25 JST
- 执行者：Codex Orchestrator
- 任务来源：用户确认继续执行 UI refactor 治理任务。
- 优先级：P2
- 范围：`components/ImportantNoticeBar.tsx`

## audit

- 阅读文件：`TASKS_UI.md`、`PHASE_STATUS.md`、`DESIGN_SYSTEM.md`、`components/ImportantNoticeBar.tsx`、相关 i18n key 和重要通知服务引用。
- 当前问题：展开按钮缺少 `aria-controls`；展开列表没有 list/listitem 语义；固定 `120px` 列表高度偏死；移除按钮使用视觉字符；row 焦点态不明显；长已读名单存在移动端稳定性风险。
- 数据流 / 权限边界：本轮只处理组件 UI/a11y，不改重要通知 RPC、消息可见性、Push、Service Worker、Realtime、Storage、权限或数据库。

## select

- 选中任务：Phase 3 P2 `ImportantNoticeBar` 审计。
- 本轮目标：保证展开态、长标题/预览、已读状态和移除按钮在 360px/390px/430px 下稳定。
- 非目标：不改重要通知列表获取、read-state 请求、移除 RPC、消息定位或通知投递逻辑。

## implement

- 为展开按钮增加 `useId`、`aria-controls` 和展开/收起可读 label。
- 展开列表增加 `role="list"`，每条通知增加 `role="listitem"`。
- 展开列表从固定 `max-h-[120px]` 改为 `max-h-[32dvh]` 并保持内部滚动。
- 通知 row 增加焦点 ring、`min-h-10` 和 title，长 sender/preview/read-state 保持单行截断。
- 移除按钮从文本符号改为 inline SVG，SVG 标记 `aria-hidden`，按钮保留 `aria-label` / `title`。
- 已读名单分隔符改为 ASCII `, ` 和 `/`，并用 `title` 保存完整 read-state 文本。
- 临时新增 `/important-notice-smoke` 进行浏览器验证，验证后已删除并清理 `.next`。

## validate

- 浏览器 360px：临时 `/important-notice-smoke` 通过；无横向滚动，展开后 3 个 listitem，移除按钮 40px，选择和移除交互可用。
- 浏览器 390px：通过；无横向滚动或溢出元素。
- 浏览器 430px：通过；无横向滚动或溢出元素。
- 浏览器 console：无 error / warning。
- `npm run lint`：通过。
- `npm run typecheck`：通过。
- `npm run build`：通过，37 routes/static pages，临时 smoke route 未进入最终路由表。
- `git diff --check`：通过，仅有既有 LF/CRLF working-copy warnings。

## review

- UX review：重要通知仍保持紧凑顶部条，不扩展成大卡片；展开列表可滚动，长内容用截断保持聊天可见区域。
- A11y review：展开状态、列表语义、移除按钮名称和焦点态补齐；视觉移除图标不重复进入读屏树。
- Performance review：只改组件属性和少量 class，无新增请求、订阅或重组件。
- Security review：未改重要通知权限、RPC、Push payload、媒体 URL、token、日志或数据库。

## record

- 新增报告：`docs/agent-reports/20260525-phase3-important-notice-bar-orchestrator.md`。
- 更新任务账本：`TASKS_UI.md` 中 `ImportantNoticeBar` P2 标记完成。
- 更新设计系统：记录 `ImportantNoticeBar` 展开、长文本、读状态和移除按钮语义基线。
- 风险：真实 authenticated `/chat` 中重要通知 read-state 拉取和移除 RPC 未执行；本轮未修改这些链路。
- 下一步：低风险页面可继续账号与家庭流程页面审计；高风险项仍应在具备真实设备/会话时验证 PWA `/chat?mid=` 和 authenticated `/schedule`。
