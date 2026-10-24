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

-- Remove direct table-update access so clients cannot bypass the revision check
-- by calling PostgREST UPDATE/UPSERT directly. Bootstrap inserts remain permitted
-- under the INSERT policy; regular edits must use save_app_state.
REVOKE UPDATE ON TABLE public.app_state FROM PUBLIC;
REVOKE UPDATE ON TABLE public.app_state FROM anon;
REVOKE UPDATE ON TABLE public.app_state FROM authenticated;

REVOKE ALL ON FUNCTION public.save_app_state(uuid, bigint, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.save_app_state(bigint, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.save_app_state(bigint, jsonb) TO authenticated;
