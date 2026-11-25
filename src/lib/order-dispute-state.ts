export type OrderDisputeStatus =
  | "open"
  | "under_review"
  | "awaiting_customer"
  | "resolved"
  | "rejected";

const TRANSITIONS: Record<OrderDisputeStatus, readonly OrderDisputeStatus[]> = {
  open: ["under_review"],
  under_review: ["awaiting_customer", "resolved", "rejected"],
  awaiting_customer: ["under_review", "resolved", "rejected"],
  resolved: [],
  rejected: [],
};

export function canTransitionOrderDispute(
  current: string,
  next: string
): boolean {
  return (TRANSITIONS[current as OrderDisputeStatus] ?? []).includes(next as OrderDisputeStatus);
}

export function isTerminalOrderDisputeStatus(status: string): boolean {
  return status === "resolved" || status === "rejected";
}
