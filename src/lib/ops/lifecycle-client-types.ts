/**
 * lifecycle-client-types.ts — клиентские контракты P0.5
 * «Order Lifecycle & Capacity Engine» (используют UI-компоненты).
 */

// ---------------------------------------------------------------------------
// GET /api/orders/[id]/lifecycle
// ---------------------------------------------------------------------------

export interface LifecycleChecklistStage {
  id: string;
  order_id: string;
  stage_key: string;
  label: string;
  sort_order: number;
  is_done: boolean;
  done_at: string | null;
  done_by: string | null;
}

export interface LifecycleResponse {
  order: {
    id: string;
    number: string;
    status: string;
    payment_status: string;
    delivery_date: string | null;
    delivery_time_window: string | null;
    delivery_time: string | null;
    delivery_type: string | null;
    total: number;
    customer_id: string;
    confectioner_id: string | null;
    confectioner_name: string | null;
    created_at: string;
  };
  derived: {
    businessStatus: "created" | "confirmed" | "in_production" | "ready" | "completed" | "cancelled";
    productionStatus: "not_started" | "planned" | "in_production" | "quality_check" | "ready";
    assignmentStatus: "unassigned" | "assigned" | "reassignment_required";
    deliveryStatus: "not_ready" | "ready_for_handoff" | "handed_off" | "in_delivery" | "delivered";
  };
  nextAction: { code: string; label: string };
  risk: {
    level: "GREEN" | "YELLOW" | "ORANGE" | "RED";
    reasons: string[];
    details: string[];
    marginMinutes: number | null;
  };
  deadline: {
    deliveryDate: string | null;
    deadlineAt: string | null;
    latestSafeStartAt: string | null;
    productionMinutes: number | null;
    estimateSource: string | null;
    estimateApproximate: boolean;
  };
  reservation: {
    id: string;
    confectionerId: string;
    date: string;
    startMinute: number;
    endMinute: number;
    status: string;
  } | null;
  capacity: {
    utilizationPercent: number;
    freeMinutes: number;
    busyMinutes: number;
  } | null;
  production: {
    startedAt: string | null;
    completedAt: string | null;
    readyPhotoRequired: boolean;
    checklistComplete: boolean;
    checklist: LifecycleChecklistStage[];
  };
}

// ---------------------------------------------------------------------------
// GET /api/orders/[id]/timeline
// ---------------------------------------------------------------------------

export interface TimelineItem {
  at: string;
  type: string;
  title: string;
  source: string;
  payload: Record<string, unknown>;
  kind: "event" | "status";
  actor: string | null;
}

export interface TimelineResponse {
  order: { id: string; number: string };
  timeline: TimelineItem[];
}

// ---------------------------------------------------------------------------
// GET /api/ops/orders-today — Control Tower
// ---------------------------------------------------------------------------

export interface TowerCard {
  id: string;
  number: string;
  status: string;
  confectionerId: string | null;
  confectionerName: string | null;
  deliveryDate: string | null;
  deliveryType: string | null;
  isToday: boolean;
  productionStarted: boolean;
  capacityOk: boolean | null;
  inventoryOk: boolean;
  risk: {
    level: "GREEN" | "YELLOW" | "ORANGE" | "RED";
    reasons: string[];
    details: string[];
    marginMinutes: number | null;
  };
  latestSafeStartAt: string | null;
  deadlineAt: string | null;
}

export interface OrdersTodayResponse {
  generatedAt: string;
  today: string;
  counts: {
    ordersToday: number;
    all: number;
    onTrack: number;
    attention: number;
    atRisk: number;
    overdue: number;
    unassigned: number;
  };
  groups: {
    onTrack: TowerCard[];
    attention: TowerCard[];
    atRisk: TowerCard[];
    overdue: TowerCard[];
    unassigned: TowerCard[];
  };
  cards: TowerCard[];
}

// ---------------------------------------------------------------------------
// POST /api/orders/availability
// ---------------------------------------------------------------------------

export interface AvailabilityResponse {
  availability: "available" | "available_with_warning" | "unavailable";
  canAccept: boolean;
  risk: string;
  reasons: Array<{ code: string; message: string }>;
  suggestions: Array<{ code: string; message: string; alternativeAt?: string | null }>;
  alternativeWindows: Array<{ confectionerId: string | null; date: string; start: string; end: string }>;
  owners: Array<{
    confectionerId: string | null;
    confectionerName: string | null;
    items: string[];
    productionMinutes: number;
    estimateApproximate: boolean;
    inventory: { canProduce: boolean | null; shortageCount: number };
    capacity: {
      checked: boolean;
      fits: boolean | null;
      utilizationPercent: number | null;
      window: { start: string; end: string } | null;
    };
    deadline: {
      deliveryDate: string | null;
      deadlineAt: string | null;
      latestSafeStartAt: string | null;
      productionMinutes: number;
      marginMinutes: number | null;
    };
  }>;
}

// ---------------------------------------------------------------------------
// confectioner-today P0.5-дополнения (совместимо с ConfectionerTodayResponse)
// ---------------------------------------------------------------------------

export interface TodayPlanStage {
  stageKey: string;
  label: string;
  startMinute: number;
  endMinute: number;
  startTime: string;
  endTime: string;
  isDone: boolean;
}

export interface TodayPlanEntry {
  orderId: string;
  orderNumber: string;
  status: string;
  startMinute: number;
  endMinute: number;
  startTime: string;
  endTime: string;
  estimatedMinutes: number;
  stages: TodayPlanStage[];
  nextStage: string | null;
  riskLevel: string | null;
}

export interface ConfectionerTodayP05 {
  capacity: {
    utilizationPercent: number;
    freeMinutes: number;
    busyMinutes: number;
    workdayStartMinute: number;
    workdayEndMinute: number;
    isDefault: boolean;
  } | null;
  productionPlan: TodayPlanEntry[];
  nextAction: { orderId: string; orderNumber: string; action: string } | null;
  attention: {
    atRiskOrders: number;
    lowStockItems: number;
    unansweredChats: number;
  };
}

// ---------------------------------------------------------------------------
// POST assign/reassign/production endpoints — общая форма
// ---------------------------------------------------------------------------

export interface AssignResponse {
  ok: boolean;
  order: { id: string; number: string; confectioner_id?: string };
  confectioner?: { id: string; name: string | null };
  estimate: { minutes: number; source: string; approximate: boolean };
  deadline?: { deadlineAt: string | null; latestSafeStartAt: string | null };
  reservation: { id: string; date: string; startMinute: number; endMinute: number } | null;
  warning?: { code: string; message: string; detail?: Record<string, unknown> } | string | null;
}

export interface AssignmentCandidate {
  confectionerId: string;
  name: string;
  city: string | null;
  rating: number | null;
  specialization: string[];
  score: number;
  scoreBreakdown: Record<string, number | null>;
  reasons: string[];
  warnings: string[];
  capacity: {
    fits: boolean;
    utilizationPercent: number | null;
    freeMinutes: number | null;
    window: { start: string; end: string } | null;
    requiredMinutes: number;
  };
  inventory: { canProduce: boolean | null; shortageCount: number; shortageCost: number | null };
  conflict: { overloaded: boolean; message: string | null } | null;
}
