-- Meow Budget: read-only Supabase schema/security inventory.
-- This file contains SELECT statements only. It does not create, alter, or delete objects.
-- Run against the intended Supabase project in SQL Editor, then review all results.
-- Never paste user transaction data or secrets into a public issue/chat.

-- 1) Check whether expected tables exist, and whether RLS is enabled/forced.
SELECT
  n.nspname AS schema_name,
  c.relname AS table_name,
  c.relrowsecurity AS rls_enabled,
  c.relforcerowsecurity AS rls_forced
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind IN ('r', 'p')
  AND c.relname IN ('households', 'household_members', 'app_state')
ORDER BY c.relname;

-- 2) Inspect columns and defaults without reading application rows.
SELECT
  table_name,
  ordinal_position,
  column_name,
  data_type,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('households', 'household_members', 'app_state')
ORDER BY table_name, ordinal_position;

-- 3) Inspect constraints (primary keys, foreign keys, unique/check constraints).
SELECT
  tc.table_name,
  tc.constraint_name,
  tc.constraint_type,
  kcu.column_name,
  ccu.table_name AS referenced_table,
  ccu.column_name AS referenced_column,
  cc.check_clause
FROM information_schema.table_constraints tc
LEFT JOIN information_schema.key_column_usage kcu
  ON tc.constraint_schema = kcu.constraint_schema
 AND tc.constraint_name = kcu.constraint_name
 AND tc.table_name = kcu.table_name
LEFT JOIN information_schema.constraint_column_usage ccu
  ON tc.constraint_schema = ccu.constraint_schema
 AND tc.constraint_name = ccu.constraint_name
LEFT JOIN information_schema.check_constraints cc
  ON tc.constraint_schema = cc.constraint_schema
 AND tc.constraint_name = cc.constraint_name
WHERE tc.constraint_schema = 'public'
  AND tc.table_name IN ('households', 'household_members', 'app_state')
ORDER BY tc.table_name, tc.constraint_type, tc.constraint_name;

-- 4) Inspect RLS policies and their USING / WITH CHECK expressions.
SELECT
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual AS using_expression,
  with_check AS with_check_expression
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('households', 'household_members', 'app_state')
ORDER BY tablename, policyname;

-- 5) Inspect table-level privileges granted to application roles.
SELECT
  table_schema,
  table_name,
  grantee,
  privilege_type,
  is_grantable
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND table_name IN ('households', 'household_members', 'app_state')
  AND grantee IN ('anon', 'authenticated', 'PUBLIC', 'postgres', 'service_role')
ORDER BY table_name, grantee, privilege_type;

-- 6) Inspect relevant functions, security mode, search_path, and execute grants.
-- Function definitions are included for review; do not share them publicly if they
-- contain project-specific secrets or sensitive implementation details.
SELECT
  n.nspname AS schema_name,
  p.proname AS function_name,
  pg_get_function_identity_arguments(p.oid) AS identity_arguments,
  pg_get_userbyid(p.proowner) AS owner_name,
  p.prosecdef AS security_definer,
  p.proconfig AS function_settings,
  pg_get_function_result(p.oid) AS return_type,
  pg_get_functiondef(p.oid) AS function_definition,
  has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_can_execute,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_can_execute,
  EXISTS (
    SELECT 1
    FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) AS acl
    WHERE acl.grantee = 0
      AND acl.privilege_type = 'EXECUTE'
  ) AS public_can_execute
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('create_household', 'join_household', 'is_household_member', 'save_app_state')
ORDER BY p.proname, identity_arguments;

-- 7) Check whether app_state is part of a Realtime publication.
SELECT
  pub.pubname AS publication_name,
  schemaname,
  tablename
FROM pg_publication_tables pt
JOIN pg_publication pub ON pub.pubname = pt.pubname
WHERE schemaname = 'public'
  AND tablename = 'app_state'
ORDER BY pub.pubname;

-- 8) Show relevant schema migration tracking tables, if present.
-- This is only a presence check; it does not modify migration history.
SELECT
  to_regclass('supabase_migrations.schema_migrations') AS supabase_schema_migrations_table,
  to_regclass('public.schema_migrations') AS public_schema_migrations_table;

-- Do not query actual app_state.state values here: it contains the user's ledger data.
