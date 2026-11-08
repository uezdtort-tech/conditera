/**
 * Тесты undo/redo конструктора тортов (Z-v15).
 *
 * Покрывают механизм истории в Zustand-слайсе cakeBuilder
 * (updateCakeBuilder / undoCakeBuilder / redoCakeBuilder / resetCakeBuilder)
 * и хук хоткеев useCakeBuilderHistory (Ctrl+Z / Ctrl+Y, защита input-ов).
 *
 * Паттерн VisualConstructorV2 (qwentopt) — past/present/future —
 * адаптирован под реальный store Conditera.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act, fireEvent } from "@testing-library/react";
import { useAppStore, CAKE_BUILDER_HISTORY_LIMIT } from "./store";
import { useCakeBuilderHistory } from "./use-cake-builder-history";

const FRESH = {
  step: 0,
  decorations: [] as string[],
  dietary: [] as string[],
  productType: undefined,
  servings: undefined,
  quantity: undefined,
};

const resetBuilder = () => {
  useAppStore.setState({
    cakeBuilder: { ...FRESH },
    cakeBuilderPast: [],
    cakeBuilderFuture: [],
  });
};

describe("cake-builder history (store)", () => {
  beforeEach(resetBuilder);

  it("updateCakeBuilder сохраняет предыдущее состояние в past и очищает future", () => {
    const s = useAppStore.getState();
    s.updateCakeBuilder({ step: 1 });
    s.updateCakeBuilder({ base: "sponge" });

    const st = useAppStore.getState();
    expect(st.cakeBuilderPast).toHaveLength(2);
    expect(st.cakeBuilderPast[0]).toEqual({ ...FRESH });
    expect(st.cakeBuilderPast[1]).toEqual({ ...FRESH, step: 1 });
    expect(st.cakeBuilder).toEqual({ ...FRESH, step: 1, base: "sponge" });
    expect(st.cakeBuilderFuture).toHaveLength(0);
  });

  it("undoCakeBuilder восстанавливает предыдущее состояние и возвращает true", () => {
    const s = useAppStore.getState();
    s.updateCakeBuilder({ productType: "cake" });
    s.updateCakeBuilder({ step: 3 });

    expect(useAppStore.getState().undoCakeBuilder()).toBe(true);
    let st = useAppStore.getState();
    expect(st.cakeBuilder).toEqual({ ...FRESH, productType: "cake" });
    expect(st.cakeBuilderPast).toHaveLength(1);
    // undone-состояние попало в future (для redo)
    expect(st.cakeBuilderFuture[0]).toEqual({ ...FRESH, productType: "cake", step: 3 });

    expect(useAppStore.getState().undoCakeBuilder()).toBe(true);
    st = useAppStore.getState();
    expect(st.cakeBuilder).toEqual({ ...FRESH });
    expect(st.cakeBuilderPast).toHaveLength(0);
  });

  it("undoCakeBuilder при пустой истории — no-op, возвращает false", () => {
    expect(useAppStore.getState().undoCakeBuilder()).toBe(false);
    expect(useAppStore.getState().cakeBuilder).toEqual({ ...FRESH });
  });

  it("redoCakeBuilder возвращает отменённое состояние", () => {
    const s = useAppStore.getState();
    s.updateCakeBuilder({ filling: "choco" });
    useAppStore.getState().undoCakeBuilder();

    expect(useAppStore.getState().redoCakeBuilder()).toBe(true);
    const st = useAppStore.getState();
    expect(st.cakeBuilder).toEqual({ ...FRESH, filling: "choco" });
    expect(st.cakeBuilderFuture).toHaveLength(0);
    expect(st.cakeBuilderPast).toHaveLength(1);
  });

  it("redoCakeBuilder при пустой future — no-op, возвращает false", () => {
    expect(useAppStore.getState().redoCakeBuilder()).toBe(false);
  });

  it("новое действие после undo обрывает redo-ветку", () => {
    const s = useAppStore.getState();
    s.updateCakeBuilder({ base: "biscuit" });
    useAppStore.getState().undoCakeBuilder();
    expect(useAppStore.getState().cakeBuilderFuture).toHaveLength(1);

    useAppStore.getState().updateCakeBuilder({ base: "choux" });
    const st = useAppStore.getState();
    expect(st.cakeBuilderFuture).toHaveLength(0);
    expect(useAppStore.getState().redoCakeBuilder()).toBe(false);
    expect(st.cakeBuilder).toEqual({ ...FRESH, base: "choux" });
  });

  it("цикл update→undo→redo→undo возвращает исходное состояние", () => {
    const s = useAppStore.getState();
    s.updateCakeBuilder({ step: 2 });
    s.updateCakeBuilder({ tiers: 3 });
    const undo = useAppStore.getState().undoCakeBuilder;
    const redo = useAppStore.getState().redoCakeBuilder;

    undo(); // tiers: 3 отменён
    redo(); // tiers: 3 возвращён
    expect(useAppStore.getState().cakeBuilder).toEqual({ ...FRESH, step: 2, tiers: 3 });
    undo(); // снова без tiers
    expect(useAppStore.getState().cakeBuilder).toEqual({ ...FRESH, step: 2 });
  });

  it("история ограничена CAKE_BUILDER_HISTORY_LIMIT", () => {
    const s = useAppStore.getState();
    for (let i = 1; i <= CAKE_BUILDER_HISTORY_LIMIT + 10; i++) {
      s.updateCakeBuilder({ step: Math.min(i, 9) });
    }
    const st = useAppStore.getState();
    expect(st.cakeBuilderPast).toHaveLength(CAKE_BUILDER_HISTORY_LIMIT);
    // вытеснены самые старые снимки: past[0] — состояние перед 11-м обновлением,
    // когда step уже был 9 (Math.min(10,9) на 10-й итерации)
    expect(st.cakeBuilderPast[0].step).toBe(9);
  });

  it("undo восстанавливает и шаг, и выбор вместе (навигация wizard-а)", () => {
    const s = useAppStore.getState();
    s.updateCakeBuilder({ productType: "cake", step: 2 });
    // переход «Далее» на шаг 3 + выбор начинки — два отдельных обновления
    s.updateCakeBuilder({ step: 3 });
    s.updateCakeBuilder({ filling: "berry" });

    useAppStore.getState().undoCakeBuilder();
    const st = useAppStore.getState();
    expect(st.cakeBuilder.step).toBe(3);
    expect(st.cakeBuilder.filling).toBeUndefined();

    useAppStore.getState().undoCakeBuilder();
    expect(useAppStore.getState().cakeBuilder.step).toBe(2);
  });

  it("resetCakeBuilder очищает и конфигурацию, и историю", () => {
    const s = useAppStore.getState();
    s.updateCakeBuilder({ productType: "cake" });
    s.updateCakeBuilder({ step: 4 });
    useAppStore.getState().resetCakeBuilder();

    const st = useAppStore.getState();
    expect(st.cakeBuilder).toEqual({ ...FRESH });
    expect(st.cakeBuilderPast).toHaveLength(0);
    expect(st.cakeBuilderFuture).toHaveLength(0);
    expect(useAppStore.getState().undoCakeBuilder()).toBe(false);
  });

  it("снапшоты изолированы: мутация массивов после undo не искажает историю", () => {
    const s = useAppStore.getState();
    s.updateCakeBuilder({ decorations: ["berries"] });
    useAppStore.getState().undoCakeBuilder();
    // текущее состояние — FRESH с новым массивом decorations
    useAppStore.getState().updateCakeBuilder({ decorations: ["sprinkles"] });
    useAppStore.getState().undoCakeBuilder();

    const st = useAppStore.getState();
    expect(st.cakeBuilder.decorations).toEqual([]);
  });
});

describe("useCakeBuilderHistory (hotkeys)", () => {
  beforeEach(resetBuilder);

  const pressKey = (key: string, opts: { ctrl?: boolean; shift?: boolean } = {}) => {
    fireEvent.keyDown(window, {
      key,
      ctrlKey: opts.ctrl ?? true,
      metaKey: false,
      shiftKey: opts.shift ?? false,
      bubbles: true,
    });
  };

  it("Ctrl+Z отменяет последнее действие, Ctrl+Y возвращает", () => {
    useAppStore.getState().updateCakeBuilder({ base: "sponge" });

    const { unmount } = renderHook(() => useCakeBuilderHistory(true));

    act(() => pressKey("z"));
    expect(useAppStore.getState().cakeBuilder.base).toBeUndefined();

    act(() => pressKey("y"));
    expect(useAppStore.getState().cakeBuilder.base).toBe("sponge");

    unmount();
  });

  it("Ctrl+Shift+Z тоже делает redo", () => {
    useAppStore.getState().updateCakeBuilder({ base: "choux" });
    useAppStore.getState().undoCakeBuilder();

    const { unmount } = renderHook(() => useCakeBuilderHistory(true));
    act(() => pressKey("z", { shift: true }));
    expect(useAppStore.getState().cakeBuilder.base).toBe("choux");

    unmount();
  });

  it("хоткеи неактивны, когда active=false", () => {
    useAppStore.getState().updateCakeBuilder({ base: "sponge" });

    const { unmount } = renderHook(() => useCakeBuilderHistory(false));
    act(() => pressKey("z"));
    expect(useAppStore.getState().cakeBuilder.base).toBe("sponge");

    unmount();
  });

  it("хоткей игнорируется при наборе текста в input", () => {
    useAppStore.getState().updateCakeBuilder({ base: "sponge" });

    const { unmount } = renderHook(() => useCakeBuilderHistory(true));
    const input = document.createElement("input");
    document.body.appendChild(input);

    act(() => {
      fireEvent.keyDown(input, {
        key: "z",
        ctrlKey: true,
        shiftKey: false,
        bubbles: true,
      });
    });
    expect(useAppStore.getState().cakeBuilder.base).toBe("sponge");

    document.body.removeChild(input);
    unmount();
  });
});
