"use client";

/**
 * use-ops-task-actions.ts — общий хук обработки задач операционной очереди
 * (resolve/dismiss через POST /api/ops/tasks/{id}) для админского
 * «Операционного центра» и таба «Сегодня» кондитера.
 *
 * Контракт: {task} | 409 NOT_OPEN (задача уже обработана).
 * После успеха инвалидируем переданные query-ключи (по умолчанию ops-набор).
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { csrfFetch, getCsrfToken, getSessionAuthHeaders } from "@/lib/api-client";

export function useOpsTaskAction(invalidateKeys: readonly unknown[][] = [["ops-tasks"], ["ops-summary"], ["ops-today"]]) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, action }: { id: string; action: "resolve" | "dismiss" }) => {
      const res = await csrfFetch(`/api/ops/tasks/${id}`, {
        method: "POST",
        headers: await getSessionAuthHeaders(await getCsrfToken()),
        body: JSON.stringify({ action } satisfies { action: "resolve" | "dismiss" }),
      });
      if (res.status === 409) {
        throw new Error("Задача уже обработана");
      }
      if (!res.ok) {
        const err = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(err?.error || `HTTP ${res.status}`);
      }
      return (await res.json()) as { task?: unknown };
    },
    onSuccess: (_data, vars) => {
      toast.success(vars.action === "resolve" ? "Задача выполнена" : "Задача скрыта");
      for (const key of invalidateKeys) {
        void queryClient.invalidateQueries({ queryKey: key });
      }
    },
    onError: (error: Error) => {
      toast.error("Не удалось обработать задачу", { description: error.message });
    },
  });
}
