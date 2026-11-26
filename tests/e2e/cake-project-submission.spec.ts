import { expect, test } from "@playwright/test";

const APP = process.env.E2E_APP_URL || "http://localhost:3000";
const DEMO_PASSWORD = "Demo123!";
const DEMO_CUSTOMER_ID = "11111111-1111-4111-8111-111111111106";
const DEMO_CONFECTIONER_ID = "11111111-1111-4111-8111-111111111101";
const TEST_DEVICE_HEADERS = { "x-real-ip": "10.250.250.250", "user-agent": "Playwright-E2E/1.0 (+https://conditera.ru)" };

test.describe("Создание проекта торта и переговоров", () => {
  const sessionTokens: string[] = [];
  let csrfToken = "";

  test.afterEach(async ({ request }) => {
    // Тест использует общие demo-аккаунты; обязательно освобождаем их сессии,
    // чтобы параллельные E2E-тесты не блокировали друг друга политикой устройств.
    for (const token of sessionTokens.splice(0)) {
      await request.post(APP + "/api/auth/logout", {
        headers: {
          Authorization: "Bearer " + token,
          ...(csrfToken ? { "x-csrf-token": csrfToken } : {}),
        },
      }).catch(() => {});
    }
    csrfToken = "";
  });

  test("проект сохраняется, цена переводится в копейки, одобренный кондитер получает запрос", async ({ request }) => {
    const csrfResponse = await request.get(APP + "/api/csrf-token");
    expect(csrfResponse.ok()).toBeTruthy();
    const csrfBody = await csrfResponse.json() as { token: string };
    csrfToken = csrfBody.token;

    const customerLogin = await request.post(APP + "/api/auth/login", {
      data: { email: "customer@demo.ru", password: DEMO_PASSWORD },
      headers: TEST_DEVICE_HEADERS,
    });
    expect(customerLogin.ok(), await customerLogin.text()).toBeTruthy();
    const customerBody = await customerLogin.json();
    expect(customerBody.user?.id || customerBody.id).toBe(DEMO_CUSTOMER_ID);
    if (customerBody.accessToken) sessionTokens.push(customerBody.accessToken);

    const confectionerLogin = await request.post(APP + "/api/auth/login", {
      data: { email: "confectioner@demo.ru", password: DEMO_PASSWORD },
      headers: TEST_DEVICE_HEADERS,
    });
    expect(confectionerLogin.ok(), await confectionerLogin.text()).toBeTruthy();
    const confectionerBody = await confectionerLogin.json();
    expect(confectionerBody.user?.id || confectionerBody.id).toBe(DEMO_CONFECTIONER_ID);
    if (confectionerBody.accessToken) sessionTokens.push(confectionerBody.accessToken);

    // Один APIRequestContext хранит cookie последнего login; возвращаем cookie заказчика,
    // чтобы cookie и явный Bearer token не представляли разные учётные записи.
    const customerLoginForSubmit = await request.post(APP + "/api/auth/login", {
      data: { email: "customer@demo.ru", password: DEMO_PASSWORD },
    });
    expect(customerLoginForSubmit.ok()).toBeTruthy();
    const customerSubmitBody = await customerLoginForSubmit.json();
    const customerSubmitToken = customerSubmitBody.accessToken as string;
    if (customerSubmitToken) sessionTokens.push(customerSubmitToken);

    const deliveryDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const response = await request.post(APP + "/api/inquiries", {
      headers: {
        Authorization: "Bearer " + customerSubmitToken,
        "x-csrf-token": csrfBody.token,
      },
      data: {
        project: {
          productType: "cake",
          eventType: "birthday",
          base: "vanilla",
          filling: "strawberry",
          coating: "cream",
          decorations: ["berries"],
          dietary: [],
          servings: 12,
          quantity: 1,
          city: "Москва",
          deliveryDate,
          deliveryType: "pickup",
          address: "",
          inscription: "С днём рождения!",
          comment: "E2E-проверка создания проекта",
        },
        confectionerIds: [DEMO_CONFECTIONER_ID],
        estimatedPriceRubles: 7500,
        estimatedDeliveryCostRubles: 0,
        requestDiscount: false,
        discountPercent: 0,
        discountComment: "",
      },
    });

    expect(response.status(), await response.text()).toBe(201);
    const result = await response.json();
    expect(result.success).toBe(true);
    expect(result.inquiryId).toBeTruthy();
    expect(result.draftId).toBeTruthy();
    expect(result.negotiationsCount).toBe(1);
    expect(result.negotiations).toHaveLength(1);

    const own = await request.get(APP + "/api/inquiries", {
      headers: { Authorization: "Bearer " + customerSubmitToken },
    });
    expect(own.ok(), await own.text()).toBeTruthy();
    const ownBody = await own.json();
    const inquiry = ownBody.inquiries.find((item: { id: string }) => item.id === result.inquiryId);
    expect(inquiry).toBeTruthy();
    expect(inquiry.product_type).toBe("cake");
    expect(inquiry.estimated_price).toBe(750000);
    expect(inquiry.project_spec.price.productKopecks).toBe(750000);

    const confectionerLoginForAvailable = await request.post(APP + "/api/auth/login", {
      data: { email: "confectioner@demo.ru", password: DEMO_PASSWORD },
    });
    expect(confectionerLoginForAvailable.ok()).toBeTruthy();
    const confectionerAvailableBody = await confectionerLoginForAvailable.json();
    if (confectionerAvailableBody.accessToken) sessionTokens.push(confectionerAvailableBody.accessToken);
    const available = await request.get(APP + "/api/inquiries?filter=available", {
      headers: { Authorization: "Bearer " + (confectionerAvailableBody.accessToken as string) },
    });
    expect(available.ok(), await available.text()).toBeTruthy();
    const availableBody = await available.json();
    expect(availableBody.inquiries.some((item: { id: string }) => item.id === result.inquiryId)).toBe(true);
  });
});
