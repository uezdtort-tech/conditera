/**
 * visibility.ts — SQL-условие видимости ops_tasks для пользователя (Task 2-a).
 *
 * ADMIN/SUPER_ADMIN — видят ВСЁ (включая MODERATOR/CONFECTIONER-задачи):
 *   отступление от буквального чтения ТЗ сделано сознательно — админ является
 *   суперпользователем (паттерн MODERATOR-квартета: ADMIN всегда допущен) и
 *   смоук-требование «GET /api/ops/tasks под админом показывает LOW_STOCK и
 *   MEDIA_PENDING» иначе не выполняется.
 * MODERATOR — ADMIN+MODERATOR+общие (assignee_role IS NULL) + назначенные лично ему.
 * Остальные (CONFECTIONER и др.) — только назначенные лично (assignee_id = user.id).
 */

export interface OpsVisibilityUser {
  id: string;
  roles: string[];
}

export interface VisibilityFilter {
  /** SQL-фрагмент; ссылки на таблицу — через алиас t; параметры с $paramStart */
  clause: string;
  /** Значения параметров по порядку, начиная с paramStart */
  params: string[];
}

export function visibleTaskFilter(
  user: OpsVisibilityUser,
  paramStart = 1
): VisibilityFilter {
  const p = `$${paramStart}`;
  const roles = user.roles ?? [];

  if (roles.includes("ADMIN") || roles.includes("SUPER_ADMIN")) {
    return { clause: "TRUE", params: [] };
  }

  if (roles.includes("MODERATOR")) {
    return {
      clause: `(t.assignee_role IN ('ADMIN', 'MODERATOR') OR t.assignee_role IS NULL OR t.assignee_id = ${p}::uuid)`,
      params: [user.id],
    };
  }

  return { clause: `t.assignee_id = ${p}::uuid`, params: [user.id] };
}
