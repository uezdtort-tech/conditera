import { expect, test } from "@playwright/test";

const APP = process.env.E2E_APP_URL || "http://localhost:3000";
const DEMO_PASSWORD = "Demo123!";
const DEMO_CUSTOMER_ID = "11111111-1111-4111-8111-111111111106";
const DEMO_CONFECTIONER_ID = "11111111-1111-4111-8111-111111111101";

test.describe("Создание проекта торта и переговоров", () => {
  test("проект сохраняется, цена переводится в копейки, одобренный кондитер получает запрос", async ({ request }) => {
    const csrfResponse = await request.get(APP + "/api/csrf-token");
    expect(csrfResponse.ok()).toBeTruthy();
    const csrfBody = await csrfResponse.json() as { token: string };

    const customerLogin = await request.post(APP + "/api/auth/login", {
      data: { email: "customer@demo.ru", password: DEMO_PASSWORD },
    });
    expect(customerLogin.ok(), await customerLogin.text()).toBeTruthy();
    const customerBody = await customerLogin.json();
    const customerToken = customerBody.accessToken as string;
    expect(customerBody.user?.id || customerBody.id).toBe(DEMO_CUSTOMER_ID);

    const confectionerLogin = await request.post(APP + "/api/auth/login", {
      data: { email: "confectioner@demo.ru", password: DEMO_PASSWORD },
    });
    expect(confectionerLogin.ok(), await confectionerLogin.text()).toBeTruthy();
    const confectionerBody = await confectionerLogin.json();
    const confectionerToken = confectionerBody.accessToken as string;
    expect(confectionerBody.user?.id || confectionerBody.id).toBe(DEMO_CONFECTIONER_ID);

    const deliveryDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const response = await request.post(APP + "/api/inquiries", {
      headers: {
        Authorization: "Bearer " + customerToken,
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
      headers: { Authorization: "Bearer " + customerToken },
    });
    expect(own.ok(), await own.text()).toBeTruthy();
    const ownBody = await own.json();
    const inquiry = ownBody.inquiries.find((item: { id: string }) => item.id === result.inquiryId);
    expect(inquiry).toBeTruthy();
    expect(inquiry.product_type).toBe("cake");
    expect(inquiry.estimated_price).toBe(750000);
    expect(inquiry.project_spec.price.productKopecks).toBe(750000);

    const available = await request.get(APP + "/api/inquiries?filter=available", {
      headers: { Authorization: "Bearer " + confectionerToken },
    });
    expect(available.ok(), await available.text()).toBeTruthy();
    const availableBody = await available.json();
    expect(availableBody.inquiries.some((item: { id: string }) => item.id === result.inquiryId)).toBe(true);
  });
});
