# Style Consistency Audit

日期：2026-05-25
范围：只做 UI 风格一致性、可访问性和性能风险审计；未修改页面、组件、业务逻辑、Auth、数据库、RPC、Push、Service Worker 或 `PHASE_STATUS.md` / `TASKS_UI.md`。

## 执行方式

本轮使用 orchestrator + specialist agents 的方式执行，只读收集证据后由主线程合并报告。

| 角色 | Agent | 使用 skill | 产出 |
| --- | --- | --- | --- |
| Visual Baseline | Faraday `019e5f23-67c8-7033-a9ed-233e69482e05` | `frontend-design` | 提取 `/chat` 作为产品视觉基线 |
| Style Divergence | Archimedes `019e5f23-adca-7ca1-9ae3-6cec49d5e63a` | `frontend-design` | 页面/组件风格偏差矩阵 |
| Boundary & Risk | Darwin `019e5f23-f3cb-7ba3-a045-2813b36ddd13` | `fullstack-architect` | 保护边界、风险分级、验证计划 |
| QA Evidence | Pascal `019e5f24-3761-71f2-a601-a68c9ab4b2de` | `build-web-apps:frontend-testing-debugging`、`browser` | validation、移动宽度与浏览器证据 |

本地额外读取或扫描：

- `AGENTS.md`
- `UI_RULES.md`
- `DESIGN_SYSTEM.md`
- `TASKS_UI.md`
- `CODEX_UI_LOOP.md`
- `docs/iteration-log/_latest.md`
- `docs/agent-reports/qa-a11y-performance.md`
- `package.json`
- `app/`、`components/` 中样式、a11y、motion 相关用法

## Product Visual Grammar

当前最可信的产品基线来自 `/chat`，不是入口页、设置页或 `mood-tree`。

- 页面壳：`/chat` 使用 `100dvh` / dynamic viewport、`chat-paper-bg` 暖纸感背景、顶部/底部半透明 native chrome。
- 触感：高频图标按钮约 40-44px，配 `native-press`、低透明白底、轻 ring 和明确 `focus-visible`。
- 圆角：输入栏约 18px，消息气泡和图片约 20-22px，错误/空态面板可到 28px；整体圆润但不做夸张 SaaS 卡片。
- 阴影：以暖色低透明阴影为主，气泡、输入栏、popover 有轻浮层感；避免整页大阴影和厚重 dashboard 面板。
- 字号：正文 `text-sm`，meta `text-[11px]` / `text-xs`，标题紧凑；不使用营销页 hero 字号。
- 色彩语义：`brand` 是主动作和自己消息，`emerald` 是家庭/守护/成功，`violet` 是悄悄话/私密，`rose` 是危险/错误，`amber` 是重要提醒。
- 图标语言：优先沿用 `public/ui-icons`，功能性 icon-only 按钮必须有 `aria-label` 或 `title`。
- 状态：loading/empty/error 应像 App 内状态，短文案、固定空间、轻 surface；不要变成后台仪表盘。

一句话基线：HomeTree 应是“暖纸感、原生 App 壳、轻浮层、圆润气泡、语义色清楚、移动端单手友好”的家庭沟通产品。

## Style Consistency Matrix

| page/component | current style | deviation from `/chat` baseline | target style | severity | implementation risk | suggested slice |
| --- | --- | --- | --- | --- | --- | --- |
| `/` | `app-page-narrow` + 大 `action-card`，右侧用 `+` / arrow 文字符号 | 入口像卡片选择页，图标语言和聊天页 `ui-icons` 不一致 | 保留轻入口，统一 `ActionRow`、`TextLink`、图标按钮触控区 | P1 | Low | Entry surfaces |
| `/join` | `section-card` 表单、找回代码嵌套卡片、`RoleSelect` 大图卡 | 表单页感强，surface 层级比聊天页更“网页化” | 统一 Auth surface、`FormField`、`TextLink`，减少嵌套卡片 | P1 | Medium | Auth/join forms |
| `/login`、`/register`、`/forgot-password`、`/reset-password` | 标准窄表单卡、按钮/链接分散 | 基本可用，但偏 Web 表单，缺少 App 原生节奏 | 做统一 Auth shell、状态 note、footer action 规则 | P2 | Low | Auth forms |
| `/verify-family-code`、`/create-family` | 家庭流程表单依赖 `section-card` 和 `btn-*` | 视觉与 Auth 页接近，但和 `/chat` 的 warm native shell 仍有距离 | 与 Auth forms 一起收敛，不改 session/code flow | P2 | Low-Medium | Family setup forms |
| `/schedule` | 日历工具页，手写 header icon、分段控件、密集 chips、详情 sheet | 功能密度高，局部接近轻 dashboard；按钮圆角、图标、色彩语义分散 | 先统一 shell：`AppPageHeader`、`IconButton`、`SegmentedControl`、`StatusChip` | P1 | High | Schedule shell only |
| `/me` | 个人 dashboard：身份卡、快捷入口、今日事项卡 | 卡片堆叠感明显，和聊天的轻 surface 不同 | 改成轻 profile surface + action rows，保留信息结构 | P1 | Medium | Profile surface |
| `/members` | 成员列表在 `section-card` 内，头像 initials，部分 40px rounded-xl icon | 接近产品语境，但 action icon 尺寸/圆角与聊天不完全一致 | 统一成员 row、avatar token、守护/悄悄话 icon button | P1 | Medium | Member rows |
| `/settings` | 多个 `section-card` 堆叠，Push/管理/诊断混排 | 最明显的“设置后台化”，视觉层级比主产品重 | 改为 Settings list groups + ActionRow；管理/诊断降视觉权重 | P1 | Medium | Settings shell |
| `/admin/system-health` | summary grid + 检查列表，明确运维工具 | 有意偏 admin，但不应污染主产品风格 | 保留维护工具属性，套低调 App shell，避免企业后台扩散 | P2 | Low | Admin containment |
| `/mood-tree` | 独立绿色主题、gradient、SVG 树、强动画、自定义圆按钮 | 像另一个 mini app；控件不走 `btn` / `ui-icons` / 全局状态体系 | 可保留活动特色，但 header/back/button/status 回归产品基础语言 | P0 | Medium | Mood-tree base controls |
| `components/ui` | 已有 `Button`、`TextField`、`Card`、`BottomTabBar` | 页面仍大量手写 Tailwind，两套以上按钮/卡片语言并存 | 低风险页先采用 wrapper 或语义 class，避免大规模替换 | P1 | Low | Component adoption |
| `app/globals.css` primitives | `btn`、`field`、`section-card`、`action-card` 与 `native-*` 并存 | `native-icon-button` / `native-input-bar` 是聊天过渡语言，不是全站命名 | 建立角色化命名：`IconButton`、`SectionSurface`、`ChatInputShell` | P1 | Low | Shared primitives |
| `Dialog` / `Toast` / overlays | 已有全局壳和入场动画 | shadow / animation 较重，和聊天 sheet/popover 轻暖层级不完全一致 | 统一 overlay radius、shadow、safe-area、reduced-motion | P1 | Medium | Overlay polish |
| `ImportantNoticeBar` | amber 顶部通知条，接近聊天语义 | 仍有局部尺寸/展开列表/移除按钮一致性风险 | 作为聊天内组件单独验证，不外扩为通用 card | P2 | Medium | Chat notice |
| `AudioBubble` | rounded pill + audio wave 动画 | 风格接近聊天，但 motion/a11y 仍需补齐 | 播放态、已播放态、重要高亮和 reduced-motion 一起审 | P2 | Medium | Audio bubble |
| `EffectOverlay` | 多套 gradient 特效和大 caption | 比主产品更强装饰，motion 风险高 | 降低装饰强度，尊重 reduced-motion；不遮挡关键浮层 | P2 | Medium | Effect motion |
| `image-preview` / `offline` | 独立全屏预览与离线状态 | 功能合理，但按钮语言与主产品略漂移 | 保持功能场景，统一 button hit area 和 focus ring | P3 | Low | Boundary pages |

## Major Style Divergences

1. 三套视觉语言并存：
   - `/chat` 的原生 App 语言。
   - `app-page + section-card` 的表单/设置/个人页语言。
   - `/mood-tree` 的独立活动页语言。

2. 卡片使用过密：
   - `/settings`、`/me`、`/join` 最容易读成“后台/表单页面”。
   - 后续应把多层 `section-card` 收敛为 list group、action row、轻 note，而不是继续堆卡。

3. 图标与按钮语言漂移：
   - `public/ui-icons`、文字符号、内联 SVG、自定义圆按钮并存。
   - 先统一 icon-only 按钮的尺寸、圆角、ring、label，再决定是否需要新图标资产。

4. 状态与 tone 仍分散：
   - `tone-chip` / `status-badge` 已有语义，但页面内仍有大量手写 `rounded-full bg-*`。
   - `/schedule` 的 `cyan` / `fuchsia` 必须继续限制在日程 tone，不扩散为全局色。

5. Motion 规则不完整：
   - `native-press`、toast/dialog 入场、important highlight、audio wave、effect overlay、loading bounce/pulse 仍缺统一 reduced-motion 策略。

## Protected Boundaries

这些区域后续 UI 重构只能做视觉 class 或共享壳的最小修改，不能碰业务行为：

- Auth/session：`lib/authLocal.ts`、入口页 session restore、owner Supabase Auth 判断。
- RPC/RLS/权限：消息和日程服务调用、`member_id + member_token` 传递、owner/admin 条件。
- Chat：`100dvh`、输入栏、录音 pointer 流程、悄悄话、Realtime 补偿、`family_seq`、`message_recipients`、Push `mid` 回流。
- Schedule：月/周/日切换、详情 sheet、私密可见性、负责人响应、评论、提醒状态、Reminder Push。
- Push / Service Worker：`public/sw.js`、`ServiceWorkerRegister`、presence、payload 安全摘要、404/410 subscription 禁用。
- Storage/upload：图片、语音、头像上传校验和 family path 隔离。
- System health：维护密钥、token、hash、family code、Push endpoint 不得被暴露到普通 UI、URL 或日志。

## Recommended Shared Primitives

建议先定义“目标角色”，不急着批量替换：

- `AppPageHeader`：统一普通页面 header、返回按钮、标题/subtitle、右侧 action。
- `IconButton`：44px 默认触控区，支持 `brand` / `emerald` / `violet` / `rose` / `slate` tone，强制可读名称。
- `TextLink`：解决当前入口/加入页小文本链接 hit area 不足。
- `ActionRow`：替代入口页、设置页、个人页里的大卡片式动作入口。
- `SectionSurface`：把 `section-card` 从“所有区块都包卡片”收敛成真实分组 surface。
- `SegmentedControl`：先服务 `/schedule` 月/周/日和筛选，不碰日程数据流。
- `StatusChip` / `ToneChip`：复用现有 `tone-chip-*`、`status-badge-*`，减少手写 pill。
- `AppEmptyState` / `AppLoadingState` / `AppErrorState`：统一空态、加载、错误态空间和语气。
- `AuthShell`：统一登录、注册、找回、重置、家庭代码验证、创建/加入家庭的页面节奏。

## First 3 Minimal Refactor Slices

1. P1 `TextLink + Entry surfaces`
   - 范围：`/`、`/join` 的次级文本链接和 action row。
   - 目标：统一触控区、focus-visible、图标/文本动作语言。
   - 禁止：不改登录、找回家庭代码、join/create-family/session 流程。
   - 验证：lint、typecheck、build、diff；360/390/430 无横向滚动和按钮溢出。

2. P1 `Settings shell`
   - 范围：`/settings` 视觉层级，只整理 section/list/action 的表达。
   - 目标：减少 dashboard 卡片感，Push/家庭管理/诊断分组更像 App 设置。
   - 禁止：不改 Push API、Service Worker、owner 判断、离开家庭行为、健康检查入口权限。
   - 验证：lint、typecheck、build、diff；360/390/430 长家庭名、家庭代码、诊断值不溢出。

3. P0 `Mood-tree base controls`
   - 范围：`/mood-tree` 的 header/back/buttons/status/chips 基础控件。
   - 目标：保留活动页特色，但控制回到 HomeTree 主视觉语言。
   - 禁止：不重写心情树交互和状态数据。
   - 验证：lint、typecheck、build、diff；360/390/430 无横向滚动；reduced-motion 至少不出现强持续动画。

## QA / A11y / Performance Notes

- `focus-visible`：源码中大量按钮和可交互项已有 `focus-visible:ring-*`；本轮 browser Tab 探针未能可靠推进 `document.activeElement`，需要下一轮用真实键盘或 Playwright 复测。
- `aria labels`：聊天 header、底部导航、成员入口、Toast、Dialog 基本有可读名称；仍需延续前次报告中的 Dialog 密码显示按钮、ChatInput textarea、Schedule 临时输入控件 label 修复。
- `form labels`：Auth/家庭流程主要表单已有 label；Dialog 与部分 schedule drawer 输入仍是重点。
- `keyboard navigation`：Dialog、Schedule detail sheet、Chat action menu 已有部分语义；仍需真实 keyboard 回归。
- `reduced-motion`：当前最大缺口是 `native-press`、toast/dialog、effect overlay、audio wave、chat loading bounce/pulse。
- `layout shift`：聊天图片 `<img>` 仍缺 width/height/aspect-ratio 预留，弱网下可能造成消息列表跳动。
- `loading skeleton stability`：聊天 assistant pending bubble 有 `min-h-[112px]`，相对稳定；`/schedule` 未登录状态下 browser 观察到 5 秒后仍停留 `加载中...`，应作为 loading fallback 风险单独处理。

## Validation Evidence

本轮主线程未改 UI 代码。Pascal 只读验证记录：

| 命令/检查 | 结果 | 备注 |
| --- | --- | --- |
| `npm run lint` | PASS | 无 ESLint warning/error |
| `npm run typecheck` | PASS | `tsc --noEmit` 通过 |
| `git diff --check` | PASS | 仅有既有 LF/CRLF warning |
| `npm run build` | Not run in Pascal pass | 为避免只读阶段改写 `.next`；前次 QA 报告中 clean build PASS |
| `npm run test` | N/A | `package.json` 未定义 |
| `npm run test:e2e` | N/A | `package.json` 未定义 |
| `npm run test:lhci` | N/A | `package.json` 未定义 |
| Browser 360/390/430 | PASS with caveat | 使用既有 `.next` production artifact；可渲染页面无横向滚动、无 console warn/error |

浏览器 caveat：

- `/chat`、`/me`、`/members`、`/settings` 在无 session 下回到 `/`，只能证明未登录保护态和入口渲染。
- `/schedule` 无 session 下长时间停留加载态，不能证明真实日程 UI。
- 由于当前 worktree dirty 且 Pascal 没有重新 build，browser 观察不能保证完全代表当前源码。

## Migration / API / RPC Impact

无。本文档仅记录审计结果和建议，没有修改 migration、API、RPC、Auth、RLS、Push、Service Worker、Storage 或业务逻辑。

## Recommended AI Engineering Practice

- 继续使用 orchestrator + specialist agents，但每个 agent 必须有清晰边界：baseline、divergence、risk、verification，不让多个 agent 同时改同一 UI 文件。
- 对高风险页面采用 class-only / shell-only 小切片；聊天、日程、Push、Storage、Auth 相关改动必须先列保护边界。
- 每个 UI 实现 slice 都按 `CODEX_UI_LOOP.md`：audit -> select -> implement -> validate -> review -> record。
- 自动验证不足时，不把 browser smoke 当作真实 PWA/软键盘/Push 结论；必须记录 caveat 和真机补测步骤。
- 先修复“视觉语言统一的基础设施”，再逐页迁移；不要把风格统一做成一次性大重写。
