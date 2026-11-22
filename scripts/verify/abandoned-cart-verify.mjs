import { Client } from "pg";

const BASE = process.env.VERIFY_BASE || "http://127.0.0.1:3000";
const PG_URL = process.env.PGURL;
const CRON_SECRET = process.env.CRON_SECRET;
if (!PG_URL || !CRON_SECRET) throw new Error("PGURL and CRON_SECRET are required");

const db = new Client({ connectionString: PG_URL });
const failures = [];
let userId = null;
let oldNotifyPrefs = null;
let oldLegacyPreference = null;
let legacyPreferenceExisted = false;
let cartItemId = null;
const logIds = new Set();

function assert(name, condition, detail = "") {
  if (condition) console.log(`  PASS ${name}`);
  else {
    failures.push(name);
    console.error(`  FAIL ${name}${detail ? `: ${detail}` : ""}`);
  }
}

async function request(method, path, body, authorized = true) {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(authorized ? { "X-Cron-Secret": CRON_SECRET } : {}),
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text.slice(0, 200) }; }
  return { status: response.status, json };
}

try {
  await db.connect();

  const selected = await db.query(
    `SELECT p.id::text AS id, p.notify_prefs
       FROM public.profiles p
      WHERE p.is_blocked IS NOT TRUE
        AND p.email IS NOT NULL
        AND p.email LIKE '%@demo.ru'
        AND NOT EXISTS (SELECT 1 FROM public.cart_items c WHERE c.user_id = p.id)
        AND NOT EXISTS (
          SELECT 1 FROM public.orders o
           WHERE o.user_id = p.id
             AND o.created_at > now() - interval '24 hours'
        )
      ORDER BY p.created_at
      LIMIT 1`,
  );
  if (!selected.rows.length) throw new Error("No isolated demo profile without a cart or recent order is available");
  userId = selected.rows[0].id;
  oldNotifyPrefs = selected.rows[0].notify_prefs;

  const legacy = await db.query(
    "SELECT abandoned_cart FROM public.notification_preferences WHERE user_id = $1::uuid",
    [userId],
  );
  legacyPreferenceExisted = legacy.rows.length > 0;
  oldLegacyPreference = legacy.rows[0]?.abandoned_cart ?? null;

  await db.query(
    `UPDATE public.profiles
        SET notify_prefs = COALESCE(notify_prefs, '{}'::jsonb) ||
          '{"abandonedCart":true,"emailEnabled":true,"pushEnabled":true,"inAppEnabled":true}'::jsonb
      WHERE id = $1::uuid`,
    [userId],
  );
  await db.query(
    `INSERT INTO public.notification_preferences (user_id, abandoned_cart)
     VALUES ($1::uuid, true)
     ON CONFLICT (user_id) DO UPDATE SET abandoned_cart = true`,
    [userId],
  );

  const product = await db.query(
    "SELECT id::text AS id FROM public.products WHERE status = 'ACTIVE' ORDER BY created_at LIMIT 1",
  );
  if (!product.rows.length) throw new Error("No active product available for abandoned-cart verification");

  const inserted = await db.query(
    `INSERT INTO public.cart_items (user_id, product_id, quantity, created_at, updated_at)
     VALUES ($1::uuid, $2::uuid, 1, now() - interval '3 hours', now() - interval '3 hours')
     RETURNING id::text AS id`,
    [userId, product.rows[0].id],
  );
  cartItemId = inserted.rows[0].id;

  const unauthorized = await request("GET", "/api/cron/abandoned-cart", undefined, false);
  assert("cron endpoint rejects requests without X-Cron-Secret", unauthorized.status === 401, String(unauthorized.status));

  const [first, concurrent] = await Promise.all([
    request("GET", "/api/cron/abandoned-cart"),
    request("GET", "/api/cron/abandoned-cart"),
  ]);
  const firstCart = first.json?.carts?.find((cart) => cart.userId === userId);
  const concurrentCart = concurrent.json?.carts?.find((cart) => cart.userId === userId);
  if (firstCart?.id) logIds.add(firstCart.id);
  if (concurrentCart?.id) logIds.add(concurrentCart.id);
  assert("two concurrent GETs both return 200", first.status === 200 && concurrent.status === 200);
  assert("concurrent GETs return the same persisted cart log", Boolean(firstCart?.id) && firstCart.id === concurrentCart?.id);
  assert("cart log ID is a UUID, not a synthetic user key", typeof firstCart?.id === "string" && /^[0-9a-f-]{36}$/i.test(firstCart.id));

  if (!firstCart?.id) throw new Error("Cannot continue without a persisted abandoned-cart log");
  const logCount = await db.query(
    "SELECT count(*)::int AS count FROM public.abandoned_cart_logs WHERE user_id = $1::uuid AND cart_fingerprint IS NOT NULL",
    [userId],
  );
  assert("concurrent registration creates one fingerprinted log", logCount.rows[0].count === 1, String(logCount.rows[0].count));

  const skipped = await request("PATCH", "/api/cron/abandoned-cart", {
    cartId: firstCart.id,
    action: "mark_notified",
    skipped: true,
    channel: "email",
  });
  const skippedRow = await db.query(
    "SELECT reminder_status, reminder_sent_at FROM public.abandoned_cart_logs WHERE id = $1::uuid",
    [firstCart.id],
  );
  assert("skipped notification is persisted as retryable failure", skipped.status === 200 && skippedRow.rows[0]?.reminder_status === "failed" && skippedRow.rows[0]?.reminder_sent_at === null);

  const retry = await request("GET", "/api/cron/abandoned-cart");
  const retryCart = retry.json?.carts?.find((cart) => cart.userId === userId);
  assert("failed/skipped reminder remains eligible for retry", retry.status === 200 && retryCart?.id === firstCart.id);

  const sent = await request("PATCH", "/api/cron/abandoned-cart", {
    cartId: firstCart.id,
    action: "mark_notified",
    skipped: false,
    channel: "push",
  });
  const sentRow = await db.query(
    "SELECT reminder_status, reminder_sent_at, reminder_channel FROM public.abandoned_cart_logs WHERE id = $1::uuid",
    [firstCart.id],
  );
  assert("successful notification is durably marked sent", sent.status === 200 && sentRow.rows[0]?.reminder_status === "sent" && Boolean(sentRow.rows[0]?.reminder_sent_at) && sentRow.rows[0]?.reminder_channel === "push");

  const afterSent = await request("GET", "/api/cron/abandoned-cart");
  assert("sent cart is no longer returned by the cron endpoint", afterSent.status === 200 && !afterSent.json?.carts?.some((cart) => cart.userId === userId));

  await db.query(
    "UPDATE public.cart_items SET quantity = 2, updated_at = now() - interval '2 hours 30 minutes' WHERE id = $1::uuid",
    [cartItemId],
  );
  const changed = await request("GET", "/api/cron/abandoned-cart");
  const changedCart = changed.json?.carts?.find((cart) => cart.userId === userId);
  if (changedCart?.id) logIds.add(changedCart.id);
  assert("changed cart snapshot gets a new fingerprint and reminder log", changed.status === 200 && Boolean(changedCart?.id) && changedCart.id !== firstCart.id);

  if (changedCart?.id) {
    const changedSent = await request("PATCH", "/api/cron/abandoned-cart", {
      cartId: changedCart.id,
      action: "mark_notified",
      skipped: false,
      channel: "email",
    });
    assert("second cart snapshot can be marked sent independently", changedSent.status === 200);
  }

  await db.query(
    `UPDATE public.profiles
        SET notify_prefs = COALESCE(notify_prefs, '{}'::jsonb) || '{"abandonedCart":false}'::jsonb
      WHERE id = $1::uuid`,
    [userId],
  );
  await db.query(
    "UPDATE public.notification_preferences SET abandoned_cart = false WHERE user_id = $1::uuid",
    [userId],
  );
  await db.query(
    "UPDATE public.cart_items SET quantity = 3, updated_at = now() - interval '2 hours 20 minutes' WHERE id = $1::uuid",
    [cartItemId],
  );
  const optedOut = await request("GET", "/api/cron/abandoned-cart");
  assert("abandoned-cart opt-out suppresses reminders", optedOut.status === 200 && !optedOut.json?.carts?.some((cart) => cart.userId === userId));

  const invalidPatch = await request("PATCH", "/api/cron/abandoned-cart", {
    cartId: "not-a-uuid",
    action: "mark_notified",
  });
  assert("PATCH rejects malformed log IDs", invalidPatch.status === 400);
} finally {
  if (userId) {
    if (cartItemId) await db.query("DELETE FROM public.cart_items WHERE id = $1::uuid", [cartItemId]).catch(() => {});
    if (logIds.size) {
      await db.query("DELETE FROM public.abandoned_cart_logs WHERE id = ANY($1::uuid[])", [[...logIds]]).catch(() => {});
    }
    await db.query("UPDATE public.profiles SET notify_prefs = $2::jsonb WHERE id = $1::uuid", [userId, oldNotifyPrefs]).catch(() => {});
    if (legacyPreferenceExisted) {
      await db.query("UPDATE public.notification_preferences SET abandoned_cart = $2 WHERE user_id = $1::uuid", [userId, oldLegacyPreference]).catch(() => {});
    } else {
      await db.query("DELETE FROM public.notification_preferences WHERE user_id = $1::uuid", [userId]).catch(() => {});
    }
  }
  await db.end().catch(() => {});
}

if (failures.length) {
  throw new Error(`Abandoned-cart verification failed: ${failures.join(", ")}`);
}
console.log("PASS: abandoned-cart persistence, concurrency, retry, deduplication and opt-out contract");
