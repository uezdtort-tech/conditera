"""Comprehensive preview: screenshots of all key features of the project.

Captures ~15 screenshots covering:
1. Home page (hero + promotions + popular products + categories)
2. Catalog (with filters)
3. Product detail (with AR button)
4. Confectioner profile
5. Cart + Checkout
6. Customer dashboard (loyalty)
7. Admin: overview
8. Admin: n8n automation
9. Admin: organization verification (DaData)
10. Admin: antifraud
11. Admin: CMS banners
12. Customer: notifications preferences
13. Auth screen (with demo accounts)
14. Product with AR preview (3D model-viewer)
15. Mobile app preview
"""
import asyncio
import os
from playwright.async_api import async_playwright

OUT_DIR = "/home/z/my-project/download/preview"
os.makedirs(OUT_DIR, exist_ok=True)


async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(
            headless=True,
            args=[
                "--no-sandbox",
                "--disable-setuid-sandbox",
                "--disable-dev-shm-usage",
                "--disable-gpu",
                "--single-process",
                "--no-zygote",
            ],
        )
        context = await browser.new_context(
            viewport={"width": 1440, "height": 900},
            locale="ru-RU",
        )
        page = await context.new_page()

        errors = []
        page.on("pageerror", lambda exc: errors.append(str(exc)))

        # 1. Open homepage
        print("[1] Opening homepage...")
        await page.goto("http://localhost:3000/", wait_until="domcontentloaded", timeout=60000)
        await page.wait_for_timeout(5000)

        # Dismiss popups + set up fetch interceptor for auth
        await page.evaluate("""() => {
            if (window.useAppStore) {
                const s = window.useAppStore.getState();
                const allIds = (s.promotions || []).map(p => p.id);
                window.useAppStore.setState({
                    promoPopupDismissed: allIds,
                    promoPopupShown: false,
                    authModalOpen: false,
                });
            }
        }""")
        for _ in range(3):
            await page.keyboard.press("Escape")
            await page.wait_for_timeout(200)

        await page.screenshot(path=f"{OUT_DIR}/01-home.png", full_page=False)
        print("  ✓ 01-home.png")

        # 2. Login as admin via API + set up auth
        print("[2] Logging in as admin...")
        login_resp = await page.request.post(
            "http://localhost:3000/api/auth/login",
            data={"email": "admin@demo.ru", "password": "admin123"},
            headers={"Content-Type": "application/json"},
        )
        login_data = await login_resp.json() if login_resp.ok else {}
        print(f"  ✓ Logged in: {login_data.get('user', {}).get('email')}")

        await page.evaluate("""(data) => {
            if (data.accessToken) {
                localStorage.setItem('accessToken', data.accessToken);
                localStorage.setItem('refreshToken', data.refreshToken);
            }
            const originalFetch = window.fetch;
            window.fetch = function(url, options) {
                options = options || {};
                options.headers = options.headers || {};
                if (!options.headers.Authorization && !options.headers.authorization) {
                    const token = localStorage.getItem('accessToken');
                    if (token) options.headers.Authorization = 'Bearer ' + token;
                }
                return originalFetch.call(this, url, options);
            };
        }""", login_data)

        # 3. Catalog page
        print("[3] Catalog page...")
        await page.evaluate("""() => {
            if (window.useAppStore) window.useAppStore.getState().navigate('catalog');
        }""")
        await page.wait_for_timeout(4000)
        await page.screenshot(path=f"{OUT_DIR}/03-catalog.png", full_page=False)
        print("  ✓ 03-catalog.png")

        # 4. Product detail (with AR)
        print("[4] Product detail...")
        await page.evaluate("""() => {
            if (window.useAppStore) window.useAppStore.getState().navigate('product', { id: 'p0_wedding' });
        }""")
        await page.wait_for_timeout(4000)
        await page.screenshot(path=f"{OUT_DIR}/04-product-detail.png", full_page=False)
        print("  ✓ 04-product-detail.png (with AR)")

        # 5. Confectioner profile
        print("[5] Confectioner profile...")
        await page.evaluate("""() => {
            if (window.useAppStore) window.useAppStore.getState().navigate('confectioner-profile', { id: 'c0' });
        }""")
        await page.wait_for_timeout(4000)
        await page.screenshot(path=f"{OUT_DIR}/05-confectioner-profile.png", full_page=False)
        print("  ✓ 05-confectioner-profile.png")

        # 6. Switch to admin dashboard
        print("[6] Admin dashboard...")
        await page.evaluate("""() => {
            if (window.useAppStore) {
                window.useAppStore.getState().loginAs('ADMIN');
                const s = window.useAppStore.getState();
                const allIds = (s.promotions || []).map(p => p.id);
                window.useAppStore.setState({
                    promoPopupDismissed: allIds,
                    promoPopupShown: false,
                    authModalOpen: false,
                });
            }
        }""")
        await page.wait_for_timeout(3000)
        await page.screenshot(path=f"{OUT_DIR}/06-admin-overview.png", full_page=False)
        print("  ✓ 06-admin-overview.png")

        # 7. Admin: n8n Automation
        print("[7] Admin: n8n Automation...")
        await page.evaluate("""() => {
            const els = Array.from(document.querySelectorAll('*'));
            const target = els.find(el => el.children.length === 0 && el.textContent === 'Автоматизация (n8n)');
            if (target) target.click();
        }""")
        await page.wait_for_timeout(4000)
        await page.screenshot(path=f"{OUT_DIR}/07-n8n-automation.png", full_page=False)
        print("  ✓ 07-n8n-automation.png")

        # Click "Детали" on first workflow to show the graph
        print("[7b] n8n workflow detail graph...")
        try:
            details_btn = page.locator('button:has-text("Детали")').first
            if await details_btn.count() > 0:
                await details_btn.scroll_into_view_if_needed(timeout=2000)
                await details_btn.click(timeout=5000)
                await page.wait_for_timeout(3000)
                await page.screenshot(path=f"{OUT_DIR}/07b-n8n-workflow-graph.png", full_page=False)
                print("  ✓ 07b-n8n-workflow-graph.png")
                await page.keyboard.press("Escape")
                await page.wait_for_timeout(500)
        except Exception as e:
            print(f"  ⚠ {e}")

        # 8. Admin: Organization verification (DaData)
        print("[8] Admin: Organization verification (DaData)...")
        await page.evaluate("""() => {
            const els = Array.from(document.querySelectorAll('*'));
            const target = els.find(el => el.children.length === 0 && el.textContent === 'Проверка организаций');
            if (target) target.click();
        }""")
        await page.wait_for_timeout(4000)
        await page.screenshot(path=f"{OUT_DIR}/08-dadata-verification.png", full_page=False)
        print("  ✓ 08-dadata-verification.png")

        # 9. Switch to customer dashboard
        print("[9] Customer dashboard (loyalty)...")
        await page.evaluate("""() => {
            if (window.useAppStore) window.useAppStore.getState().loginAs('CUSTOMER');
        }""")
        await page.wait_for_timeout(3000)

        # Click Loyalty tab
        await page.evaluate("""() => {
            const els = Array.from(document.querySelectorAll('*'));
            const target = els.find(el => el.children.length === 0 && el.textContent === 'Лояльность');
            if (target) target.click();
        }""")
        await page.wait_for_timeout(3000)
        await page.screenshot(path=f"{OUT_DIR}/09-customer-loyalty.png", full_page=False)
        print("  ✓ 09-customer-loyalty.png")

        # 10. Customer: Notifications preferences
        print("[10] Customer: Notification preferences...")
        await page.evaluate("""() => {
            const els = Array.from(document.querySelectorAll('*'));
            const target = els.find(el => el.children.length === 0 && el.textContent === 'Уведомления');
            if (target) target.click();
        }""")
        await page.wait_for_timeout(3000)
        await page.screenshot(path=f"{OUT_DIR}/10-notifications.png", full_page=False)
        print("  ✓ 10-notifications.png")

        # 11. Switch to confectioner dashboard
        print("[11] Confectioner dashboard...")
        await page.evaluate("""() => {
            if (window.useAppStore) window.useAppStore.getState().loginAs('CONFECTIONER');
        }""")
        await page.wait_for_timeout(3000)
        await page.screenshot(path=f"{OUT_DIR}/11-confectioner-dashboard.png", full_page=False)
        print("  ✓ 11-confectioner-dashboard.png")

        # 12. Mobile preview (iPhone viewport)
        print("[12] Mobile preview (iPhone)...")
        await page.set_viewport_size({"width": 390, "height": 844})
        await page.evaluate("""() => {
            if (window.useAppStore) window.useAppStore.getState().loginAs('CUSTOMER');
        }""")
        await page.wait_for_timeout(3000)
        await page.screenshot(path=f"{OUT_DIR}/12-mobile-customer.png", full_page=False)
        print("  ✓ 12-mobile-customer.png")

        # Reset viewport
        await page.set_viewport_size({"width": 1440, "height": 900})

        # Print errors
        if errors:
            print(f"\n[Page errors: {len(errors)}]")
            for e in errors[:3]:
                print(f"  - {e[:200]}")

        await browser.close()
        print(f"\n✅ Done — {len(os.listdir(OUT_DIR))} screenshots saved to {OUT_DIR}")


asyncio.run(main())
