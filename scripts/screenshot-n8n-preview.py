"""Take screenshots of the n8n automation dashboard preview.

Improved version: handles the promo popup that intercepts clicks.
"""
import asyncio
from playwright.async_api import async_playwright
import os

OUT_DIR = "/home/z/my-project/download"
os.makedirs(OUT_DIR, exist_ok=True)


async def dismiss_dialogs(page):
    """Dismiss any modal dialogs that might intercept clicks."""
    # Try to dismiss via the Zustand store directly (most reliable)
    try:
        await page.evaluate(
            """() => {
                if (window.useAppStore) {
                    const s = window.useAppStore.getState();
                    s.setAuthModalOpen(false);
                    // Dismiss promo popup
                    if (s.promoPopupShown) {
                        s.setShowPromoPopup ? s.setShowPromoPopup(false) : null;
                        // Use the raw setter if available
                        window.useAppStore.setState({ promoPopupShown: false, authModalOpen: false });
                    }
                }
            }"""
        )
    except Exception:
        pass

    # Press Escape a few times
    for _ in range(3):
        await page.keyboard.press("Escape")
        await page.wait_for_timeout(200)

    # Try clicking any visible "Close" / "X" buttons inside dialogs
    close_selectors = [
        '[data-state="open"] button[type="button"][aria-label="Close"]',
        '[data-state="open"] [data-slot="dialog-close"]',
        'button:has(svg.lucide-x)',
        '[role="dialog"] button:has-text("Close")',
        '[role="dialog"] button:has-text("Позже")',
        '[role="dialog"] button:has-text("Закрыть")',
        # Promo popup close button (radix dialog)
        '[role="dialog"] button[class*="absolute"][class*="right"]',
        '[role="dialog"] > button',
    ]
    for sel in close_selectors:
        try:
            btns = page.locator(sel)
            count = await btns.count()
            for i in range(count):
                try:
                    btn = btns.nth(i)
                    if await btn.is_visible():
                        await btn.click(timeout=2000, force=True)
                        await page.wait_for_timeout(300)
                except Exception:
                    pass
        except Exception:
            pass

    # Force-hide any open dialog overlays via DOM
    try:
        await page.evaluate(
            """() => {
                // Remove promo popup overlays
                document.querySelectorAll('[data-slot="dialog-overlay"]').forEach(el => {
                    el.style.display = 'none';
                });
                // Hide promo popups (the ones with promo content) but keep the workflow detail dialog
                document.querySelectorAll('[role="dialog"]').forEach(el => {
                    if (el.textContent && el.textContent.includes('EARLY14')) {
                        el.style.display = 'none';
                        if (el.parentElement) el.parentElement.style.display = 'none';
                    }
                });
            }"""
        )
    except Exception:
        pass


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
            viewport={"width": 1280, "height": 800},
            locale="ru-RU",
        )
        page = await context.new_page()

        # 1. Open homepage
        print("[1] Opening homepage...")
        await page.goto("http://localhost:3000/", wait_until="domcontentloaded", timeout=60000)
        await page.wait_for_timeout(3000)

        # Pre-emptively disable the promo popup via Zustand store
        try:
            await page.evaluate(
                """() => {
                    if (window.useAppStore) {
                        const s = window.useAppStore.getState();
                        // Dismiss ALL promotions from the popup
                        const allIds = (s.promotions || []).map(p => p.id);
                        window.useAppStore.setState({
                            promoPopupDismissed: allIds,
                            promoPopupShown: false,
                            authModalOpen: false,
                        });
                    }
                }"""
            )
        except Exception:
            pass

        # Dismiss any popups
        await dismiss_dialogs(page)

        await page.screenshot(path=f"{OUT_DIR}/n8n-01-home.png", full_page=False)
        print("  → n8n-01-home.png")

        # 2. Login as admin via API (set localStorage tokens)
        print("[2] Logging in as admin...")
        login_resp = await page.request.post(
            "http://localhost:3000/api/auth/login",
            data={"email": "admin@demo.ru", "password": "admin123"},
            headers={"Content-Type": "application/json"},
        )
        if login_resp.ok:
            body = await login_resp.json()
            print(f"  → login OK, user: {body.get('user', {}).get('email')}")
            # Set tokens in localStorage so the app sees us logged in
            await page.evaluate(
                """(data) => {
                    localStorage.setItem('accessToken', data.accessToken);
                    localStorage.setItem('refreshToken', data.refreshToken);
                    localStorage.setItem('user', JSON.stringify(data.user));
                }""",
                body,
            )
            # Reload page so the app picks up the auth state
            await page.goto("http://localhost:3000/", wait_until="domcontentloaded")
            await page.wait_for_timeout(3000)
            await dismiss_dialogs(page)
        else:
            print(f"  ⚠ Login failed: {login_resp.status}")
            text = await login_resp.text()
            print(f"  → {text[:200]}")

        await page.screenshot(path=f"{OUT_DIR}/n8n-02-after-login.png", full_page=False)
        print("  → n8n-02-after-login.png")

        # 3. Navigate to admin dashboard via Zustand store
        # The store is exposed on window.useAppStore (dev only)
        print("[3] Navigating to admin dashboard via window.useAppStore.loginAs('ADMIN')...")
        result = await page.evaluate(
            """() => {
                if (window.useAppStore) {
                    const s = window.useAppStore.getState();
                    s.loginAs('ADMIN');
                    // Also dismiss all popups again
                    const allIds = (s.promotions || []).map(p => p.id);
                    window.useAppStore.setState({
                        promoPopupDismissed: allIds,
                        promoPopupShown: false,
                        authModalOpen: false,
                    });
                    return 'loginAs called';
                }
                return 'useAppStore not on window';
            }"""
        )
        print(f"  → {result}")
        await page.wait_for_timeout(3000)
        await dismiss_dialogs(page)

        await page.screenshot(path=f"{OUT_DIR}/n8n-03-admin-overview.png", full_page=False)
        print("  → n8n-03-admin-overview.png")

        # 4. Click "Автоматизация (n8n)" sidebar tab
        print("[4] Clicking 'Автоматизация (n8n)' tab...")
        await dismiss_dialogs(page)
        clicked = False
        for sel in [
            'button:has-text("Автоматизация")',
            'div:has-text("Автоматизация (n8n)")',
            '[role="button"]:has-text("Автоматизация")',
        ]:
            try:
                el = page.locator(sel).first
                if await el.count() > 0:
                    await el.click(timeout=5000, force=True)
                    clicked = True
                    break
            except Exception:
                pass

        if not clicked:
            print("  ⚠ Could not click automation tab via selectors")
            await page.evaluate(
                """() => {
                    const els = document.querySelectorAll('*');
                    for (const el of els) {
                        if (el.children.length === 0 && el.textContent === 'Автоматизация (n8n)') {
                            el.click();
                            if (el.parentElement) el.parentElement.click();
                            return true;
                        }
                    }
                    return false;
                }"""
            )

        await page.wait_for_timeout(4000)
        await dismiss_dialogs(page)
        await page.screenshot(path=f"{OUT_DIR}/n8n-04-automation-overview.png", full_page=False)
        print("  → n8n-04-automation-overview.png")
        await page.screenshot(path=f"{OUT_DIR}/n8n-04-automation-overview-full.png", full_page=True)
        print("  → n8n-04-automation-overview-full.png")

        # 5. Click "Детали" on first workflow
        print("[5] Clicking 'Детали' on first workflow...")
        # NOTE: Do NOT call dismiss_dialogs here — it would close the workflow dialog we're about to open
        # Only dismiss the promo popup (which is identified by EARLY14 content)
        try:
            await page.evaluate(
                """() => {
                    document.querySelectorAll('[role="dialog"]').forEach(el => {
                        if (el.textContent && el.textContent.includes('EARLY14')) {
                            el.style.display = 'none';
                            if (el.parentElement) el.parentElement.style.display = 'none';
                        }
                    });
                    document.querySelectorAll('[data-slot="dialog-overlay"]').forEach(el => {
                        // Only hide if the corresponding dialog is a promo
                        if (el.nextElementSibling && el.nextElementSibling.textContent && el.nextElementSibling.textContent.includes('EARLY14')) {
                            el.style.display = 'none';
                        }
                    });
                }"""
            )
        except Exception:
            pass

        # Scroll to the workflow cards section
        await page.evaluate("window.scrollTo(0, 0)")
        await page.wait_for_timeout(800)
        try:
            details_btn = page.locator('button:has-text("Детали")').first
            count = await details_btn.count()
            print(f"  → found {count} Детали button(s)")
            if count > 0:
                await details_btn.scroll_into_view_if_needed(timeout=3000)
                await page.wait_for_timeout(300)
                try:
                    await details_btn.click(timeout=5000)
                except Exception:
                    await details_btn.evaluate("el => el.click()")
                await page.wait_for_timeout(3500)
                print("  → clicked Детали")
                # Check if dialog is open
                dialog_count = await page.locator('[role="dialog"]').count()
                print(f"  → dialogs open: {dialog_count}")
            else:
                print("  ⚠ No Детали button found")
        except Exception as e:
            print(f"  ⚠ {e}")

        # Don't dismiss — take screenshot with dialog open
        await page.screenshot(path=f"{OUT_DIR}/n8n-05-workflow-detail.png", full_page=False)
        print("  → n8n-05-workflow-detail.png")
        await page.screenshot(path=f"{OUT_DIR}/n8n-05-workflow-detail-full.png", full_page=True)
        print("  → n8n-05-workflow-detail-full.png")

        # 6. Close dialog
        await page.keyboard.press("Escape")
        await page.wait_for_timeout(1000)

        # 7. Click "Симулировать" on first workflow
        print("[6] Clicking 'Симулировать' on first workflow...")
        try:
            sim_btn = page.locator('button:has-text("Симулировать")').first
            if await sim_btn.count() > 0:
                await sim_btn.click(timeout=5000)
                await page.wait_for_timeout(2500)
        except Exception as e:
            print(f"  ⚠ {e}")

        await page.screenshot(path=f"{OUT_DIR}/n8n-06-simulation-result.png", full_page=True)
        print("  → n8n-06-simulation-result.png")

        # 8. Click "Симулировать" on second workflow too
        try:
            sim_btns = page.locator('button:has-text("Симулировать")')
            count = await sim_btns.count()
            if count >= 2:
                await sim_btns.nth(1).click(timeout=5000)
                await page.wait_for_timeout(2500)
        except Exception as e:
            print(f"  ⚠ {e}")

        await page.screenshot(path=f"{OUT_DIR}/n8n-07-all-simulated.png", full_page=True)
        print("  → n8n-07-all-simulated.png")

        await browser.close()
        print("\n✅ All screenshots captured")


asyncio.run(main())
