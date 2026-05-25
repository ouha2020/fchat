# 04 Validation Gate Prompts

Goal: make every task stop at a clear pass/fail gate.

## Prompt: Validate Current Iteration

```text
Act as QA gatekeeper for the current UI iteration.

Read:
- AGENTS.md
- UI_RULES.md
- CODEX_UI_LOOP.md
- TASKS_UI.md
- docs/iteration-log/_latest.md
- current git diff

Run available commands:
- npm run lint
- npm run typecheck
- npm run build
- git diff --check

If package.json includes test/e2e/lhci scripts, run them too.
If a script is missing, record it as missing.

For UI changes, also verify or record required manual checks:
- 360px
- 390px
- 430px
- no horizontal scroll
- no button text overflow
- no sheet/dialog overflow
- keyboard does not hide critical action

For chat changes, require:
- send text
- image
- audio
- location
- whisper
- important notice
- message action menu
- Push click return if touched

For schedule changes, require:
- month/week/day switch
- create/edit/delete
- filters
- comments
- assignee response
- reminder status
- private visibility boundary

Output:
- PASS or BLOCKED
- command results
- manual checks completed/missing
- risks
- exact next fix if blocked
```

## Prompt: Security Boundary Review

```text
Act as security reviewer for a UI refactor diff.

Inspect staged and unstaged changes.

Check for:
- member token in URL
- Auth token in URL/logs
- service role key in client or repo
- admin hash/password hash in UI/logs
- Push payload containing message body, media URL, coordinates, family code, tokens
- UI-only permission filtering replacing RPC/server checks
- direct table reads replacing RPC/service paths
- removed-member access loopholes
- private chat or private schedule visibility confusion

Also scan staged files for token-like strings:
- sbp_
- gho_
- sk-
- service_role
- VAPID_PRIVATE_KEY
- SUPABASE_SERVICE_ROLE_KEY

Output:
- pass/block
- findings with file references
- required fixes
```

## Prompt: Merge Gate

```text
Act as the final merge gate.

Do not merge automatically.

Required evidence:
- selected task completed
- validation commands passed
- task-specific manual checks recorded
- docs/iteration-log/_latest.md updated
- TASKS_UI.md updated by Orchestrator
- no forbidden file changes
- no secrets in staged diff
- PR is draft unless user explicitly asks ready-for-review

If database migrations are included:
- confirm migration files and supabase/schema.sql both updated
- confirm production migration has been applied or explicitly mark as pending
- confirm /admin/system-health or SQL reconciliation is planned

Output:
- merge readiness: READY / NOT READY
- blockers
- recommended PR title
- recommended PR body
```

## Local Gate Command Set For This Repository

This repo currently uses npm. Default commands:

```bash
npm run lint
npm run typecheck
npm run build
git diff --check
```

Known missing scripts:

```bash
npm run test
npm run test:e2e
npm run test:lhci
```

Do not report missing scripts as passed.
