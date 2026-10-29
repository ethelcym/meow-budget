# Production Supabase security review — 2026-10-29

Read-only advisor scan of production project `hennrsqbxvrwmdizdnzg`. No production schema, auth setting, or ledger data changed.

## Findings
- WARN: `public.set_updated_at` has mutable search_path. https://supabase.com/docs/guides/database/database-linter?lint=0011_function_search_path_mutable
- WARN: anonymous users can EXECUTE SECURITY DEFINER functions `create_household()`, `is_household_member(uuid)`, `join_household(text)`. Must inspect function bodies and role grants before restricting. https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable
- WARN: authenticated users can EXECUTE the same SECURITY DEFINER functions; some access is expected for household flows, but verify auth.uid() and membership checks. https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable
- WARN: Auth leaked-password protection disabled. https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection

## Limitations
- Attempted production catalog SELECT via SQL connector, but the call was blocked. RLS and table privileges remain unverified.
- Production revision schema and migration prerequisites remain unverified.
- These advisor WARN results are not proof of an exploitable vulnerability.
- Do not apply a baseline test-project schema to existing production.
- Do not modify grants/functions until verified against app sign-in, create/join household workflows.

## Next gates
1. Read-only inspect production function definitions, RLS, privileges via an approved path.
2. Prepare and test incremental production migration in an isolated staging environment.
3. Backup production ledger and establish rollback; ask for separate user approval before writes.

## Read-only schema inspection follow-up — 2026-10-29
- Production public tables: `households` (1 row), `household_members` (2 rows), `app_state` (1 row). Counts only; no ledger or invite codes retrieved.
- All three tables have RLS enabled.
- Production `app_state` columns are `household_id`, `state`, `updated_by`, `updated_at`; `revision` is absent. The revision-checked sync RPC migration is therefore a release prerequisite, subject to reviewed backup, grant audit and explicit approval.
- Supabase migration listing returned no entries; this does not establish that the existing schema is absent, and baseline migration must not be applied.
- Browser smoke CI run 40793175968 succeeded. New November transform unit tests were committed, but that browser workflow alone does not prove those unit tests ran.

## Read-only policy and grants audit — 2026-10-29
- All current SELECT and UPDATE policies for `app_state` are restricted to `authenticated` and check `is_household_member`; UPDATE has both USING and WITH CHECK. INSERT similarly checks membership. `households` and `household_members` SELECT policies check membership.
- Reviewed production `create_household`, `join_household` and `is_household_member` bodies. Both mutating RPCs check `auth.uid()` before writing; membership helper filters by `auth.uid()`. Advisor warnings about anonymous EXECUTE remain a hardening issue, not proof of anonymous data access.
- **Important security finding:** information_schema.role_table_grants reports `TRUNCATE`, `TRIGGER`, and `REFERENCES` granted to both `anon` and `authenticated` on all three public tables. `TRUNCATE` is not row-filtered by RLS. Revoke unnecessary privileges in a separately approved, tested migration; do not change production now. Confirm effective permissions and role inheritance before deployment.
- `authenticated` has direct UPDATE on `app_state` today, so the existing browser can bypass revision checks; revision RPC migration must revoke UPDATE, but deploy order must avoid breaking old clients.
- Migration file `202610240001_add_app_state_revision.sql` is additive to state JSON and checks membership + expected revision, but currently comments refer to test-only baseline. Review and create production-specific upgrade and rollback steps before approval.
