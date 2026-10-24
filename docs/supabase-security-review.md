# Supabase sync and security review

Status: **repository review updated; production database and authorization behavior remain unverified**. No live database schema, policies, functions, or data were changed during this review.

## Confirmed from current development code

- The browser uses the Supabase project URL and a publishable client key. The reviewed `index.html` does not contain a service-role key.
- The client reads `public.app_state` and expects `household_id`, `state`, `updated_by`, `updated_at`, and now `revision`.
- The client reads `household_members.household_id` filtered by the signed-in `user_id`.
- Household creation/joining calls `create_household()` and `join_household(p_invite_code)`.
- The development client uses `save_app_state(p_expected_revision, p_state)` for normal saves rather than an unconditional whole-state upsert. The migration performs an atomic revision compare-and-swap and increments the revision only when the expected revision matches.
- On a revision conflict, the client retains its local state, displays a warning, and pauses automatic sync. It does not automatically merge the two versions.
- The client Realtime callback currently ignores updates whose `updated_by` matches the signed-in user. This can suppress updates from another device signed into the same account. This same-account multi-device behavior remains a known test item; do not claim instant cross-device sync is fully verified.
- Household creation/joining and first-time missing-state bootstrap still use an upsert path to initialize `app_state`. That bootstrap is separate from revision-checked normal saves and can race if multiple devices initialize an absent state row at the same time.
- The repository now includes a baseline schema migration (`202610240000_initial_shared_household_schema.sql`) followed by the incremental revision migration (`202610240001_add_app_state_revision.sql`). The baseline is intended only for a fresh, empty isolated test project and must not be run against production or an existing project without a separate schema diff/review.

## Migration review: `202610240001_add_app_state_revision.sql`

The migration:
- adds `revision bigint NOT NULL DEFAULT 1` if the column is absent;
- defines `save_app_state(bigint, jsonb)` with `SECURITY DEFINER` and a fixed `search_path = pg_catalog, public`;
- rejects unauthenticated calls, invalid expected revisions, and null state;
- updates only a row belonging to a household in which `auth.uid()` is a member and only when its current revision equals the expected revision;
- increments and returns the revision, raising `REVISION_CONFLICT` when no row matches;
- revokes execution from `PUBLIC` and `anon`, then grants it to `authenticated`;
- revokes direct `UPDATE` on `app_state` from browser roles so REST updates/upserts cannot bypass the revision check. The definer-rights RPC explicitly checks authentication, household membership, and the expected revision.

This is a static code review, not proof that PostgreSQL runtime behavior, existing grants, RLS policies, or the full app flow are secure. The RPC uses `SECURITY DEFINER` because direct table updates are revoked. This increases the importance of its explicit membership predicate, fixed search path, schema-qualified table references, and restricted execute grants. The migration depends on the baseline table structure.

## Must be verified in Supabase before production release

1. RLS is enabled on `households`, `household_members`, and `app_state`; record whether RLS is forced and whether table grants are appropriately restricted.
2. A signed-in user can read only households and app state where they are a member.
3. Inserts/updates to `app_state` are restricted to members of the exact household; a client-supplied household ID alone is not authorization.
4. `household_members` policies and table grants prevent users from adding themselves to arbitrary households or changing another member's `user_id`/role.
5. `create_household`, `join_household`, and `is_household_member` are checked for function owner, SECURITY DEFINER/INVOKER mode, fixed `search_path`, execute grants, membership checks, and invite-code protections.
6. Realtime publication and SELECT policies do not expose another household's state.
7. The revision migration is applied only to the intended test project first, then validated using two test household accounts and one unrelated account.
8. The same-account/two-device Realtime case is tested, alongside stale-revision conflicts and local backup/recovery.
9. Restore from a backup is tested before a production migration is considered.

## Safe verification method

Use the read-only catalog inspection script at `supabase/diagnostics/read_only_security_audit.sql` in the Supabase SQL Editor. It contains SELECT-only catalog queries; inspect the results before planning any write operation. Verify the target Project Reference ID independently in the dashboard. Do not disable RLS or use a service-role key in browser code.

## Release blockers

- The revision migration has **not** been applied to Supabase and the development client has not been validated against a dedicated test project.
- The baseline schema migration is prepared for isolated testing but has not been executed or runtime-reviewed against a live test project.
- Actual RLS policies, grants, RPC behavior, Realtime access, and backup restoration have not been runtime-tested.
- Same-account multi-device Realtime behavior and the first-time state-bootstrap race still need explicit verification.

Do not merge or deploy until these blockers are resolved and the user explicitly approves the release step.
