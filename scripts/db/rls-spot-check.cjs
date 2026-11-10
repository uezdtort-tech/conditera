/* RLS cross-user isolation spot-check v3.
 * Фазы: (1) superuser собирает ID; (2) SET ROLE authenticated; (3) RLS-пробы. */
const { Client } = require('pg');
const URL = 'postgresql://postgres@127.0.0.1:54329/conditera';

(async () => {
  // Фаза 1: superuser — собрать ID (RLS не мешает)
  const admin = new Client({ connectionString: URL, statement_timeout: 8000 });
  await admin.connect();
  const profiles = await admin.query(
    "SELECT id, email FROM public.profiles WHERE email IN ('customer@demo.ru','confectioner@demo.ru','customer2@demo.ru')"
  );
  const byEmail = Object.fromEntries(profiles.rows.map((r) => [r.email, r.id]));
  const total = await admin.query('SELECT count(*)::int AS n FROM public.orders');
  console.log('profiles found:', Object.keys(byEmail).length, '| orders total (superuser):', total.rows[0].n);
  await admin.end();

  if (Object.keys(byEmail).length < 3) {
    console.error('FATAL: не все демо-профили найдены');
    process.exit(1);
  }

  // Фаза 2: роль authenticated (не superuser, bypassrls=false)
  const c = new Client({ connectionString: URL, statement_timeout: 8000 });
  await c.connect();
  await c.query('SET ROLE authenticated');

  // Фаза 3: пробы видимости
  const test = async (label, uid) => {
    await c.query("SELECT set_config('request.jwt.claims', $1::text, false)", [
      JSON.stringify({ sub: uid, role: 'authenticated' }),
    ]);
    const v = await c.query('SELECT count(*)::int AS n FROM public.orders');
    console.log(label, '-> orders visible:', v.rows[0].n);
  };

  await test('owner (customer@demo.ru)      ', byEmail['customer@demo.ru']);
  await test('confectioner of the order     ', byEmail['confectioner@demo.ru']);
  await test('unrelated (customer2@demo.ru) ', byEmail['customer2@demo.ru']);

  // anon: claims пустые
  await c.query("SELECT set_config('request.jwt.claims', '', false)");
  const anon = await c.query('SELECT count(*)::int AS n FROM public.orders');
  console.log('anon (no claims)              -> orders visible:', anon.rows[0].n);

  // unrelated UPDATE чужого заказа: ожидаем 0 строк
  await c.query("SELECT set_config('request.jwt.claims', $1::text, false)", [
    JSON.stringify({ sub: byEmail['customer2@demo.ru'], role: 'authenticated' }),
  ]);
  const upd = await c
    .query("UPDATE public.orders SET status = 'CANCELLED' WHERE user_id = $1 RETURNING id", [byEmail['customer@demo.ru']])
    .catch((e) => ({ rows: [], err: e.message }));
  console.log(
    'unrelated UPDATE rows affected:', upd.rows.length,
    upd.err ? '(error: ' + String(upd.err).slice(0, 70) + ')' : ''
  );

  // Убедимся, что заказ не был повреждён
  await c.query("SELECT set_config('request.jwt.claims', $1::text, false)", [
    JSON.stringify({ sub: byEmail['customer@demo.ru'], role: 'authenticated' }),
  ]);
  const still = await c.query("SELECT status FROM public.orders WHERE user_id = $1", [byEmail['customer@demo.ru']]);
  console.log('order status after unrelated UPDATE attempt:', still.rows.map((r) => r.status).join(','));

  await c.end();
})().catch((err) => {
  console.error('ERR:', err.message);
  process.exit(1);
});
