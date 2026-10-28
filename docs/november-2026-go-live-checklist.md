# Meow Budget — November 2026 go-live checklist

Status: preparation only. NO production deployment, database migration, or deletion authorized by this document.

## User-approved target
- Start fresh on 2026-11-01; current transaction records are trial data.
- Preserve category tree, monthly budgets, household identity and membership, invitation relationship, and per-device Mr/Mrs role settings.
- Continue using the other expense app as source of truth until explicit cutover.
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