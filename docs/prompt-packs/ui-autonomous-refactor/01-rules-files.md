# 01 Rules File Prompts

Goal: create or maintain the rules files that make UI refactor work repeatable, bounded, and reviewable.

## Prompt: Bootstrap Rules Files

```text
/goal Bootstrap the UI refactor governance system for this repository.

Read first:
- AGENTS.md, if present
- package.json
- app or src directory structure
- existing design system docs, if present
- README.md

Create or update only governance documents. Do not edit app pages, components, services, database, API, Push, Service Worker, or business logic.

Required outputs:
- AGENTS.md: project entry rules for Codex agents.
- UI_RULES.md: product/UI invariants, forbidden UI directions, mobile-first constraints, a11y rules, security boundaries.
- DESIGN_SYSTEM.md: current design-system baseline, token sources, component semantics, style evolution constraints.
- CODEX_UI_LOOP.md: audit -> select -> implement -> validate -> review -> record -> continue loop.
- docs/iteration-log/_template.md: iteration log template.
- docs/iteration-log/_latest.md: initial baseline log.

Rules:
- Preserve existing project-specific constraints.
- If existing AGENTS.md has stricter product/security rules, keep them.
- The system must prefer mobile-first, warm, minimal, native-app-like UI.
- The system must prohibit broad dashboard/SaaS-style redesign unless explicitly requested.
- The rules must mention required validation commands available in package.json.
- If a validation script is missing, record it as missing; do not invent success.

Validation:
- For docs-only changes, run git diff --check.

Final answer in Chinese:
- 修改内容
- 修改文件
- migration / API / RPC 影响
- 验证结果
- 风险点
- 下一步建议
```

## Prompt: Review Rules Consistency

```text
Act as the UI governance reviewer.

Read:
- AGENTS.md
- UI_RULES.md
- DESIGN_SYSTEM.md
- TASKS_UI.md
- CODEX_UI_LOOP.md
- docs/iteration-log/_latest.md

Do not edit implementation files.

Check:
- Are rules consistent with the project identity?
- Do rules prevent business logic, permission, database, Push, Realtime, Storage, and Service Worker drift?
- Are mobile widths 360px, 390px, and 430px explicitly covered?
- Are icon-only controls, labels, focus, reduced motion, and long text covered?
- Are validation commands realistic for this repository?

If changes are needed, update only governance docs and iteration log.
Run git diff --check.
```

## File Boundary Rules

- Orchestrator may edit `PHASE_STATUS.md`, `TASKS_UI.md`, governance docs, and iteration logs.
- Workers may not edit `PHASE_STATUS.md` or finalize `TASKS_UI.md`.
- Workers must write reports under `docs/agent-reports/`.
- Implementation workers must receive explicit file ownership before editing.
