# 03 Multi-Agent Orchestration Prompts

Goal: require multi-subagent work while preventing file conflicts and unsafe merges.

## Prompt: Orchestrator With Subagents

```text
/goal Act as the Orchestrator for this UI refactor.

Read:
- AGENTS.md
- UI_RULES.md
- DESIGN_SYSTEM.md
- TASKS_UI.md
- CODEX_UI_LOOP.md
- PHASE_STATUS.md
- docs/iteration-log/_latest.md

Your job:
- Do not do large UI implementation yourself.
- Maintain phase control.
- Assign safe parallel tasks.
- Prevent multiple agents from editing the same files.
- Workers must write reports under docs/agent-reports/.
- Update PHASE_STATUS.md after every dispatch/review.
- Update TASKS_UI.md only after reviewing worker outputs.
- Do not merge worker changes unless validation passes.

Required worker pattern:
- Use report-only workers for audits.
- Use implementation workers only when file ownership is disjoint.
- Every worker must declare changed files.
- Every worker must run required validation or explain why not.

Stop condition:
- Phase state is updated.
- Worker outputs are reviewed.
- Next safe task is selected.
```

## Worker Prompt: Page Inventory

```text
You are Worker W1: Page Inventory.

Read:
- AGENTS.md
- UI_RULES.md
- DESIGN_SYSTEM.md
- TASKS_UI.md
- CODEX_UI_LOOP.md
- PHASE_STATUS.md
- app/**
- relevant lib/** and components/** references

Write only:
- docs/agent-reports/YYYYMMDD-page-inventory.md

Do not edit pages, components, services, schema, migrations, Push, Service Worker, PHASE_STATUS.md, TASKS_UI.md, or iteration logs.

Report:
- every route found
- purpose
- key user path
- data/service dependencies
- sensitive surfaces
- manual validation points
- next task recommendations
- validation performed
```

## Worker Prompt: Component Inventory

```text
You are Worker W2: Component Inventory.

Read:
- governance docs
- components/**
- app/** references
- public/ui-icons/**
- app/globals.css

Write only:
- docs/agent-reports/YYYYMMDD-component-inventory.md

Classify components:
- display
- interaction
- business-sensitive
- chat-sensitive
- schedule-sensitive
- PWA/Push support

For each key component, report:
- props/state dependencies
- layout/mobile risks
- a11y risks
- validation needs
- safe follow-up tasks
```

## Worker Prompt: Style Semantics

```text
You are Worker W3: Style Semantics.

Read:
- app/globals.css
- tailwind.config.ts
- representative app/** and components/** Tailwind usage
- governance docs

Write only:
- docs/agent-reports/YYYYMMDD-style-semantics.md

Report:
- existing semantic classes
- repeated Tailwind patterns
- extraction candidates
- deprecation candidates
- chat/schedule/safe-area/keyboard warnings
- low-risk first implementation options
```

## Worker Prompt: Mobile Width Audit

```text
You are Worker W4: Mobile Width Audit.

Read:
- app/**
- components/**
- app/globals.css
- governance docs

Write only:
- docs/agent-reports/YYYYMMDD-mobile-widths.md

Audit 360px, 390px, 430px risks:
- horizontal scroll
- long text overflow
- cramped buttons
- fixed width elements
- sheet/dialog overflow
- keyboard/safe-area issues

Static review is acceptable if browser is unavailable.
Do not start long-running servers unless explicitly allowed.
```

## Worker Prompt: Chat Layering

```text
You are Worker W5: Chat Layering.

Read:
- app/chat/page.tsx
- components/ChatInput.tsx
- components/ChatMessage.tsx
- components/ImportantNoticeBar.tsx
- public/sw.js references
- message/push/realtime service references

Write only:
- docs/agent-reports/YYYYMMDD-chat-layering.md

Report risks for:
- 100dvh / dynamic viewport
- keyboard
- input bar
- recording
- toolbar
- whisper mode
- important notice
- message action menu
- toast/dialog
- notification click return

Do not change chat architecture.
```

## Worker Prompt: Schedule Layering

```text
You are Worker W6: Schedule Layering.

Read:
- app/schedule/page.tsx
- lib/scheduleService.ts
- schedule reminder/collaboration references
- types/schedule.ts

Write only:
- docs/agent-reports/YYYYMMDD-schedule-layering.md

Report risks for:
- detail panel
- filters
- month/week/day switching
- comment input
- assignee response
- reminder status
- keyboard/safe-area
- private schedule visibility wording

Do not change schedule architecture or RPC behavior.
```

## Implementation Worker Template

```text
You are Worker <id>: <task name>.

You are not alone in the codebase. Do not revert or overwrite edits made by others.

Allowed write files:
- <explicit file 1>
- <explicit file 2>

Read scope:
- <files needed>

Forbidden:
- PHASE_STATUS.md
- TASKS_UI.md unless Orchestrator explicitly assigns finalization
- unrelated files
- database/API/Push/Service Worker/auth unless explicitly in scope

Implementation requirements:
- smallest useful diff
- preserve business logic
- preserve permission boundaries
- preserve mobile-first behavior
- add or update focused tests only if available and proportional

Validation:
- npm run lint
- npm run typecheck
- npm run build
- git diff --check
- task-specific browser/mobile/manual checks

Final response:
- changed files
- validation results
- risks
- handoff notes
```
