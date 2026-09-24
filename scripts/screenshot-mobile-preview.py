"""Run both backend (Next.js) + mobile preview server + Playwright screenshots.

Strategy:
1. Start Next.js backend on port 3000 (timeout wrapper to keep alive)
2. Start python http.server for mobile static export on port 8082
3. Wait, run Playwright to capture screenshots
4. Cleanup both servers
"""
import asyncio
import subprocess
import time
import os
import signal
from playwright.async_api import async_playwright

OUT_DIR = "/home/z/my-project/download"
os.makedirs(OUT_DIR, exist_ok=True)

VIEWPORT = {"width": 390, "height": 844}
USER_AGENT = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"


async def main():
    # Start Next.js backend on port 3000 (with timeout wrapper to keep alive)
    print("[setup] Starting Next.js backend on port 3000...")
    backend = subprocess.Popen(
        ["timeout", "900", "node", "/home/z/my-project/node_modules/.bin/next", "dev", "-H", "0.0.0.0", "-p", "3000"],
        cwd="/home/z/my-project",
        stdout=open("/tmp/dev.log", "w"),
        stderr=subprocess.STDOUT,
        start_new_session=True,
    )
    print(f"[setup] Backend PID: {backend.pid}")

    # Wait for backend to start
    print("[setup] Waiting for backend...")
    import urllib.request
    for i in range(30):
        try:
            urllib.request.urlopen("http://localhost:3000/", timeout=3)
            print(f"[setup] Backend ready after {i+1}s")
            break
        except Exception:
            time.sleep(2)
    else:
        print("[setup] ⚠ Backend did not start")

    # Start mobile static server on port 8082
    print("[setup] Starting mobile static server on port 8082...")
    mobile_server = subprocess.Popen(
        ["python3", "-m", "http.server", "8082", "--directory", "/tmp/mobile-export"],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        start_new_session=True,
    )
    time.sleep(2)
    print(f"[setup] Mobile server PID: {mobile_server.pid}")

    try:
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
                viewport=VIEWPORT,
                user_agent=USER_AGENT,
                device_scale_factor=2,
                is_mobile=True,
                has_touch=True,
                locale="ru-RU",
            )
            page = await context.new_page()

            print("\n[1] Opening mobile app home...")
            await page.goto("http://127.0.0.1:8082", wait_until="domcontentloaded", timeout=60000)
            await page.wait_for_timeout(8000)
            await page.screenshot(path=f"{OUT_DIR}/mobile-01-home.png", full_page=False)
            print("  ✓ mobile-01-home.png")

            # 2. Profile (guest)
            print("\n[2] Going to Profile tab (guest)...")
            profile_tab = page.get_by_text("Профиль", exact=True)
            if await profile_tab.count() > 0:
                try:
                    await profile_tab.first.click(timeout=5000)
                    await page.wait_for_timeout(2000)
                except Exception:
                    pass
            await page.screenshot(path=f"{OUT_DIR}/mobile-02-profile-guest.png", full_page=False)
            print("  ✓ mobile-02-profile-guest.png")

            # 3. Click Войти → Auth screen
            print("\n[3] Going to Auth screen...")
            login_btn = page.get_by_text("Войти")
            if await login_btn.count() > 0:
                try:
                    await login_btn.first.click(timeout=5000)
                    await page.wait_for_timeout(2000)
                except Exception:
                    pass
            await page.screenshot(path=f"{OUT_DIR}/mobile-03-auth.png", full_page=False)
            print("  ✓ mobile-03-auth.png")

            # 4. Fill the form & submit
            print("\n[4] Filling login form + submitting...")
            try:
                email_input = page.locator('input[type="email"], input[placeholder="Email"]')
                if await email_input.count() > 0:
                    await email_input.first.fill("customer@demo.ru")
                pwd_input = page.locator('input[type="password"]')
                if await pwd_input.count() > 0:
                    await pwd_input.first.fill("demo123")
                await page.screenshot(path=f"{OUT_DIR}/mobile-04-auth-filled.png", full_page=False)
                print("  ✓ mobile-04-auth-filled.png")

                # Click submit button (the second "Войти" inside the modal)
                submit_btns = page.get_by_text("Войти")
                count = await submit_btns.count()
                if count > 1:
                    await submit_btns.nth(count - 1).click(timeout=5000)
                elif count > 0:
                    await submit_btns.first.click(timeout=5000)
                await page.wait_for_timeout(4000)
            except Exception as e:
                print(f"  ⚠ {e}")

            # 5. Profile (logged in) — inject user via store + navigate via store
            print("\n[5] Injecting user via store...")
            try:
                result = await page.evaluate("""() => {
                    if (window.useAppStore) {
                        window.useAppStore.setState({
                            user: {
                                id: 'cust_demo_1',
                                email: 'customer@demo.ru',
                                name: 'Анна Соколова',
                                phone: '+7 916 123-45-67',
                                avatar: 'https://i.pravatar.cc/200?img=47',
                                roles: ['CUSTOMER'],
                                city: 'Москва',
                                loyaltyLevel: 'GOLD',
                                bonusBalance: 1240,
                            },
                            isAuthenticated: true,
                            authModalOpen: false,
                        });
                        return 'user set: ' + window.useAppStore.getState().user.name;
                    }
                    return 'useAppStore not on window';
                }""")
                print(f"  → {result}")
            except Exception as e:
                print(f"  ⚠ {e}")

            await page.wait_for_timeout(2500)

            # Force-close any open modal by pressing Escape multiple times
            for _ in range(5):
                await page.keyboard.press("Escape")
                await page.wait_for_timeout(200)

            # Click Профиль tab via JS — click the SPAN directly (not parent)
            try:
                clicked = await page.evaluate("""() => {
                    const els = Array.from(document.querySelectorAll('*'));
                    const profileEls = els.filter(el => el.children.length === 0 && el.textContent === 'Профиль');
                    if (profileEls.length === 0) return 'no profile element';
                    // Click the first visible one (it's a SPAN inside the tab link)
                    for (const el of profileEls) {
                        if (el.offsetParent !== null) {
                            el.click();
                            return 'clicked span: visible';
                        }
                    }
                    return 'no visible profile element';
                }""")
                print(f"  → {clicked}")
            except Exception as e:
                print(f"  ⚠ {e}")

            await page.wait_for_timeout(3000)
            await page.screenshot(path=f"{OUT_DIR}/mobile-05-profile-logged-in.png", full_page=False)
            print("  ✓ mobile-05-profile-logged-in.png")

            # 6. Scroll profile down
            print("\n[6] Scrolling profile menu...")
            await page.evaluate("window.scrollTo(0, 400)")
            await page.wait_for_timeout(800)
            await page.screenshot(path=f"{OUT_DIR}/mobile-06-profile-menu.png", full_page=False)
            print("  ✓ mobile-06-profile-menu.png")

            # 7. Try to click Чаты с кондитерами via JS
            print("\n[7] Looking for Чаты menu item (via JS)...")
            try:
                clicked = await page.evaluate("""() => {
                    const els = Array.from(document.querySelectorAll('*'));
                    const target = els.find(el => el.children.length === 0 && el.textContent === 'Чаты с кондитерами');
                    if (!target) return 'not found';
                    target.click();
                    return 'clicked';
                }""")
                print(f"  → {clicked}")
                if clicked == 'clicked':
                    await page.wait_for_timeout(3000)
                    await page.screenshot(path=f"{OUT_DIR}/mobile-07-chat-list.png", full_page=False)
                    print("  ✓ mobile-07-chat-list.png (chat list)")

                    # Click on first chat room — try Сладкая уездная first
                    clicked2 = await page.evaluate("""() => {
                        const els = Array.from(document.querySelectorAll('*'));
                        const target = els.find(el => el.children.length === 0 && el.textContent === 'Сладкая уездная');
                        if (!target) return 'not found';
                        target.click();
                        return 'clicked: ' + target.textContent;
                    }""")
                    print(f"  → {clicked2}")
                    await page.wait_for_timeout(3000)
                    await page.screenshot(path=f"{OUT_DIR}/mobile-08-chat-detail.png", full_page=False)
                    print("  ✓ mobile-08-chat-detail.png (chat detail with mic button)")
            except Exception as e:
                print(f"  ⚠ {e}")

            # 8. Try Nearby confectioners
            print("\n[8] Going back, looking for Кондитеры рядом...")
            for _ in range(3):
                await page.keyboard.press("Escape")
                await page.wait_for_timeout(300)

            # Click Профиль tab to reset
            try:
                profile_tab = page.get_by_text("Профиль", exact=True)
                if await profile_tab.count() > 0:
                    await profile_tab.first.click(timeout=3000)
                    await page.wait_for_timeout(1500)
                    await page.evaluate("window.scrollTo(0, 400)")
                    await page.wait_for_timeout(500)
            except Exception:
                pass

            try:
                nearby_menu = page.get_by_text("Кондитеры рядом")
                if await nearby_menu.count() > 0:
                    await nearby_menu.first.click(timeout=5000)
                    await page.wait_for_timeout(4000)
                    await page.screenshot(path=f"{OUT_DIR}/mobile-09-nearby-list.png", full_page=False)
                    print("  ✓ mobile-09-nearby-list.png")
                else:
                    print("  ⚠ Кондитеры рядом not found")
            except Exception as e:
                print(f"  ⚠ {e}")

            # 9. Try clicking on Home, then quick action "Рядом со мной"
            print("\n[9] Going to Home, clicking Рядом со мной quick action...")
            try:
                home_tab = page.get_by_text("Главная", exact=True)
                if await home_tab.count() > 0:
                    await home_tab.first.click(timeout=3000)
                    await page.wait_for_timeout(2000)
                    # Look for "Рядом со мной" quick action
                    nearby_quick = page.get_by_text("Рядом со мной")
                    if await nearby_quick.count() > 0:
                        await nearby_quick.first.click(timeout=5000)
                        await page.wait_for_timeout(4000)
                        await page.screenshot(path=f"{OUT_DIR}/mobile-10-nearby-from-home.png", full_page=False)
                        print("  ✓ mobile-10-nearby-from-home.png")
            except Exception as e:
                print(f"  ⚠ {e}")

            # 10. Catalog
            print("\n[10] Going to Catalog tab...")
            try:
                catalog_tab = page.get_by_text("Каталог", exact=True)
                if await catalog_tab.count() > 0:
                    await catalog_tab.first.click(timeout=3000)
                    await page.wait_for_timeout(3000)
                    await page.screenshot(path=f"{OUT_DIR}/mobile-11-catalog.png", full_page=False)
                    print("  ✓ mobile-11-catalog.png")
            except Exception as e:
                print(f"  ⚠ {e}")

            await browser.close()
            print("\n✅ Done")
    finally:
        # Cleanup
        print("\n[cleanup] Stopping servers...")
        try:
            os.killpg(os.getpgid(backend.pid), signal.SIGTERM)
        except Exception:
            pass
        try:
            os.killpg(os.getpgid(mobile_server.pid), signal.SIGTERM)
        except Exception:
            pass
        time.sleep(2)


asyncio.run(main())
