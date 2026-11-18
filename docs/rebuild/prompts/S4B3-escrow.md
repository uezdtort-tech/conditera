# ПРОМПТ S4B3 — Эскроу, бонусы, выплаты

Этап 4 «Деньги» | Блок 3. Зависимости: S4B2 (payments/ledger).
> Скопируйте текст ниже целиком в нового агента.

---

## 1. РОЛЬ
Ты — backend-инженер. Ты строишь защищённый денежный контур маркетплейса:
эскроу-удержание до подтверждения доставки, бонусную программу и выплаты
кондитерам — всё через ledger (S4B2).

## 2. СТЕК И НЕИЗМЕНЯЕМЫЕ ПРАВИЛА
- Next.js 16 (App Router) + TypeScript strict; bun (:3000, lint, tsc).
- Tailwind CSS 4 + shadcn/ui; без indigo/blue.
- Данные: только Prisma; движения денег — ТОЛЬКО через
  src/lib/payments/ledger.ts (S4B2); payout-статусы единые (SD-10).
- Безопасность: админ-действия за guardAdmin + admin_actions аудит;
  2FA-подтверждение на complete выплаты (colонка completedTfaAt);
  CSRF/rate-limit; не печатать .env*.
- Процесс: коммит `[S4B3] ...`; tsc→vitest→agent-browser; worklog.md.
- Запреты: прод/боевые ключи; старый проект — только чтение.

## 3. ЦЕЛЬ БЛОКА
Эскроу-цикл заказа, бонусные начисления/списание, заявки и выплаты
кондитерам с аудитом — без легаси-роутов и «висящих» денег.

## 4. ШАГИ
1. Эскроу (модели Escrow: orderId, confectionerId, amount, status
   held|released|refunded; поля в ledger kind=hold|release|refund):
   - при Order=paid → транзакция: Escrow=held + ledger hold
     (списание с виртуального счёта кондитера в резерв);
   - при Order=completed (покупатель подтвердил/авто-таймер) →
     release: ledger release на баланс кондитера;
   - при refund → refund: возврат покупателю, Escrow=refunded.
2. Авто-таймер завершения: cron-задача auto-complete (регистрируется
   в реестре S8B1; здесь — функция в src/lib/orders/auto-complete.ts:
   заказы delivering старше N дней → completed + release; N=7 из
   site_settings).
3. Бонусы: модель BonusProgram в site_settings (процент, уровни
   лояльности по обороту — как в старом: loyalty_level по сумме);
   - начисление при Order=completed: % от суммы → ledger kind=bonus
     покупателю;
   - списание в checkout (S4B1 промокод-поле расширяется: «списать
     бонусы») — ledger kind=payment с пометкой бонус-части;
   - истечение бонусов (срок из настроек) — задача expiring-bonuses
     (реестр S8B1).
4. Выплаты: модель Payout (confectionerId, amount, status
   pending|approved|completed|rejected, ledgerRef, completedTfaAt):
   - POST /api/payouts (confectioner, CSRF) — заявка при балансе ≥
     суммы (проверка ledger-остатка); создаёт ledger kind=hold;
   - admin: POST /api/admin/payouts/:id/approve | reject; complete —
     только с TOTP-кодом (S2B1 2FA): POST /api/admin/payouts/:id/complete
     {tfaCode} → completedTfaAt + ledger kind=payout;
   - ОДИН роут-набор (никаких легаси-дублей — D9);
   - UI: /account/payouts (кондитер: заявки и статусы) и
     /admin/payouts (админ: очередь, approve/reject/complete с 2FA).
5. Страница /account/balance: баланс = последний ledger.balanceAfter,
   история движений (пагинация, фильтр kind).
6. Инвариант целостности: утилита scripts/verify-ledger.ts — для
   каждого пользователя сумма ledger-записей = balanceAfter последней
   записи; запускать после seed и в worklog-отчёте.

## 5. ЧТО ВЗЯТЬ ИЗ СТАРОГО ПРОЕКТА
- миграции escrow/bonuses — составы полей;
- уроки LIMIT 1–4: ledger не влит → теперь ядро; payouts без 2FA →
  теперь TOTP обязателен; легаси-роут → теперь один набор.

## 6. ЗАПРЕТЫ
- Ручные UPDATE баланса в обход ledger — запрещены.
- Не выдавать выплаты без TOTP даже в dev (в dev — mock-2FA с
  фиксированным кодом из env, помечено в docs).
- Не хранить суммы в float — только integer копейки.

## 7. КРИТЕРИИ ПРИЁМКИ
- [ ] Полный цикл: paid → held → completed → release → баланс
      кондитера верен; ledger-инвариант проходит;
- [ ] Бонусы начисляются/списываются, ledger отражает;
- [ ] Выплата: заявка → approve → complete(2FA) — статусы и ledger
      корректны; без TOTP complete → 403;
- [ ] scripts/verify-ledger.ts → OK на seed-данных;
- [ ] tsc 0, lint 0; коммит [S4B3]; worklog.

## 8. ВЕРИФИКАЦИЯ (curl + agent-browser)
- curl-цикл заказа до completed (mock-оплата) + ledger-проверка;
- agent-browser: кондитер делает заявку выплаты; админ approve →
  complete с кодом; /account/balance показывает историю.

## 9. АРТЕФАКТЫ И ОТЧЁТ
- Коммит [S4B3]; worklog (правила эскроу/бонусов/выплат).
- Отчёт: денежная модель v2, отличия от старой (D9/D10 закрыты).
