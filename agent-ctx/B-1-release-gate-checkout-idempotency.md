# B-1 — Release Gate v4.1: checkout idempotency (U-07 fix)

Agent: Z.ai Code (B-1) · Base: main @ `0bcb79a` · Commit: `87fe425` · Push: НЕ выполнялся

## Result: FIX VERIFIED — client-only fix, server untouched

Запретная зона (payment/webhook/escrow/payout/refund/bonus-balance) — 0 diff; серверный `/api/checkout` не менялся вовсе.

## Chain trace (file:line)

| Сторона | Точка | Было |
|---|---|---|
| Client UI | `src/components/pages/extra-pages.tsx:1453-1457` (HEAD 0bcb79a) | ключ = `useState(crypto.randomUUID())` — один на МОНТИРОВАНИЕ; стабилен по кликам внутри страницы, но НОВЫЙ после remount/перезагрузки → дубль при «ответ потерян + reload» |
| Client UI | `extra-pages.tsx:1556` | отправка заголовком `Idempotency-Key` (формат верный) |
| Client hook | `src/lib/supabase/use-marketplace.ts:593-604` | `useCreateOrder` POST без ключа ВООБЩЕ → каждый resubmit = дубль (dead code, но публичный API) |
| Server | `src/app/api/checkout/route.ts:160` | чтение: `extractIdempotencyKey` (`src/lib/promo-codes.ts:274-281`: 8..100, `[A-Za-z0-9._-]`) |
| Server | `route.ts:161-177` | replay: `user_id` + `metadata->>idempotency_key`, окно 15 мин (`:54`) → `buildReplayResponse` `:761-806` (200, тот же orderId, `idempotentReplay:true`) |
| Server | `route.ts:524-528` | хранение `orders.metadata.idempotency_key = key ?? null` |
| Server | `route.ts:533-557` + `supabase/migrations/0060:50-53` | гонка: `uq_orders_idempotency (user_id, metadata->>'idempotency_key') WHERE key IS NOT NULL` → 23505 → replay |
| Server | absent key | без lookup, metadata=null (вне частичного индекса) → новый заказ каждый POST = **opt-in контракт** |
| Server | same key, другой payload | тело не сверяется — replay первого (user-scoped) |

## Verdict

Сервер звука при переданном ключе → **client-only fix**; сервер оставлен лояльным (blast radius «reject без ключа»: легитимные keyless-вызывающие — контрольная секция B прогона/скрипты; money-creation путь).

## Fix (3 файла)

- **NEW `src/lib/checkout-idempotency.ts`** — ключ на ЛОГИЧЕСКУЮ отправку: сигнатура тела (канонический stringify + FNV-1a), sessionStorage (переживает remount/reload) при исходе unknown (сеть/5xx → ретрай = replay), закрытие при известном исходе (2xx/4xx → следующая отправка = НОВЫЙ ключ, без ложного replay повтора заказа).
- `extra-pages.tsx` (CheckoutPage) — проводка хелпера, единая точка resolve (вкл. catch сети).
- `use-marketplace.ts` (useCreateOrder) — шлёт `Idempotency-Key` по тому же контракту.

## Tests & Gates (все exit 0)

- vitest: `src/lib/checkout-idempotency.test.ts` (14) + `use-marketplace.checkout-idem.test.tsx` (6, renderHook, конвенции fillings-теста)
- **Полный сюит: 48 files / 1003 tests passed**; typecheck 0; lint 0; scan-evidence 0
- LIVE `scripts/verify/checkout-idempotency-verify.mjs`: **PASS 15/0** — A same-key×2 → 1 заказ (один orderId `5cdb93be-…`, replay-флаг); B no-key×2 → 2 заказа (opt-in контракт задокументирован, finding #2 за владельцем); C 4× parallel same-key → 200×4, 1 заказ (в dev.log «race resolved via unique index (0060)»); D lost-response → retry вернул ТОТ ЖЕ orderId `2c10744d-…`, 1 строка. Cleanup: 0 остаточных synthetic-строк.

## Evidence

- `docs/evidence/acceptance/U-07-fix-idempotency-0bcb79a.md` (chain, verdict, diffstat, live-матрица с UUID)
- `docs/evidence/acceptance/U-07-checkout-order-idempotency-1362744.md` — аппендикс «FIX VERIFIED (v4.1)»
- `.run/acc/u07-fix-idempotency-transcript.txt`
- worklog.md — секция `Task ID: B-1` (не коммитилась)
