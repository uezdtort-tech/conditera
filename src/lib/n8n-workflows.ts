/**
 * n8n workflow types + workflow definitions (client-side metadata).
 *
 * The actual n8n workflow JSON files live in /n8n-workflows/*.json — these can
 * be imported directly into n8n via the UI.
 *
 * This file contains the lightweight metadata used by the admin dashboard
 * preview: node positions, connections, descriptions, schedules.
 */

export type NodeType =
  | "trigger"
  | "http"
  | "split"
  | "if"
  | "action"
  | "log"
  | "noop";

export interface WorkflowNode {
  id: string;
  name: string;
  type: NodeType;
  description: string;
  position: { x: number; y: number };
  /** Visual style */
  color: string;
  icon: string;
  /** Optional detail shown in expanded panel */
  detail?: string;
}

export interface WorkflowEdge {
  from: string;
  to: string;
  label?: string;
  /** Branch label for IF nodes: "true" | "false" */
  branch?: "true" | "false";
}

export interface Workflow {
  id: string;
  name: string;
  description: string;
  schedule: string;
  scheduleCron: string;
  icon: string;
  color: string;
  tags: string[];
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  /** Filename of the n8n JSON to import */
  jsonFile: string;
  /** Stats placeholder */
  estimatedUsersAffected: string;
  estimatedNotifications: string;
}

export const WORKFLOWS: Workflow[] = [
  {
    id: "abandoned-cart",
    name: "Брошенная корзина",
    description:
      "Каждый час проверяет корзины пользователей, которые были оставлены больше 2 часов назад без оформления заказа. Отправляет персонализированное напоминание с количеством товаров и суммой, плюс +50 бонусов за завершение в течение 24 часов.",
    schedule: "Каждый час",
    scheduleCron: "0 * * * *",
    icon: "🛒",
    color: "#f59e0b",
    tags: ["retention", "loyalty"],
    jsonFile: "01-abandoned-cart.json",
    estimatedUsersAffected: "8–15 в час",
    estimatedNotifications: "150–300 в день",
    nodes: [
      {
        id: "trigger",
        name: "Каждый час",
        type: "trigger",
        description: "Cron trigger — запускается каждый час в :00",
        position: { x: 0, y: 0 },
        color: "#10b981",
        icon: "⏰",
        detail: "scheduleTrigger · interval=1h",
      },
      {
        id: "fetch",
        name: "Найти брошенные корзины",
        type: "http",
        description: "GET /api/cron/abandoned-cart — возвращает список пользователей с корзинами старше 2 часов",
        position: { x: 220, y: 0 },
        color: "#3b82f6",
        icon: "🔍",
        detail: "Фильтры: createdAt < now-2h, нет заказов за 24h, не уведомлён, opted-in",
      },
      {
        id: "split",
        name: "Разделить по корзинам",
        type: "split",
        description: "splitOut — для каждого пользователя отдельная ветка выполнения",
        position: { x: 440, y: 0 },
        color: "#8b5cf6",
        icon: "🔀",
      },
      {
        id: "if",
        name: "Если не уведомлён",
        type: "if",
        description: "Проверяет, не отправляли ли мы уже напоминание по этой корзине",
        position: { x: 660, y: 0 },
        color: "#f59e0b",
        icon: "❓",
      },
      {
        id: "send",
        name: "Отправить напоминание",
        type: "action",
        description: "POST /api/notifications/send · template=ABANDONED_CART · channels: email, push, in_app",
        position: { x: 880, y: -80 },
        color: "#ec4899",
        icon: "✉️",
        detail: "Vars: itemsCount, total\n+50 бонусов за завершение в 24ч",
      },
      {
        id: "mark",
        name: "Пометить как уведомлённый",
        type: "action",
        description: "PATCH /api/cron/abandoned-cart — чтобы не дублировать напоминания",
        position: { x: 1100, y: -80 },
        color: "#6b7280",
        icon: "✓",
      },
      {
        id: "skip",
        name: "Пропустить",
        type: "noop",
        description: "Корзина уже получила напоминание — пропускаем",
        position: { x: 880, y: 80 },
        color: "#9ca3af",
        icon: "⏭️",
      },
    ],
    edges: [
      { from: "trigger", to: "fetch" },
      { from: "fetch", to: "split" },
      { from: "split", to: "if" },
      { from: "if", to: "send", label: "да", branch: "true" },
      { from: "if", to: "skip", label: "нет", branch: "false" },
      { from: "send", to: "mark" },
    ],
  },
  {
    id: "weekly-digest",
    name: "Дайджест недели",
    description:
      "Каждый понедельник в 10:00 отправляет активным пользователям email-дайджест: новые товары, активные акции, новые кондитеры на платформе, новые пользователи. Только тем, кто opted-in в настройках уведомлений.",
    schedule: "Пн 10:00 (раз в неделю)",
    scheduleCron: "0 10 * * 1",
    icon: "📧",
    color: "#3b82f6",
    tags: ["email", "retention"],
    jsonFile: "02-weekly-digest.json",
    estimatedUsersAffected: "500–5000",
    estimatedNotifications: "500–5000 в неделю",
    nodes: [
      {
        id: "trigger",
        name: "Пн 10:00",
        type: "trigger",
        description: "Cron trigger — понедельник 10:00 Europe/Moscow",
        position: { x: 0, y: 0 },
        color: "#10b981",
        icon: "⏰",
        detail: "scheduleTrigger · weekly · Monday 10:00",
      },
      {
        id: "fetch",
        name: "Собрать данные дайджеста",
        type: "http",
        description: "GET /api/cron/weekly-digest — возвращает статистику недели + список opted-in пользователей",
        position: { x: 220, y: 0 },
        color: "#3b82f6",
        icon: "📊",
        detail: "Stats: newProducts, activePromos, newConfectioners, newUsers",
      },
      {
        id: "split",
        name: "Разделить по пользователям",
        type: "split",
        description: "Для каждого opted-in пользователя — отдельная ветка",
        position: { x: 440, y: 0 },
        color: "#8b5cf6",
        icon: "🔀",
      },
      {
        id: "send",
        name: "Отправить дайджест",
        type: "action",
        description: "POST /api/notifications/send · template=PROMO_NEAR_YOU · channels: email, in_app",
        position: { x: 660, y: 0 },
        color: "#ec4899",
        icon: "✉️",
        detail: "HTML email со статистикой недели и ссылками на новинки",
      },
      {
        id: "log",
        name: "Записать статус",
        type: "log",
        description: "POST /api/cron/status — записывает run в историю (для админ-панели)",
        position: { x: 880, y: 0 },
        color: "#6b7280",
        icon: "📝",
      },
    ],
    edges: [
      { from: "trigger", to: "fetch" },
      { from: "fetch", to: "split" },
      { from: "split", to: "send" },
      { from: "send", to: "log" },
    ],
  },
  {
    id: "expiring-bonuses",
    name: "Сгорание бонусов",
    description:
      "Каждый день в 09:00 находит пользователей, у которых есть бонусы, сгорающие в течение следующих 14 дней. Отправляет напоминание по email, push и in-app: «У вас сгорит N бонусов через M дней — используйте их при следующем заказе!»",
    schedule: "Ежедневно 09:00",
    scheduleCron: "0 9 * * *",
    icon: "⏰",
    color: "#ef4444",
    tags: ["loyalty", "retention"],
    jsonFile: "03-expiring-bonuses.json",
    estimatedUsersAffected: "5–30 в день",
    estimatedNotifications: "5–30 в день",
    nodes: [
      {
        id: "trigger",
        name: "09:00 каждый день",
        type: "trigger",
        description: "Cron trigger — ежедневно в 09:00 Europe/Moscow",
        position: { x: 0, y: 0 },
        color: "#10b981",
        icon: "⏰",
        detail: "scheduleTrigger · daily · 09:00",
      },
      {
        id: "fetch",
        name: "Найти сгорающие бонусы",
        type: "http",
        description: "GET /api/cron/expiring-bonuses — возвращает пользователей с EARN-транзакциями, истекающими в течение 14 дней",
        position: { x: 220, y: 0 },
        color: "#ef4444",
        icon: "🔥",
        detail: "WHERE type=EARN, expiresAt <= now+14d, GROUP BY userId, SUM(points)",
      },
      {
        id: "split",
        name: "Разделить по пользователям",
        type: "split",
        description: "Для каждого пользователя — отдельная ветка",
        position: { x: 440, y: 0 },
        color: "#8b5cf6",
        icon: "🔀",
      },
      {
        id: "send",
        name: "Отправить напоминание",
        type: "action",
        description: "POST /api/notifications/send · template=BONUS_EXPIRING · channels: email, push, in_app",
        position: { x: 660, y: 0 },
        color: "#ec4899",
        icon: "✉️",
        detail: "Vars: points, expiresAt\nПодсказка: «Используйте при следующем заказе»",
      },
      {
        id: "log",
        name: "Записать статус",
        type: "log",
        description: "POST /api/cron/status — записывает run + totalPoints в историю",
        position: { x: 880, y: 0 },
        color: "#6b7280",
        icon: "📝",
      },
    ],
    edges: [
      { from: "trigger", to: "fetch" },
      { from: "fetch", to: "split" },
      { from: "split", to: "send" },
      { from: "send", to: "log" },
    ],
  },
];

// ===== Cron run logs (in-memory demo, in prod stored in SiteSetting) =====
export interface CronRun {
  workflow: string;
  status: "success" | "failed" | "running";
  timestamp: string;
  duration?: number;
  sent?: number;
  notified?: number;
  totalPoints?: number;
  errorMessage?: string;
}

// Mock recent runs for preview
export const MOCK_RECENT_RUNS: CronRun[] = [
  {
    workflow: "abandoned-cart",
    status: "success",
    timestamp: new Date(Date.now() - 23 * 60 * 1000).toISOString(),
    duration: 1240,
    sent: 12,
  },
  {
    workflow: "expiring-bonuses",
    status: "success",
    timestamp: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
    duration: 890,
    notified: 8,
    totalPoints: 4250,
  },
  {
    workflow: "abandoned-cart",
    status: "success",
    timestamp: new Date(Date.now() - 83 * 60 * 1000).toISOString(),
    duration: 1180,
    sent: 15,
  },
  {
    workflow: "weekly-digest",
    status: "success",
    timestamp: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
    duration: 4520,
    sent: 1247,
  },
  {
    workflow: "expiring-bonuses",
    status: "success",
    timestamp: new Date(Date.now() - 27 * 60 * 60 * 1000).toISOString(),
    duration: 920,
    notified: 11,
    totalPoints: 6800,
  },
  {
    workflow: "abandoned-cart",
    status: "failed",
    timestamp: new Date(Date.now() - 143 * 60 * 1000).toISOString(),
    duration: 340,
    errorMessage: "Connection timeout to /api/cron/abandoned-cart",
  },
];
