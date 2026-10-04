/**
 * Регрессионные тесты F-1 (аудит @ 18651d4): гонка reject↔complete
 * в PATCH /api/admin/payouts (action=complete).
 *
 * Сценарий: complete помечает заказы ДО CAS approved→paid. Если в окне
 * конкурентный reject выигрывает CAS (резерв возвращён), полная маркировка
 * оставляла заказы навсегда «выплаченными» при восстановленном балансе.
 * resolveCompleteRace кодифицирует контракт разрешения гонки.
 */
import { describe, it, expect } from "vitest";
import { resolveCompleteRace } from "@/lib/payout-complete-race";

describe("resolveCompleteRace (F-1: гонка reject↔complete)", () => {
  it("конкурентный complete выиграл (status=paid) — идемпотентный успех, БЕЗ unmark", () => {
    const r = resolveCompleteRace("paid");
    expect(r.treatAsSuccess).toBe(true);
    expect(r.unmarkOwn).toBe(false);
    expect(r.needsOps).toBe(false);
  });

  it("конкурентный reject выиграл (status=rejected) — снять ТОЛЬКО свою маркировку", () => {
    const r = resolveCompleteRace("rejected");
    expect(r.treatAsSuccess).toBe(false);
    expect(r.unmarkOwn).toBe(true);
    expect(r.needsOps).toBe(false);
  });

  it("заявка не найдена (null) — ничего не менять, нужен оператор", () => {
    const r = resolveCompleteRace(null);
    expect(r.treatAsSuccess).toBe(false);
    expect(r.unmarkOwn).toBe(false);
    expect(r.needsOps).toBe(true);
  });

  it("неизвестный/легаси-статус — ничего не менять (fail-closed)", () => {
    for (const status of ["pending", "approved", "legacy_status", ""]) {
      const r = resolveCompleteRace(status);
      expect(r.unmarkOwn).toBe(false);
      expect(r.treatAsSuccess).toBe(false);
      expect(r.needsOps).toBe(true);
    }
  });
});
