/**
 * Z-v17: unit-тесты серверных валидаторов контура поставщика.
 *  - validateProduct (supplier/warehouse): единицы, категории, копейки, MOQ;
 *  - validateForSubmit (supplier/profile): обязательные поля, email.
 */
import { describe, it, expect } from "vitest";

import { validateProduct } from "@/app/api/supplier/warehouse/route";
import { validateForSubmit } from "@/app/api/supplier/profile/route";

describe("validateProduct (каталог поставщика)", () => {
  const valid = {
    productName: "Шоколад тёмный 70%",
    unit: "kg",
    category: "chocolate",
    price: 8500,
    quantity: 10,
    minOrderQty: 2,
    orderStep: 2,
  };

  it("валидный товар проходит", () => {
    expect(validateProduct(valid)).toEqual([]);
  });

  it("короткое название отклоняется", () => {
    expect(validateProduct({ ...valid, productName: "Ш" })).not.toEqual([]);
  });

  it("недопустимая единица измерения отклоняется", () => {
    expect(validateProduct({ ...valid, unit: "ton" })).not.toEqual([]);
  });

  it("недопустимая категория отклоняется", () => {
    expect(validateProduct({ ...valid, category: "jewelry" })).not.toEqual([]);
  });

  it("дробная цена (копейки) отклоняется", () => {
    expect(validateProduct({ ...valid, price: 10.5 })).not.toEqual([]);
  });

  it("отрицательный остаток отклоняется", () => {
    expect(validateProduct({ ...valid, quantity: -1 })).not.toEqual([]);
  });

  it("MOQ=0 отклоняется", () => {
    expect(validateProduct({ ...valid, minOrderQty: 0 })).not.toEqual([]);
  });

  it("частичная валидация (PATCH) пропускает отсутствующие поля", () => {
    expect(validateProduct({ price: 9900 }, true)).toEqual([]);
  });
});

describe("validateForSubmit (профиль поставщика)", () => {
  const complete = {
    companyName: "ШокоПром",
    contactPerson: "Иван Иванов",
    phone: "+7 900 000-00-00",
    email: "info@shokoprom.ru",
    region: "Москва",
    description: "Оптовый поставщик шоколада",
    productCategories: ["chocolate"],
  };

  it("полный профиль проходит", () => {
    expect(validateForSubmit(complete)).toEqual([]);
  });

  it("без названия — ошибка", () => {
    const errors = validateForSubmit({ ...complete, companyName: "" });
    expect(errors.some((e) => e.includes("Название"))).toBe(true);
  });

  it("без категорий — ошибка", () => {
    const errors = validateForSubmit({ ...complete, productCategories: [] });
    expect(errors.some((e) => e.includes("категорию"))).toBe(true);
  });

  it("битый email — ошибка", () => {
    const errors = validateForSubmit({ ...complete, email: "not-an-email" });
    expect(errors.some((e) => e.includes("email"))).toBe(true);
  });

  it("все обязательные поля перечисляются сразу", () => {
    const errors = validateForSubmit({});
    expect(errors.length).toBeGreaterThanOrEqual(6);
  });
});
