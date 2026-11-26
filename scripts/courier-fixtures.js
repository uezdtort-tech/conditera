/**
 * Этап 2 fixtures: курьер-пользователь + заказ IN_DELIVERY + доставка assigned.
 * Идемпотентно; тестовые UUID фиксированы для повторных прогонов.
 */
const { Client } = require("pg");

const COURIER_ID = "22222222-2222-4222-8222-222222222201";
const CUST = "11111111-1111-4111-8111-111111111106";
const CONF = "11111111-1111-4111-8111-111111111101";
const ORDER_ID = "33333333-3333-4333-8333-333333333301";
const DELIVERY_ID = "44444444-4444-4444-8444-444444444401";

(async () => {
  const connectionString = process.env.PGURL || process.env.DATABASE_URL || "postgresql://postgres@127.0.0.1:54329/conditera";
  const c = new Client({ connectionString });
  await c.connect();

  // 1) auth.users — копия строки customer с новым id/email
  const au = await c.query("SELECT id FROM auth.users WHERE id = $1", [COURIER_ID]);
  if (au.rows.length === 0) {
    const src = await c.query(
      "SELECT * FROM auth.users WHERE email = 'customer@demo.ru' LIMIT 1"
    );
    const s = src.rows[0];
    await c.query(
      `INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password,
        email_confirmed_at, created_at, updated_at, raw_user_meta_data)
       VALUES ($1, $2, $3, $4, $5, $6, now(), now(), now(), $7::jsonb)`,
      [
        COURIER_ID, s.instance_id, s.aud, s.role, "courier@demo.ru",
        s.encrypted_password, s.raw_user_meta_data ?? null,
      ]
    );
  }

  // 2) profiles — копия customer (password_hash => Demo123!)
  await c.query(
    `INSERT INTO profiles (id, email, name, phone, password_hash, city, created_at, updated_at)
     SELECT $1, 'courier@demo.ru', 'Демо Курьер', '+7 900 000-00-09', password_hash, 'Москва', now(), now()
     FROM profiles WHERE email='customer@demo.ru'
     ON CONFLICT (id) DO NOTHING`,
    [COURIER_ID]
  );

  // 3) роль COURIER
  const role = await c.query(
    "SELECT id FROM user_roles WHERE user_id=$1 AND role='COURIER' AND is_active",
    [COURIER_ID]
  );
  if (role.rows.length === 0) {
    await c.query(
      "INSERT INTO user_roles (id, user_id, role, is_active, assigned_at) VALUES (gen_random_uuid(), $1, 'COURIER', true, now())",
      [COURIER_ID]
    );
  }

  // 4) заказ IN_DELIVERY
  await c.query(
    `INSERT INTO orders (id, number, user_id, confectioner_id, status, total, delivery_cost,
       delivery_address, delivery_city, created_at, updated_at)
     VALUES ($1, 'DEMO-2001', $2, $3, 'IN_DELIVERY', 4200, 350, 'ул. Тестовая 1', 'Москва', now(), now())
     ON CONFLICT (id) DO UPDATE SET status='IN_DELIVERY', updated_at=now()`,
    [ORDER_ID, CUST, CONF]
  );

  // 5) доставка assigned курьеру (сброс к исходному состоянию при повторе)
  await c.query(
    `INSERT INTO deliveries (id, order_id, courier_id, status, address, cost, created_at, updated_at)
     VALUES ($1, $2, $3, 'assigned', 'ул. Тестовая 1', 350, now(), now())
     ON CONFLICT (id) DO UPDATE SET status='assigned', courier_id=$3,
       pickup_at=NULL, delivered_at=NULL, courier_earnings=NULL, updated_at=now()`,
    [DELIVERY_ID, ORDER_ID, COURIER_ID]
  );

  // 6) история статуса заказа (для проверки changed_by при завершении)
  await c.query(
    `DELETE FROM order_status_history WHERE order_id=$1 AND status_to='DELIVERED'`,
    [ORDER_ID]
  );

  console.log("courier:", COURIER_ID);
  console.log("order:", ORDER_ID);
  console.log("delivery:", DELIVERY_ID);
  await c.end();
})().catch((e) => { console.error("FAIL:", e.message); process.exit(1); });
