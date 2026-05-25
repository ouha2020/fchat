# 02 Task Ledger Prompts

Goal: turn the research report into a phase-based task ledger that agents can execute without guessing.

## Prompt: Build Task Ledger

```text
/goal Build a UI refactor task ledger for this repository.

Read:
- AGENTS.md
- UI_RULES.md
- DESIGN_SYSTEM.md
- CODEX_UI_LOOP.md
- docs/iteration-log/_latest.md
- current routes/components/styles

Create or update:
- TASKS_UI.md

Do not edit implementation files.

Task ledger requirements:
- Organize tasks by phase.
- Each task must be small enough for one safe iteration.
- Each task must include priority P0/P1/P2/P3.
- Each task must identify target page/component/system.
- Each task must identify validation needs.
- Security, permissions, database, Push, Service Worker, RPC, Realtime, and Storage items must be marked as architecture/security tasks, not UI polish.

Suggested phases:
- Phase 0: governance and baseline.
- Phase 1: full UI audit.
- Phase 2: design system foundation.
- Phase 3: shared components.
- Phase 4: high-frequency pages.
- Phase 5: accessibility.
- Phase 6: performance.
- Phase 7: validation and release gates.

Priority model:
- P0: blocks usage, causes privacy/permission confusion, breaks chat/schedule critical path, causes mobile horizontal scroll, hides key controls, or creates clear a11y failure.
- P1: high-frequency instability, long text overflow, inconsistent components, poor touch ergonomics.
- P2: medium-frequency consistency, empty/loading/error states, visual hierarchy, reducing duplicated local styles.
- P3: low-risk polish, motion tuning, icon asset cleanup, non-critical visuals.

Validation:
- Docs-only: git diff --check.

Final answer in Chinese with changed files and risks.
```

## Prompt: Select Next Task

```text
Act as the Orchestrator.

Read:
- AGENTS.md
- UI_RULES.md
- DESIGN_SYSTEM.md
- TASKS_UI.md
- CODEX_UI_LOOP.md
- PHASE_STATUS.md
- docs/iteration-log/_latest.md
- docs/agent-reports/, if present

Select exactly one next task.

Rules:
- Do not select Phase N+1 until Phase N exit gates pass.
- Prefer report-only audit before implementation when uncertainty is high.
- Prefer shared low-risk design-system tasks before sensitive chat/schedule implementation.
- Do not select tasks that touch the same files as active workers.
- If the worktree is dirty, list relevant and unrelated changes before assigning.

Output:
- selected task
- why it is next
- owner
- allowed write files
- read scope
- validation gates
- stop condition
```

## Prompt: Finalize Worker Findings Into Ledger

```text
Act as the Orchestrator and final editor of TASKS_UI.md.

Read all worker reports under docs/agent-reports/.

For each finding:
- Accept, reject, or defer it.
- Convert accepted findings into TASKS_UI.md tasks.
- Preserve priority and safety boundaries.
- Do not copy speculative findings as facts.
- Do not mark tasks done unless the report includes validation evidence.

Only the Orchestrator may update TASKS_UI.md.
Run git diff --check.
```
