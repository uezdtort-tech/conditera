/**
 * src/lib/crm/ticket-messages.ts — маппинг строки ticket_messages в UI-контракт.
 *
 * Вынесено из src/app/api/crm/tickets/[id]/messages/route.ts (R03V-фикс):
 * Next.js route-файлам разрешены только handler-экспорты — прочие экспорты
 * ломают генерируемую route-type проверку (TS2344). Функция использовалась
 * двумя маршрутами (messages и [id]) — общий lib-модуль устраняет импорт
 * маршрута из маршрута.
 *
 * Контракт не менялся: authorId/authorName/authorRole/message/isInternal/createdAt.
 */

/** Строка ticket_messages (0005_crm_cms.sql:52-63, snake_case). */
export interface TicketMessageRow {
  id: string;
  ticket_id: string;
  sender_id: string;
  text: string;
  is_internal: boolean | null;
  is_system: boolean | null;
  created_at: string;
}

export function mapTicketMessage(row: TicketMessageRow, ticketOwnerId: string) {
  const isOwner = row.sender_id === ticketOwnerId;
  return {
    id: row.id,
    ticketId: row.ticket_id,
    authorId: row.sender_id,
    authorName: isOwner ? "Клиент" : "Оператор поддержки",
    authorRole: row.is_system ? "system" : isOwner ? "customer" : "admin",
    message: row.text,
    isInternal: Boolean(row.is_internal),
    createdAt: row.created_at,
  };
}
