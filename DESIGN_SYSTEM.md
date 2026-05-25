# DESIGN_SYSTEM.md — 当前设计系统基线

本文档记录当前 UI refactor 的设计系统基线。现阶段只描述和约束，不进行视觉重设计。代码级来源仍是 `tailwind.config.ts`、`app/globals.css`、`components/` 与各页面现有 Tailwind class。

## 技术基线

- Framework：Next.js 14 App Router。
- Language：TypeScript，`strict: true`。
- React：React 18，客户端页面大量使用 `"use client"`。
- Styling：Tailwind CSS 3 + `app/globals.css` 全局语义类。
- Package manager：npm，锁文件为 `package-lock.json`。
- Icon / asset：无 lucide、heroicons、react-icons 依赖；当前图标资产位于 `public/ui-icons/`。
- Component library：无外部 UI 组件库；现有组件为本仓库自研。

## 样式来源

- `tailwind.config.ts` 定义 `brand` 色阶和系统字体栈。
- `app/globals.css` 定义全局基础样式、滚动辅助、原生按压动效、输入栏、按钮、表单、卡片、页面容器、toast/dialog/mood-tree 动效等。
- 页面内仍有大量局部 Tailwind class；后续重构应逐步收敛到可复用语义，而不是一次性全局替换。

## 色彩

- 主色：`brand-500 #4f6cf7`，用于主按钮、链接、主要强调。
- 主色深浅：`brand-50` 到 `brand-700`，用于背景、焦点、hover、active。
- 中性色：以 Tailwind `slate` 为主，用于文本、边框、页面背景。
- 情绪/状态色：
  - `rose`：危险、错误、删除。
  - `emerald`：成功、家庭成员/守护相关正向状态。
  - `amber`：重要通知、提醒、警告。
  - `sky` / `blue` / `violet`：辅助信息、录音发送、悄悄话。
- 避免把整套 UI 推向单一色相；家庭感来自留白、层级、文案克制和触感，不靠大面积渐变。

### 颜色使用矩阵

| 色系 | 允许用途 | 禁止/限制 |
| --- | --- | --- |
| `brand` | 主按钮、主链接、当前选中态、当前用户消息、焦点 ring。 | 不用于错误、删除、私密、警告或 Push 权限状态。 |
| `slate` | 正文、辅助文本、边框、背景、禁用态、已完成/历史态。 | 不作为唯一状态表达；已完成态需要文字或删除线等辅助表达。 |
| `rose` | 错误、危险、删除、拒绝、权限失败。 | 不用于普通提醒、未读或装饰性强调。 |
| `emerald` | 成功、已完成、家庭成员正向状态、守护/keeper 正向语义、循环日程提示。 | 不表示管理员权限，也不暗示服务器未确认的成功状态。 |
| `amber` | 重要通知、提醒、警告、需要注意但不一定失败的状态。 | 不用于普通品牌强调；大面积使用会让页面显得告警化。 |
| `sky` / `blue` | 信息说明、上传/录音/发送中的中性过程提示。 | 不作为 primary 替代，不扩散为整页主色。 |
| `violet` | 悄悄话、私密上下文、隐私相关视觉提示。 | 不作为普通日程类型色；私密状态必须配文字或锁标识。 |
| `fuchsia` | 仅允许作为 `/schedule` 私密日程类型 tone 的局部区分色。 | 不纳入全局状态色；不用于按钮、表单、Toast、权限成功/失败或普通私密 badge 的唯一表达。 |
| `cyan` | 仅允许作为 `/schedule` 普通日程类型 tone 的局部区分色。 | 不纳入全局品牌色；不用于主按钮、全站导航、Toast 或系统健康状态。 |

### schedule tone 规则

- `schedule` 默认类型当前允许使用 `cyan`，用于日程卡左侧 accent、dot、类型 badge、月视图 chip 和时间文本。
- `todo` 使用 `violet`，但这不改变 `violet` 在聊天中代表悄悄话/私密上下文的语义；日程内必须靠文案区分类型。
- `reminder` 使用 `amber`，表示提醒/注意；提醒 Push 仍只能使用安全摘要，不能把标题、备注或评论内容放入 payload。
- `private` 当前允许使用 `fuchsia` 作为日程类型 tone，但私密可见性仍以锁标识、文字和 RPC 权限为准；`fuchsia` 不得替代隐私文案。
- `done` 使用 `slate` 和删除线/低透明度表达已完成；不能只靠灰色表达状态。
- 如果后续抽取 `tone-chip-*` 或 `status-badge-*`，必须先把 schedule type tone 和全局状态 tone 分开命名，避免把 `fuchsia` / `cyan` 扩散到非日程场景。

### 颜色门禁

- 状态不能只靠颜色表达；必须同时有文字、图标、形状、删除线、锁标识或上下文。
- 同一屏主要强调色不超过一个；辅助色只用于局部状态或分类，避免页面读成单一蓝紫、单一琥珀或企业后台面板。
- 新增色系或扩大 `fuchsia` / `cyan` 作用域前，必须先更新本文档和 `TASKS_UI.md`，并说明对应业务语义。
- UI 实现任务涉及颜色改动时，必须检查 360px、390px、430px 下 badge/chip 文案是否换行或截断合理。

## 字体与排版

- 字体栈使用系统 sans：`ui-sans-serif`、`system-ui`、`-apple-system`、`Segoe UI`、`PingFang SC`、`Microsoft YaHei` 等。
- 页面标题当前使用 `page-title`：约 `text-2xl`、粗体、紧凑行高。
- 正文和控件以 `text-sm` 为主，辅助说明使用 `text-xs` 或低对比 `slate-500`。
- 移动端不要使用过大的 hero 字体；本产品优先像原生工具，而不是营销页。
- 长文本必须有折行、截断或 `break-words` 策略。

## 圆角、阴影与层级

- 当前基础按钮和输入多为 `rounded-xl` 到 `rounded-2xl`。
- 聊天输入、弹窗、sheet 等原生感部件可使用更大圆角，但要保持克制。
- 阴影主要用于浮层、输入栏、toast、重要通知和少量卡片；不要扩大为整页装饰阴影。
- 浮层层级需要明确：toast、dialog、input bar、message action menu、keeper sheet 不应互相遮挡关键操作。

## 基础语义类

- `btn`：按钮基础。
- `btn-primary`：主要动作。
- `btn-secondary`：次要动作。
- `btn-ghost`：低强调动作。
- `btn-danger`：危险动作。
- `field`：输入控件。
- `label`：表单标签。
- `card`、`section-card`、`action-card`：卡片与动作项。
- `app-page`、`app-page-narrow`：页面容器。
- `app-header`、`app-header-stack`：页面头部。
- `back-link`：返回入口。
- `page-title`、`page-subtitle`：页面标题与说明。
- `icon-action`：图标动作按钮。
- `meta-chip`：轻量元信息。
- `status-note`、`error-note`、`success-note`：状态提示。

## 按钮规则

- 当前按钮语义来自 `app/globals.css` 的 `btn`、`btn-sm`、`btn-md`、`btn-lg`、`btn-icon` 和 `btn-primary` / `btn-secondary` / `btn-ghost` / `btn-danger`。
- 新增通用按钮优先使用 `components/ui/Button.tsx`，但不要在聊天、日程、Push、权限相关路径里批量替换；这些路径必须单独做回归。
- `primary` 只用于页面或流程的主动作；同一视觉区域不要并列多个 primary。
- `secondary` 用于普通次要动作；`ghost` 用于低强调导航或辅助动作；`danger` 仅用于删除、离开、重置等破坏性动作。
- `icon` 尺寸按钮必须有 `aria-label` 或 `title`，并保持约 44px 的触控区；不要只靠图标或颜色表达动作含义。
- loading 状态必须保留按钮宽度和语义，使用 `aria-busy`；disabled 状态不得隐藏按钮含义。
- 按钮文案保持短句；如果 360px 下可能溢出，应优先换行、截断、改短标签或改为明确图标按钮，而不是压缩触控区。
- `app/globals.css` 中 button variant 会包含 `btn` 基础语义；`btn-sm`、`btn-md`、`btn-lg`、`btn-icon` 尺寸修饰必须定义在 variant 之后，确保 `components/ui/Button.tsx` 输出的 variant + size 组合能让尺寸生效。

## 输入与标签规则

- 输入语义来自 `field`、`field-error`、`field-hint`、`field-error-text` 和 `label`。
- 新增普通文本输入优先使用 `components/ui/TextField.tsx`，以获得 `label`、`hint`、`error`、`aria-describedby`、`aria-invalid` 和 `aria-errormessage` 的默认关联。
- placeholder 不能替代 label；紧凑 UI 可使用 `sr-only` label，但表单控件必须有可读名称。
- 错误文本使用 `field-error-text`，需要被屏幕阅读器感知时使用 `role="alert"` 或等价机制。
- 表单行必须使用 `min-w-0`、`break-words`、`truncate` 或合理换行策略，避免长昵称、长标题、长备注撑破移动端布局。
- `field` 必须允许在 flex/grid 容器内收缩；`label`、`field-hint` 和 `field-error-text` 必须允许长文案断行，不能把移动端撑出横向滚动。
- 密码、成员 token、Auth token、family code 等敏感值不得进入 placeholder、URL、日志或可复制诊断文本，除非该流程明确允许用户查看并已有安全说明。
- 移动端键盘可能遮挡输入，涉及 Dialog、Sheet、聊天输入栏、日程评论输入时必须单独验证 360px、390px、430px。

## 标签与状态提示规则

- `meta-chip` 当前只表示中性轻量元信息，不应用作成功、警告、危险或私密权限的唯一表达。
- `status-note` 用于中性说明；`success-note` 用于成功或已完成状态；`error-note` 用于错误、失败或危险提示。
- `info-note` 用于中性信息说明；`warning-note` 用于需要注意但不一定失败的提示；不要把它们用作长篇说明卡片。
- `tone-chip` 用于分类、属性、轻量元信息；`status-badge` 用于已确认的状态结果。两者必须组合 tone variant 使用。
- 状态不能只靠颜色表达；必须同时有文字、图标、形状或上下文。
- 私密、悄悄话、权限、提醒投递、Push 状态等业务敏感状态必须保持文案准确，不能用 UI badge 暗示服务器未授予的权限。
- 状态提示要可换行，避免把错误详情、诊断结果、长成员名或长设备信息挤进单行 pill。
- Toast、Dialog、Sheet、action menu 必须遵守本文档的浮层层级与视口策略；实现前先确认 z-index、safe-area、dismiss 和焦点边界。

### note / chip / badge 语义

- `status-note`：中性说明或加载说明，使用 `slate`。
- `info-note`：帮助信息、流程提示、账号/邮箱验证说明，使用 `sky`。
- `warning-note`：需要注意的恢复、兼容、环境或风险提示，使用 `amber`。
- `success-note`：成功完成、已发送、已保存等结果，使用 `emerald`。
- `error-note`：错误、失败、危险或权限拒绝，使用 `rose`，必要时配合 `role="alert"`。
- `tone-chip` + `tone-chip-muted/info/success/warning/danger/private`：用于分类或属性标签，例如角色、类型、隐私、提醒属性。它不能承载未被服务器确认的操作结果。
- `status-badge` + `status-badge-muted/info/success/warning/danger/private`：用于短状态结果，例如 enabled/disabled、active/inactive、ok/warn/error。状态必须有可读文字，不能只显示色点。
- note 文案可以换行；chip/badge 文案必须短，长成员名、长错误、长设备指纹应使用 note 或行内文本，不塞进 pill。

### settings 行语义

- `settings-row`、`settings-row-label`、`settings-row-value` 用于 `/settings` 中 label/value 结构，必须允许长家庭名、长平台名、诊断值和时间戳换行，不得把右侧值固定成不可收缩单行。
- `settings-family-code` / `settings-family-code-text` 只用于家庭代码显示区域；代码可以断行，显示/隐藏按钮必须保持固定触控区和可读 `aria-label` / `title`。
- `settings-action-grid` 用于设置页短按钮组，360px 默认单列，390px 起可双列；不要把它复用到聊天输入栏或日程详情这类高频操作区。
- `/me` 的身份摘要、昵称、家庭名、个人看板标题和事项 meta 必须允许换行或收缩；头像操作在窄屏优先单列，个人看板空态使用 note 语义，私密锁图标必须有屏幕阅读器文本。
- `/members` 的成员行必须把身份区和操作区分开；360px/390px 优先上下布局，430px 起再允许左右布局。长昵称、角色、管理员/我 badge、最近活跃文案必须可换行或收缩，移除/悄悄话/守护入口必须保留可读标签和稳定触控区。

## 共享组件采用规则

- `components/ui/Button.tsx`、`TextField.tsx`、`Card.tsx`、`BottomTabBar.tsx` 是共享组件基础能力，不代表所有页面已完成迁移。
- 新页面或低风险页面可优先使用共享组件；高风险路径必须逐个迁移并验证。
- 不要为了“统一”在同一轮大规模替换页面内 Tailwind class；先选一个页面或一个组件面。
- 共享组件不得隐藏业务权限判断；权限、可见性、成员身份、Push、Realtime 和 Storage 边界仍由服务/RPC/API 保证。

## 图标资产规则

当前项目没有引入 lucide、heroicons、react-icons 等图标库；运行时图标主要来自 `public/ui-icons/` 的 512px PNG、少量内联 SVG、少量文字符号和 PWA `icon.png`。Phase 2 的决策是：继续使用 `public/ui-icons` 作为当前产品图标来源，不在本阶段引入新图标库。引入图标库必须作为单独任务评估包体、风格一致性、可访问性和迁移范围。

### 当前资产范围

- `public/ui-icons/image.png`、`location.png`、`voice.png`、`plus.png`、`whisper-lock.png`：聊天输入、消息预览和悄悄话相关动作。
- `public/ui-icons/notify-on.png`、`notify-off.png`、`schedule.png`、`me.png`、`members.png`、`settings.png`：聊天顶部/底部导航和通知入口。
- `public/ui-icons/role-father.png`、`role-mother.png`、`role-child.png`：角色选择与成员身份展示。
- PWA 图标 `icon.png` / `apple-icon.png` 不属于 `public/ui-icons` 体系，修改时必须按 PWA 发布规则单独验证。

### 使用规则

- 功能性 icon-only 按钮必须有 `aria-label` 或 `title`，并保持约 44px 触控区；图标本身应 `aria-hidden` 或使用空 `alt`，可读名称由按钮提供。
- 纯装饰图标使用 `alt=""`、`aria-hidden="true"` 或等价隐藏方式；不要让屏幕阅读器重复朗读图标和相邻文字。
- 导航图标应通过文字 label、`aria-current` 和可读名称表达状态；不要只靠图标、颜色或 badge 表达当前页、未读或通知状态。
- 业务敏感状态图标，例如悄悄话、私密日程、Push 状态、管理员/owner 操作，必须配合文字、`sr-only` 文本或上下文，不得只靠图形暗示权限。
- `background-image` 图标仅适合已有聊天工具按钮这类固定尺寸控件；新增普通图标优先使用 `next/image` 或明确的内联 SVG，以便尺寸、alt 和布局稳定。
- 内联 SVG 只用于简单系统符号，例如锁、播放、展开等；复杂品牌感或家庭角色图形继续使用现有 PNG 风格，不混入另一套线性图标风格。

### 新增和替换规则

- 新增 `public/ui-icons` 资产必须使用短横线命名，语义来自功能或对象，例如 `schedule-add.png`，不要使用临时导出名。
- 新图标应提供明确用途、目标尺寸、可访问名称来源和 fallback 文案；没有这些信息不得进入共享组件。
- 现有 PNG 单个文件较大，新增或替换前必须优先压缩，并确认小尺寸下仍清晰；不得为了小图标直接加入未压缩大图。
- 不要在同一轮把 PNG、内联 SVG、文字符号和图标库混合大规模替换；每轮只迁移一个低风险组件或一个小图标族。
- 引入图标库的门槛：至少两个以上页面需要同一套系统线性图标、现有 PNG 无法表达、包体影响可接受、并有明确迁移清单和回滚方案。

### 后续候选任务

- P2：审计并压缩 `public/ui-icons` 现有 PNG，记录压缩前后大小和视觉差异。
- P2：为 `IconAsset` 或局部 icon map 建立类型化清单，避免手写路径漂移。
- P2：补齐私密/锁/播放/状态类内联 SVG 的可访问文本策略，尤其是日程紧凑入口。
- P3：评估是否需要图标库；若需要，先在低风险页面试点，不触碰聊天输入、Push、日程详情等高风险路径。

## app/globals.css 语义类分类

以下分类用于指导后续 UI worker 选择安全任务；本节不代表已经允许批量替换页面内 Tailwind class。

### keep

- `btn`、`btn-sm`、`btn-md`、`btn-lg`、`btn-icon`、`btn-primary`、`btn-secondary`、`btn-ghost`、`btn-danger`：继续作为按钮基础语义，新增通用按钮优先经由 `components/ui/Button.tsx` 使用。
- `field`、`field-error`、`field-hint`、`field-error-text`、`label`：继续作为表单控件基础语义，新增普通输入优先经由 `components/ui/TextField.tsx` 使用。
- `app-page`、`app-page-narrow`、`app-header`、`app-header-stack`、`back-link`、`page-title`、`page-subtitle`：继续作为页面壳、页面头部和标题语义。
- `section-card`、`action-card`、`empty-state`：继续作为低风险展示面和动作项语义，但不要把整页改成卡片堆叠。
- `status-note`、`error-note`、`success-note`：继续作为中性、错误、成功提示；长文本必须可换行。
- `no-scrollbar`、`native-scroll`：继续作为低层滚动辅助类，不能承载业务状态含义。
- `bottom-tab-*`：继续作为 `BottomTabBar` 组件内部语义，不作为页面任意导航样式复用。

### narrow scope

- `native-press`：仅作为低层按压反馈辅助，不作为公开设计系统角色名扩散。
- `native-icon-button`：仅用于现有聊天或工具型图标按钮过渡；后续应收敛到角色化命名。
- `native-input-bar`：仅用于现有聊天输入栏或同类底部输入壳过渡，不扩展到普通表单。
- `chat-paper-bg`：仅用于聊天路由背景，不作为全站页面背景。
- `important-message-highlight`、`important-message-focus`：仅用于聊天重要消息高亮和定位反馈。
- `animate-toast-in`、`animate-dialog-in`：仅用于 toast/dialog 入场；后续动效任务需补齐 reduced-motion 边界。
- `mood-*`：心情树 feature-owned 全局类，不作为通用语义类复用。

### extraction candidate

- `dialog-panel`、`dialog-actions`：已用于 `components/Dialog.tsx`，作为 Dialog 面板 max-height、内部滚动、safe-area、长文案和按钮换行的基础语义；后续只在 Dialog/Sheet 专项任务中演进。
- `sheet-backdrop`、`sheet-panel`、`sheet-body-safe`：候选用于 keeper sheet 与 schedule detail sheet，但必须先完成层级和 safe-area 策略。
- `chat-action-dismiss-layer`、`chat-action-menu`：已用于 `/chat` 消息操作菜单，承载 body-level dismiss、z-index、滚动上限和 viewport clamp 的视觉语义；后续只在消息 action menu 专项任务中演进。
- `chat-input-actions-popover`、`chat-input-whisper-popover`、`chat-input-whisper-list`：已用于 `components/ChatInput.tsx` 的 composer-local popover，高度必须来自输入栏上方可用 visual viewport，并保持内部滚动可达。
- `surface-soft`、`surface-card`、`surface-muted`：候选用于重复的白色/浅灰信息面，避免每页手写相同 `rounded-* bg-* ring-*`。
- `info-note`、`warning-note`、`tone-chip-*`、`status-badge-*`：基础语义已加入 `app/globals.css`；后续只做低风险逐处采用，不批量替换聊天或日程高风险路径。
- `settings-row-*`、`settings-family-code-*`、`settings-action-grid`：仅作为 `/settings` 页面行布局和短按钮组语义，防止长值撑破移动端；不作为全站表单布局方案。
- `icon-action-*`、`pill-action-*`：候选统一轻量图标动作和小胶囊动作，但应先从低风险组件或局部常量开始。
- `safe-bottom-*`、`avatar-token-*`：候选降低底部安全区和头像尺寸/色调漂移，涉及聊天或日程时必须逐个回归。
- `chat-icon-button`、`chat-mode-bar`：候选仅在聊天层级审计通过后处理，不先全局替换。

### deprecation plan

- `card`、`card-compact`：语义过泛；冻结新增直接使用，优先选择 `section-card`、`action-card`、`empty-state` 或 `components/ui/Card.tsx` 的明确 variant。
- `native-icon-button`、`native-input-bar`：保留兼容别名，后续用 `chat-icon-button`、`tool-icon-button`、`chat-input-shell` 等角色化名称逐步替换。
- `meta-chip`：保留为中性元信息 chip；不要直接改色或扩展 ring，后续由 tone chip 家族承接状态表达。
- `mood-*`：保持 feature-owned，不进入通用设计系统词表；未来如采用 CSS module 或 feature CSS，可再迁移。
- 未覆盖 reduced-motion 的动效类：后续动效任务需审查 `native-press`、重要消息高亮、toast/dialog、`audio-wave` 和心情树动效。

## 浮层层级与视口策略

本节约束 Dialog、Sheet、Toast、Action Menu 的后续实现和审计。当前代码已经存在不同 z-index 层级，本节先定义目标规则，不要求在同一轮批量替换实现。

### 层级顺序

- Page content：普通页面、列表、消息流、日程卡片默认不新增高 z-index；局部装饰和状态标记应停留在内容层。
- Sticky app chrome：聊天 header、重要通知、底部输入栏、底部 tab 可以使用局部 z-index，但不得压过 body-level action menu、sheet、dialog。
- Input-local popover：聊天输入栏的更多操作、悄悄话选择器等附着在输入栏上方，属于 composer 内部浮层；它们必须在剩余可视高度内滚动，不能假装成全局 modal。
- Action Menu：消息操作菜单等 body-level action menu 应压过输入栏和页面 chrome，并带 dismiss layer；它必须低于 Sheet、Dialog 和 Toast。
- Sheet：日程详情、keeper request 等底部或居中 sheet 应压过 action menu 和输入栏；当 sheet 是 modal 行为时，背景内容不得继续可键盘操作。
- Dialog：确认、提示、账号密码、管理员密码等 Dialog 保留最高交互优先级；不要新增会压过 Dialog 的业务浮层。
- Toast：Toast 是视觉提示层，不抢焦点；当前可保持最高视觉层，但必须避免长期遮挡底部关键操作。需要用户决策的错误不应只用 Toast 表达。
- Effect overlay：特效层只能作为短时视觉反馈；不得压过 Dialog、Toast 或正在输入的关键 sheet 表单。

### visual viewport

- 所有 body-level fixed overlay 都必须考虑 `window.visualViewport`，并以 `100dvh` 作为 fallback。
- Dialog、modal Sheet 和 body-level Action Menu 需要监听 visual viewport `resize` / `scroll` 与 `orientationchange`，或在这些事件发生时安全关闭/重算位置。
- Action Menu 的定位必须 clamp 到 visual viewport 内，不得只用 `window.innerWidth` / `window.innerHeight`；键盘打开、浏览器地址栏收起、横竖屏切换都要重新计算。
- `/chat` 消息 action menu 当前使用原始触发点、实际菜单尺寸、`window.visualViewport` 和底部 composer 边界重算位置；后续改动不得退回一次性 `innerWidth` / `innerHeight` 估算。
- `ChatInput` 的 composer-local popover 当前按输入栏上方剩余 visual viewport 高度设置最大高度；更多操作和悄悄话选择器必须继续在内部滚动，不得退回固定 `max-h-72` / `max-h-52`。
- `ChatInput` 录音中遇到 visual viewport `resize` / `scroll`、窗口 `resize` 或 `orientationchange` 时采用隐私取消策略，沿用录音后台停止提示；不要在未专项验证的情况下静默重算 release/cancel safe rect。
- Sheet 高度必须使用可视高度上限和内部滚动，优先让 header、主要内容、底部操作分别稳定；长内容不能把关闭按钮、发送按钮、保存按钮挤出屏幕。
- `/schedule` 详情 sheet 的只读主体必须允许纵向滚动；会话区需要保留最低可用高度，避免负责人响应、评论输入和底部编辑/完成/删除按钮在压缩高度下互相覆盖或变成不可命中的视觉重叠。
- 聊天页继续使用动态 viewport 变量和 `100dvh` 思路；不得把聊天根容器退回 `h-screen`。

### dismiss layer

- 非破坏性、非凭证类轻量浮层可支持点击遮罩关闭；危险操作、账号密码、管理员密码等敏感 Dialog 必须明确 cancel / confirm 路径，不能只依赖遮罩关闭。
- body-level Action Menu 打开时，dismiss layer 必须覆盖页面 chrome 和输入栏，避免用户在菜单未关闭时误触发送、录音、删除或导航。
- 同一时刻如果 Dialog 与 Sheet 叠加，Dialog 拥有最上层 dismiss 语义；底层 Sheet 不应响应背景点击或键盘焦点。
- Escape 应关闭当前最上层可关闭浮层，并把焦点恢复到打开它的控件；如果浮层内有未提交输入，关闭策略必须先定义是否需要确认。
- pointer outside、Escape、路由切换、visual viewport 剧烈变化的处理必须一致，不要让浮层视觉关闭但内部状态仍保持打开。

### safe-area

- 底部固定输入栏、底部 tab、Toast、Sheet footer 必须考虑 `env(safe-area-inset-bottom)`，并保留最小触控 padding。
- Toast 在聊天页不能遮挡输入栏、录音状态、悄悄话模式条或关键底部操作；如果出现连续错误，应允许用户轻触关闭且不抢焦点。
- `components/Toast.tsx` 使用 `toast-viewport` 控制全局位置；移动端 bottom offset 必须高于聊天输入栏/底部导航并叠加 `env(safe-area-inset-bottom)`，桌面端可回到较低右下角。
- `toast-bar` 必须可点击关闭、带可读关闭提示、长文案可断行；图标只做视觉辅助并隐藏给读屏。
- Sheet 的滚动区域底部需要包含 safe-area padding；按钮行不应被 iOS home indicator、PWA 底部栏或键盘覆盖。
- `KeeperRequestSheet.tsx` 使用 `sheet-backdrop`、`sheet-panel`、`sheet-body-safe`、`sheet-actions` 管理底部 safe-area、面板高度、内部滚动和 footer 可见性；后续 sheet 不要各自手写一套底部 padding。
- 任何底部浮层都要在 360px、390px、430px 宽度下检查横向溢出、按钮换行和长文案换行。

### 焦点与可访问性

- Dialog 和 modal Sheet 必须有 `role="dialog"`、`aria-modal="true"`、可读标题绑定或 `aria-label`。
- 打开 Dialog 或 modal Sheet 时应设置初始焦点；关闭后应恢复到触发控件。危险确认和凭证输入不得让焦点落在背景页面。
- `components/Dialog.tsx` 的 Dialog 壳层使用当前弹窗标题作为 `aria-label`，打开时把焦点移入 modal wrapper，关闭时恢复触发焦点；后续改动不得让焦点停留在背景页面。
- `/schedule` 详情 sheet 当前使用 `role="dialog"`、`aria-modal`、标题绑定、初始焦点、焦点恢复和 Tab 焦点圈；外层高度跟随 `window.visualViewport`，面板高度以当前可视区域为上限，并在压缩高度下通过只读主体滚动和会话区最低高度保持拒绝原因、评论输入/发送、编辑保存可触达。真实 iOS/Android 软键盘仍需专项回归。
- `dialog-panel` 负责 max-height、内部滚动、长文案断行和 bottom safe-area padding；`dialog-actions` 负责按钮行换行与最小宽度。
- Action Menu 应选择明确模型：若是菜单，使用 `role="menu"` / `menuitem` 并支持键盘关闭；若包含复杂表单或长列表，使用 dialog/listbox 语义，不混用。
- Toast 使用 `role="status"` / `aria-live`，不主动抢焦点；错误需要用户处理时改用 Dialog、Sheet 内联错误或页面内 `error-note`。
- icon-only 关闭、更多、菜单、返回等控件必须有 `aria-label` 或 `title`，并保持约 44px 触控区。

### 验证门禁

- 文档-only 任务至少运行 `git diff --check`。
- 任何浮层实现任务必须运行 `npm run lint`、`npm run typecheck`、`npm run build`、`git diff --check`。
- 手动验证至少覆盖 360px、390px、430px；键盘打开；无横向滚动；关键按钮可见可点；长标题、长备注、长昵称不撑破布局。
- 聊天相关浮层还必须验证输入栏、录音、工具栏、悄悄话、重要通知、消息 action menu 和 Push 点击回流不被破坏。
- 日程相关浮层还必须验证详情 sheet、评论输入、负责人响应、编辑保存、提醒状态展开和私密可见性文案。

## 关键组件基线

- `ChatInput.tsx`：文字、图片、语音、位置、悄悄话、守护请求入口；底部 safe area 是核心约束。
- `ChatInput.tsx` 的更多操作和悄悄话选择器使用 `chat-input-actions-popover` / `chat-input-whisper-popover` / `chat-input-whisper-list`，只管理可视高度、换行和内部滚动，不承载发送、录音、上传、位置或悄悄话业务逻辑。
- `ChatInput.tsx` 的录音 release/cancel 区域不得在 viewport/orientation 变化后继续沿用旧坐标；当前基线是直接取消录音并展示隐私提示，不改变音频上传或发送流程。
- `ChatMessage.tsx`：文本、图片、语音、位置、系统消息、悄悄话、长按操作、重要高亮。
- `Dialog.tsx`：确认、提示、输入、管理员密码、账号密码等全局弹窗。
- `Toast.tsx`：全局 toast。
- `ImportantNoticeBar.tsx`：聊天顶部重要通知；展开/收起按钮必须暴露 `aria-expanded`、`aria-controls` 和可读 label；展开内容使用 list/listitem 语义，列表高度使用视口相对上限并保持内部滚动；长 sender/preview/read-state 文案单行截断并用 `title` 保留完整信息；移除按钮必须保持稳定触控区、`aria-label` / `title`，视觉图标为 `aria-hidden`。
- `KeeperRequestSheet.tsx`：守护请求表单 sheet。
- `AssistantActionCard.tsx`：聊天内助理动作卡。
- `AssistantActionCard.tsx` 的 action row 使用 `assistant-action-row` 和 `assistant-action-button`，按钮必须可换行并保持触控区；不要把它扩展成泛 AI 卡片堆叠风。
- `RoleSelect.tsx` / `RoleBadge.tsx`：成员角色展示和选择；`RoleSelect` 必须使用 radiogroup/radio/aria-checked 语义，选中态必须有非颜色标记；`RoleBadge` 使用 `tone-chip` 基线，角色色只表示分类，不表示权限。
- `AudioBubble.tsx`：语音播放气泡；播放/暂停按钮必须提供本地化 `aria-label` / `title` 和 `aria-pressed`，未播放状态不能只靠红点表达，需保留 `sr-only` 文本；播放图标与波形属于装饰性内容，应使用 `aria-hidden`，并保持 360px/390px/430px 下不横向溢出。
- `ServiceWorkerRegister.tsx` / `AppPresenceTracker.tsx`：PWA/Push 支撑，不属于纯视觉组件。

## 页面基线

- `/`：入口选择。
- `/verify-family-code`、`/create-family`、`/join`、`/login`、`/register`、`/forgot-password`、`/reset-password`：家庭创建、加入与账号流程。
- `/chat`：主聊天页，最高优先级体验面。
- `/schedule`：日程页，含月/周/日、筛选、详情、评论、提醒状态。
- `/schedule` 详情 sheet 已补齐 modal a11y 基线，并开始跟随 visual viewport；评论输入、负责人响应、提醒状态和编辑保存的软键盘遮挡仍需真机或 authenticated browser 回归。
- `/me`：个人页与个人看板；当前基线是长昵称/长家庭名可换行、头像操作 360px 单列/390px 起可双列、空态使用 `status-note`，私密锁有 `sr-only` 标签。
- `/members`：家庭成员管理；当前基线是成员行 360px/390px 上下布局、430px 起左右布局，长昵称和最近活跃文案可换行，移除按钮 `min-h-10`，守护/悄悄话 icon-only 入口保留 `aria-label` / `title`。
- `/settings`：设置、Push、家庭管理、健康入口；当前使用 `settings-row-*` 处理长家庭名、家庭代码、Push 诊断值和健康入口在 360px/390px/430px 下的收缩与换行。
- `/admin/system-health`：系统健康检查 UI。
- `/image-preview`、`/offline`、`/mood-tree`：图片预览、离线页、心情树。

## 演进原则

- 先记录现状，再抽取共性，再做局部替换。
- 优先沉淀无风险展示组件；涉及聊天、日程、Push、权限的 UI 必须逐个验证。
- 新增设计 token 或语义类必须能解释清楚复用场景。
- 不在同一轮里同时做视觉重设计和业务流调整。
- 每次 UI 迭代后更新 `docs/iteration-log/_latest.md`。
