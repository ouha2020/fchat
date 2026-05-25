# QA / A11y / Performance Review

日期：2026-05-25
范围：仅执行 QA、可访问性与性能审计；未修改业务逻辑、数据库、Auth、Push、Service Worker、页面 UI 或任务状态文档。

## 已读取文件

- `AGENTS.md`
- `UI_RULES.md`
- `DESIGN_SYSTEM.md`
- `CODEX_UI_LOOP.md`
- `package.json`
- 相关页面/组件源码：`app/page.tsx`、`app/join/page.tsx`、`app/chat/page.tsx`、`app/schedule/page.tsx`、`components/ChatInput.tsx`、`components/ChatMessage.tsx`、`components/Dialog.tsx`、`components/EffectOverlay.tsx`、`components/AudioBubble.tsx`、`app/globals.css`

## Validation Results

| 项目 | 结果 | 备注 |
| --- | --- | --- |
| `npm run lint` | PASS | `next lint` 无 warning/error |
| `npm run typecheck` | PASS | `tsc --noEmit` 通过 |
| `npm run build` | PASS | 最终 clean build 通过，37 个静态页面生成完成 |
| `npm run test` | N/A | `package.json` 未定义 `test` |
| `npm run test:e2e` | N/A | `package.json` 未定义 `test:e2e` |
| `npm run test:lhci` | N/A | `package.json` 未定义 `test:lhci` |
| `git diff --check` | PASS | exit 0；仅输出既有工作区文件的 LF/CRLF warning |

验证注意：

- 首次 build 通过。
- 后续启动 `next dev` 并进行浏览器 viewport 检查时，同工作区 dev server 与 `.next` 产物发生竞争，出现 `MODULE_NOT_FOUND './8948.js'`、缺失 `app/page.js` / `app/join/page.js` 等 dev/build 产物污染。
- 停止同工作区 Next dev/start 进程并清理生成目录 `.next` 后，重新执行 `npm run build`，最终 PASS。
- 渲染检查改用 clean build 后的 production preview：`http://127.0.0.1:3010`。

## Browser / Layout Checks

Production preview：

- `/` 在 360px、390px、430px：无横向滚动。
- `/join` 在 390px：无横向滚动。
- `/` 与 `/join`：页面非空，标题为 `Family Chat`。
- `/` 与 `/join`：production preview 控制台未捕获 `127.0.0.1:3010` 相关 warning/error。
- 首页主操作卡片可通过 locator focus probe 获得 `:focus-visible`，有 2px outline。

发现：

1. 首页次级文字链接触控高度不足。
   - `app/page.tsx:115` 的登录/忘记密码链接在 360/390/430px 下高度约 20px，低于 UI_RULES 建议的 40px。
   - 建议：为这两个链接加 `min-h-10 inline-flex items-center px-2` 或等价触控区域。

2. 加入页“忘记家庭代码”按钮触控高度不足。
   - `app/join/page.tsx:179` 的找回按钮在 390px 下高度约 20px。
   - 建议：保持文本样式，但扩大 hit area，例如 `inline-flex min-h-10 items-center`.

## Accessibility Findings

1. 多个 Dialog 表单控件缺少真正关联的 label。
   - `components/Dialog.tsx:386` 的通用输入框仅有 placeholder。
   - `components/Dialog.tsx:472` 起，密码字段使用 `<span className="label">`，未通过 `<label>` 包裹或 `htmlFor` 关联 input。
   - 建议：为每个 input 增加 `id` + `<label htmlFor>`，或使用 `aria-label` / `aria-labelledby`。

2. 密码显示/隐藏按钮被移出键盘 Tab 顺序。
   - `components/Dialog.tsx:483`、`components/Dialog.tsx:510` 等显示/隐藏按钮设置了 `tabIndex={-1}`。
   - 影响：键盘用户无法操作显示/隐藏密码。
   - 建议：移除 `tabIndex={-1}`，补充 `aria-label`，并确保 focus-visible 样式。

3. 聊天输入框缺少显式可访问名称。
   - `components/ChatInput.tsx:704` 的 textarea 只有 placeholder。
   - 建议：增加 `aria-label={t("inputPlaceholder")}` 或 sr-only label。

4. 日程详情抽屉内部分临时表单控件缺少 label。
   - `app/schedule/page.tsx:1868` 拒绝原因 textarea 仅依赖 placeholder。
   - `app/schedule/page.tsx:2060` 私聊对象 select 未关联 label。
   - `app/schedule/page.tsx:2075` 评论 textarea 仅依赖 placeholder。
   - 建议：使用 sr-only label，避免视觉增加负担。

5. 消息特效重播区域鼠标可点但键盘不可达。
   - `components/ChatMessage.tsx:436` 在有 `effect_id` 时给 `div` 加 `onClick`，但没有 `role="button"`、`tabIndex`、Enter/Space handler。
   - 建议：改为 button 语义或补齐键盘交互。

## Reduced Motion

已有覆盖：

- `app/globals.css:497` 的 `prefers-reduced-motion` 目前覆盖 mood tree 相关动画。

缺口：

- `app/globals.css:38` 的 `.native-press` transition / active transform 未降级。
- `app/globals.css:270` 的 important message highlight animation 未降级。
- `app/globals.css:293` / `308` 的 toast/dialog 入场动画未降级。
- `components/EffectOverlay.tsx:130` / `142` 的 inline effect animation 未检查 reduced motion。
- `components/AudioBubble.tsx:122` 的 audio wave animation 未检查 reduced motion。
- `app/chat/page.tsx:502` 与 `508` 的 bounce/pulse loading animation 未降级。

建议：统一增加 reduced-motion 分支，禁用或缩短 transform/animation；对 `EffectOverlay` 用 hook 检查 `prefers-reduced-motion`，减少粒子数量或直接显示静态 caption。

## Layout / CLS / Skeleton

通过项：

- 首页和加入页在 360/390/430px 主要布局无横向滚动。
- 聊天助手 pending bubble 使用 `min-h-[112px]` 和固定宽度 skeleton（`app/chat/page.tsx:498`、`508`-`510`），结构相对稳定。

风险：

- 聊天图片消息 `<img>` 未设置 `width`、`height` 或 `aspect-ratio`（`components/ChatMessage.tsx:357`）。
- 影响：图片加载前消息气泡高度无法预留，弱网或缓存 miss 时可能产生明显 layout shift。
- 建议：上传后保存图片尺寸，渲染时用 aspect-ratio/固定预览框预留空间；至少为图片气泡设置稳定的 min/max preview box。

## Performance Notes

- 最终 build 结果中 `/chat` First Load JS 约 245 kB，`/schedule` 约 216 kB，shared JS 约 87.5 kB。
- 当前仓库没有 LHCI/performance budget 脚本，无法自动量化 LCP/CLS/INP。
- 建议后续补 `test:lhci` 或轻量 Playwright trace，对 `/`、`/join`、`/chat`、`/schedule` 建立移动端预算。

## Suggested Fix Order

1. 补 Dialog / ChatInput / Schedule drawer 的 label 与密码显示按钮键盘可达性。
2. 扩大首页和加入页次级文本链接 hit area。
3. 为消息特效 replay 补 button 语义和键盘处理。
4. 扩展 reduced-motion 覆盖到全局按压、toast/dialog、effect overlay、audio wave、loading pulse/bounce。
5. 为聊天图片消息预留 aspect-ratio，降低 CLS。

## Migration / API / RPC Impact

本轮未修改数据库、migration、API、RPC、Auth、Push、Service Worker 或业务权限逻辑。当前报告仅记录 QA/a11y/performance 结果与建议。
