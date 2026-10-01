/**
 * payout-complete-race.ts — разрешение гонки reject↔complete при подтверждении выплаты.
 *
 * Аудит @ 18651d4 (F-1): admin complete помечает заказы (payout_transferred_at)
 * ДО CAS-перехода approved→paid. Если в окне между маркировкой и CAS админ-2
 * успевает reject (CAS approved→rejected выигрывает), заявка отклоняется:
 * резерв возвращается RPC add_confectioner_balance, но заказы остаются
 * помеченными payout_transferred_at — батч навсегда выбывает из eligible
 * при возвращённом резерве (дрейф «баланс восстановлен ↔ заказы помечены
 * выплаченными»).
 *
 * Правило разрешения (по статусу заявки ПОСЛЕ проигранного CAS):
 *   • "paid"     — конкурентом был ВТОРОЙ complete: его маркировка легитимна,
 *                  наш ретрай считается идемпотентным успехом.
 *   • "rejected" — конкурентом был reject: резерв возвращён, снимаем ТОЛЬКО
 *                  свою маркировку (по своему timestamp — payout_request_id
 *                  уже мог быть сброшен reject'ом), дрейфа нет.
 *   • null/прочее — заявка удалена/неизвестное состояние: ничего не трогаем,
 *                  требуется оператор.
 */

export interface CompleteRaceResolution {
  /** Считать операцию успешной (идемпотентный ретрай поверх конкурентного complete). */
  treatAsSuccess: boolean;
  /** Снять собственную маркировку payout_transferred_at. */
  unmarkOwn: boolean;
  /** Заявка в неизвестном состоянии — нужен оператор, ничего не менять. */
  needsOps: boolean;
}

export function resolveCompleteRace(statusAfter: string | null): CompleteRaceResolution {
  switch (statusAfter) {
    case "paid":
      return { treatAsSuccess: true, unmarkOwn: false, needsOps: false };
    case "rejected":
      return { treatAsSuccess: false, unmarkOwn: true, needsOps: false };
    default:
      return { treatAsSuccess: false, unmarkOwn: false, needsOps: true };
  }
}
