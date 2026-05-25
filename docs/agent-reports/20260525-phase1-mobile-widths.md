# W4 Phase 1 Mobile Width Risk Audit

日期：2026-05-25 JST
范围：360px、390px、430px 移动宽度风险审计
模式：report-only；未修改页面、组件、样式、服务、治理状态或业务逻辑文件。

## Scope / Files Reviewed

已阅读治理文件：

- `AGENTS.md`
- `UI_RULES.md`
- `DESIGN_SYSTEM.md`
- `TASKS_UI.md`
- `CODEX_UI_LOOP.md`
- `PHASE_STATUS.md`
- `docs/iteration-log/_latest.md`

静态审阅的主要 UI 面：

- 全局布局与样式：`app/layout.tsx`, `app/globals.css`
- 聊天相关：`app/chat/page.tsx`, `components/ChatInput.tsx`, `components/ChatMessage.tsx`, `components/AssistantActionCard.tsx`, `components/ImportantNoticeBar.tsx`, `components/AudioBubble.tsx`
- 日程相关：`app/schedule/page.tsx`
- 浮层/反馈：`components/Dialog.tsx`, `components/KeeperRequestSheet.tsx`, `components/Toast.tsx`
- 页面：`app/page.tsx`, `app/join/page.tsx`, `app/register/page.tsx`, `app/me/page.tsx`, `app/members/page.tsx`, `app/settings/page.tsx`, `app/admin/system-health/page.tsx`, `app/image-preview/page.tsx`, `app/offline/page.tsx`, `app/mood-tree/page.tsx`
- 小组件：`components/RoleSelect.tsx`, `components/ui/BottomTabBar.tsx`, `components/ui/Button.tsx`, `components/ui/TextField.tsx`

Browser check:

- 本机已有 `localhost:3000` 监听，未启动新服务。
- 尝试用 in-app Browser 在 360/390/430 viewport 打开公开路由 `/`, `/join`, `/register`, `/admin/system-health`, `/image-preview`；浏览器侧均返回 `net::ERR_BLOCKED_BY_CLIENT`。
- 已重置临时 viewport。
- 为避免读取真实家庭数据，未用浏览器打开可能含本地 session 的 `/chat`, `/schedule`, `/settings`, `/me`, `/members`。

## Findings

### P0

未发现可静态确认的 P0。

正向基线：

- `app/chat/page.tsx:2670` 使用 `var(--chat-viewport-height, 100dvh)`，没有把聊天页退回 `h-screen`。
- `components/ChatInput.tsx:57-58` 与 `components/ChatInput.tsx:551` 保留底部输入栏和 `safe-area-inset-bottom`。
- `app/globals.css:178-180` 的 bottom tab bar 已处理底部 safe area。

### P1

1. Dialog 长内容和键盘下的底部按钮可达性风险
   文件：`components/Dialog.tsx:266-274`, `components/Dialog.tsx:293-313`, `components/Dialog.tsx:468-578`, `components/Dialog.tsx:616-689`, `components/Dialog.tsx:727-800`
   风险：overlay 会跟随 `visualViewport`，但 dialog card 本身没有 `max-height` 和内部滚动区。管理密码/账号密码类弹窗内容较长，在 360px 宽度叠加键盘时，底部确认按钮可能需要页面级滚动才能触达；按钮行也是固定横向 `flex gap-3`，长翻译文案会拥挤。
   最小后续任务：为 Dialog shell 定义移动端 `max-h`、内部滚动和 safe-area padding；确认/取消按钮在窄宽或长文案时允许换行或纵向堆叠。

2. 聊天消息 action menu 没有 viewport clamp
   文件：`app/chat/page.tsx:2687-2690`
   风险：菜单使用 long-press 坐标直接设置 `left/top`，`min-w-44` 但没有根据 viewport 右/下边界修正。360px 下靠右长按时，菜单可能部分出屏，属于关键消息操作不可达风险。
   最小后续任务：计算菜单宽高后 clamp 到 viewport 内，至少限制 `left <= innerWidth - menuWidth - margin`。

3. ChatInput 常态输入栏在 360px 下按钮密度偏高
   文件：`components/ChatInput.tsx:663-727`
   风险：一行内固定两个 40px icon、一个 flex textarea、一个 `px-4` 发送按钮。中文短文案大致可容纳，但英文/日文较长发送文案、系统字体差异或较大字号下，textarea 会被压到很窄；这是聊天最高频入口。
   最小后续任务：为发送按钮增加窄宽 compact 规则，或在 360px 下使用 icon/短标签；确保 textarea 有稳定最小可用宽度。

4. AssistantActionCard 三按钮行在聊天气泡宽度内可能拥挤
   文件：`components/AssistantActionCard.tsx:152-178`, `components/AssistantActionCard.tsx:181-207`, `components/ChatMessage.tsx:27`, `components/ChatMessage.tsx:101-125`
   风险：助手卡片位于 `max-w-[78%]` 气泡内；360px 内容宽度下可用宽度约 260px。三按钮横排 `flex gap-2`，部分按钮非 `flex-1`、无 `min-w-0/truncate/wrap`，长翻译或 loading 文案时容易挤压或溢出。
   最小后续任务：助手卡片操作区改为可换行 grid/flex-wrap，并给按钮文本截断或短标签策略。

5. 日程详情 sheet 在小屏加键盘时有评论输入和底部操作风险
   文件：`app/schedule/page.tsx:1631-1632`, `app/schedule/page.tsx:1692`, `app/schedule/page.tsx:2028-2094`, `app/schedule/page.tsx:2112-2137`
   风险：详情面板固定 `h-[92dvh]`，评论 composer 在内部 flex 区底部；没有类似 Dialog 的 visualViewport 适配。360px 宽度通常可排版，但键盘弹出后评论输入、发送按钮、编辑/完成/删除按钮可能被压缩或遮挡。
   最小后续任务：对 schedule detail sheet 做 360/390/430 + 键盘手动回归；必要时拆出 sticky footer 并加入 safe-area/keyboard-aware bottom padding。

### P2

1. `image-preview` 顶部操作栏在英文/日文下可能横向溢出
   文件：`app/image-preview/page.tsx:70-100`
   风险：顶部为 `justify-between`，左侧返回按钮，右侧两个 pill 按钮横排且无 wrap/min-w-0。中文大概率可放下；英文如 "Set chat background" + "Open original" 在 360px 下可能超过可用宽度。
   最小后续任务：右侧操作允许 wrap，或 360px 下用 icon/短标签。

2. Settings 行组件缺少长值收缩策略
   文件：`app/settings/page.tsx:399-435`, `app/settings/page.tsx:857-864`, `app/settings/page.tsx:866-887`
   风险：`Row` 和 `DiagRow` 是 `flex justify-between`，label/value 都没有 `min-w-0`、`truncate` 或 `break-words`。长家庭名、长昵称、诊断 platform 字符串可能在 360px 撑开布局。
   最小后续任务：行组件加 `min-w-0`，value 侧使用 `text-right break-words` 或 `truncate`，敏感值继续保持不暴露。

3. Members 管理行在 admin 操作下可用宽度偏紧
   文件：`app/members/page.tsx:217-274`
   风险：成员行有头像、昵称/角色区、右侧 whisper icon 和管理员移除按钮；右侧操作组 `shrink-0`。长昵称和移除中状态文案下，360px 可用空间很窄，虽有 truncate，但操作密度偏高。
   最小后续任务：管理员移除操作在 360px 下考虑二级菜单或更短 destructive icon+label。

4. Admin system-health summary 四列在窄宽下过密
   文件：`app/admin/system-health/page.tsx:136-149`, `app/admin/system-health/page.tsx:223-237`
   风险：四列 summary pill 在 360px 下每列约 70-75px，中文短标签可用，但英文/日文和大数值会挤压。该页不是高频家庭用户路径，但仍需避免横向滚动。
   最小后续任务：改为 `grid-cols-2 sm:grid-cols-4` 或使用 `minmax(0,1fr)` 并截断标签。

5. Toast 底部定位未显式考虑 safe area 和聊天输入栏高度变化
   文件：`components/Toast.tsx:72-80`
   风险：固定 `bottom-20` 在普通页面可接受，但聊天页底部可能叠加 keeper/whisper mode bar、输入栏、iOS safe area；toast 可能遮挡或贴近底部关键操作。
   最小后续任务：定义 toast 与 bottom input/safe-area 的层级和偏移规则，尤其覆盖 chat/schedule。

6. Schedule reminder chip/button grids 在长翻译下拥挤
   文件：`app/schedule/page.tsx:2354-2375`, `app/schedule/page.tsx:2454-2470`, `app/schedule/page.tsx:2500-2514`
   风险：提醒 offset、snooze、月/周/日切换多处使用 2/3 列紧密按钮。中文短标签可用；英文/日文长标签可能压缩按钮文本。
   最小后续任务：按钮文本加 truncate/title 或在 360px 使用更短标签。

### P3

1. `RoleSelect` 三列角色卡可用，但缺少 label 截断兜底
   文件：`components/RoleSelect.tsx:28-50`
   风险：当前三角色短文案可放下；后续多语言或角色名称扩展时可能拥挤。
   最小后续任务：角色 label 加 `truncate max-w-full`。

2. 非聊天根布局仍使用 `min-h-screen`
   文件：`app/layout.tsx:39`
   风险：这不是宽度问题，但 iOS 动态视口下可能影响非聊天页首屏/底部定位判断。聊天页已单独处理 `100dvh`。
   最小后续任务：后续统一评估非聊天页面是否需要 `min-h-[100dvh]`，不要影响聊天页现有 viewport 逻辑。

3. Mood tree 横向 nav 是有意的横向滚动
   文件：`app/mood-tree/page.tsx:257-266`
   风险：`overflow-x-auto no-scrollbar` + `min-w-[118px]` 属于显式横向导航，不应计为 body 横向滚动；但无滚动条可能降低可发现性。
   最小后续任务：手动确认 360px 下 nav 不导致 body 横向滚动，并考虑边缘 fade 或 snap。

## Risk Notes

- 本轮主要为静态审阅；浏览器实测被 `net::ERR_BLOCKED_BY_CLIENT` 阻断，未获得真实截图或 DOM 横向滚动指标。
- 未打开可能含真实本地会话数据的聊天、日程、设置、个人页和成员页，避免在报告中暴露家庭数据。
- 多语言是主要风险放大器：中文短标签下很多布局可能刚好可用，但英文/日文长标签、系统字体差异、较大字号会让 360px 更紧。
- 本轮只发现 UI 宽度/层级风险；未发现需要修改 RPC、API、Push、Service Worker、Storage 或数据库权限的事项。

## Minimal Next Tasks

1. P1：Dialog 移动端 max-height / internal scroll / footer wrap 审计与最小修复。
2. P1：Chat message action menu viewport clamp。
3. P1：ChatInput 360px compact pass，保留文字、语音、图片、位置、悄悄话和 keeper 入口逻辑不变。
4. P1：AssistantActionCard 操作按钮在 260px 气泡内的 wrap/truncate pass。
5. P1：Schedule detail sheet 360/390/430 + keyboard 手动回归，确认评论输入和底部操作可达。
6. P2：Settings `Row`/`DiagRow` 长值收缩策略。
7. P2：Image preview toolbar 360px wrap/compact 策略。

## Validation Suggestions

- 启动或复用本地 dev server 后，用 360px、390px、430px 分别检查：
  - `document.scrollingElement.scrollWidth <= document.documentElement.clientWidth + 1`
  - 无 body 级横向滚动
  - 长家庭名、长昵称、长日程标题、长备注、长英文/日文按钮文案不撑破布局
- 聊天页重点手动路径：
  - 普通文字发送、语音录制/失败/重试、工具栏展开、悄悄话选择、keeper mode、重要通知栏展开、消息长按菜单靠右/靠底位置。
- 日程页重点手动路径：
  - 月/周/日切换、筛选展开、创建/编辑表单、详情 sheet、评论输入、提醒状态、负责人接受/拒绝、键盘弹出。
- 浮层重点：
  - Dialog 长内容 + 键盘
  - KeeperRequestSheet 长成员昵称/长 note
  - Toast 与聊天输入栏/safe-area 是否互相遮挡
- 文档-only 变更至少运行 `git diff --check`。

## File Modification Statement

本轮只新增/修改了本报告文件：`docs/agent-reports/20260525-phase1-mobile-widths.md`。

未修改任何页面、组件、样式、服务、API、RPC、migration、schema、Push、Service Worker、`TASKS_UI.md`、`PHASE_STATUS.md` 或 `docs/iteration-log/_latest.md`。
