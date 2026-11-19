-- Isolated PostgreSQL 17 fixture for 0064_product_slices_rls.sql.
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;

CREATE SCHEMA auth;
CREATE OR REPLACE FUNCTION auth.uid()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;

CREATE TABLE public.products (
  id uuid PRIMARY KEY,
  confectioner_id uuid NOT NULL,
  status text NOT NULL,
  deleted_at timestamptz
);
CREATE TABLE public.user_roles (
  user_id uuid NOT NULL,
  role text NOT NULL,
  is_active boolean NOT NULL DEFAULT true
);
CREATE TABLE public.product_slices (
  id text PRIMARY KEY,
  "productId" text NOT NULL,
  "fillingName" text NOT NULL,
  image text,
  config jsonb,
  caption text,
  "sortOrder" integer NOT NULL DEFAULT 0,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
CREATE POLICY products_public_read ON public.products
  FOR SELECT TO anon, authenticated
  USING (status = 'published' OR deleted_at IS NOT NULL);

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT SELECT ON public.products, public.user_roles TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_slices TO anon, authenticated, service_role;

INSERT INTO public.products (id, confectioner_id, status, deleted_at) VALUES
  ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'published', NULL),
  ('10000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001', 'draft', NULL),
  ('10000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000002', 'published', NULL),
  ('10000000-0000-0000-0000-000000000004', '20000000-0000-0000-0000-000000000001', 'published', now());

INSERT INTO public.user_roles (user_id, role, is_active) VALUES
  ('20000000-0000-0000-0000-000000000003', 'ADMIN', true);

INSERT INTO public.product_slices (id, "productId", "fillingName") VALUES
  ('slice-public-owner', '10000000-0000-0000-0000-000000000001', 'Публичный торт владельца'),
  ('slice-draft-owner', '10000000-0000-0000-0000-000000000002', 'Черновик владельца'),
  ('slice-public-other', '10000000-0000-0000-0000-000000000003', 'Публичный торт другого'),
  ('slice-deleted', '10000000-0000-0000-0000-000000000004', 'Удалённый товар');
