import { expect, test, type APIRequestContext } from "@playwright/test";

const APP = process.env.E2E_APP_URL || "http://localhost:3000";
const RUN_ID = Date.now().toString();
const PASSWORD = "E2e-CakeProject!2026";

async function registerUser(
  request: APIRequestContext,
  role: "CUSTOMER" | "CONFECTIONER",
  suffix: string,
) {
  const email = "cake-project-" + suffix + "-" + RUN_ID + "@e2e.conditera.ru";
  const response = await request.post(APP + "/api/auth/register", {
    data: {
      email,
      password: PASSWORD,
      name: "E2E " + role + " " + RUN_ID,
      phone: "+7999" + RUN_ID.slice(-7) + (suffix === "customer" ? "1" : "2"),
      role,
      consentPd: true,
      consentTerms: true,
      consentOffer: true,
    },
  });
  expect([200, 201]).toContain(response.status());
  const login = await request.post(APP + "/api/auth/login", {
    data: { email, password: PASSWORD },
  });
  expect(login.ok(), "login " + role + " failed: " + login.status() + " " + await login.text()).toBeTruthy();
  const body = await login.json();
  return { id: body.user?.id || body.id, token: body.accessToken as string };
}

test.describe("Создание проекта торта и переговоров", () => {
  test("проект сохраняется, цена переводится в копейки, кондитер получает запрос", async ({ request }) => {
    const csrfResponse = await request.get(APP + "/api/csrf-token");
    expect(csrfResponse.ok()).toBeTruthy();
    const csrfBody = await csrfResponse.json() as { token: string };

    const customer = await registerUser(request, "CUSTOMER", "customer");
    const confectioner = await registerUser(request, "CONFECTIONER", "confectioner");
    expect(customer.id).toBeTruthy();
    expect(confectioner.id).toBeTruthy();
    expect(customer.id).not.toBe(confectioner.id);

    const deliveryDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const response = await request.post(APP + "/api/inquiries", {
      headers: {
        Authorization: "Bearer " + customer.token,
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
        confectionerIds: [confectioner.id],
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
      headers: { Authorization: "Bearer " + customer.token },
    });
    expect(own.ok(), await own.text()).toBeTruthy();
    const ownBody = await own.json();
    const inquiry = ownBody.inquiries.find((item: { id: string }) => item.id === result.inquiryId);
    expect(inquiry).toBeTruthy();
    expect(inquiry.product_type).toBe("cake");
    expect(inquiry.estimated_price).toBe(750000);
    expect(inquiry.project_spec.price.productKopecks).toBe(750000);

    const available = await request.get(APP + "/api/inquiries?filter=available", {
      headers: { Authorization: "Bearer " + confectioner.token },
    });
    expect(available.ok(), await available.text()).toBeTruthy();
    const availableBody = await available.json();
    expect(availableBody.inquiries.some((item: { id: string }) => item.id === result.inquiryId)).toBe(true);
  });
});
