import { expect, test } from "@playwright/test";

test.describe("SEO baseline", () => {
  test("robots.txt allows public pages and excludes private routes", async ({ request }) => {
    const response = await request.get("/robots.txt");
    expect(response.status()).toBe(200);

    const robots = await response.text();
    expect(robots).toContain("Sitemap:");
    expect(robots).toMatch(/Disallow:\s*\/api/);
    expect(robots).toMatch(/Disallow:\s*\/dashboard/);
    expect(robots).toMatch(/Disallow:\s*\/checkout/);
    expect(robots).toMatch(/Disallow:\s*\/admin/);
  });

  test("sitemap.xml contains public URLs and no mock/query-only records", async ({ request }) => {
    const response = await request.get("/sitemap.xml");
    expect(response.status()).toBe(200);

    const sitemap = await response.text();
    expect(sitemap).toContain("<urlset");
    expect(sitemap).toContain("/catalog");
    expect(sitemap).not.toContain("?id=");
    expect(sitemap).not.toMatch(/mock[-_]/i);
  });

  test("homepage renders title, description, canonical, Open Graph and structured data", async ({ page }) => {
    await page.goto("/");

    await expect(page).toHaveTitle(/Уездный кондитер|Cond[i]?tera/i);
    await expect(page.locator('meta[name="description"]')).toHaveAttribute("content", /.+/);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", /https?:\/\//);
    await expect(page.locator('meta[property="og:title"]')).toHaveAttribute("content", /.+/);
    await expect(page.locator('script[type="application/ld+json"]').first()).toBeAttached();
  });
});
