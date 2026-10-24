# Supabase sync and security review (static review)

Status: **review started; production safety is not yet verified**. This document records only what can be confirmed from the application code and repository. No live database schema, RLS policies, functions, or data were changed.

## Confirmed from application code

- The browser uses the Supabase project URL and a publishable client key. No `service_role` key is present in the inspected `index.html`.
- The client reads/writes `public.app_state` and expects columns `household_id`, `state`, and `updated_by`.
- The client reads `household_members.household_id` filtered by `user_id`.
- Household creation/joining calls RPCs `create_household()` and `join_household(p_invite_code)`.
- Realtime subscription listens for `UPDATE` events on `app_state` filtered by household ID.
- Local unsynced edits trigger a client-side conflict warning when a remote update is observed.
- Cloud writes upsert the whole `state` JSON blob. This is last-write-wins without a server-side version check; the client-side guard cannot prevent simultaneous writes racing before a realtime event arrives.
- No schema/migration or RLS SQL file for these tables/RPCs was found in the inspected repository paths. The live Supabase dashboard/policies are not accessible from this repository review.

## Must be verified in Supabase before real shared use

1. RLS is enabled on `households`, `household_members`, and `app_state`.
2. A signed-in user can read household data only for households where they are a member.
3. Insert/update/delete of `app_state` is restricted to members of the exact `household_id`; a client-supplied household ID alone is not sufficient authorization.
4. `household_members` policies prevent users from adding themselves to arbitrary households or changing another member's `user_id`/role.
5. `create_household` and `join_household` are reviewed for SECURITY DEFINER use, fixed `search_path`, authenticated-only execution grants, invite-code entropy/expiry/rate limiting, and membership checks. The join function must not leak household IDs or membership information to unauthorized users.
6. Realtime publication and SELECT policies do not expose another household's `app_state`.
7. Only the publishable/anon key is shipped to the browser; no secret/service-role key is ever placed in client code.

## Required sync correctness change before production

Move from unconditional whole-blob upserts to server-enforced optimistic concurrency (for example, a version/revision column and an RPC that updates only when the expected revision matches), or a similarly atomic server-side strategy. On conflict, retain both versions and require an explicit merge/recovery path. Do not rely on realtime notifications alone to prevent lost updates.

## Safe verification method

Use Supabase SQL Editor with a read-only inspection first. Record the actual table definitions, RLS status, policies, grants, RPC definitions and function settings. Then test with two separate authenticated household users and a third unrelated user. Do not disable RLS or use a service-role key in the browser. Do not apply schema changes until the existing schema and policies have been reviewed and backed up.
