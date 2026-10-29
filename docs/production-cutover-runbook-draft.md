# Production migration runbook (DRAFT — DO NOT EXECUTE)

Status: preparation only. No production SQL has been applied. Requires a verified database backup, rollback rehearsal, and separate user approval before execution.

## Verified production prerequisites

- Three public tables: households (1), household_members (2), app_state (1), all RLS enabled.
- Two household memberships exist; do not touch them or invite codes.
- app_state has no revision column, and authenticated currently has direct UPDATE.
- Existing SELECT, INSERT and UPDATE policies on app_state check household membership.
- The existing migration `202610240001_add_app_state_revision.sql` adds revision and CAS RPC but also immediately revokes direct UPDATE. **Applying it while older deployed clients are running could break saves.** Do not run it as-is.
- Role grants currently include TRUNCATE, TRIGGER and REFERENCES for anon/authenticated on all three public tables. These need review and tightening; RLS does not protect TRUNCATE.

## Proposed staged rollout

1. **Backup and rehearsal**: export complete app_state JSON and database schema/policies/functions/grants through approved secure tooling; verify restore on isolated project. Never place personal financial data or secrets in GitHub.
2. **Preflight**: verify table/column names, app_state row count and household ID consistency, function ownership and effective privileges; confirm users have stopped using old clients during cutover.
3. **Additive phase**: add revision bigint NOT NULL DEFAULT 1 and create membership-checked save_app_state CAS RPC; leave legacy UPDATE privilege in place until compatible client is ready. Recheck RLS and function EXECUTE grants.
4. **Client cutover**: deploy revision-aware client only after staged smoke tests, and confirm two-device roundtrip with real authenticated accounts. Prevent stale cached old PWA versions from writing during migration.
5. **Enforcement phase**: only after client compatibility confirmed, revoke direct UPDATE on app_state for PUBLIC, anon, authenticated and restrict RPC EXECUTE to authenticated. Audit effective grants, not just explicit grants.
6. **Least-privilege hardening**: review and revoke unnecessary TRUNCATE, TRIGGER and REFERENCES on households, household_members and app_state from anon/authenticated; ensure required SELECT/INSERT/UPDATE privileges still support the intended functions. Review anonymous function EXECUTE and set_updated_at search_path independently.
7. **November reset**: after a second backup and explicit go-ahead, perform an atomic, revision-checked update of only app_state JSON keys tx, repayments, recurring, planned. Preserve cats, budgets, household and membership rows. Verify clean read on both devices and absence of automatic re-created entries.
8. **Postflight**: verify sync, conflicts, restore readiness, login/join flow, category and budget persistence, and security advisors.

## Abort/rollback rules

- Stop on missing backup, unexpected row count, conflicting revision, RLS regression, broken login, or client mismatch.
- Never run resetAll() or the test baseline migration against production.
- Do not simply restore old app_state over concurrent writes; stop clients and restore with an approved controlled revision/backup procedure.
- Rollback SQL and recovery path must be rehearsed in the isolated project before production changes.

## Test status

- GitHub offline browser workflow run 40793175968 succeeded.
- Fresh-start Node tests added; check the separate Validate Meow Budget workflow before calling them passed.
