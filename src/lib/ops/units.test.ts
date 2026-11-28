import { describe, expect, it } from "vitest";
import { convertQty, normalizeUnit } from "./units";

describe("culinary unit conversion", () => {
  it("normalizes dozen aliases to the pieces dimension", () => {
    expect(normalizeUnit("дес")).toBe("шт");
    expect(normalizeUnit("дюжина")).toBe("шт");
    expect(normalizeUnit("dozen")).toBe("шт");
  });

  it("converts dozen to pieces and back without losing the unit factor", () => {
    expect(convertQty(1, "дес", "шт")).toBe(10);
    expect(convertQty(8, "шт", "дес")).toBeCloseTo(0.8, 6);
    expect(convertQty(2, "dozen", "pcs")).toBe(24);
  });

  it("continues to reject incompatible dimensions", () => {
    expect(convertQty(1, "кг", "шт")).toBeNull();
  });
});
