/**
 * product-price-panel.test.tsx — панель кондитера «Цены и история стоимости» (PR-3).
 *
 * Проверяется на моках fetch (по образцу catalog-page.test.tsx):
 *   • live-превью новой цены (+50%): «Сейчас/Новая цена/Изменение/Начало действия»;
 *   • человекочитаемые метки reason/source в истории (и экспортируемые словари);
 *   • честное пустое состояние «Истории пока нет» + fallback на цену карточки;
 *   • бейдж «Запланировано» при current.planned;
 *   • submit: кнопка disabled while pending + idempotencyKey переиспользуется
 *     при повторе ЭТОЙ отправки (409 → retry с тем же ключом);
 *   • 400 → серверное сообщение показывается пользователю;
 *   • календарь: точка на дне с изменением, клик фильтрует историю (Europe/Moscow);
 *   • предупреждения себестоимости + честные notice-блоки;
 *   • «Цена на дату» с reason (и без него для initial).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  ProductPricePanel,
  REASON_LABELS,
  SOURCE_LABELS,
  SELECTABLE_REASONS,
} from "./product-price-panel";

const PRODUCT_ID = "11111111-2222-4333-8444-555555555555";
const API_BASE = `/api/confectioner/products/${PRODUCT_ID}`;

// ==================== Фикстуры API (PR-1B) ====================

const HISTORY_FULL = {
  current: {
    versionId: "v2",
    amount: 2000,
    currency: "RUB",
    effectiveFrom: "2026-10-01T00:00:00+03:00",
    planned: false,
  },
  previous: { amount: 1500, effectiveFrom: "2026-08-01T00:00:00+03:00" },
  items: [
    {
      id: "v2",
      amount: 2000,
      currency: "RUB",
      effectiveFrom: "2026-10-01T00:00:00+03:00",
      effectiveTo: null,
      reason: "ingredients",
      comment: "Сливки подорожали",
      source: "confectioner_ui",
      previousVersionId: "v1",
      deltaRub: 500,
      deltaPercent: 33.3,
      costSnapshotRub: 800,
      createdBy: "u1",
      createdAt: "2026-09-20T10:00:00+03:00",
    },
    {
      id: "v1",
      amount: 1500,
      currency: "RUB",
      effectiveFrom: "2026-08-01T00:00:00+03:00",
      effectiveTo: "2026-10-01T00:00:00+03:00",
      reason: "initial",
      comment: "Сид",
      source: "migration_seed",
      previousVersionId: null,
      deltaRub: null,
      deltaPercent: null,
      costSnapshotRub: null,
      createdBy: "system",
      createdAt: "2026-07-01T10:00:00+03:00",
    },
  ],
};

const COST_OK = {
  currentCost: {
    available: true,
    amountRub: 800,
    approximate: true,
    basis: "recipe_ingredients × current inventory cost_per_unit",
  },
  currentPrice: {
    amount: 2000,
    currency: "RUB",
    versionId: "v2",
    effectiveFrom: "2026-10-01T00:00:00+03:00",
    reason: "ingredients",
    approximate: false,
  },
  margin: { amountRub: 1200, percent: 60 },
  priceHistoryCosts: {
    items: [{ effectiveFrom: "2026-10-01T00:00:00+03:00", costRub: 800, approximate: true }],
    notice:
      "исторические закупочные цены ингредиентов не сохранялись — историческая себестоимость недоступна; " +
      "приведённые снимки приблизительные (зафиксированы в момент изменения цены)",
  },
  warnings: { costExceedsPrice: false, marginLow: false, costGrewWhilePriceStale: false },
  ingredientDynamics: { available: false, reason: "historical purchase prices were not tracked" },
};

const PRICE_AT = {
  amount: 1800,
  currency: "RUB",
  versionId: "vX",
  effectiveFrom: "2026-09-01T00:00:00+03:00",
  reason: "fuel",
};

// ==================== Мок fetch (роутер по URL) ====================

let historyData: typeof HISTORY_FULL;
let costData: typeof COST_OK;
let priceAtData: typeof PRICE_AT;
let postResponder: (body: Record<string, unknown>) => Response | Promise<Response>;
const postBodies: Record<string, unknown>[] = [];

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  const method = (init?.method || "GET").toUpperCase();
  if (url.includes("/api/csrf-token")) return jsonResponse({ token: "test-csrf-token" });
  if (url.includes("/price-history")) return jsonResponse(historyData);
  if (url.includes("/cost-analysis")) return jsonResponse(costData);
  if (url.includes("/price-at")) return jsonResponse(priceAtData);
  if (url.includes("/price") && method === "POST") {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    postBodies.push(body);
    return postResponder(body);
  }
  return jsonResponse({ error: `unexpected fetch: ${method} ${url}` }, 404);
});

beforeEach(() => {
  vi.clearAllMocks();
  postBodies.length = 0;
  historyData = JSON.parse(JSON.stringify(HISTORY_FULL));
  costData = JSON.parse(JSON.stringify(COST_OK));
  priceAtData = JSON.parse(JSON.stringify(PRICE_AT));
  postResponder = () => jsonResponse({ versionId: "v3", newAmount: 3000, planned: false });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderPanel(): void {
  render(<ProductPricePanel productId={PRODUCT_ID} currentPrice={2000} />);
}

async function renderLoadedPanel(): Promise<void> {
  renderPanel();
  await screen.findByText("Начальная цена");
}

async function openConfirmDialog(): Promise<void> {
  fireEvent.change(screen.getByLabelText("Новая цена, ₽"), { target: { value: "3000" } });
  fireEvent.click(screen.getByRole("button", { name: "Изменить цену" }));
  await screen.findByText("Подтвердите изменение цены");
}

// ==================== Тесты ====================

describe("ProductPricePanel — превью и словари меток", () => {
  it("live-превью считает +50%: Сейчас/Новая цена/Изменение/Начало действия", async () => {
    await renderLoadedPanel();
    fireEvent.change(screen.getByLabelText("Новая цена, ₽"), { target: { value: "3000" } });

    const preview = screen.getByTestId("price-preview");
    expect(preview).toHaveTextContent("Сейчас: 2 000 ₽");
    expect(preview).toHaveTextContent("Новая цена: 3 000 ₽");
    expect(preview).toHaveTextContent("Изменение: +1 000 ₽ (+50%)");
    expect(preview).toHaveTextContent(/Начало действия: \d{2}\.\d{2}\.\d{4}/);
  });

  it("reason/source человекочитаемы в таблице истории; словари полные", async () => {
    await renderLoadedPanel();

    expect(screen.getByText("Начальная цена")).toBeInTheDocument();
    expect(screen.getByText("Кондитер")).toBeInTheDocument(); // confectioner_ui
    expect(screen.getByText("Система")).toBeInTheDocument(); // migration_seed
    expect(screen.getAllByText("Ингредиенты").length).toBeGreaterThanOrEqual(1);

    // Экспортируемые словари (контракт на будущие переиспользования)
    expect(REASON_LABELS.initial).toBe("Начальная цена");
    expect(REASON_LABELS.composition_change).toBe("Изменение комплектации");
    expect(REASON_LABELS.electricity).toBe("Электроэнергия");
    expect(SOURCE_LABELS.admin_correction).toBe("Админ-исправление");
    expect(SOURCE_LABELS.migration_seed).toBe("Система");
    expect(SELECTABLE_REASONS).not.toContain("initial");
  });

  it("дельты в таблице: +500 ₽ (+33,3%) и тире для initial", async () => {
    await renderLoadedPanel();
    const rows = screen.getAllByTestId("history-row");
    expect(rows).toHaveLength(2);
    expect(rows[0].dataset.day).toBe("2026-10-01"); // DESC: свежая сверху
    expect(rows[1].dataset.day).toBe("2026-08-01");
    // Изменение отображается дважды: в блоке «Текущая цена» и в ячейке таблицы
    expect(screen.getAllByText("+500 ₽ (+33,3%)").length).toBe(2);
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(1);
  });
});

describe("ProductPricePanel — честные состояния", () => {
  it("пустая история → «Истории пока нет», цена fallback из карточки", async () => {
    historyData = {
      current: null,
      previous: null,
      items: [],
    } as unknown as typeof HISTORY_FULL;
    renderPanel();

    await screen.findByText("Истории пока нет");
    expect(screen.getByText(/цена из карточки; история цен недоступна/)).toBeInTheDocument();
  });

  it("current.planned → бейдж «Запланировано» у текущей цены", async () => {
    historyData.current.planned = true;
    renderPanel();

    const section = screen.getByTestId("section-current-price");
    await within(section).findByText("Запланировано");
  });
});

describe("ProductPricePanel — сохранение цены (POST /price)", () => {
  it("кнопка disabled while pending; idempotencyKey переиспользуется при retry после 409", async () => {
    const gates: { resolve: (r: Response) => void }[] = [];
    postResponder = () =>
      new Promise<Response>((resolve) => {
        gates.push({ resolve });
      });

    await renderLoadedPanel();
    await openConfirmDialog();

    const confirmBtn = screen.getByTestId("confirm-price-button");
    expect(confirmBtn).toBeEnabled();
    fireEvent.click(confirmBtn);
    await waitFor(() => expect(confirmBtn).toBeDisabled()); // in-flight

    // Первый запрос ушёл с корректным телом (reason по умолчанию, CSRF через csrfFetch)
    expect(postBodies).toHaveLength(1);
    expect(postBodies[0].amount).toBe(3000);
    expect(postBodies[0].reason).toBe("ingredients");
    expect(typeof postBodies[0].effectiveFrom).toBe("string");
    expect(postBodies[0].idempotencyKey).toBeTruthy();

    gates[0].resolve(
      jsonResponse({ error: "PRICE_PERIOD_CONFLICT", message: "Период цены пересекается" }, 409)
    );
    await waitFor(() => expect(confirmBtn).toBeEnabled()); // диалог открыт для retry

    fireEvent.click(confirmBtn); // повторная отправка той же попытки
    await waitFor(() => expect(postBodies).toHaveLength(2));
    expect(postBodies[1].idempotencyKey).toBe(postBodies[0].idempotencyKey);

    gates[1].resolve(jsonResponse({ versionId: "v3", newAmount: 3000, planned: false }, 200));
    await waitFor(() => expect(screen.queryByText("Подтвердите изменение цены")).toBeNull());
    // История перезапрошена: 1 (mount) + 1 (после 409) + 1 (после успеха)
    await waitFor(() => {
      const historyCalls = fetchMock.mock.calls.filter(([u]) =>
        String(u).includes("/price-history")
      ).length;
      expect(historyCalls).toBeGreaterThanOrEqual(3);
    });
  });

  it("400 → серверное сообщение показывается в диалоге", async () => {
    postResponder = () =>
      jsonResponse(
        {
          error: "VALIDATION_FAILED",
          message: "amount должен быть целым числом RUB в диапазоне 0..10000000",
        },
        400
      );

    await renderLoadedPanel();
    await openConfirmDialog();

    fireEvent.click(screen.getByTestId("confirm-price-button"));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /amount должен быть целым числом RUB/
    );
  });

  it("будущая дата = планирование: бейдж в форме и note в подтверждении", async () => {
    await renderLoadedPanel();
    fireEvent.change(screen.getByLabelText("Новая цена, ₽"), { target: { value: "3000" } });
    // 2099 год — заведомо будущее (YYYY-MM-DD сравнивается с today Europe/Moscow)
    fireEvent.change(screen.getByLabelText("Дата начала действия"), {
      target: { value: "2099-01-01" },
    });
    expect(screen.getByTestId("price-preview")).toHaveTextContent("Начало действия: 01.01.2099");

    fireEvent.click(screen.getByRole("button", { name: "Изменить цену" }));
    await screen.findByText("Подтвердите изменение цены");
    expect(screen.getByText("Запланировано")).toBeInTheDocument();
    expect(
      screen.getByText("Покупатели увидят новую цену с этой даты.")
    ).toBeInTheDocument();
  });
});

describe("ProductPricePanel — календарь изменений", () => {
  it("точка на дне с изменением; клик по дню фильтрует историю (Europe/Moscow)", async () => {
    await renderLoadedPanel();

    // Календарь открыт на месяце последнего изменения (октябрь 2026)
    const dayBtn = screen.getByRole("button", { name: "01.10.2026" });
    expect(within(dayBtn).getByTestId("calendar-change-dot")).toBeInTheDocument();

    fireEvent.click(dayBtn);
    await waitFor(() => {
      const rows = screen.getAllByTestId("history-row");
      expect(rows).toHaveLength(1);
      expect(rows[0].dataset.day).toBe("2026-10-01");
    });
    expect(screen.getByText("Показать всю историю")).toBeInTheDocument();
    expect(screen.queryByText("01.08.2026")).not.toBeInTheDocument(); // строка v1 скрыта

    fireEvent.click(screen.getByRole("button", { name: "Показать всю историю" }));
    await waitFor(() => expect(screen.getAllByTestId("history-row")).toHaveLength(2));
  });
});

describe("ProductPricePanel — себестоимость и цена на дату", () => {
  it("предупреждения себестоимости + честные notice-блоки", async () => {
    costData.warnings.costExceedsPrice = true;
    costData.warnings.marginLow = true;
    renderPanel();

    await screen.findByText("Себестоимость не ниже цены продажи");
    expect(screen.getByText("Маржинальность ниже 20%")).toBeInTheDocument();
    expect(screen.getByText(/приблизительно \(рецепт × текущие закупочные цены\)/)).toBeInTheDocument();
    expect(
      screen.getByText(/Исторические закупочные цены ингредиентов не сохранялись/)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Динамика цен ингредиентов: недоступна/)
    ).toBeInTheDocument();
    const margin = screen.getByText(/Маржа: \+1 200 ₽ \(\+60%\)/);
    expect(margin).toBeInTheDocument();
  });

  it("«Цена на дату» показывает цену и причину (кроме initial)", async () => {
    await renderLoadedPanel();
    fireEvent.change(screen.getByLabelText("Дата", { exact: true }), {
      target: { value: "2026-09-01" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Проверить цену" }));

    const result = await screen.findByTestId("price-at-result");
    expect(result).toHaveTextContent("Цена на 01.09.2026: 1 800 ₽");
    expect(result).toHaveTextContent("причина: Топливо");
  });

  it("initial-версия в «Цене на дату» — без причины, с пометкой о синтезе", async () => {
    priceAtData = {
      amount: 1500,
      currency: "RUB",
      versionId: null,
      effectiveFrom: "2026-05-01T00:00:00+03:00",
      reason: "initial",
    } as unknown as typeof PRICE_AT;
    await renderLoadedPanel();
    fireEvent.change(screen.getByLabelText("Дата", { exact: true }), {
      target: { value: "2026-05-01" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Проверить цену" }));

    const result = await screen.findByTestId("price-at-result");
    expect(result).toHaveTextContent("Цена на 01.05.2026: 1 500 ₽");
    expect(result).not.toHaveTextContent("причина:");
    expect(result).toHaveTextContent("истории нет — цена из карточки");
  });
});

// userEvent используется (импорт не должен быть «мёртвым»): смоук интерактивного ввода
describe("ProductPricePanel — смоук пользовательского ввода", () => {
  it("ввод суммы с клавиатуры обновляет превью", async () => {
    const user = userEvent.setup();
    await renderLoadedPanel();
    await user.type(screen.getByLabelText("Новая цена, ₽"), "2500");
    expect(screen.getByTestId("price-preview")).toHaveTextContent("Новая цена: 2 500 ₽");
    expect(screen.getByTestId("price-preview")).toHaveTextContent("+500 ₽ (+25%)");
  });
});
