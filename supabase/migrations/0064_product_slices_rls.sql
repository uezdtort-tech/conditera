-- 0064_product_slices_rls.sql
-- product_slices is created by the legacy schema sync migration 0017 without
-- RLS. This migration closes direct PostgREST access and aligns ownership with
-- products.confectioner_id -> auth.users(id) (see 0002 and 0027).

BEGIN;

CREATE OR REPLACE FUNCTION public.can_manage_product_slices(p_product_id text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, auth
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.products p
    WHERE p.id::text = p_product_id
      AND p.deleted_at IS NULL
      AND (
        p.confectioner_id = auth.uid()
        OR EXISTS (
          SELECT 1
          FROM public.user_roles ur
          WHERE ur.user_id = auth.uid()
            AND ur.role IN ('ADMIN', 'SUPER_ADMIN')
            AND ur.is_active = true
        )
      )
  );
$function$;

CREATE OR REPLACE FUNCTION public.can_read_product_slices(p_product_id text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, auth
AS $function$
  SELECT
    EXISTS (
      SELECT 1
      FROM public.products p
      WHERE p.id::text = p_product_id
        AND p.status = 'published'
        AND p.deleted_at IS NULL
    )
    OR public.can_manage_product_slices(p_product_id);
$function$;

REVOKE ALL ON FUNCTION public.can_manage_product_slices(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_read_product_slices(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_manage_product_slices(text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_read_product_slices(text) TO anon, authenticated, service_role;

ALTER TABLE public.product_slices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_slices FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS product_slices_select_visible ON public.product_slices;
DROP POLICY IF EXISTS product_slices_insert_owner ON public.product_slices;
DROP POLICY IF EXISTS product_slices_update_owner ON public.product_slices;
DROP POLICY IF EXISTS product_slices_delete_owner ON public.product_slices;

CREATE POLICY product_slices_select_visible
  ON public.product_slices
  FOR SELECT
  TO anon, authenticated
  USING (public.can_read_product_slices("productId"));

CREATE POLICY product_slices_insert_owner
  ON public.product_slices
  FOR INSERT
  TO authenticated
  WITH CHECK (public.can_manage_product_slices("productId"));

CREATE POLICY product_slices_update_owner
  ON public.product_slices
  FOR UPDATE
  TO authenticated
  USING (public.can_manage_product_slices("productId"))
  WITH CHECK (public.can_manage_product_slices("productId"));

CREATE POLICY product_slices_delete_owner
  ON public.product_slices
  FOR DELETE
  TO authenticated
  USING (public.can_manage_product_slices("productId"));

GRANT SELECT ON public.product_slices TO anon, authenticated, service_role;
GRANT INSERT, UPDATE, DELETE ON public.product_slices TO authenticated, service_role;

CREATE INDEX IF NOT EXISTS idx_product_slices_product_sort_created
  ON public.product_slices ("productId", "sortOrder", "createdAt");

COMMENT ON TABLE public.product_slices IS
  'Product cake cross-sections. RLS exposes only published products publicly; owners/admins manage private drafts.';

COMMIT;

-- Owner checks intentionally use auth.users identity, not confectioners.id.
