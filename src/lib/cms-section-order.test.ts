import { describe, expect, it } from "vitest";
import { normalizeCmsBlockOrder, normalizeCmsSectionOrder } from "./cms-section-order";

describe("CMS section ordering contract", () => {
  it("normalizes valid sections in explicit order", () => {
    expect(normalizeCmsSectionOrder([
      { slug: "steps", title: "Шаги", sortOrder: 20, visible: true },
      { slug: "hero", title: "Hero", sortOrder: 10, visible: false },
    ])?.map((row) => row.slug)).toEqual(["hero", "steps"]);
  });

  it("rejects duplicate slugs and positions", () => {
    expect(normalizeCmsSectionOrder([
      { slug: "hero", sortOrder: 1, visible: true },
      { slug: "hero", sortOrder: 2, visible: true },
    ])).toBeNull();
    expect(normalizeCmsSectionOrder([
      { slug: "hero", sortOrder: 1, visible: true },
      { slug: "steps", sortOrder: 1, visible: true },
    ])).toBeNull();
  });

  it("rejects unsafe slugs, invalid titles and invalid visibility values", () => {
    expect(normalizeCmsSectionOrder([{ slug: "../hero", sortOrder: 1, visible: true }])).toBeNull();
    expect(normalizeCmsSectionOrder([{ slug: "hero", title: " ", sortOrder: 1, visible: true }])).toBeNull();
    expect(normalizeCmsSectionOrder([{ slug: "hero", sortOrder: 1, visible: "yes" }])).toBeNull();
  });
});


describe("CMS block ordering contract", () => {
  it("accepts unique bounded block ids", () => {
    expect(normalizeCmsBlockOrder(["block-a", "block-b"])).toEqual(["block-a", "block-b"]);
  });

  it("rejects duplicate, malformed and oversized block lists", () => {
    expect(normalizeCmsBlockOrder(["same", "same"])).toBeNull();
    expect(normalizeCmsBlockOrder([""])).toBeNull();
    expect(normalizeCmsBlockOrder(Array.from({ length: 201 }, (_, i) => `block-${i}`))).toBeNull();
  });
});
