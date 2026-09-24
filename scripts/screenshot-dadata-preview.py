"""Take screenshots of the DaData organization verification admin tab.

Flow:
1. Login as admin via API
2. Inject user into Zustand store (loginAs ADMIN)
3. Click "Проверка организаций" sidebar tab
4. Take screenshots:
   - Overview (stats cards + DaData status)
   - Filters + verification list
   - Full page
5. Trigger a manual verification (POST /api/organization/verify)
6. Take screenshot showing the new verification in the list
"""
import asyncio
import subprocess
import time
import os
from playwright.async_api import async_playwright

OUT_DIR = "/home/z/my-project/download"
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

        # Dismiss promo popups via store
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
        await page.wait_for_timeout(500)
        for _ in range(3):
            await page.keyboard.press("Escape")
            await page.wait_for_timeout(200)

        # 2. Login as admin via API
        print("[2] Logging in as admin...")
        login_resp = await page.request.post(
            "http://localhost:3000/api/auth/login",
            data={"email": "admin@demo.ru", "password": "admin123"},
            headers={"Content-Type": "application/json"},
        )
        if not login_resp.ok:
            print(f"  ⚠ Login failed: {login_resp.status}")
            return
        login_data = await login_resp.json()
        print(f"  ✓ Logged in as: {login_data['user']['email']}")

        # Store tokens in localStorage so the browser's fetch calls include auth
        await page.evaluate("""(data) => {
            localStorage.setItem('accessToken', data.accessToken);
            localStorage.setItem('refreshToken', data.refreshToken);
            // Intercept fetch to add Authorization header
            const originalFetch = window.fetch;
            window.fetch = function(url, options) {
                options = options || {};
                options.headers = options.headers || {};
                if (!options.headers.Authorization && !options.headers.authorization) {
                    const token = localStorage.getItem('accessToken');
                    if (token) {
                        options.headers.Authorization = 'Bearer ' + token;
                    }
                }
                return originalFetch.call(this, url, options);
            };
        }""", login_data)

        # 3. Navigate to admin dashboard via store
        print("[3] Navigating to admin dashboard...")
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
        await page.screenshot(path=f"{OUT_DIR}/dadata-01-admin-overview.png", full_page=False)
        print("  ✓ dadata-01-admin-overview.png")

        # 4. Trigger manual verifications FIRST (before opening the tab)
        # This way the tab will load with the verifications already in the DB
        print("[4] Triggering manual verifications via API...")
        token = login_data.get("accessToken")

        # Verify Сбербанк (valid INN, ACTIVE in real DaData)
        print("  → INN 7707083893 (Сбербанк)...")
        verify_resp = await page.request.post(
            "http://localhost:3000/api/organization/verify",
            data={"inn": "7707083893", "trigger": "ADMIN_MANUAL"},
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {token}",
            },
        )
        if verify_resp.ok:
            verify_data = await verify_resp.json()
            print(f"    ✓ status={verify_data.get('status')}, isAllowed={verify_data.get('isAllowed')}")

        # Verify invalid INN
        print("  → INN 1234567890 (invalid)...")
        bad_resp = await page.request.post(
            "http://localhost:3000/api/organization/verify",
            data={"inn": "1234567890", "trigger": "ADMIN_MANUAL"},
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {token}",
            },
        )
        if bad_resp.ok:
            bad_data = await bad_resp.json()
            print(f"    ✓ status={bad_data.get('status')}, isAllowed={bad_data.get('isAllowed')}")

        # Verify another valid INN (772381418917 — example)
        print("  → INN 7813250510 (another test)...")
        verify_resp2 = await page.request.post(
            "http://localhost:3000/api/organization/verify",
            data={"inn": "7813250510", "trigger": "ADMIN_MANUAL"},
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {token}",
            },
        )
        if verify_resp2.ok:
            print(f"    ✓ recorded")

        # 5. NOW click "Проверка организаций" sidebar tab (will load with data)
        print("[5] Clicking 'Проверка организаций' tab (with data)...")
        clicked = await page.evaluate("""() => {
            const els = Array.from(document.querySelectorAll('*'));
            const target = els.find(el => el.children.length === 0 && el.textContent === 'Проверка организаций');
            if (!target) return 'not found';
            target.click();
            return 'clicked';
        }""")
        print(f"  → {clicked}")
        await page.wait_for_timeout(4000)

        # 6. Take screenshot of the org verification tab with data
        print("[6] Taking screenshots of org verification tab (with data)...")
        await page.screenshot(path=f"{OUT_DIR}/dadata-02-org-verification.png", full_page=False)
        print("  ✓ dadata-02-org-verification.png")
        await page.screenshot(path=f"{OUT_DIR}/dadata-02-org-verification-full.png", full_page=True)
        print("  ✓ dadata-02-org-verification-full.png")

        # 7. Scroll down to see the verification list + cron info
        print("[7] Scrolling down to see list + cron info...")
        await page.evaluate("window.scrollTo(0, 500)")
        await page.wait_for_timeout(500)
        await page.screenshot(path=f"{OUT_DIR}/dadata-03-list-with-entries.png", full_page=False)
        print("  ✓ dadata-03-list-with-entries.png")

        # 8. Scroll further to see cron info
        await page.evaluate("window.scrollTo(0, 1000)")
        await page.wait_for_timeout(500)
        await page.screenshot(path=f"{OUT_DIR}/dadata-04-cron-info.png", full_page=False)
        print("  ✓ dadata-04-cron-info.png")

        # Print errors
        if errors:
            print("\n[Page errors during render]")
            for e in errors[:3]:
                print(f"  - {e[:200]}")

        await browser.close()
        print("\n✅ Done")


asyncio.run(main())
