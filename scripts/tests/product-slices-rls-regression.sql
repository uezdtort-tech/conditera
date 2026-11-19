-- Run after 0064_product_slices_rls.sql. Any mismatch aborts the CI job.
BEGIN;
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claim.sub', '', true);
DO $test$
BEGIN
  IF (SELECT count(*) FROM public.product_slices) <> 2 THEN
    RAISE EXCEPTION 'anon must see only the two published, non-deleted slices';
  END IF;
END
$test$;
COMMIT;

BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '20000000-0000-0000-0000-000000000001', true);
DO $test$
BEGIN
  IF (SELECT count(*) FROM public.product_slices) <> 3 THEN
    RAISE EXCEPTION 'owner must see public slices and own draft slice only';
  END IF;
END
$test$;
INSERT INTO public.product_slices (id, "productId", "fillingName")
VALUES ('slice-owner-insert', '10000000-0000-0000-0000-000000000002', 'Новая начинка');

DO $test$
BEGIN
  BEGIN
    INSERT INTO public.product_slices (id, "productId", "fillingName")
    VALUES ('slice-foreign-insert', '10000000-0000-0000-0000-000000000003', 'Чужая начинка');
    RAISE EXCEPTION 'owner must not insert a slice for another confectioner';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
END
$test$;
COMMIT;

BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '20000000-0000-0000-0000-000000000003', true);
DO $test$
BEGIN
  IF (SELECT count(*) FROM public.product_slices) <> 5 THEN
    RAISE EXCEPTION 'admin must see all existing slices including the owner-created row';
  END IF;
END
$test$;
UPDATE public.product_slices
SET "fillingName" = 'Администратор обновил'
WHERE id = 'slice-public-other';
COMMIT;

BEGIN;
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claim.sub', '', true);
DO $test$
BEGIN
  IF (SELECT count(*) FROM public.product_slices) <> 5 THEN
    RAISE EXCEPTION 'service_role must retain server-side full access';
  END IF;
END
$test$;
COMMIT;
