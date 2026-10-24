# Isolated Supabase test-project runbook

Status: preparation only. No Supabase project was created or changed, and no SQL was executed.

## Non-negotiable isolation rules

- Keep the existing production Project and its URL unchanged.
- Use a separate Supabase Project with a distinct Project Reference ID.
- Configure the development build with only the test Project URL and its publishable/anon key. Never put a service-role or secret key in browser code.
- Use fictional test accounts, a fictional household, and synthetic transactions only. Do not import the production household's app_state JSON, invite code, user records, or transaction data.
- Before executing any migration, compare the target Project Reference ID in the dashboard with the test Project ID recorded for the test run. If it does not match, stop.
- Keep PR #1 in Draft. Do not merge or deploy as part of test setup.

## Prepared migration order

The development branch now contains these two migrations:

1. `supabase/migrations/202610240000_initial_shared_household_schema.sql` — baseline schema and least-privilege policies for a fresh, empty test project.
2. `supabase/migrations/202610240001_add_app_state_revision.sql` — revision counter and atomic save RPC.

The baseline migration uses ordinary `CREATE TABLE` and `CREATE POLICY` statements intentionally: it is for a fresh, empty test project, not for re-running against production or an existing project. Do not execute it until the target Project Reference ID has been checked and the SQL reviewed. It creates tables/functions/policies only and does not copy any ledger data.

## Security decisions in the prepared baseline and revision migration

- The baseline defines `households`, `household_members`, and `app_state`, enables RLS, and limits browser table access to the operations required by the client.
- The baseline restricts household creation/joining to authenticated RPCs and revokes their execute privileges from `PUBLIC` and `anon`.
- The baseline gives authenticated users SELECT access to household/membership data and SELECT/INSERT access to app_state. It does not grant direct app_state UPDATE or DELETE.
- The revision migration adds `revision bigint NOT NULL DEFAULT 1`.
- `save_app_state(bigint, jsonb)` uses `SECURITY DEFINER` with a fixed `search_path = pg_catalog, public`, schema-qualified table references, explicit authentication and household-membership checks, and an atomic expected-revision predicate.
- The revision migration revokes direct `UPDATE` on `app_state` from browser roles, so REST UPDATE/UPSERT cannot bypass compare-and-swap. Normal state edits must use the RPC.
- Function execution is revoked from `PUBLIC` and `anon`, then granted to `authenticated`.

Because the save RPC uses `SECURITY DEFINER`, its implementation and function-owner privileges must be reviewed carefully. The static checks do not prove runtime authorization is correct.

## Read-only inspection

Before any writes, use `supabase/diagnostics/read_only_security_audit.sql` against the intended project. It contains SELECT-only catalog queries for table structure, RLS, grants, relevant function definitions, and Realtime publication. It does not read ledger rows or change database objects.

## Test sequence after project creation is explicitly approved

1. Record the test Project Reference ID and verify it is different from production.
2. Run the read-only audit and save the results privately for review.
3. On the empty test project only, apply the reviewed baseline migration, then the revision migration. Stop on any error; do not improvise a production rollback.
4. Confirm the revision column, RLS policies, function definition/search_path, function grants, and absence of direct authenticated UPDATE privilege on `app_state`.
5. Configure a separate development build to use the test Project URL and publishable/anon key. Verify the URL/Reference ID again before signing in.
6. Create only synthetic Auth users: household member A, household member B, and unrelated user C.
7. Verify A and B can read the household's state. Verify C cannot read/write the state, create arbitrary membership by direct table writes, or execute restricted RPCs anonymously.
8. Have A and B both read revision N. Save from A and confirm revision N+1. Attempt a save from B using stale revision N and confirm it fails with `REVISION_CONFLICT`; verify B's local edit remains available for backup.
9. Test Realtime updates with clean and dirty local state. The current client ignores Realtime updates whose `updated_by` equals the signed-in user's ID, so two devices using the same account may not display updates immediately. Treat this as unresolved until specifically tested and corrected if necessary.
10. Test first-time household/state initialization separately. The app's initial state bootstrap still uses an upsert path; simultaneous bootstrap attempts may race. Direct UPDATE is now revoked, so a racing upsert must not be allowed to bypass the revision RPC.
11. Run app regression tests for split attribution, repayments, recurring boundaries/idempotency, edit/delete, JSON backup/import, and legacy-state normalization.
12. Record actual results and failures. Do not merge/deploy until authorization, conflict handling, same-account device behavior, and regression tests pass.

## Safe stop and recovery rules

- If the test build displays the production Project Reference ID, stop immediately and do not sign in or submit any write.
- If a migration/test fails, stop on the test Project, preserve logs and local backup data, and diagnose before retrying.
- On a revision conflict, do not automatically reload over local changes. Export the local backup first and preserve both versions for explicit recovery.
- Do not attempt to roll back production because of a test-project failure.
- Any future production rollout requires separate explicit approval, a verified backup/restore plan, and a reviewed deployment/rollback sequence.

## What this runbook does not claim

This document is a preparation checklist, not evidence that a test Project exists, that either migration has run, that RLS is secure at runtime, or that live two-device synchronization has passed.
