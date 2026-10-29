# Meow Budget — November 2026 go-live checklist

Status: preparation only. NO production deployment, database migration, or deletion authorized by this document.

## User-approved target
- Start fresh on 2026-11-01; current transaction records are trial data.
- Preserve category tree, monthly budgets, household identity and membership, invitation relationship, and per-device Mr/Mrs role settings.
- Historical Shareroo migration is out of scope by user choice; start collecting new records only after approved cutover.
- User agreed to a future cleanup, NOT to deleting records immediately.

## Findings (2026-10-29)
- Test cloud-test.html uses isolated Supabase project kixnyvgqtznjzdrvbweb.
- Production index.html uses hennrsqbxvrwmdizdnzg.
- main and feature/inline-recurring-entry have diverged (feature 115 commits ahead, 2 behind); do not merge blindly.
- Main lacks revision-based CAS; feature index has CAS but lacks the tested reconnect retry; cloud-test has both.
- Test on two iPhones verified stale-write protection, retained offline data, reconnect retry, and receipt on other device. Full automated regression and production permissions not yet verified.

## Release gates
1. Review production DB schema/RLS/RPC and auth grants read-only. Do not run baseline migration on existing DB.
2. Prepare reviewed incremental migration for production revision and save_app_state; verify access policies and backup/rollback.
3. Create a release candidate from current main with selectively ported, tested features. Keep production Supabase config separate from test config.
4. Run automated regression: recurring, split shares, repayment, edit/delete, backup import/export, authentication, account joining, duplicate entries, offline/reconnect, and stale conflict.
5. Validate on both real phones with isolated test project and distinct accounts/roles.
6. Before cutover export full production ledger JSON and verify it can be restored; preserve DB backup and exact Git SHA.
7. Prepare transaction-only reset: retain cats, budgets, household and member records, user role preferences. Clear tx and ONLY explicitly designated transaction-derived settlement/repayment data after review. Check recurring schedules/planned entries for unintended re-creation of trial transactions. Reset must be revision-checked and audited; do not call resetAll() because it restores demo data and overwrites settings.
8. Confirm with user exact deletion scope, especially repayments, recurring templates and planned entries, and explicit go-live timing. Perform no deletion until separate approval.
9. Publish production release only after user approves. Verify both devices and rollback readiness.

## Important
A JSON import overwrites entire state; do not use it as a conflict merge. The isolated test data must never be imported to production.
## Verification update — 2026-10-29
- GitHub Actions isolated offline-browser workflow run 40792840284 completed successfully after test auth-overlay fix (commit 3fab3bec).
- This validates browser smoke tests, NOT live production RLS, production migrations, or actual transaction cleanup.
- Inspected cloud-test.html: `defaults()` includes seven demo transactions; `resetAll()` restores defaults, so it must NOT be used for November cutover.
- App state contains `tx`, `cats`, `budgets`, `repayments`, `recurring`, and `planned`. A safe fresh-start operation must explicitly decide the fate of `repayments`, `recurring`, and `planned` to prevent old settlements or automatic recreation of trial entries.
- `ROLE_KEY` is device-local and user-scoped; do not clear local storage wholesale.
- Production release remains blocked until schema/permissions inspection, backup and explicit approval.

## User decision — 2026-10-29: recurring schedules
- User explicitly approved clearing existing recurring expense schedules at the November fresh start; no need to preserve these templates.
- Planned transaction records and test-derived repayments/settlements should be reviewed for clearing so that no historical test amount survives into the new ledger. Preserve categories, budgets, household membership and per-device roles.
- This records intended future cleanup scope only; it is NOT authorization to delete immediately. Before execution, verify backup and ask for cutover approval.

## User decision: no Shareroo migration (2026-10-29)
- User decided **not to import** Shareroo historical records. No paid export/free trial, screenshot transcription, or migration workflow needed.
- November objective is easy daily tracking and subsequent monthly spending review, not reconstructing prior history.
- Preserve agreed November reset scope (transactions, repayments, recurring, planned) and settings (categories, budgets, household and roles).
- Any legacy import plan is deferred and must not be part of release blockers or deployment scope.

## Release gate evidence matrix — updated 2026-10-29

| Gate | Status | Evidence / next required proof |
|---|---|---|
| Browser offline smoke | PASS (isolated only) | GitHub Actions run 40797441386 successful; does not prove live cloud behavior |
| November fresh-start Node tests | UNVERIFIED | CI workflow files updated; obtain dedicated job run/step evidence, not just offline smoke result |
| Sync and conflict regression | PARTIAL | Prior manual two-device test passed; re-run against release candidate after DB migration rehearsal |
| Production CAS schema | BLOCKED | Production app_state lacks revision; staged migration must be tested before deployment |
| Backup and restore | BLOCKED | Full production backup and isolated restore rehearsal not yet verified |
| Safe November reset | PREPARED ONLY | Pure helper on isolated test page; no authorized production execution or integrated revision-checked reset |
| Security privilege hardening | BLOCKED | Review/revoke unnecessary grants after isolated verification and approval |
| Production go-live | NOT APPROVED | Requires all gates above, explicit cutover approval, and rollback plan |

Do not interpret PASS on browser smoke as overall release approval. No Shareroo import is required.

## Test-project CAS evidence — 2026-10-29

Read-only inspection of isolated test project confirms: one household, two household members, one app_state row, RLS on all three tables, revision column and save_app_state RPC present. Effective `authenticated` permissions: RPC EXECUTE true, direct app_state UPDATE false. This validates permission wiring only, not a real signed-in concurrency test. No SQL writes performed. See `docs/production-cutover-runbook-draft.md`.
