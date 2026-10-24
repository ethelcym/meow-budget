# Revision-based shared sync rollout

Status: implementation and test-project migrations prepared on `feature/shared-settlement-v1`; **not applied to Supabase** and not production-verified.

## Why

The browser previously upserted the entire `app_state.state` document unconditionally. Two devices could therefore overwrite one another's updates. The development client now calls `save_app_state(p_expected_revision, p_state)`; the database atomically increments `revision` only when the stored revision equals the client's expected revision.

## Prepared migration order

1. `supabase/migrations/202610240000_initial_shared_household_schema.sql` — baseline schema for a fresh, empty isolated test project.
2. `supabase/migrations/202610240001_add_app_state_revision.sql` — revision counter and protected save RPC.

Do not run the baseline against production or an existing project. It uses CREATE statements and is intended only for a new test project after verifying the Project Reference ID.

## Concurrency and permissions

The revision migration:
- adds `app_state.revision bigint NOT NULL DEFAULT 1` if absent;
- defines `save_app_state(bigint, jsonb)` as `SECURITY DEFINER` with fixed `search_path = pg_catalog, public` and schema-qualified application table references;
- requires authentication and validates the expected revision and state payload;
- updates only a row belonging to a household where `auth.uid()` is a member and only when the stored revision equals the expected revision;
- increments and returns the revision, raising `REVISION_CONFLICT` if no row matches;
- revokes direct `UPDATE` on `app_state` from browser roles so REST writes cannot bypass the RPC's revision check;
- revokes function execution from `PUBLIC` and `anon`, granting it to `authenticated`.

Because the RPC is `SECURITY DEFINER`, its explicit membership predicate, fixed search path, function owner, and execute grants are important security boundaries. Static tests cannot prove live PostgreSQL authorization.

## Safe rollout order

1. Inspect schema and permissions using `supabase/diagnostics/read_only_security_audit.sql`. It contains catalog SELECT queries only and does not read ledger rows.
2. Create/identify a separate test Project only after explicit approval. Record its Project Reference ID and verify it differs from production.
3. Apply the reviewed baseline migration and then the revision migration to the test project only. Stop on any error.
4. Verify RLS, policies, grants, function definition/search_path, authenticated-only RPC execution, and absence of direct authenticated UPDATE privilege on `app_state`.
5. Configure a separate development build to use only the test Project URL and publishable/anon key. Double-check the Reference ID before signing in.
6. Use only synthetic test accounts A and B in one household plus unrelated account C. Confirm C cannot read/write the household state or add membership by direct table writes.
7. Have A and B both read revision N. Save from A and confirm N+1. Attempt a save from B using stale revision N and confirm `REVISION_CONFLICT`; verify B's local edit remains available for backup.
8. Test Realtime with clean and dirty local state. The current client ignores Realtime updates when `updated_by` matches the signed-in user, so same-account multi-device updates may not display immediately. Treat this as unresolved until tested and corrected if necessary.
9. Test first-time household/state initialization separately. The client's missing-state bootstrap still uses an upsert; simultaneous initialization can race, but direct UPDATE is revoked and must not be allowed to bypass revision checking.
10. Run regression tests for split attribution, repayments, recurring boundaries/idempotency, edit/delete, JSON backup/import, and legacy-state normalization.
11. Record results, including failures. Do not merge/deploy until authorization, conflict handling, same-account device behavior, and regression tests pass.

## Limitations and release blockers

- A revision conflict prevents silent stale writes but does not automatically merge two JSON documents. Export local state before any reload/recovery operation.
- The migration does not change household membership or invite-code behavior beyond the baseline project setup.
- Realtime is a notification mechanism, not the concurrency guarantee. The revision-checked RPC is the concurrency guarantee for normal saves.
- Neither migration has been applied to Supabase. No live database migration or production deployment was performed.
- Actual RLS policies, grants, RPC behavior, Realtime access, and backup restoration have not been runtime-tested in an isolated project.
- Same-account multi-device Realtime behavior and first-time bootstrap race still need explicit verification.
- Production rollout requires separate explicit approval, a verified backup/restore plan, and a reviewed deployment/rollback sequence.
