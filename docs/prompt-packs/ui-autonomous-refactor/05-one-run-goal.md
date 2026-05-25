# 05 One-Run Executable Goal

Use this when you want Codex to start one controlled phase of the system.

```text
/goal Run one controlled UI refactor orchestration phase for this repository.

Read:
- AGENTS.md
- UI_RULES.md
- DESIGN_SYSTEM.md
- TASKS_UI.md
- CODEX_UI_LOOP.md
- PHASE_STATUS.md
- docs/iteration-log/_latest.md
- docs/agent-reports/ if present

Mode:
- Orchestrator first.
- Do not start implementation until phase status allows it.
- Prefer report-only worker audits when uncertainty is high.
- Use multiple subagents for independent read-only audits.
- Each worker must have a unique report path.
- No two agents may edit the same files.

Phase rules:
- Phase 0: governance docs only.
- Phase 1: full UI audit reports only.
- Phase 2: design-system documentation and low-risk semantics.
- Phase 3+: implementation only after Phase 1 reports are reviewed and task ledger is finalized.

Required Orchestrator actions:
1. Confirm current branch and worktree state.
2. Confirm active phase from PHASE_STATUS.md.
3. Assign disjoint worker tasks.
4. Record worker ids, owners, write scopes, and status in PHASE_STATUS.md.
5. Wait for worker outputs only when needed for the next critical decision.
6. Review reports before updating TASKS_UI.md.
7. Run validation gates.
8. Update docs/iteration-log/_latest.md.
9. Stop with clear next step.

Worker report requirements:
- scope
- files reviewed
- findings by P0/P1/P2/P3
- security/architecture boundaries
- recommended next tasks
- validation performed
- changed files statement

Validation gates:
- docs-only: git diff --check
- code changes: npm run lint, npm run typecheck, npm run build, git diff --check
- UI changes: 360px, 390px, 430px mobile checks
- chat changes: chat-specific manual regression
- schedule changes: schedule-specific manual regression
- database changes: migration + schema sync + production application plan

Forbidden:
- direct push to main
- merging worker changes without validation
- updating TASKS_UI.md from unreviewed worker output
- changing database/API/Push/Service Worker in a UI polish task
- submitting secrets or local MCP/Codex config

Final answer in Chinese:
- 修改内容
- 修改文件
- migration / API / RPC 影响
- 验证结果
- 风险点
- 下一步建议
```
