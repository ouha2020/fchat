# UI Autonomous Refactor Prompt Pack

Source report: `C:/Users/wangb/Downloads/deep-research-report.md`

This pack turns the research report into executable Codex prompts for a mobile-first UI refactor system.

Use order:

1. `01-rules-files.md`
2. `02-task-ledger.md`
3. `03-multi-agent-orchestration.md`
4. `04-validation-gates.md`
5. `05-one-run-goal.md`

Operating principles:

- The Orchestrator controls phase status and final task ledger updates.
- Workers write reports or bounded patches only inside assigned scopes.
- No two workers may edit the same file set.
- No worker may bypass validation gates.
- Implementation does not advance phases until reports are reviewed and validation passes.

Recommended output locations:

- Rules: repository root, for example `AGENTS.md`, `UI_RULES.md`, `DESIGN_SYSTEM.md`, `CODEX_UI_LOOP.md`.
- Task ledger: `TASKS_UI.md`.
- Phase status: `PHASE_STATUS.md`.
- Worker reports: `docs/agent-reports/`.
- Iteration logs: `docs/iteration-log/`.
