-- Migration: roles foundation (sub-project #1)
-- Adds:
--   1. public.is_chef()         — JWT helper for sub-project #2
--   2. public.list_app_users()  — SECURITY DEFINER browser-callable users list
--
-- Idempotent: safe to re-apply. Folded into schema.sql §8.

-- ── 1. is_chef() ──────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.is_chef() RETURNS boolean AS $$
  SELECT coalesce((auth.jwt() -> 'app_metadata' ->> 'role') = 'chef', false);
$$ LANGUAGE sql STABLE;

COMMENT ON FUNCTION public.is_chef() IS
  'Returns true when the calling JWT has app_metadata.role = "chef". Used by chef-ownership RLS policies (sub-project #2).';

-- ── 2. list_app_users() ──────────────────────────────────────────────────
-- SECURITY DEFINER lets the function read auth.users; the body asserts
-- is_admin() so callers must hold an admin JWT. Returns role normalised
-- (null/absent → 'user'), supports filter + email search + pagination.
CREATE OR REPLACE FUNCTION public.list_app_users(
  p_role     text DEFAULT 'all',
  p_q        text DEFAULT NULL,
  p_page     int  DEFAULT 1,
  p_per_page int  DEFAULT 50
) RETURNS TABLE (
  id              uuid,
  email           text,
  full_name       text,
  role            text,
  created_at      timestamptz,
  last_sign_in_at timestamptz,
  provider        text,
  total_count     bigint
) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_offset int;
  v_per    int := least(greatest(p_per_page, 1), 200);
  v_role   text := lower(coalesce(p_role, 'all'));
  v_q      text := nullif(trim(coalesce(p_q, '')), '');
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  v_offset := greatest(p_page - 1, 0) * v_per;

  RETURN QUERY
  WITH base AS (
    SELECT
      u.id,
      u.email::text                                                              AS email,
      coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_user_meta_data ->> 'name') AS full_name,
      coalesce(u.raw_app_meta_data  ->> 'role',     'user')                      AS role,
      u.created_at,
      u.last_sign_in_at,
      coalesce(u.raw_app_meta_data  ->> 'provider', 'email')                     AS provider
    FROM auth.users u
    WHERE
      (v_role = 'all' OR coalesce(u.raw_app_meta_data ->> 'role', 'user') = v_role)
      AND (v_q IS NULL OR u.email ILIKE '%' || v_q || '%')
  ),
  counted AS (SELECT count(*)::bigint AS n FROM base)
  SELECT b.id, b.email, b.full_name, b.role, b.created_at, b.last_sign_in_at, b.provider, c.n
  FROM base b CROSS JOIN counted c
  ORDER BY b.created_at DESC
  LIMIT v_per OFFSET v_offset;
END $$;

REVOKE ALL ON FUNCTION public.list_app_users(text, text, int, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_app_users(text, text, int, int) TO authenticated;

COMMENT ON FUNCTION public.list_app_users(text, text, int, int) IS
  'Admin-only browser-callable. Returns auth.users with role normalised. SECURITY DEFINER; body asserts is_admin().';
