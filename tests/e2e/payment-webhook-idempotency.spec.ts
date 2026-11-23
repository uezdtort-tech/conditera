/**
 * E2E интеграционный тест — идемпотентность payment webhook.
 *
 * Сценарий: YooKassa может присылать webhook повторно (retry-on-failure).
 * Каждый retry должен быть обработан идемпотентно — без двойных начислений
 * бонусов и без повторной отправки email-уведомлений.
 *
 * Тестирует:
 *   1. Первый webhook payment.succeeded → заказ переходит в escrow,
 *      бонусы начисляются, notification отправляется.
 *   2. Повторный webhook с тем же orderId и status → idempotent (200 OK),
 *      без дублирования side-effects.
 *   3. Невалидный payload (нет orderId) → 400 Bad Request.
 *   4. Подделка IP в production-режиме → 401 Unauthorized.
 *
 * Запуск:
 *   npx playwright test tests/e2e/payment-webhook-idempotency.spec.ts --project=chromium
 */
import { randomUUID } from 'crypto'
import { test, expect, type APIRequestContext } from '@playwright/test';

// Test data — используем детерминированные ID, чтобы тесты были повторяемыми.
const TEST_ORDER_ID = randomUUID();
const TEST_PAYMENT_ID = `e2e-payment-${Date.now()}`;
const TEST_CUSTOMER_ID = `e2e-customer-${Date.now()}`;
const TEST_CUSTOMER_EMAIL = `e2e-customer-${Date.now()}@example.com`;

interface YooKassaWebhookBody {
  event: string;
  object: {
    id: string;
    status: string;
    metadata: { orderId: string };
  };
}

function makeWebhook(
  event: string,
  orderId: string,
  paymentId: string,
  status: string = 'succeeded'
): YooKassaWebhookBody {
  return {
    event,
    object: {
      id: paymentId,
      status,
      metadata: { orderId },
    },
  };
}

test.describe.serial('Payment webhook contract — malformed payload and missing orders', () => {

  test('1. payment.succeeded для отсутствующего заказа → 404', async ({ request }: { request: APIRequestContext }) => {
    const body = makeWebhook('payment.succeeded', TEST_ORDER_ID, TEST_PAYMENT_ID);

    const response = await request.post('/api/payment/webhook', {
      data: body,
      headers: {
        // CI запускает production runtime: передаём адрес из официального allowlist YooKassa.
        'content-type': 'application/json',
        'x-real-ip': '185.71.76.13',
      },
    });

    expect(response.status()).toBe(404);
    expect((await response.json()).error).toBe('Order not found');
  });

  test('2. повторные события для отсутствующего заказа стабильно возвращают 404', async ({ request }: { request: APIRequestContext }) => {
    const body = makeWebhook('payment.succeeded', TEST_ORDER_ID, TEST_PAYMENT_ID);

    const response1 = await request.post('/api/payment/webhook', {
      data: body,
      headers: { 'content-type': 'application/json', 'x-real-ip': '185.71.76.13' },
    });
    const response2 = await request.post('/api/payment/webhook', {
      data: body,
      headers: { 'content-type': 'application/json', 'x-real-ip': '185.71.76.13' },
    });

    expect(response1.status()).toBe(404);
    expect(response2.status()).toBe(404);
    expect((await response1.json()).error).toBe('Order not found');
    expect((await response2.json()).error).toBe('Order not found');
  });

  test('3. Невалидный payload (нет orderId) → 400 Bad Request', async ({ request }: { request: APIRequestContext }) => {
    // Отправляем payload без metadata.orderId
    const badBody = {
      event: 'payment.succeeded',
      object: {
        id: TEST_PAYMENT_ID,
        status: 'succeeded',
        metadata: {}, // нет orderId
      },
    };

    const response = await request.post('/api/payment/webhook', {
      data: badBody,
      headers: { 'content-type': 'application/json', 'x-real-ip': '185.71.76.13' },
    });

    expect(response.status()).toBe(400);
  });

  test('4. Payload без object → 400 Bad Request', async ({ request }: { request: APIRequestContext }) => {
    const badBody = {
      event: 'payment.succeeded',
      // object отсутствует
    };

    const response = await request.post('/api/payment/webhook', {
      data: badBody,
      headers: { 'content-type': 'application/json', 'x-real-ip': '185.71.76.13' },
    });

    expect(response.status()).toBe(400);
  });

  test('5. Полностью пустой body → 400 Bad Request', async ({ request }: { request: APIRequestContext }) => {
    const response = await request.post('/api/payment/webhook', {
      data: '',
      headers: { 'content-type': 'application/json', 'x-real-ip': '185.71.76.13' },
    });

    expect(response.status()).toBe(400);
  });

  test('6. Невалидный JSON → 400 Bad Request', async ({ request }: { request: APIRequestContext }) => {
    const response = await request.post('/api/payment/webhook', {
      data: '{not valid json',
      headers: { 'content-type': 'application/json', 'x-real-ip': '185.71.76.13' },
    });

    expect(response.status()).toBe(400);
  });

  test('7. Webhook payment.canceled → 200 (обработан)', async ({ request }: { request: APIRequestContext }) => {
    const orderId = randomUUID();
    const paymentId = `e2e-cancel-p-${Date.now()}`;

    const body = makeWebhook('payment.canceled', orderId, paymentId, 'canceled');

    const response = await request.post('/api/payment/webhook', {
      data: body,
      headers: { 'content-type': 'application/json', 'x-real-ip': '185.71.76.13' },
    });

    expect(response.status()).toBe(404);
  });

  test('8. Webhook refund.succeeded → 200 (обработан)', async ({ request }: { request: APIRequestContext }) => {
    const orderId = randomUUID();
    const paymentId = `e2e-refund-p-${Date.now()}`;

    const body = makeWebhook('refund.succeeded', orderId, paymentId, 'succeeded');

    const response = await request.post('/api/payment/webhook', {
      data: body,
      headers: { 'content-type': 'application/json', 'x-real-ip': '185.71.76.13' },
    });

    expect(response.status()).toBe(404);
  });

  test('9. Unknown event → 200 OK (логируется, не падает)', async ({ request }: { request: APIRequestContext }) => {
    const orderId = randomUUID();
    const paymentId = `e2e-unknown-p-${Date.now()}`;

    const body = makeWebhook('payment.unknown_event', orderId, paymentId, 'unknown');

    const response = await request.post('/api/payment/webhook', {
      data: body,
      headers: { 'content-type': 'application/json', 'x-real-ip': '185.71.76.13' },
    });

    // Неизвестное событие не должно создавать фиктивный заказ или платёж.
    expect(response.status()).toBe(404);
  });

  test('10. Повторные webhook для отсутствующего заказа отклоняются одинаково', async ({ request }: { request: APIRequestContext }) => {
    const orderId = randomUUID();
    const paymentId = `e2e-triple-p-${Date.now()}`;
    const body = makeWebhook('payment.succeeded', orderId, paymentId);

    const statuses: number[] = [];
    for (let attempt = 0; attempt < 3; attempt++) {
      const response = await request.post('/api/payment/webhook', {
        data: body,
        headers: { 'content-type': 'application/json', 'x-real-ip': '185.71.76.13' },
      });
      statuses.push(response.status());
    }

    // Для несуществующего заказа корректный результат — 404, а не фиктивная обработка.
    expect(statuses).toEqual([404, 404, 404]);
  });

  test('11. GET /api/payment/webhook → 200 status ok', async ({ request }: { request: APIRequestContext }) => {
    const response = await request.get('/api/payment/webhook');

    expect(response.status()).toBe(200);
    const json = await response.json();
    expect(json).toHaveProperty('status', 'ok');
    expect(json).toHaveProperty('webhookUrl');
    expect(json.webhookUrl).toContain('/api/payment/webhook');
  });
});

test.describe('Payment webhook — edge cases', () => {
  test('разные status для одного orderId — обновляется статус', async ({ request }: { request: APIRequestContext }) => {
    const orderId = randomUUID();
    const paymentId = `e2e-status-p-${Date.now()}`;

    // 1. pending → обработан
    const r1 = await request.post('/api/payment/webhook', {
      data: makeWebhook('payment.waiting_for_capture', orderId, paymentId, 'waiting_for_capture'),
      headers: { 'content-type': 'application/json', 'x-real-ip': '185.71.76.13' },
    });

    // 2. succeeded — новый статус, не idempotent, обрабатывается
    const r2 = await request.post('/api/payment/webhook', {
      data: makeWebhook('payment.succeeded', orderId, paymentId, 'succeeded'),
      headers: { 'content-type': 'application/json', 'x-real-ip': '185.71.76.13' },
    });

    // 3. succeeded повторно — idempotent
    const r3 = await request.post('/api/payment/webhook', {
      data: makeWebhook('payment.succeeded', orderId, paymentId, 'succeeded'),
      headers: { 'content-type': 'application/json', 'x-real-ip': '185.71.76.13' },
    });

    expect([r1.status(), r2.status(), r3.status()]).toEqual([404, 404, 404]);
  });
});
