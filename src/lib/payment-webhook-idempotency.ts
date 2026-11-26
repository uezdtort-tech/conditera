const FINAL_PAYMENT_STATUSES = new Set(["succeeded", "cancelled", "refunded"]);

/**
 * Decide whether a webhook can be acknowledged as an already-applied replay.
 * payment.succeeded is intentionally excluded: a concurrent cancellation may
 * have won the order CAS and the repeated webhook must re-check compensation.
 */
export function shouldSkipFinalPaymentWebhook(
  event: string,
  currentStatus: string,
  incomingStatus: string
): boolean {
  return (
    event !== "refund.succeeded" &&
    event !== "payment.succeeded" &&
    FINAL_PAYMENT_STATUSES.has(currentStatus) &&
    currentStatus === incomingStatus
  );
}
