-- STAGING DRAFT ONLY: do not apply to production without backup, isolated restore test, and explicit approval.
-- Additive CAS preparation: preserves legacy UPDATE permission for existing deployed clients.
-- This is NOT the final enforcement migration; do not apply together with 202610240001_add_app_state_revision.sql.
-- Review existing function ownership, grants, RLS, and auth behavior in an isolated Supabase project first.

-- Meow Budget: atomic optimistic concurrency for shared app_state.
-- Apply only after the reviewed baseline schema to an isolated test project.
-- This migration adds a revision counter and a compare-and-swap RPC.
-- It does not alter existing state JSON or rewrite existing rows.

ALTER TABLE public.app_state
  ADD COLUMN IF NOT EXISTS revision bigint NOT NULL DEFAULT 1;

CREATE OR REPLACE FUNCTION public.save_app_state(
  p_household_id uuid,
  p_expected_revision bigint,
  p_state jsonb
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  next_revision bigint;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED';
  END IF;

  IF p_expected_revision IS NULL OR p_expected_revision < 1 THEN
    RAISE EXCEPTION 'INVALID_EXPECTED_REVISION';
  END IF;

  IF p_state IS NULL THEN
    RAISE EXCEPTION 'INVALID_STATE';
  END IF;

  -- SECURITY DEFINER is required because direct UPDATE privileges are revoked
  -- from browser roles below. Membership is checked explicitly in this function.
  -- The revision predicate and UPDATE occur atomically in one statement.
  UPDATE public.app_state AS a
     SET state = p_state,
         updated_by = auth.uid(),
         updated_at = now(),
         revision = a.revision + 1
   WHERE a.household_id = p_household_id
     AND EXISTS (
           SELECT 1
             FROM public.household_members AS hm
            WHERE hm.household_id = a.household_id
              AND hm.user_id = auth.uid()
         )
     AND a.revision = p_expected_revision
  RETURNING a.revision INTO next_revision;

  IF next_revision IS NULL THEN
    RAISE EXCEPTION 'REVISION_CONFLICT';
  END IF;

  RETURN next_revision;
END;
$function$;


-- Explicitly restrict RPC execution to authenticated users; direct table UPDATE is unchanged in this stage.
REVOKE ALL ON FUNCTION public.save_app_state(uuid, bigint, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.save_app_state(uuid, bigint, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.save_app_state(uuid, bigint, jsonb) TO authenticated;

-- Post-migration checks (read-only):
-- SELECT column_name, data_type FROM information_schema.columns WHERE table_schema='public' AND table_name='app_state' AND column_name='revision';
-- SELECT household_id, revision FROM public.app_state;
-- Do not revoke legacy UPDATE until the compatible client has been deployed and verified.
