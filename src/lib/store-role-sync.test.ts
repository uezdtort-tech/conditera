/**
 * store-role-sync.test.ts — A-1: согласованность activeRole ↔ кабинета (nav.view).
 *
 * Первопричина дефекта (приёмка 7392403): активная роль и view кабинета
 * менялись РАЗНЫМИ точками независимо:
 *   • setActiveRole менял только activeRole (view оставался кабинетом прежней
 *     роли — возврат на /dashboard по SPA рендерил чужой кабинет);
 *   • setSupabaseUser при каждом ре-синке сессии (SupabaseAuthSync на
 *     маунте/фокусе) принудительно сбрасывал activeRole на primary, ломая
 *     ручной выбор «Сменить роль» и воспроизводя рассинхрон.
 *
 * Контракт после фикса:
 *   1. setActiveRole — ЕДИНСТВЕННАЯ точка ручной смены роли; в dashboard-разделе
 *      view следует за activeRole атомарно, вне кабинетов — не дёргает навигацию.
 *   2. setSupabaseUser: логин/смена пользователя → primary-роль + пересчёт
 *      dashboard-view (D-01 сохранён); ре-синк того же пользователя → валидный
 *      ручной выбор СОХРАНЯЕТСЯ (роли могли изменить на сервере — проверяем
 *      вхождение); невалидная роль → primary.
 *   3. logout очищает activeRole — состояние кабинета не переезжает между
 *      пользователями.
 *   4. Клиентское состояние прав не расширяет: серверные role-guards — вне
 *      скоупа этого теста (клиентский store не источник полномочий).
 */
import { describe, it, expect, beforeEach } from "vitest";
import { useAppStore } from "./store";
import { dashboardViewForRole } from "./primary-role";

const COURIER_ID = "user-courier-1";
const OTHER_ID = "user-other-2";

const courierUser = {
  id: COURIER_ID,
  email: "courier@test.local",
  name: "Курьер Тест",
  roles: ["CUSTOMER", "COURIER"] as ("CUSTOMER" | "COURIER")[],
  createdAt: "2026-01-01T00:00:00Z",
};

const customerUser = {
  id: OTHER_ID,
  email: "customer@test.local",
  name: "Покупатель Тест",
  roles: ["CUSTOMER"] as ("CUSTOMER")[],
  createdAt: "2026-01-01T00:00:00Z",
};

function seed(overrides: Partial<ReturnType<typeof useAppStore.getState>> = {}) {
  useAppStore.setState({
    user: null,
    activeRole: null,
    isAuthenticated: false,
    nav: { view: "home" },
    ...overrides,
  } as Partial<ReturnType<typeof useAppStore.getState>>);
}

/** Инвариант A-1: в dashboard-разделе view соответствует activeRole. */
function expectCabinetConsistent() {
  const { activeRole, nav } = useAppStore.getState();
  if (nav.view.startsWith("dashboard-")) {
    expect(nav.view).toBe(dashboardViewForRole(activeRole));
  }
}

beforeEach(() => seed());

describe("A-1: setActiveRole — единая точка смены роли", () => {
  it("в кабинете курьера ручной выбор CUSTOMER атомарно переводит view в кабинет покупателя", () => {
    seed({
      user: courierUser,
      activeRole: "COURIER",
      isAuthenticated: true,
      nav: { view: "dashboard-courier" },
    });

    useAppStore.getState().setActiveRole("CUSTOMER");

    const s = useAppStore.getState();
    expect(s.activeRole).toBe("CUSTOMER");
    expect(s.nav.view).toBe("dashboard-customer"); // кабинет следует за ролью
    expectCabinetConsistent();
  });

  it("обратное переключение CUSTOMER → COURIER в кабинете покупателя", () => {
    seed({
      user: courierUser,
      activeRole: "CUSTOMER",
      isAuthenticated: true,
      nav: { view: "dashboard-customer" },
    });

    useAppStore.getState().setActiveRole("COURIER");

    const s = useAppStore.getState();
    expect(s.activeRole).toBe("COURIER");
    expect(s.nav.view).toBe("dashboard-courier");
  });

  it("вне кабинетов (каталог) view не дёргается — роль применится при переходе в кабинет", () => {
    seed({
      user: courierUser,
      activeRole: "COURIER",
      isAuthenticated: true,
      nav: { view: "catalog" },
    });

    useAppStore.getState().setActiveRole("CUSTOMER");

    const s = useAppStore.getState();
    expect(s.activeRole).toBe("CUSTOMER");
    expect(s.nav.view).toBe("catalog"); // навигация не тронута
  });
});

describe("A-1: setSupabaseUser — ре-синк сессии не ломает ручной выбор", () => {
  it("регресс A-1: ре-синк ТОГО ЖЕ пользователя сохраняет ручной выбор роли (не сбрасывает на primary)", () => {
    seed({
      user: courierUser,
      activeRole: "CUSTOMER", // ручной выбор «Сменить роль»
      isAuthenticated: true,
      nav: { view: "dashboard-customer" },
    });

    // SupabaseAuthSync ре-синхронизирует того же пользователя (маунт/фокус)
    useAppStore.getState().setSupabaseUser({ ...courierUser });

    const s = useAppStore.getState();
    expect(s.user?.id).toBe(COURIER_ID);
    expect(s.activeRole).toBe("CUSTOMER"); // НЕ сброшен на COURIER
    expect(s.nav.view).toBe("dashboard-customer");
    expectCabinetConsistent();
  });

  it("ре-синк того же пользователя с невалидной activeRole (роль снята на сервере) → primary", () => {
    seed({
      user: courierUser,
      // роль CONFECTIONER больше не входит в roles пользователя
      activeRole: "CONFECTIONER",
      isAuthenticated: true,
      nav: { view: "dashboard-confectioner" },
    });

    useAppStore.getState().setSupabaseUser({ ...courierUser });

    const s = useAppStore.getState();
    expect(s.activeRole).toBe("COURIER"); // primary
    // view на dashboard-разделе от «снятой» роли остаётся до перехода,
    // но следующее открытие кабинета пересчитается по activeRole
    expect(s.nav.view).toBe("dashboard-confectioner");
    useAppStore.getState().setActiveRole("COURIER");
    expect(useAppStore.getState().nav.view).toBe("dashboard-courier");
  });

  it("repro приёмки: смена роли → уход со страницы → возврат на /dashboard (SPA) — кабинет соответствует роли", () => {
    seed({
      user: courierUser,
      activeRole: "COURIER",
      isAuthenticated: true,
      nav: { view: "dashboard-courier" },
    });

    // 1) ручная смена роли в header (на /dashboard)
    useAppStore.getState().setActiveRole("CUSTOMER");
    expect(useAppStore.getState().nav.view).toBe("dashboard-customer");

    // 2) SPA-переход на другую страницу и обратно (view меняется на каталог и назад)
    useAppStore.setState({ nav: { view: "catalog" } });
    useAppStore.getState().navigate("dashboard-customer"); // возврат: goToDashboard по activeRole
    expect(useAppStore.getState().nav.view).toBe("dashboard-customer");

    // 3) ре-синк сессии (фокус окна) — выбор сохраняется, рассинхрона нет
    useAppStore.getState().setSupabaseUser({ ...courierUser });
    const s = useAppStore.getState();
    expect(s.activeRole).toBe("CUSTOMER");
    expect(s.nav.view).toBe("dashboard-customer");
    expectCabinetConsistent();
  });
});

describe("A-1/D-01: setSupabaseUser — логин и смена пользователя", () => {
  it("свежий логин мультит-рольного курьера → primary-роль (D-01) и пересчёт dashboard-view", () => {
    seed({
      // состояние «предыдущего» покупателя в SPA (без reload): кабинет покупателя
      user: customerUser,
      activeRole: "CUSTOMER",
      isAuthenticated: true,
      nav: { view: "dashboard-customer" },
    });

    useAppStore.getState().setSupabaseUser({ ...courierUser });

    const s = useAppStore.getState();
    expect(s.user?.id).toBe(COURIER_ID);
    expect(s.activeRole).toBe("COURIER"); // pickPrimaryRole, не roles[0]
    expect(s.nav.view).toBe("dashboard-courier"); // чужой кабинет заменён
  });

  it("смена пользователя при НЕ-dashboard view не дёргает навигацию", () => {
    seed({
      user: customerUser,
      activeRole: "CUSTOMER",
      isAuthenticated: true,
      nav: { view: "catalog" },
    });

    useAppStore.getState().setSupabaseUser({ ...courierUser });

    const s = useAppStore.getState();
    expect(s.activeRole).toBe("COURIER");
    expect(s.nav.view).toBe("catalog");
  });

  it("смена пользователя не переносит кабинет прежнего пользователя (D-01 регресс)", () => {
    seed({
      user: courierUser,
      activeRole: "COURIER",
      isAuthenticated: true,
      nav: { view: "dashboard-courier" },
    });

    // вход покупателем (одна роль)
    useAppStore.getState().setSupabaseUser({ ...customerUser });

    const s = useAppStore.getState();
    expect(s.activeRole).toBe("CUSTOMER");
    expect(s.nav.view).toBe("dashboard-customer");
  });
});

describe("A-1: logout — изоляция состояния кабинета", () => {
  it("logout очищает activeRole/user — кабинет не переезжает на следующего пользователя", () => {
    seed({
      user: courierUser,
      activeRole: "COURIER",
      isAuthenticated: true,
      nav: { view: "dashboard-courier" },
    });

    useAppStore.getState().logout();

    const s = useAppStore.getState();
    expect(s.user).toBeNull();
    expect(s.activeRole).toBeNull();
    expect(s.isAuthenticated).toBe(false);

    // следующий пользователь входит с чистым состоянием → primary-роль
    useAppStore.getState().setSupabaseUser({ ...customerUser });
    const s2 = useAppStore.getState();
    expect(s2.activeRole).toBe("CUSTOMER");
    expectCabinetConsistent();
  });
});
