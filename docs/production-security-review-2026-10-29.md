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
