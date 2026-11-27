import { describe, expect, it } from "vitest";
import { groupPublishedHomeBlocks } from "./use-published-home-blocks";

describe("published homepage CMS blocks API contract", () => {
  it("groups active database rows by section and maps snake_case fields", () => {
    const grouped = groupPublishedHomeBlocks([
      {
        id: "block-1",
        section: "advantages",
        title: "Свежие ингредиенты",
        subtitle: "Каждый день",
        content: "Описание блока",
        image_url: "https://conditera.ru/media/ingredients.jpg",
        link_url: "/catalog",
        link_text: "Открыть каталог",
        is_active: true,
      },
      {
        id: "block-2",
        section: "steps",
        title: "Выберите торт",
        content: "Первый шаг",
        is_active: true,
      },
    ]);

    expect(grouped.advantages).toEqual([{
      id: "block-1",
      title: "Свежие ингредиенты",
      subtitle: "Каждый день",
      text: "Описание блока",
      image: "https://conditera.ru/media/ingredients.jpg",
      link: "/catalog",
      linkText: "Открыть каталог",
    }]);
    expect(grouped.steps?.[0]).toMatchObject({ id: "block-2", title: "Выберите торт", text: "Первый шаг" });
  });

  it("excludes inactive rows and malformed records", () => {
    const grouped = groupPublishedHomeBlocks([
      { id: "hidden", section: "hero", is_active: false },
      { id: "missing-section", is_active: true },
      null,
      "not-a-row",
      { id: "visible", section: "hero", is_active: true, title: "Видимый блок" },
    ]);

    expect(grouped.hero).toEqual([{ id: "visible", title: "Видимый блок" }]);
    expect(grouped.advantages).toBeUndefined();
  });

  it("returns an empty map for an invalid API payload", () => {
    expect(groupPublishedHomeBlocks({ blocks: [] })).toEqual({});
    expect(groupPublishedHomeBlocks(null)).toEqual({});
  });
});
