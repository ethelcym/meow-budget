-- Meow Budget: atomic optimistic concurrency for shared app_state.
-- Apply manually to the intended Supabase project after reviewing/backing up.
-- This migration adds a revision counter and a compare-and-swap RPC.
-- It does not alter existing state JSON or rewrite existing rows.

ALTER TABLE public.app_state
  ADD COLUMN IF NOT EXISTS revision bigint NOT NULL DEFAULT 1;

CREATE OR REPLACE FUNCTION public.save_app_state(
  p_expected_revision bigint,
  p_state jsonb
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
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

  UPDATE public.app_state
     SET state = p_state,
         updated_by = auth.uid(),
         updated_at = now(),
         revision = revision + 1
   WHERE household_id IN (
           SELECT hm.household_id
             FROM public.household_members hm
            WHERE hm.user_id = auth.uid()
         )
     AND revision = p_expected_revision
  RETURNING revision INTO next_revision;

  IF next_revision IS NULL THEN
    RAISE EXCEPTION 'REVISION_CONFLICT';
  END IF;

  RETURN next_revision;
END;
$function$;

REVOKE ALL ON FUNCTION public.save_app_state(bigint, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.save_app_state(bigint, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.save_app_state(bigint, jsonb) TO authenticated;
