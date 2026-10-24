-- Meow Budget baseline schema for an ISOLATED test project.
-- This migration is intended for a fresh, empty Supabase project only.
-- Do not run against production or an existing project without a separate schema diff/review.
-- It creates schema objects only; it does not import or read any ledger data.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE public.households (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invite_code text NOT NULL UNIQUE DEFAULT upper(encode(gen_random_bytes(8), 'hex')),
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.household_members (
  household_id uuid NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'member')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (household_id, user_id),
  UNIQUE (user_id)
);

CREATE TABLE public.app_state (
  household_id uuid PRIMARY KEY REFERENCES public.households(id) ON DELETE CASCADE,
  state jsonb NOT NULL,
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- This helper intentionally uses SECURITY DEFINER to read membership from RLS.
-- Its search_path is fixed and every application table reference is schema-qualified.
CREATE FUNCTION public.is_household_member(p_household_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.household_members AS hm
    WHERE hm.household_id = p_household_id
      AND hm.user_id = auth.uid()
  );
$function$;

CREATE FUNCTION public.create_household()
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  new_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED';
  END IF;

  -- Serialize household creation for a user through the UNIQUE(user_id) constraint
  -- on household_members; the explicit check gives the normal friendly error.
  IF EXISTS (
    SELECT 1 FROM public.household_members AS hm
    WHERE hm.user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'ALREADY_IN_HOUSEHOLD';
  END IF;

  INSERT INTO public.households (created_by)
  VALUES (auth.uid())
  RETURNING id INTO new_id;

  INSERT INTO public.household_members (household_id, user_id, role)
  VALUES (new_id, auth.uid(), 'owner');

  RETURN new_id;
END;
$function$;

CREATE FUNCTION public.join_household(p_invite_code text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  target_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.household_members AS hm
    WHERE hm.user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'ALREADY_IN_HOUSEHOLD';
  END IF;

  SELECT h.id
    INTO target_id
    FROM public.households AS h
   WHERE h.invite_code = upper(trim(p_invite_code));

  IF target_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_INVITE_CODE';
  END IF;

  INSERT INTO public.household_members (household_id, user_id, role)
  VALUES (target_id, auth.uid(), 'member');

  RETURN target_id;
END;
$function$;

CREATE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$;

ALTER TABLE public.households ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.household_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY "members can read their household"
ON public.households
FOR SELECT TO authenticated
USING (public.is_household_member(id));

CREATE POLICY "members can read membership"
ON public.household_members
FOR SELECT TO authenticated
USING (public.is_household_member(household_id));

CREATE POLICY "members can read app state"
ON public.app_state
FOR SELECT TO authenticated
USING (public.is_household_member(household_id));

CREATE POLICY "members can insert app state"
ON public.app_state
FOR INSERT TO authenticated
WITH CHECK (public.is_household_member(household_id));

-- No direct UPDATE or DELETE policy is created for the application role.
-- Normal state changes must go through the revision-checked RPC migration.

CREATE TRIGGER app_state_updated_at
BEFORE UPDATE ON public.app_state
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

REVOKE ALL ON TABLE public.households, public.household_members, public.app_state FROM PUBLIC;
REVOKE ALL ON TABLE public.households, public.household_members, public.app_state FROM anon;
REVOKE ALL ON TABLE public.households, public.household_members, public.app_state FROM authenticated;
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT SELECT ON public.households, public.household_members TO authenticated;
GRANT SELECT, INSERT ON public.app_state TO authenticated;

REVOKE ALL ON FUNCTION public.create_household() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_household() FROM anon;
GRANT EXECUTE ON FUNCTION public.create_household() TO authenticated;

REVOKE ALL ON FUNCTION public.join_household(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.join_household(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.join_household(text) TO authenticated;

REVOKE ALL ON FUNCTION public.is_household_member(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_household_member(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.is_household_member(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.set_updated_at() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_updated_at() FROM anon;

-- After applying, enable app_state in the supabase_realtime publication through
-- the Dashboard if it is not already published. Publication changes are not done here.
