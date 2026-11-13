/**
 * upload-role-guard.test.ts — ZV33-8d FIX B (D2): ролевой гвард загрузки.
 *
 * Лочит контракт ролей:
 *   • canUpload (управленческий путь /api/services/upload): покупатель — false,
 *     кондитер/админ — true, не-аутентифицированный/мусор — false;
 *   • canUploadToPath: /api/services/upload — менеджер-роли; /api/upload —
 *     + CUSTOMER (улика-обоснованное исключение: фото отзывов category="reviews"
 *     и вложения тикетов category="tickets" в customer-dashboard);
 *   • список путей гварда — ровно два upload-эндпоинта.
 */
import { describe, it, expect } from "vitest";
import {
  UPLOAD_GUARD_PATHS,
  UPLOAD_SERVICE_ALLOWED_ROLES,
  UPLOAD_GENERAL_ALLOWED_ROLES,
  canUpload,
  canUploadToPath,
} from "./upload-role-guard";

const BUYER = "CUSTOMER";
const CONFECTIONER = "CONFECTIONER";
const ADMIN = "ADMIN";
const SUPER_ADMIN = "SUPER_ADMIN";

describe("canUpload (management path, ZV33-8d FIX B)", () => {
  it("покупатель → false (D2: произвольные загрузки закрыты)", () => {
    expect(canUpload(BUYER)).toBe(false);
  });

  it("кондитер / админ / супер-админ → true", () => {
    expect(canUpload(CONFECTIONER)).toBe(true);
    expect(canUpload(ADMIN)).toBe(true);
    expect(canUpload(SUPER_ADMIN)).toBe(true);
  });

  it("не-аутентифицированный / мусор → false", () => {
    expect(canUpload("")).toBe(false);
    expect(canUpload("GUEST")).toBe(false);
    expect(canUpload("CUSTOMER, ADMIN")).toBe(false); // инъекция строкой не проходит
    expect(canUpload("CUSTOMER")).toBe(false);
  });
});

describe("canUploadToPath (path-scoped guard)", () => {
  it("/api/services/upload: только менеджер-роли", () => {
    expect(canUploadToPath([CONFECTIONER], "/api/services/upload")).toBe(true);
    expect(canUploadToPath([ADMIN], "/api/services/upload")).toBe(true);
    expect(canUploadToPath([SUPER_ADMIN], "/api/services/upload")).toBe(true);
    expect(canUploadToPath([BUYER], "/api/services/upload")).toBe(false);
    expect(canUploadToPath(undefined, "/api/services/upload")).toBe(false);
    expect(canUploadToPath(null, "/api/services/upload")).toBe(false);
  });

  it("/api/upload: менеджер-роли + CUSTOMER (фото отзывов/тикетов)", () => {
    expect(canUploadToPath([CONFECTIONER], "/api/upload")).toBe(true);
    expect(canUploadToPath([ADMIN], "/api/upload")).toBe(true);
    expect(canUploadToPath([BUYER], "/api/upload")).toBe(true);
  });

  it("несколько ролей: достаточно одной допустимой", () => {
    expect(canUploadToPath([BUYER, CONFECTIONER], "/api/services/upload")).toBe(true);
    expect(canUploadToPath(["SUPPORT", BUYER], "/api/services/upload")).toBe(false);
  });

  it("подпути/чужие пути — не путь гварда (общая политика)", () => {
    // прокси матчит точные пути; на чужой путь хелпер отвечает общей политикой
    expect(canUploadToPath([BUYER], "/api/upload/extra")).toBe(true);
    expect(canUploadToPath([BUYER], "/api/products")).toBe(true); // не гвард — прокси не вызовет
  });

  it("списки ролей и путей задокументированы", () => {
    expect(UPLOAD_GUARD_PATHS).toEqual(["/api/upload", "/api/services/upload"]);
    expect(UPLOAD_SERVICE_ALLOWED_ROLES).toEqual([CONFECTIONER, ADMIN, SUPER_ADMIN]);
    expect(UPLOAD_GENERAL_ALLOWED_ROLES).toContain(BUYER);
    expect(UPLOAD_GENERAL_ALLOWED_ROLES).toHaveLength(4);
  });
});
