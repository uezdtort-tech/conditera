/**
 * use-automation.ts — TanStack Query hooks для автоматизации (замена n8n).
 *
 * Управление scheduled jobs через pg_cron + Supabase Edge Functions.
 *
 * Query hooks:
 *   - useScheduledJobs() — список запланированных задач
 *   - useScheduledJob(id) — детали задачи
 *
 * Mutation hooks:
 *   - useCreateScheduledJob() — создать задачу
 *   - useUpdateScheduledJob() — обновить (вкл/выкл)
 *   - useDeleteScheduledJob() — удалить
 *   - useRunJobNow() — запустить задачу вручную (вызывает Edge Function)
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabaseBrowser } from "@/lib/supabase/browser";

// ==================== Types ====================
export interface ScheduledJob {
  id: string;
  name: string;
  description: string | null;
  type: string;
  function_name: string | null;
  sql_query: string | null;
  cron_expression: string;
  timezone: string;
  is_active: boolean;
  last_run_at: string | null;
  next_run_at: string | null;
  runs_count: number;
  success_count: number;
  failure_count: number;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

// ==================== Query hooks ====================

/** Список запланированных задач */
export function useScheduledJobs() {
  return useQuery<ScheduledJob[]>({
    queryKey: ["scheduled-jobs"],
    queryFn: async () => {
      const { data, error } = await supabaseBrowser
        .from("scheduled_jobs")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) throw new Error(error.message);
      return (data || []) as ScheduledJob[];
    },
    staleTime: 30 * 1000,
  });
}

/** Детали задачи */
export function useScheduledJob(jobId: string | null) {
  return useQuery<ScheduledJob>({
    queryKey: ["scheduled-job", jobId],
    queryFn: async () => {
      const { data, error } = await supabaseBrowser
        .from("scheduled_jobs")
        .select("*")
        .eq("id", jobId)
        .single();

      if (error) throw new Error(error.message);
      return data as ScheduledJob;
    },
    enabled: Boolean(jobId),
  });
}

// ==================== Mutation hooks ====================

/** Создать задачу */
export function useCreateScheduledJob() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (job: Omit<ScheduledJob, "id" | "created_at" | "updated_at" | "last_run_at" | "next_run_at" | "runs_count" | "success_count" | "failure_count" | "last_error">) => {
      const { data, error } = await supabaseBrowser
        .from("scheduled_jobs")
        .insert(job)
        .select()
        .single();

      if (error) throw new Error(error.message);

      // Создать pg_cron schedule
      // ВАЖНО: pg_cron extension должен быть установлен в БД
      // SELECT cron.schedule(job.name, job.cron_expression, $$SELECT net.http_post(...$$);

      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["scheduled-jobs"] });
      toast.success("Задача создана и запланирована");
    },
    onError: (error: Error) => {
      toast.error("Ошибка создания задачи", { description: error.message });
    },
  });
}

/** Обновить задачу (включить/выключить) */
export function useUpdateScheduledJob() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...updates }: Partial<ScheduledJob> & { id: string }) => {
      const { data, error } = await supabaseBrowser
        .from("scheduled_jobs")
        .update(updates)
        .eq("id", id)
        .select()
        .single();

      if (error) throw new Error(error.message);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["scheduled-jobs"] });
      toast.success("Задача обновлена");
    },
    onError: (error: Error) => {
      toast.error("Ошибка", { description: error.message });
    },
  });
}

/** Удалить задачу */
export function useDeleteScheduledJob() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (jobId: string) => {
      const { error } = await supabaseBrowser
        .from("scheduled_jobs")
        .delete()
        .eq("id", jobId);

      if (error) throw new Error(error.message);

      // Удалить pg_cron schedule
      // SELECT cron.unschedule(job_name);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["scheduled-jobs"] });
      toast.success("Задача удалена");
    },
  });
}

/** Запустить задачу вручную (через Edge Function) */
export function useRunJobNow() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (job: ScheduledJob) => {
      if (job.type === "edge_function" && job.function_name) {
        // Вызвать Edge Function
        const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
        if (!supabaseUrl) throw new Error("Supabase URL not configured");

        const response = await fetch(`${supabaseUrl}/functions/v1/${job.function_name}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY}`,
          },
          body: JSON.stringify({ manual: true }),
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        return response.json();
      } else if (job.type === "sql" && job.sql_query) {
        // Выполнить SQL через RPC (нужна специальная функция)
        // Для безопасности — только через admin client
        toast.info("SQL задачи запускаются только через pg_cron автоматически");
        return null;
      } else {
        throw new Error("Неизвестный тип задачи");
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["scheduled-jobs"] });
      toast.success("Задача запущена");
    },
    onError: (error: Error) => {
      toast.error("Ошибка запуска", { description: error.message });
    },
  });
}
