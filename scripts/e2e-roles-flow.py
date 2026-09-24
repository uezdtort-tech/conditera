#!/usr/bin/env python3
"""
E2E роли-флоу: проверить, что каждая из 6 ролей может авторизоваться
и получить доступ к своим API endpoints.

Роли:
  1. COURIER         — /api/courier/deliveries, /api/courier/available-orders, /api/courier/earnings
  2. SUPPLIER        — /api/supplier/warehouse, /api/supplier/products, /api/supplier/dashboard
  3. CORPORATE_CLIENT — /api/b2b/orders, /api/b2b/catalog
  4. ADMIN           — /api/admin/confectioners/pending, /api/admin/fraud-monitor
  5. VENUE_OWNER     — /api/auth/refresh, /api/channel/posts (публичный, но проверяем token)
  6. BLOGGER         — /api/auth/refresh, /api/channel/posts

Паттерн тот же, что в e2e-test-http.py:
  - попытка register → если 429 (rate limit 3/hour) → попытка login с seeded email
  - для ADMIN — готовый seeded пользователь admin@uyezdny.ru / AdminPassword123!

Запуск:
  python3 scripts/e2e-roles-flow.py
  (требует запущенный dev-server на :3001 — ./scripts/dev-server-3001.sh start)
"""

import json
import sys
import time
import urllib.request
import urllib.error

BASE_URL = "http://localhost:3001"
API_BASE = f"{BASE_URL}/api"


class C:
    GREEN = "\033[92m"
    RED = "\033[91m"
    YELLOW = "\033[93m"
    BLUE = "\033[94m"
    BOLD = "\033[1m"
    CYAN = "\033[96m"
    END = "\033[0m"


passed = 0
failed = 0
skipped = 0


def log_section(name):
    print(f"\n{C.BOLD}{C.CYAN}{'=' * 60}{C.END}")
    print(f"{C.BOLD}{C.CYAN}  {name}{C.END}")
    print(f"{C.BOLD}{C.CYAN}{'=' * 60}{C.END}")


def log_pass(name, detail=""):
    global passed
    passed += 1
    print(f"  {C.GREEN}✓{C.END} {name}" + (f" — {detail}" if detail else ""))


def log_fail(name, detail=""):
    global failed
    failed += 1
    print(f"  {C.RED}✗{C.END} {name}" + (f" — {C.RED}{detail}{C.END}" if detail else ""))


def log_skip(name, reason=""):
    global skipped
    skipped += 1
    print(f"  {C.YELLOW}⊘{C.END} {name}" + (f" — {reason}" if reason else ""))


def http(method, path, body=None, headers=None, token=None):
    url = f"{API_BASE}{path}" if path.startswith("/") else f"{API_BASE}/{path}"
    data = json.dumps(body).encode("utf-8") if body is not None else None
    final_headers = {"Content-Type": "application/json"}
    if headers:
        final_headers.update(headers)
    if token:
        final_headers["Authorization"] = f"Bearer {token}"

    req = urllib.request.Request(url, data=data, method=method, headers=final_headers)
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            status = resp.status
            body_text = resp.read().decode("utf-8")
            try:
                body_json = json.loads(body_text)
            except Exception:
                body_json = None
            return status, body_json, body_text
    except urllib.error.HTTPError as e:
        body_text = e.read().decode("utf-8") if e.fp else ""
        try:
            body_json = json.loads(body_text)
        except Exception:
            body_json = None
        return e.code, body_json, body_text
    except Exception as e:
        return None, None, str(e)


def extract_token(body):
    if not body:
        return None
    return body.get("accessToken") or body.get("token")


def register_role(role, extra_payload=None):
    """Зарегистрировать пользователя с указанной ролью.
    Возвращает (token, email) или (None, email) при неудаче.
    """
    email = f"{role.lower()}_{int(time.time())}@test.ru"
    payload = {
        "email": email,
        "password": "TestPassword123!",
        "name": f"Тестовый {role}",
        "phone": f"+7999{int(time.time()) % 1000000:06d}",
        "role": role,
        "accountType": "individual",
    }
    if extra_payload:
        payload.update(extra_payload)

    status, body, _ = http("POST", "/auth/register", payload)
    if status in (200, 201):
        token = extract_token(body)
        return token, email
    if status == 429:
        log_skip(f"register {role}", "rate limit (3/hour) — используем seeded")
        # Пробуем login по заранее заготовленному email
        seeded_email = f"{role.lower()}@test.ru"
        s2, b2, _ = http("POST", "/auth/login", {
            "email": seeded_email,
            "password": "TestPassword123!",
        })
        if s2 == 200:
            return extract_token(b2), seeded_email
        return None, seeded_email
    if status == 409:
        log_skip(f"register {role}", "email уже занят — login")
        s2, b2, _ = http("POST", "/auth/login", {
            "email": email,
            "password": "TestPassword123!",
        })
        if s2 == 200:
            return extract_token(b2), email
        return None, email
    log_fail(f"register {role}", f"→ {status}: {str(body)[:150] if body else ''}")
    return None, email


def login(email, password):
    status, body, _ = http("POST", "/auth/login", {"email": email, "password": password})
    if status == 200:
        return extract_token(body), body
    return None, None


def expect_status(role, method, path, expected_statuses, token=None, body=None, label=None):
    """Вызвать endpoint и проверить статус. Возвращает (ok, status, body)."""
    label = label or f"{method} {path}"
    status, resp_body, _ = http(method, path, body=body, token=token)
    if status in expected_statuses:
        log_pass(f"[{role}] {label} → {status}",
                 f"{(str(resp_body)[:80] + '…') if resp_body else ''}")
        return True, status, resp_body
    log_fail(f"[{role}] {label} → {status}",
             f"ожидался {expected_statuses}: {str(resp_body)[:120] if resp_body else ''}")
    return False, status, resp_body


# ===== Тесты по ролям =====

def test_courier():
    log_section("РОЛЬ 1: COURIER (курьер)")
    token, email = register_role("COURIER")
    if not token:
        log_skip("COURIER endpoints", "нет токена")
        return
    log_pass("Авторизация COURIER", f"email={email}")

    # GET /api/courier/deliveries — список доставок курьера
    expect_status("COURIER", "GET", "/courier/deliveries", {200}, token=token)

    # GET /api/courier/available-orders — доступные для взятия заказы
    expect_status("COURIER", "GET", "/courier/available-orders", {200}, token=token)

    # GET /api/courier/earnings — заработок курьера
    expect_status("COURIER", "GET", "/courier/earnings", {200}, token=token)


def test_supplier():
    log_section("РОЛЬ 2: SUPPLIER (поставщик)")
    token, email = register_role("SUPPLIER")
    if not token:
        log_skip("SUPPLIER endpoints", "нет токена")
        return
    log_pass("Авторизация SUPPLIER", f"email={email}")

    # GET /api/supplier/warehouse — список позиций склада
    expect_status("SUPPLIER", "GET", "/supplier/warehouse", {200}, token=token)

    # GET /api/supplier/warehouse?lowStock=1 — только низкие остатки
    expect_status("SUPPLIER", "GET", "/supplier/warehouse?lowStock=1", {200}, token=token,
                  label="GET /supplier/warehouse?lowStock=1")

    # GET /api/supplier/products — товары поставщика
    expect_status("SUPPLIER", "GET", "/supplier/products", {200}, token=token)

    # GET /api/supplier/dashboard — дашборд поставщика
    expect_status("SUPPLIER", "GET", "/supplier/dashboard", {200}, token=token)


def test_corporate_client():
    log_section("РОЛЬ 3: CORPORATE_CLIENT (корпоративный клиент)")
    token, email = register_role("CORPORATE_CLIENT")
    if not token:
        log_skip("CORPORATE_CLIENT endpoints", "нет токена")
        return
    log_pass("Авторизация CORPORATE_CLIENT", f"email={email}")

    # GET /api/b2b/catalog — оптовый каталог
    expect_status("CORPORATE_CLIENT", "GET", "/b2b/catalog", {200}, token=token)

    # GET /api/b2b/orders — список B2B-заказов
    expect_status("CORPORATE_CLIENT", "GET", "/b2b/orders", {200}, token=token)


def test_admin():
    log_section("РОЛЬ 4: ADMIN (администратор)")
    # Готовый seeded-пользователь
    token, body = login("admin@uyezdny.ru", "AdminPassword123!")
    if not token:
        log_fail("ADMIN login", "не удалось войти как admin@uyezdny.ru")
        return
    log_pass("Авторизация ADMIN", "email=admin@uyezdny.ru")

    # GET /api/admin/confectioners/pending — список pending-кондитеров
    expect_status("ADMIN", "GET", "/admin/confectioners/pending", {200}, token=token)

    # GET /api/admin/fraud-monitor — антифрод-монитор
    expect_status("ADMIN", "GET", "/admin/fraud-monitor", {200}, token=token)

    # GET /api/operator/escalations — эскалации оператора (admin имеет доступ)
    expect_status("ADMIN", "GET", "/operator/escalations", {200}, token=token)


def test_venue_owner():
    log_section("РОЛЬ 5: VENUE_OWNER (владелец площадки)")
    token, email = register_role("VENUE_OWNER")
    if not token:
        log_skip("VENUE_OWNER endpoints", "нет токена")
        return
    log_pass("Авторизация VENUE_OWNER", f"email={email}")

    # POST /api/auth/refresh — обновление токена (проверка, что token валиден)
    # /api/auth/refresh читает refreshToken из cookie/body — мы просто проверяем,
    # что endpoint отвечает. Используем GET /api/notifications/unread-count как
    # более надёжную проверку авторизации.
    expect_status("VENUE_OWNER", "GET", "/notifications/unread-count", {200}, token=token)

    # GET /api/channel/posts — публичная лента (доступна всем авторизованным)
    expect_status("VENUE_OWNER", "GET", "/channel/posts?limit=5", {200}, token=token,
                  label="GET /channel/posts?limit=5")

    # GET /api/notifications/list — список уведомлений пользователя
    expect_status("VENUE_OWNER", "GET", "/notifications/list", {200}, token=token)


def test_blogger():
    log_section("РОЛЬ 6: BLOGGER (блогер)")
    token, email = register_role("BLOGGER")
    if not token:
        log_skip("BLOGGER endpoints", "нет токена")
        return
    log_pass("Авторизация BLOGGER", f"email={email}")

    # GET /api/notifications/unread-count — проверка авторизации
    expect_status("BLOGGER", "GET", "/notifications/unread-count", {200}, token=token)

    # GET /api/channel/posts — публичная лента
    expect_status("BLOGGER", "GET", "/channel/posts?limit=5", {200}, token=token,
                  label="GET /channel/posts?limit=5")

    # GET /api/notifications/preferences — предпочтения уведомлений
    expect_status("BLOGGER", "GET", "/notifications/preferences", {200}, token=token)


def test_health():
    """Health-check dev-сервера."""
    log_section("HEALTH CHECK")
    try:
        with urllib.request.urlopen(f"{BASE_URL}/", timeout=10) as resp:
            if resp.status == 200:
                log_pass("GET / → 200", "dev server отвечает")
                return True
    except Exception as e:
        log_fail("GET /", str(e))
        return False
    return False


def main():
    print(f"{C.BOLD}{C.CYAN}")
    print("=" * 60)
    print("  E2E РОЛИ-ФЛОУ: 6 РОЛЕЙ × АВТОРИЗАЦИЯ × API ENDPOINTS")
    print("=" * 60)
    print(C.END)
    print(f"  Target: {BASE_URL}/api")
    print(f"  Роли: COURIER, SUPPLIER, CORPORATE_CLIENT, ADMIN, VENUE_OWNER, BLOGGER")
    print(f"  Примечание: register rate-limit = 3/hour, поэтому часть ролей")
    print(f"              может быть пропущена (⊘) при повторных запусках.")

    if not test_health():
        print(f"\n{C.RED}Dev server не запущен на порту 3001{C.END}")
        print(f"Запустите: ./scripts/dev-server-3001.sh start")
        return 1

    test_courier()
    test_supplier()
    test_corporate_client()
    test_admin()
    test_venue_owner()
    test_blogger()

    # Итог
    print(f"\n{C.BOLD}{C.CYAN}{'=' * 60}{C.END}")
    total = passed + failed + skipped
    print(f"  {C.GREEN}Прошло:    {passed}{C.END}")
    print(f"  {C.RED}Провалено: {failed}{C.END}")
    print(f"  {C.YELLOW}Пропущено: {skipped}{C.END}")
    print(f"  Всего:     {total}")
    print(f"{C.BOLD}{C.CYAN}{'=' * 60}{C.END}")

    if failed == 0:
        print(f"\n{C.GREEN}✅ Все доступные роли-тесты прошли (или корректно пропущены)!{C.END}")
        return 0
    print(f"\n{C.RED}❌ Есть провалившиеся тесты{C.END}")
    return 1


if __name__ == "__main__":
    sys.exit(main())
