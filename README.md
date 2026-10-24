# Meow Budget

A lightweight shared household budget app.

## Development status

The current work is on `feature/shared-settlement-v1`. Pull request #1 remains a Draft and is not deployed to the production GitHub Pages site.

## Local verification

The GitHub Actions workflow checks inline JavaScript syntax and runs the Node test suite:

- Settlement, recurring transactions, JSON backup/import, and legacy-state behavior.
- Static checks for revision-based sync and migration safety assumptions.

These automated checks do not replace runtime testing against an isolated Supabase project.

## Supabase database files

- `supabase/migrations/202610240000_initial_shared_household_schema.sql`: baseline for a **fresh, empty isolated test project only**.
- `supabase/migrations/202610240001_add_app_state_revision.sql`: household-scoped, revision-checked save RPC and direct-update privilege revocation.
- `supabase/diagnostics/read_only_security_audit.sql`: SELECT-only catalog audit; does not read ledger rows or mutate schema.
- `docs/supabase-test-project-runbook.md`: safe isolated test-project sequence.
- `docs/supabase-security-review.md`: current design review and unresolved blockers.
- `docs/revision-sync-rollout.md`: revision migration and rollout checklist.

**Safety:** Do not run the baseline migration against production or an existing project. Do not run either migration until the target Project Reference ID is verified and the schema reviewed. No migration in this branch has been applied to Supabase. Do not merge or deploy until the isolated database tests pass and release is explicitly approved.
