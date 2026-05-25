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

## 关键组件基线

- `ChatInput.tsx`：文字、图片、语音、位置、悄悄话、守护请求入口；底部 safe area 是核心约束。
- `ChatMessage.tsx`：文本、图片、语音、位置、系统消息、悄悄话、长按操作、重要高亮。
- `Dialog.tsx`：确认、提示、输入、管理员密码、账号密码等全局弹窗。
- `Toast.tsx`：全局 toast。
- `ImportantNoticeBar.tsx`：聊天顶部重要通知。
- `KeeperRequestSheet.tsx`：守护请求表单 sheet。
- `AssistantActionCard.tsx`：聊天内助理动作卡。
- `RoleSelect.tsx` / `RoleBadge.tsx`：成员角色展示和选择。
- `AudioBubble.tsx`：语音播放气泡。
- `ServiceWorkerRegister.tsx` / `AppPresenceTracker.tsx`：PWA/Push 支撑，不属于纯视觉组件。

## 页面基线

- `/`：入口选择。
- `/verify-family-code`、`/create-family`、`/join`、`/login`、`/register`、`/forgot-password`、`/reset-password`：家庭创建、加入与账号流程。
- `/chat`：主聊天页，最高优先级体验面。
- `/schedule`：日程页，含月/周/日、筛选、详情、评论、提醒状态。
- `/me`：个人页与个人看板。
- `/members`：家庭成员管理。
- `/settings`：设置、Push、家庭管理、健康入口。
- `/admin/system-health`：系统健康检查 UI。
- `/image-preview`、`/offline`、`/mood-tree`：图片预览、离线页、心情树。

## 演进原则

- 先记录现状，再抽取共性，再做局部替换。
- 优先沉淀无风险展示组件；涉及聊天、日程、Push、权限的 UI 必须逐个验证。
- 新增设计 token 或语义类必须能解释清楚复用场景。
- 不在同一轮里同时做视觉重设计和业务流调整。
- 每次 UI 迭代后更新 `docs/iteration-log/_latest.md`。
