# CODEX_UI_LOOP.md — UI 迭代闭环

每轮 UI 工作必须按以下顺序执行：audit → select → implement → validate → review → record → continue。

## 1. audit

- 阅读 `AGENTS.md`、`UI_RULES.md`、`DESIGN_SYSTEM.md`、`TASKS_UI.md` 和 `docs/iteration-log/_latest.md`。
- 阅读本轮相关页面、组件、服务调用和权限边界。
- 识别是否涉及聊天、日程、Push、Realtime、Storage、Auth、RPC、RLS、Service Worker。
- 如果任务会触碰业务逻辑、权限、数据库或安全边界，先缩小任务或停止并说明风险。

## 2. select

- 从 `TASKS_UI.md` 选择一个最小任务。
- 记录任务优先级、目标页面/组件、不可破坏项、预期验证命令。
- 不把多个页面的大改造合并成一轮。

## 3. implement

- 只修改本轮任务需要的文件。
- 优先复用现有语义类、组件和视觉语言。
- 不顺手重构无关业务代码。
- 不改 Auth、权限、数据库 schema、RPC、Push payload、Service Worker 行为或消息/日程数据流。
- UI 代码中保持长文本、移动宽度、safe area、键盘、焦点态可用。

## 4. validate

- UI 代码改动默认执行：
  - `npm run lint`
  - `npm run typecheck`
  - `npm run build`
  - `git diff --check`
- 文档-only 改动至少执行 `git diff --check`。
- 如果脚本不存在，记录为 missing，不要伪造结果。
- 手动或浏览器检查移动宽度：360px、390px、430px。
- 涉及聊天、日程、Push、上传、录音、位置、键盘时，补充对应手动回归。

## 5. review

- UX review：检查是否符合移动端原生 App 感、家庭感、触控友好、长文本稳定。
- A11y review：检查 aria 名称、label、焦点态、键盘、对比度、动效降级。
- Security review：确认没有泄露 token、family code、消息正文到 Push payload、URL 或日志。
- Architecture review：确认没有替换聊天、日程、Push、Realtime、Storage 架构。

## 6. record

- 用 `docs/iteration-log/_template.md` 的格式更新 `docs/iteration-log/_latest.md`。
- 记录本轮任务、修改文件、验证命令和结果、手动检查、风险、下一步。
- 如果发现新任务，把它补入 `TASKS_UI.md`，并标注优先级。

## 7. continue

- 如果本轮通过验证，选择下一个最小任务。
- 如果验证失败，先修复本轮引入的问题，再继续。
- 如果发现范围扩大，停止并把新范围拆成后续任务。
- 每轮结束时确保工作树只包含本轮必要改动和用户已有改动。
