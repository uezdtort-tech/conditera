-- 0075_order_access_rls.sql
-- P0: orders are written only by trusted server routes/service_role.
-- Earlier policies let any authenticated customer/confectioner update every
-- column of their order and let any COURIER/SUPPORT read every order.
-- That bypasses lifecycle/payment gates and leaks customer data.

-- Remove broad write policies. Checkout, lifecycle, payment and courier
-- assignment already use the service-role API/server-side transactions.
DROP POLICY IF EXISTS "orders_insert_own" ON public.orders;
DROP POLICY IF EXISTS "orders_update_own" ON public.orders;

REVOKE INSERT, UPDATE, DELETE ON TABLE public.orders FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.order_items FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.payments FROM anon, authenticated;

-- A buyer sees own orders; a confectioner sees orders assigned to them;
-- support sees only orders with a ticket assigned to their user; a courier
-- sees only orders explicitly assigned through orders.courier_id.
DROP POLICY IF EXISTS "orders_select_own" ON public.orders;
CREATE POLICY "orders_select_own" ON public.orders
  FOR SELECT USING (
    auth.uid() = user_id
    OR auth.uid()::text = confectioner_id::text
    OR EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.role IN ('ADMIN', 'SUPER_ADMIN')
        AND ur.is_active = TRUE
    )
    OR (
      EXISTS (
        SELECT 1 FROM public.user_roles ur
        WHERE ur.user_id = auth.uid()
          AND ur.role = 'SUPPORT'
          AND ur.is_active = TRUE
      )
      AND EXISTS (
        SELECT 1 FROM public.support_tickets st
        WHERE st.order_id = orders.id
          AND st.assigned_to = auth.uid()
      )
    )
    OR (
      orders.courier_id = auth.uid()
      AND EXISTS (
        SELECT 1 FROM public.user_roles ur
        WHERE ur.user_id = auth.uid()
          AND ur.role = 'COURIER'
          AND ur.is_active = TRUE
      )
    )
  );

-- Order items follow exactly the same party/assignment boundary.
DROP POLICY IF EXISTS "order_items_select_own" ON public.order_items;
CREATE POLICY "order_items_select_own" ON public.order_items
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.orders o
      WHERE o.id = order_items.order_id
        AND (
          o.user_id = auth.uid()
          OR o.confectioner_id = auth.uid()
          OR EXISTS (
            SELECT 1 FROM public.user_roles ur
            WHERE ur.user_id = auth.uid()
              AND ur.role IN ('ADMIN', 'SUPER_ADMIN')
              AND ur.is_active = TRUE
          )
          OR (
            o.courier_id = auth.uid()
            AND EXISTS (
              SELECT 1 FROM public.user_roles ur
              WHERE ur.user_id = auth.uid()
                AND ur.role = 'COURIER'
                AND ur.is_active = TRUE
            )
          )
          OR (
            EXISTS (
              SELECT 1 FROM public.user_roles ur
              WHERE ur.user_id = auth.uid()
                AND ur.role = 'SUPPORT'
                AND ur.is_active = TRUE
            )
            AND EXISTS (
              SELECT 1 FROM public.support_tickets st
              WHERE st.order_id = o.id
                AND st.assigned_to = auth.uid()
            )
          )
        )
    )
  );

-- Payment rows are read-only to authenticated clients; all mutations go
-- through the server after provider verification.
