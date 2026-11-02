/**
 * primary-role.test.ts — выбор главной роли и маппинг кабинетов.
 *
 * Регресс (смена аккаунта): у курьера roles = ["CUSTOMER", "COURIER"] —
 * roles[0] давал CUSTOMER и кабинет открывался покупательским.
 */
import { describe, it, expect } from "vitest";
import { pickPrimaryRole, dashboardViewByRole, ROLE_PRIORITY } from "./primary-role";

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
