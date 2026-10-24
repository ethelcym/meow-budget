# Isolated Supabase test-project runbook

Status: preparation only. No Supabase project was created or changed, and no SQL was executed.

## Non-negotiable isolation rules

- Keep the existing production Project and its URL unchanged.
- Create a separate Supabase Project for testing, with a distinct Project Reference ID.
- Configure the development build with only the test Project URL and its publishable/anon key. Never put a service-role or secret key in browser code.
- Use fictional test accounts, a fictional household, and synthetic transactions only. Do not import the production household's app_state JSON, invite code, user records, or transaction data.
- Before any SQL execution, compare the target Project Reference ID in the dashboard against the test Project ID recorded for the test run. If it does not match, stop.
- Keep the pull request in Draft and do not merge or deploy as part of test setup.

## Important prerequisite: the repository does not contain a complete baseline schema

The current repository review did not find a complete, versioned baseline migration for `households`, `household_members`, `app_state`, their RLS policies, or the `create_household` / `join_household` functions. The revision migration is an incremental migration; it assumes `public.app_state` already exists with at least `household_id`, `state`, `updated_by`, and `updated_at`, as well as the expected membership tables and policies.

Therefore, do **not** run `202610240001_add_app_state_revision.sql` against a fresh empty Project until a reviewed baseline schema and least-privilege policies have been prepared and validated. Do not blindly copy production data or execute an unreviewed full production schema dump. First inspect the current schema/policies read-only, then create a minimal reviewed baseline using synthetic data and test-specific Auth users.

## Review of the revision migration

The current migration:

- Adds `app_state.revision bigint NOT NULL DEFAULT 1` if the column is absent.
- Creates/replaces `save_app_state(bigint, jsonb)` using `SECURITY INVOKER` and `SET search_path = public`.
- Requires an authenticated user and a positive expected revision, and rejects a null state.
- Updates only an `app_state` row whose household has a membership for `auth.uid()` and whose current revision equals the expected revision.
- Increments revision atomically, returns the new revision, and raises `REVISION_CONFLICT` when no row matches.
- Revokes function execution from `PUBLIC` and `anon`, then grants execution to `authenticated`.

Static review limitations:

- This SQL does not create the baseline tables or their RLS policies.
- It depends on the existing `app_state` UPDATE policy and membership policy being correct; neither is proven by this migration alone.
- A SQL function can compile while runtime authorization or application assumptions are still wrong.
- The migration's idempotent column addition does not make the entire rollout automatically reversible. Do not treat dropping the function/column as a casual rollback step.

## Test sequence after the isolated Project and baseline are reviewed

1. Record the test Project Reference ID and verify it is not the production ID.
2. Create only synthetic Auth users and one test household. Use separate accounts for household member A, member B, and an unrelated user C.
3. Apply the reviewed baseline schema and policies to the test Project; verify RLS is enabled and least-privilege grants are in place.
4. Apply the revision migration to the test Project only. Confirm the revision column and function signature/grants using read-only catalog queries.
5. Configure a separate development build to point to the test Project. Double-check the URL and Reference ID before signing in.
6. Verify A and B can access only their household's state. Verify C cannot read or write that state and cannot add themselves to that household by direct table writes.
7. Have A and B both read revision N. Save from A and confirm revision N+1. Attempt a save from B using stale revision N and confirm it fails with `REVISION_CONFLICT`; confirm B's local edit remains available for backup.
8. Test remote Realtime updates with local state both clean and dirty. A notification is not the concurrency guarantee; the revision-checked RPC is. Note: the current client filters out Realtime events whose `updated_by` equals the signed-in user's ID. Two devices signed in as the same account may therefore not display each other's updates immediately; revision compare-and-swap should still reject stale writes, but this same-account scenario must be explicitly tested and documented before claiming full multi-device behavior.
9. Test first-time household/state initialization separately. Do not run simultaneous first-time bootstrap requests before the state row exists.
10. Run the app regression tests for split attribution, repayments, recurring transaction boundaries/idempotency, edit/delete, JSON backup/import, and legacy-state normalization.
11. Record actual results, including failures. Do not merge or deploy until database authorization, conflict handling, and regression tests all pass.

## Safe stop and recovery rules

- If the test build displays the production Project Reference ID, stop immediately and do not sign in or submit any write.
- If a migration/test fails, stop on the test Project, preserve logs and local backup data, and diagnose before retrying.
- On a revision conflict, do not automatically reload over local changes. Export the local backup first and preserve both versions for explicit recovery.
- Do not attempt to roll back production because of a test-project failure; the test Project is isolated and can be investigated separately.
- Any future production rollout requires a separate explicit approval, a verified backup/restore plan, a reviewed migration, and a tested deployment/rollback sequence.

## What this runbook does not claim

This document is a preparation checklist, not evidence that the test Project exists, that RLS is secure, that the migration has run, or that live two-device synchronization has passed.
