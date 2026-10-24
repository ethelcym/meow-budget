# Revision-based shared sync rollout

Status: implementation prepared on `feature/shared-settlement-v1`; **not applied to Supabase** and not production-verified.

## Why

The browser previously upserted the entire `app_state.state` JSON document unconditionally. Two devices could therefore overwrite one another's updates. The new client calls `save_app_state(expected_revision, state)`; the database atomically increments `revision` only when the stored revision equals the client's expected revision.

## Migration

Apply `supabase/migrations/202610240001_add_app_state_revision.sql` to the intended Supabase project only after reviewing and backing up the project. It:
- adds `app_state.revision bigint NOT NULL DEFAULT 1` without rewriting existing JSON state;
- creates an invoker-rights RPC that checks authentication and atomically updates only a row at the expected revision;
- revokes function execution from PUBLIC and `anon`, granting it to `authenticated`.

The existing UPDATE RLS policy still applies. The RPC intentionally uses `SECURITY INVOKER`, not `SECURITY DEFINER`.

## Important rollout order

1. Back up the Supabase project/schema and confirm the target project.
2. Apply the migration in Supabase SQL Editor.
3. Verify the `revision` column exists and `save_app_state(bigint,jsonb)` is executable by authenticated users but not anon.
4. Only then test the new development build. The new frontend selects `revision` and calls the RPC; using it before the migration is applied will fail safely and leave local edits in the browser.
5. Test with two separate authenticated accounts in the same household and one unrelated account. Confirm the unrelated account cannot read or write the state.
6. Test two devices that both read revision N: the first save should return N+1; the second stale save should fail with `REVISION_CONFLICT`, leaving its local state intact and pausing automatic sync.
7. Verify realtime remote updates advance the local revision, and verify backups/recurring transactions/splits/repayments still work.
8. Do not merge/deploy until the tests above pass.

## Limitations / follow-up

- A revision conflict prevents silent overwrite, but this first version does not automatically merge two JSON documents. The conflicted device must export its local backup before reloading/merging.
- The migration does not change household membership policies, invite code behavior, or existing rows' state payloads.
- The client currently initializes an absent `app_state` row via upsert during household creation/join. This initial bootstrap is distinct from subsequent revision-checked saves; do not run first-time bootstrap concurrently on two devices before an initial state row exists.
- The browser Realtime callback is a notification mechanism, not the concurrency guarantee. The RPC revision compare-and-swap is the concurrency guarantee.
- No live Supabase migration or production deployment was performed as part of this change.
