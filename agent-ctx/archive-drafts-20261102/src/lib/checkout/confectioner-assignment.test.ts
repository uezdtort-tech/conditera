/**
 * Юнит-тесты чистых хелперов назначения кондитера custom-позиций конструктора
 * (checkout). Без БД — только решение/формат-стражи.
 *
 * FK-контракт (проверено по live-БД): orders.confectioner_id → auth.users(id),
 * поэтому валидированным значением является confectioners.userId (id юзера),
 * а НЕ id профиля.
 */
import { describe, expect, it } from "vitest";

import {
  CUSTOM_CONFECTIONER_REASON_RU,
  isUuidLike,
  resolveCustomConfectioner,
  type ConfectionerProfileRow,
} from "./confectioner-assignment";

const VALID_USER_ID = "11111111-1111-4111-8111-111111111102"; // как в live-сиде confectioners
const VALID_PROFILE_ID = "8f1c2b3a-4d5e-4f60-9a7b-8c9d0e1f2a3b";

describe("isUuidLike — Zod/UUID-страж до запроса к БД", () => {
  it("валидный UUID пропускается", () => {
    expect(isUuidLike(VALID_USER_ID)).toBe(true);
  });

  it("dev/mock-сид кондитеров ('c1', 'u2') отсекается", () => {
    expect(isUuidLike("c1")).toBe(false);
    expect(isUuidLike("u2")).toBe(false);
  });

  it("пустая строка / не-строка — false", () => {
    expect(isUuidLike("")).toBe(false);
    expect(isUuidLike(123)).toBe(false);
    expect(isUuidLike(null)).toBe(false);
    expect(isUuidLike(undefined)).toBe(false);
  });
});

describe("resolveCustomConfectioner — решение по custom-позиции", () => {
  it("verified-профиль: в orders пишем userId (auth.users), НЕ id профиля", () => {
    const row: ConfectionerProfileRow = {
      id: VALID_PROFILE_ID,
      userId: VALID_USER_ID,
      verified: true,
    };
    const res = resolveCustomConfectioner(row, "custom-позиция #1");
    expect(res).toEqual({ ok: true, confectionerId: VALID_USER_ID });
  });

  it("профиль не найден в БД → missing_profile", () => {
    for (const row of [null, undefined]) {
      const res = resolveCustomConfectioner(row, "custom-позиция #1");
      expect(res).toEqual({ ok: false, reason: "missing_profile" });
    }
  });

  it("неверифицированный профиль (verified=false) → unverified", () => {
    const res = resolveCustomConfectioner(
      { id: VALID_PROFILE_ID, userId: VALID_USER_ID, verified: false },
      "custom-позиция #1"
    );
    expect(res).toEqual({ ok: false, reason: "unverified" });
  });

  it("verificationStatus 'approved' без verified=true не считается верификацией", () => {
    const res = resolveCustomConfectioner(
      { id: VALID_PROFILE_ID, userId: VALID_USER_ID, verified: false },
      "custom-позиция #1"
    );
    expect(res).toEqual({ ok: false, reason: "unverified" });
  });

  it("legacy-сид с не-UUID userId ('u2') → bad_user_id (FK orders → auth.users)", () => {
    const res = resolveCustomConfectioner(
      { id: "c1", userId: "u2", verified: true },
      "custom-позиция #1"
    );
    expect(res).toEqual({ ok: false, reason: "bad_user_id" });
  });

  it("verified-профиль без userId → bad_user_id", () => {
    const res = resolveCustomConfectioner(
      { id: VALID_PROFILE_ID, verified: true },
      "custom-позиция #1"
    );
    expect(res).toEqual({ ok: false, reason: "bad_user_id" });
  });
});

describe("CUSTOM_CONFECTIONER_REASON_RU — покрыты все причины отказа", () => {
  it("каждая причина отказа имеет человекочитаемое описание", () => {
    expect(Object.keys(CUSTOM_CONFECTIONER_REASON_RU).sort()).toEqual(
      ["bad_user_id", "missing_profile", "unverified"].sort()
    );
    for (const text of Object.values(CUSTOM_CONFECTIONER_REASON_RU)) {
      expect(text.length).toBeGreaterThan(0);
    }
  });
});
