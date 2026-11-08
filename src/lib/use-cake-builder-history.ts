"use client";

/**
 * useCakeBuilderHistory — undo/redo для конструктора тортов.
 *
 * Паттерн заимствован из VisualConstructorV2 (qwentopt) — единственного
 * модуля Qwen с реально работающей историей (past/present/future + хоткеи) —
 * и адаптирован под Zustand-слайс cakeBuilder в src/lib/store.ts:
 *   • состояние истории живёт в store (cakeBuilderPast / cakeBuilderFuture),
 *     поэтому единообразно работает и в диалоге, и на странице /cake-builder;
 *   • хоткеи регистрируются только пока конструктор активен (диалог открыт
 *     или страница смонтирована) и не срабатывают при наборе текста;
 *   • возвращает флаги для кнопок Undo/Redo в шапке конструктора.
 */

import { useEffect, useCallback } from "react";
import { useAppStore } from "@/lib/store";

export function useCakeBuilderHistory(active: boolean) {
  const canUndo = useAppStore((s) => s.cakeBuilderPast.length > 0);
  const canRedo = useAppStore((s) => s.cakeBuilderFuture.length > 0);
  const undoCakeBuilder = useAppStore((s) => s.undoCakeBuilder);
  const redoCakeBuilder = useAppStore((s) => s.redoCakeBuilder);

  const undo = useCallback(() => undoCakeBuilder(), [undoCakeBuilder]);
  const redo = useCallback(() => redoCakeBuilder(), [redoCakeBuilder]);

  useEffect(() => {
    if (!active) return;

    const isTypingTarget = (target: EventTarget | null): boolean => {
      if (!(target instanceof HTMLElement)) return false;
      const tag = target.tagName;
      return (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        target.isContentEditable
      );
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      if (isTypingTarget(e.target)) return;

      const key = e.key.toLowerCase();
      if (key === "z" && !e.shiftKey) {
        e.preventDefault();
        undoCakeBuilder();
      } else if (key === "y" || (key === "z" && e.shiftKey)) {
        e.preventDefault();
        redoCakeBuilder();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [active, undoCakeBuilder, redoCakeBuilder]);

  return { canUndo, canRedo, undo, redo };
}
