"use client";

/**
 * QueryProvider — обёртка для @tanstack/react-query.
 *
 * Использование:
 *   import { QueryProvider } from "@/components/query-provider";
 *   <QueryProvider>{children}</QueryProvider>
 *
 * В layout.tsx оборачиваем всё приложение.
 * В дашбордах используем useQuery / useMutation для загрузки данных.
 */

import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30 * 1000, // 30 секунд данные считаются свежими
      gcTime: 5 * 60 * 1000, // 5 минут кэш живёт после последнего использования
      retry: (failureCount: number, error: unknown) => {
        // Не ретраить 4xx (клиентские ошибки)
        if (error instanceof Error && "status" in error) {
          const status = (error as { status: number }).status;
          if (status >= 400 && status < 500) return false;
        }
        return failureCount < 3;
      },
      refetchOnWindowFocus: false, // не дёргать API при фокусе окна
    },
    mutations: {
      retry: 0, // мутации не ретраим (для предотвращения дублей заказов)
    },
  },
});

export function QueryProvider({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}
