/**
 * recipes-page.test.tsx — каталог рецептов на РЕАЛЬНОМ API маркетплейса.
 *
 * Регрессия конвергенции (qwen-оптимизация): RecipesPage читал store.recipes,
 * засеянный MOCK_RECIPES, и не делал НИ ОДНОГО запроса к
 * GET /api/recipes/marketplace (реальная таблица recipe_marketplace).
 *
 * Контракт страницы:
 *  - loading → skeleton (aria-busy), без фейковых карточек;
 *  - success → реальные title/цена/теги из API-строк; клик по карточке →
 *    navigate("recipe-detail", { id: <uuid из БД> });
 *  - ошибка API → честное «Не удалось загрузить рецепты» + кнопка «Повторить»;
 *  - пустой список из БД → честное «Рецептов пока нет» (не mock-данные).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { RecipesPage } from "./recipes-page";
import { csrfFetch } from "@/lib/api-client";
import type { ApiRecipeMarketplaceRow } from "@/lib/recipe-view-model";

// --- Мок store (zustand): RecipesPage читает только navigate ---
const storeState = {
  navigate: vi.fn(),
};

vi.mock("@/lib/store", () => ({
  useAppStore: (selector: (s: typeof storeState) => unknown) => selector(storeState),
}));

// --- Мок api-client: csrfFetch перехватывается глобально ---
vi.mock("@/lib/api-client", () => ({
  csrfFetch: vi.fn(),
}));

const mockedFetch = csrfFetch as ReturnType<typeof vi.fn>;

const ROW_PAID: ApiRecipeMarketplaceRow = {
  id: "248fe84c-ad9f-4080-9c09-b8e18d7d5d60",
  author_id: "00000000-0000-0000-0000-000000000001",
  title: "Шоколадный торт «Три шоколада»",
  slug: "shokoladnyy-tort-tri-shokolada",
  description: "Авторский рецепт многослойного торта с тремя видами шоколада.",
  base_price: 500,
  is_premium: false,
  is_published: true,
  premium_price: null,
  royalty_rate: 0.05,
  cooking_time_min: 180,
  difficulty: 4,
  tags: ["chocolate", "wedding"],
  preview_image: "https://images.unsplash.com/photo-1538680273-84d8563392eb",
  views: 1247,
  purchases_count: 89,
  rating: 4.8,
  published_at: "2026-10-31T01:08:08.616Z",
  created_at: "2026-10-31T01:08:08.616Z",
  updated_at: "2026-10-31T01:08:08.616Z",
};

const ROW_FREE: ApiRecipeMarketplaceRow = {
  ...ROW_PAID,
  id: "349fe84c-ad9f-4080-9c09-b8e18d7d5d61",
  title: "Бесплатный рецепт: безе",
  description: "Классическое безе из двух ингредиентов.",
  base_price: 0,
  difficulty: 1,
  views: 10,
  tags: ["meringue"],
};

function renderPage(): void {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <RecipesPage />
    </QueryClientProvider>
  );
}

const okResponse = (body: unknown): Response =>
  new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe("RecipesPage — реальный API маркетплейса рецептов", () => {
  it("делает запрос к /api/recipes/marketplace и рендерит реальные строки из БД", async () => {
    mockedFetch.mockResolvedValue(okResponse({ data: [ROW_PAID, ROW_FREE], meta: { total: 2 } }));

    renderPage();

    await waitFor(() => {
      expect(screen.getByText("Шоколадный торт «Три шоколада»")).toBeTruthy();
    });
    expect(screen.getByText("Бесплатный рецепт: безе")).toBeTruthy();
    expect(mockedFetch).toHaveBeenCalledWith("/api/recipes/marketplace?sort=popular&limit=100");
  });

  it("клик по карточке открывает детальную с РЕАЛЬНЫМ id из БД", async () => {
    const user = userEvent.setup();
    mockedFetch.mockResolvedValue(okResponse({ data: [ROW_PAID], meta: { total: 1 } }));

    renderPage();

    const card = await screen.findByText("Шоколадный торт «Три шоколада»");
    await user.click(card);

    expect(storeState.navigate).toHaveBeenCalledWith("recipe-detail", {
      id: ROW_PAID.id,
    });
  });

  it("ошибка API → честный error state с кнопкой «Повторить», без мок-данных", async () => {
    mockedFetch.mockResolvedValue(
      new Response(JSON.stringify({ error: "Ошибка при получении списка рецептов" }), { status: 500 })
    );

    renderPage();

    await waitFor(() => {
      expect(screen.getByText("Не удалось загрузить рецепты")).toBeTruthy();
    });
    expect(screen.getByRole("button", { name: /повторить/i })).toBeTruthy();
    expect(screen.queryByText("Чизкейк Нью-Йорк: без трещин")).toBeNull();
  });

  it("пустой список из БД → честное «Рецептов пока нет»", async () => {
    mockedFetch.mockResolvedValue(okResponse({ data: [], meta: { total: 0 } }));

    renderPage();

    await waitFor(() => {
      expect(screen.getByText("Рецептов пока нет")).toBeTruthy();
    });
  });

  it("пока запрос в полёте — skeleton без карточек", async () => {
    let resolveFetch: (r: Response) => void = () => {};
    mockedFetch.mockReturnValue(
      new Promise<Response>((resolve) => {
        resolveFetch = resolve;
      })
    );

    renderPage();

    expect(screen.getByLabelText("Загрузка рецептов")).toBeTruthy();
    expect(screen.queryByText("Шоколадный торт «Три шоколада»")).toBeNull();

    resolveFetch(okResponse({ data: [ROW_PAID], meta: { total: 1 } }));
    await waitFor(() => {
      expect(screen.getByText("Шоколадный торт «Три шоколада»")).toBeTruthy();
    });
  });
});
