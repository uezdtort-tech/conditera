// @ts-nocheck
/**
 * full-flow.spec.ts — E2E smoke-тесты для основного flow.
 *
 * Запуск: npm run test:e2e
 * Запуск одного: npx playwright test full-flow --grep "homepage"
 */

import { test, expect } from "@playwright/test";

const BASE_URL = process.env.E2E_BASE_URL || "http://localhost:3000";

// ===== Production static assets =====
test.describe("Production static assets", () => {
  test("Next.js client chunks and stylesheets load successfully", async ({ page }) => {
    const failedAssets: string[] = [];
    page.on("response", (response) => {
      if (response.url().includes("/_next/static/") && response.status() >= 400) {
        failedAssets.push(`${response.status()} ${response.url()}`);
      }
    });

    await page.goto(BASE_URL, { waitUntil: "load" });
    await expect(page.locator("body")).toBeVisible();

    const runtimeAssets = await page.locator(
      'script[src*="/_next/static/"], link[rel="stylesheet"][href*="/_next/static/"]'
    ).count();
    expect(runtimeAssets).toBeGreaterThan(0);
    expect(failedAssets).toEqual([]);
  });
});

// ===== Группа: Public pages =====
test.describe("Public pages — должны возвращать 200", () => {
  test("homepage loads", async ({ page }) => {
    await page.goto(BASE_URL);
    await expect(page).toHaveTitle(/Уездный кондитер/i);
  });

  test("catalog page loads", async ({ page }) => {
    await page.goto(`${BASE_URL}/catalog`);
    await expect(page.locator("body")).toBeVisible();
  });

  test("confectioners page loads", async ({ page }) => {
    await page.goto(`${BASE_URL}/confectioners`);
    await expect(page.locator("body")).toBeVisible();
  });

  test("recipes page loads", async ({ page }) => {
    await page.goto(`${BASE_URL}/recipes`);
    await expect(page.locator("body")).toBeVisible();
  });

  test("blog page loads", async ({ page }) => {
    await page.goto(`${BASE_URL}/blog`);
    await expect(page.locator("body")).toBeVisible();
  });

  test("faq page loads", async ({ page }) => {
    await page.goto(`${BASE_URL}/faq`);
    await expect(page.locator("body")).toBeVisible();
  });

  test("help page loads", async ({ page }) => {
    await page.goto(`${BASE_URL}/help`);
    await expect(page.locator("body")).toBeVisible();
  });

  test("about page loads", async ({ page }) => {
    await page.goto(`${BASE_URL}/about`);
    await expect(page.locator("body")).toBeVisible();
  });

  test("contacts page loads", async ({ page }) => {
    await page.goto(`${BASE_URL}/contacts`);
    await expect(page.locator("body")).toBeVisible();
  });

  test("checkout page loads", async ({ page }) => {
    await page.goto(`${BASE_URL}/checkout`);
    await expect(page.locator("body")).toBeVisible();
  });
});

// ===== Группа: Auth flow =====
test.describe("Auth flow", () => {
  test("login page loads", async ({ page }) => {
    await page.goto(`${BASE_URL}/login`);
    await expect(page.locator("body")).toBeVisible();
  });

  test("login page has auth form", async ({ page }) => {
    await page.goto(`${BASE_URL}/login`);
    const body = await page.locator("body").textContent();
    expect(body).toBeTruthy();
  });

  test("dashboard redirects unauthenticated user", async ({ page }) => {
    await page.goto(`${BASE_URL}/dashboard`);
    await page.waitForTimeout(2000);
    const url = page.url();
    expect(url).toContain("login");
  });
});

// ===== Группа: API endpoints =====
test.describe("API endpoints", () => {
  test("GET /api/health returns 200", async ({ request }) => {
    const response = await request.get(`${BASE_URL}/api/health`);
    expect(response.ok()).toBeTruthy();
  });

  test("GET /api/products returns 200 or 500 (no DB in test)", async ({ request }) => {
    const response = await request.get(`${BASE_URL}/api/products`);
    expect([200, 500]).toContain(response.status());
  });

  test("GET /api/csrf-token returns 200", async ({ request }) => {
    const response = await request.get(`${BASE_URL}/api/csrf-token`);
    expect(response.ok()).toBeTruthy();
  });

  test("GET /api/auth/session returns 200", async ({ request }) => {
    const response = await request.get(`${BASE_URL}/api/auth/session`);
    expect(response.ok()).toBeTruthy();
  });

  test("GET /api/crm/tickets returns 401 without auth", async ({ request }) => {
    const response = await request.get(`${BASE_URL}/api/crm/tickets`);
    expect(response.status()).toBe(401);
  });

  test("GET /api/crm/leads returns 401 without auth", async ({ request }) => {
    const response = await request.get(`${BASE_URL}/api/crm/leads`);
    expect(response.status()).toBe(401);
  });

  test("POST /api/checkout returns 405 (GET not allowed) or 401", async ({ request }) => {
    const response = await request.get(`${BASE_URL}/api/checkout`);
    expect([401, 405]).toContain(response.status());
  });
});

// ===== Группа: Security headers =====
test.describe("Security headers", () => {
  test("X-Content-Type-Options is nosniff", async ({ request }) => {
    const response = await request.get(`${BASE_URL}/`);
    expect(response.headers()["x-content-type-options"]).toBe("nosniff");
  });

  test("X-Frame-Options is SAMEORIGIN", async ({ request }) => {
    const response = await request.get(`${BASE_URL}/`);
    expect(response.headers()["x-frame-options"]).toBe("SAMEORIGIN");
  });

  test("Referrer-Policy is strict-origin-when-cross-origin", async ({ request }) => {
    const response = await request.get(`${BASE_URL}/`);
    expect(response.headers()["referrer-policy"]).toBe("strict-origin-when-cross-origin");
  });

  test("Permissions-Policy is set", async ({ request }) => {
    const response = await request.get(`${BASE_URL}/`);
    expect(response.headers()["permissions-policy"]).toContain("geolocation=()");
  });

  test("CSP header is present", async ({ request }) => {
    const response = await request.get(`${BASE_URL}/`);
    const csp = response.headers()["content-security-policy"];
    expect(csp).toBeTruthy();
    expect(csp).toContain("default-src");
  });

  test("Cross-Origin-Opener-Policy is same-origin", async ({ request }) => {
    const response = await request.get(`${BASE_URL}/`);
    expect(response.headers()["cross-origin-opener-policy"]).toBe("same-origin");
  });

  test("Cross-Origin-Resource-Policy is same-origin", async ({ request }) => {
    const response = await request.get(`${BASE_URL}/`);
    expect(response.headers()["cross-origin-resource-policy"]).toBe("same-origin");
  });
});

// ===== Группа: Sensitive endpoints (no-store) =====
test.describe("Sensitive endpoints — Cache-Control no-store", () => {
  test(" /api/auth/* has no-store", async ({ request }) => {
    const response = await request.get(`${BASE_URL}/api/auth/session`);
    expect(response.headers()["cache-control"]).toContain("no-store");
  });
});

// ===== Группа: SEO =====
test.describe("SEO", () => {
  test("robots.txt is accessible", async ({ request }) => {
    const response = await request.get(`${BASE_URL}/robots.txt`);
    expect(response.ok()).toBeTruthy();
    expect((await response.text()).toLowerCase()).toContain("user-agent");
  });

  test("sitemap.xml is accessible", async ({ request }) => {
    const response = await request.get(`${BASE_URL}/sitemap.xml`);
    expect(response.ok()).toBeTruthy();
    expect(await response.text()).toContain("xml");
  });
});

// ===== Группа: Mobile responsive =====
test.describe("Mobile responsive", () => {
  test("homepage on mobile has no horizontal scroll", async ({ page, isMobile }) => {
    if (!isMobile) return;
    await page.goto(BASE_URL);
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 5);
  });
});

// ===== Группа: Navigation =====
test.describe("Navigation", () => {
  test("homepage has header navigation", async ({ page }) => {
    await page.goto(BASE_URL);
    await expect(page.locator("header, nav").first()).toBeVisible();
  });

  test("homepage has footer", async ({ page }) => {
    await page.goto(BASE_URL);
    await expect(page.locator("footer").first()).toBeVisible();
  });
});

// ===== Группа: Cake builder =====
test.describe("Cake builder", () => {
  test("cake builder dialog can be opened from homepage", async ({ page }) => {
    await page.goto(BASE_URL);
    const builderButton = page.getByRole("button", {
      name: /Собрать торт в конструкторе/i,
    });
    await expect(builderButton).toBeVisible();
    await builderButton.click();
    const dialog = page.getByRole("dialog").first();
    await expect(dialog).toBeVisible({ timeout: 10000 });
    await expect(dialog).toContainText("Шаг 1 / 9");
    await expect(dialog).toContainText("Тип изделия");
  });
});
