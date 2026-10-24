# Revision-based shared sync rollout

Status: implementation prepared on `feature/shared-settlement-v1`; **not applied to Supabase** and not production-verified.

## Why

The browser previously upserted the entire `app_state.state` document unconditionally. Two devices could therefore overwrite one another's updates. The development client now calls `save_app_state(p_expected_revision, p_state)`; the database atomically increments `revision` only when the stored revision equals the client's expected revision.

## Migration

Apply `supabase/migrations/202610240001_add_app_state_revision.sql` only to the intended, isolated test project after its baseline schema/policies have been reviewed and the target Project Reference ID has been verified. Do not apply this migration alone to an empty project.

The migration:
- adds `app_state.revision bigint NOT NULL DEFAULT 1` if absent;
- creates an invoker-rights RPC that checks authentication and updates only a row at the expected revision belonging to a household where the caller is a member;
- increments and returns the revision on success;
- revokes function execution from `PUBLIC` and `anon`, granting it to `authenticated`.

The existing UPDATE RLS policy still applies. The RPC intentionally uses `SECURITY INVOKER`, not `SECURITY DEFINER`.

## Safe rollout order

1. Inspect the existing schema and permissions using `supabase/diagnostics/read_only_security_audit.sql`. It contains catalog SELECT queries only and does not read ledger rows.
2. Record and verify the isolated test Project Reference ID. Confirm it differs from the production Project ID.
3. Prepare and review the complete baseline schema and least-privilege RLS policies for the test project. The repository currently contains an incremental revision migration, not a complete empty-project bootstrap migration.
4. Use only fictional Auth accounts, one fictional household, and synthetic transaction data. Do not copy production ledger JSON, invite codes, or user data into the test project.
5. Apply the reviewed baseline and then the revision migration to the test project only. Confirm the revision column and function signature/grants using read-only catalog queries.
6. Configure a separate development build to use only the test Project URL and publishable/anon key. If its Project Reference ID matches production, stop and do not sign in or write.
7. Verify two test household members can access the intended household, while an unrelated third account cannot read or write its state or add itself by direct table writes.
8. Have accounts A and B both read revision N. Save from A and confirm revision N+1. Attempt a save from B using stale revision N and confirm it fails with `REVISION_CONFLICT`; verify B's local edit remains available for backup.
9. Test Realtime updates with clean and dirty local state. Also test two devices signed into the *same account*: the current client ignores Realtime updates when `updated_by` matches the signed-in user, so updates from the same account may not display immediately. Do not claim this scenario is fixed until the behavior is tested and, if needed, corrected.
10. Test first-time household/state initialization separately. The initial missing-state bootstrap still uses an upsert and is distinct from normal revision-checked saves; do not initialize the same empty state concurrently from multiple devices.
11. Run regression tests for split attribution, repayments, recurring transaction boundaries/idempotency, edit/delete, JSON backup/import, and legacy-state normalization.
12. Record results, including failures. Do not merge or deploy until authorization, conflict handling, same-account device behavior, and regression tests pass.

## Limitations / recovery

- A revision conflict prevents silent stale writes but does not automatically merge two JSON documents. The conflicted device must export its local backup before any reload/recovery operation.
- The migration does not change household membership policies, invite-code behavior, or existing state payloads.
- Realtime is a notification mechanism, not the concurrency guarantee. The revision-checked RPC is the concurrency guarantee for normal saves.
- The incremental migration has not been applied to Supabase. No live database migration or production deployment was performed.
- Do not treat dropping the revision column/function as a casual rollback. Any rollback must be separately reviewed and must preserve existing ledger data.

## Release blockers

- No complete, reviewed baseline schema/policy migration exists in this repository for provisioning an empty test project.
- Actual RLS policies, grants, RPC behavior, Realtime access, and backup restoration have not been runtime-tested in an isolated project.
- Same-account multi-device Realtime behavior and first-time state bootstrap race need explicit verification.
- Production rollout requires a separate explicit approval, a verified backup/restore plan, and a reviewed deployment/rollback sequence.
