# Shared Component Phase Report

## Scope

- 日期：2026-05-25
- 范围：共享 UI 组件、组件级样式、`docs/agent-reports/shared-components.md`
- 顺序：Button → Input/TextField → Card → BottomTabBar
- 非目标：未改页面业务流程，未改 Auth、权限、数据库、API、RPC、Push、Service Worker，未编辑 `PHASE_STATUS.md` 或 `TASKS_UI.md`

## Changed Files

- `components/ui/classNames.ts`
  - 新增轻量 `cx` className 合并工具，避免引入额外依赖。
- `components/ui/Button.tsx`
  - 新增共享 Button，保留原生 `button` props。
  - 支持 `primary`、`secondary`、`ghost`、`danger` variants，`sm`、`md`、`lg`、`icon` sizes，`fullWidth` 和 `loading`。
- `components/ui/TextField.tsx`
  - 新增共享 `Input` 与 `TextField`。
  - 保留原生 input props，补充 label、hint、error、`aria-describedby`、`aria-invalid` 关联。
- `components/ui/Card.tsx`
  - 新增共享 Card，映射现有 `card`、`section-card`、`action-card`、`empty-state` 语义。
- `components/ui/BottomTabBar.tsx`
  - 新增底部导航组件，支持 active state、disabled state、badge、icon、`aria-current` 和安全区样式。
  - 本轮未接入现有页面，避免改变聊天页或其它页面布局行为。
- `app/globals.css`
  - 强化现有按钮、输入、卡片语义类的 focus、disabled、触控和长文本稳定性。
  - 新增 `btn-sm`、`btn-md`、`btn-lg`、`btn-icon`、`field-error`、`field-hint`、`field-error-text`、`card-compact`。
  - 新增 BottomTabBar 相关语义类，使用 Tailwind token 和现有 brand/slate/rose 色阶。

## Validation

- `npm run lint`：passed，No ESLint warnings or errors。
- `npm run typecheck`：passed，`tsc --noEmit` 成功。
- `npm run test`：not available，`package.json` 没有 test script。
- `npm run build`：passed，`next build` 成功生成 37 个 routes/static pages。
- `git diff --check`：passed；仅出现仓库已有 LF/CRLF warning，无 whitespace error。
- 浏览器回归：
  - 端口 3000 已被占用，临时 dev server 使用 3001。
  - 3001 dev server 曾因本地 `.next`/现有 Next 进程干扰导致 CSS 资源 500；随后重新 `npm run build`，改用 production server `npm run start -- -p 3002` 验证。
  - `/` 与 `/login` 在 360px、390px、430px 下均有内容、无 Next error overlay、无 console error、`scrollWidth === viewportWidth`、无窄于 40px 的可点击目标。

## Migration / API / RPC Impact

- Migration：无。
- API：无。
- RPC：无。
- Auth / permissions：无。
- Push / Service Worker：无。

## Risks

- 新增共享组件目前是基础能力，尚未批量替换页面内现有 class 用法；这是刻意保持本轮 scope 较小。
- `app/globals.css` 是全站语义类来源，本轮增强 `.btn`、`.field`、`.action-card` 的 focus/disabled/触控样式，理论影响全站现有使用点；自动构建和移动宽度抽样已通过，但聊天、日程深路径仍建议在后续页面轮次单独回归。
- BottomTabBar 未接入页面，因此只完成组件与样式沉淀，未验证真实业务导航中的 active/badge 组合。
- 当前工作树已有大量既有未提交改动；本轮只新增共享组件并调整组件级样式，未回退或整理其它改动。

## Next Component Recommendation

下一轮建议选择 `Dialog` 作为一个独立组件任务：它在确认、提示、输入、敏感操作中高频使用，应该单独检查焦点、键盘、长内容滚动、底部安全区和危险操作确认。若继续推进本轮新增原子组件的落地，建议先选 `/login` 作为最小页面，把 Button/TextField/Card 逐步替换进去并做单页回归。
