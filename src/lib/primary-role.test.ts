/**
 * primary-role.test.ts — выбор главной роли и маппинг кабинетов.
 *
 * Регресс (смена аккаунта): у курьера roles = ["CUSTOMER", "COURIER"] —
 * roles[0] давал CUSTOMER и кабинет открывался покупательским.
 */
import { describe, it, expect } from "vitest";
import {
  pickPrimaryRole,
  dashboardViewByRole,
  dashboardViewForRole,
  ROLE_PRIORITY,
  RENDERABLE_DASHBOARD_VIEWS,
} from "./primary-role";

describe("pickPrimaryRole", () => {
  it("курьер (CUSTOMER, COURIER) → COURIER, а не roles[0]", () => {
    expect(pickPrimaryRole(["CUSTOMER", "COURIER"])).toBe("COURIER");
    expect(pickPrimaryRole(["COURIER", "CUSTOMER"])).toBe("COURIER");
  });

  it("кондитер с ролью покупателя → CONFECTIONER", () => {
    expect(pickPrimaryRole(["CUSTOMER", "CONFECTIONER"])).toBe("CONFECTIONER");
  });

  it("администратор главнее курьера и покупателя", () => {
    expect(pickPrimaryRole(["COURIER", "CUSTOMER", "ADMIN"])).toBe("ADMIN");
    expect(pickPrimaryRole(["SUPER_ADMIN", "ADMIN"])).toBe("SUPER_ADMIN");
  });

  it("одиночная роль возвращается как есть", () => {
    expect(pickPrimaryRole(["CUSTOMER"])).toBe("CUSTOMER");
    expect(pickPrimaryRole(["SUPPLIER"])).toBe("SUPPLIER");
  });

  it("пустой/отсутствующий набор → GUEST", () => {
    expect(pickPrimaryRole([])).toBe("GUEST");
    expect(pickPrimaryRole(null)).toBe("GUEST");
    expect(pickPrimaryRole(undefined)).toBe("GUEST");
  });

  it("иерархия уникальна и завершается CUSTOMER/GUEST", () => {
    const set = new Set(ROLE_PRIORITY);
    expect(set.size).toBe(ROLE_PRIORITY.length);
    expect(ROLE_PRIORITY[ROLE_PRIORITY.length - 1]).toBe("GUEST");
    expect(ROLE_PRIORITY.includes("CUSTOMER")).toBe(true);
  });
});

describe("dashboardViewByRole", () => {
  it("курьерская роль ведёт в dashboard-courier", () => {
    expect(dashboardViewByRole.COURIER).toBe("dashboard-courier");
  });

  it("кондитер и студия — один кабинет", () => {
    expect(dashboardViewByRole.CONFECTIONER).toBe("dashboard-confectioner");
    expect(dashboardViewByRole.STUDIO).toBe("dashboard-confectioner");
  });

  it("админ и super-admin — один кабинет; extra-роли в dashboard-extra", () => {
    expect(dashboardViewByRole.ADMIN).toBe("dashboard-admin");
    expect(dashboardViewByRole.SUPER_ADMIN).toBe("dashboard-admin");
    expect(dashboardViewByRole.INSPECTOR).toBe("dashboard-extra");
    expect(dashboardViewByRole.GUEST).toBe("dashboard-customer");
  });
});

/**
 * A-5: единая карта ролей → кабинетов.
 * Первопричина: локальный DASHBOARD_MAP в header.tsx расходился с
 * dashboardViewByRole — роли v2.0 уезжали в «home», MODERATOR/SUPPORT/BLOGGER —
 * в dashboard-* (moderator/support/blogger), которые /dashboard/page.tsx НЕ
 * рендерит (вечный skeleton). Дублирующая карта удалена; здесь — контракт
 * единой карты: полнота по всем объявленным ролям + валидность кабинетов.
 */
describe("A-5: dashboardViewByRole — единая карта кабинетов", () => {
  it.each(ROLE_PRIORITY)("%s ведёт в РЕАЛЬНО рендеримый кабинет (не «home», не мёртвый view)", (role) => {
    const view = dashboardViewByRole[role];
    expect(RENDERABLE_DASHBOARD_VIEWS).toContain(view);
    expect(view).not.toBe("home");
  });

  it("карта покрывает ровно все объявленные роли (30) — ни одна не забыта", () => {
    expect(Object.keys(dashboardViewByRole).sort()).toEqual([...ROLE_PRIORITY].sort());
  });

  it("v2.0-роли направлены в свои кабинеты (не в «home»)", () => {
    expect(dashboardViewByRole.RECIPE_DEVELOPER).toBe("dashboard-recipe-developer");
    expect(dashboardViewByRole.LOYALTY_PARTNER).toBe("dashboard-loyalty-partner");
    expect(dashboardViewByRole.AI_ASSISTANT).toBe("dashboard-extra");
  });

  it("MODERATOR/SUPPORT/BLOGGER — в dashboard-extra (их старые dashboard-* не рендерятся страницей)", () => {
    expect(dashboardViewByRole.MODERATOR).toBe("dashboard-extra");
    expect(dashboardViewByRole.SUPPORT).toBe("dashboard-extra");
    expect(dashboardViewByRole.BLOGGER).toBe("dashboard-extra");
  });

  it("dashboardViewForRole: валидная роль → маппинг; битая/null роль → безопасный fallback", () => {
    expect(dashboardViewForRole("COURIER")).toBe("dashboard-courier");
    expect(dashboardViewForRole("RECIPE_DEVELOPER")).toBe("dashboard-recipe-developer");
    expect(dashboardViewForRole("NOT_A_ROLE" as string)).toBe("dashboard-customer");
    expect(dashboardViewForRole(null)).toBe("dashboard-customer");
    expect(dashboardViewForRole(undefined)).toBe("dashboard-customer");
  });
});
