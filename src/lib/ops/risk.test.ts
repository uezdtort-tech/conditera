/**
 * Unit-тесты Risk Engine + State Transitions (ТЗ P0.5 §12, §6, §45).
 */

import { describe, expect, it } from "vitest";
import { computeOrderRisk, type RiskInput } from "./risk";
import { deriveLifecycle, deriveNextAction, isTransitionAllowed } from "./lifecycle";
import { estimateItemProductionMinutes, estimateOrderProductionMinutes, isProductTimeMissing } from "./production-duration";
import { DEFAULT_MATCHING_WEIGHTS } from "./lifecycle-config";

function baseRisk(overrides: Partial<RiskInput> = {}): RiskInput {
  return {
    order: {
      status: "CONFIRMED",
      paymentStatus: "escrow",
      confectionerId: "u1",
      deliveryDate: "2026-10-10",
      deliveryType: "delivery",
    },
    production: {
      estimatedMinutes: 180,
      estimateApproximate: false,
      latestSafeStartAt: new Date(Date.now() + 6 * 3600_000),
      deadlineAt: new Date(Date.now() + 12 * 3600_000),
      startedAt: null,
      readyPhotoRequired: false,
      photoAttached: false,
      checklistComplete: false,
    },
    capacity: { fits: true, utilizationPercent: 40 },
    inventory: { shortageCount: 0 },
    hasReservation: true,
    now: new Date(),
    ...overrides,
  };
}

describe("computeOrderRisk — уровни (ТЗ §12)", () => {
  it("GREEN: всё с запасом", () => {
    const r = computeOrderRisk(baseRisk());
    expect(r.level).toBe("GREEN");
    expect(r.reasons).toHaveLength(0);
  });

  it("YELLOW: не оплачен (нет других проблем)", () => {
    const r = computeOrderRisk(
      baseRisk({
        order: { status: "PENDING", paymentStatus: "pending", confectionerId: null, deliveryDate: null, deliveryType: null },
        capacity: { fits: null, utilizationPercent: null },
      })
    );
    expect(r.level).toBe("YELLOW");
    expect(r.reasons).toContain("PAYMENT_NOT_CONFIRMED");
  });

  it("ORANGE: окно не закреплено (CAPACITY_NOT_RESERVED) при дедлайне < 48ч", () => {
    const r = computeOrderRisk(
      baseRisk({
        hasReservation: false,
        capacity: { fits: null, utilizationPercent: 30 },
      })
    );
    expect(r.reasons).toContain("CAPACITY_NOT_RESERVED");
    // дедлайн через 12ч → ORANGE
    expect(r.level).toBe("ORANGE");
  });

  it("YELLOW: окно не закреплено, но дедлайн далеко (>48ч)", () => {
    const r = computeOrderRisk(
      baseRisk({
        hasReservation: false,
        capacity: { fits: null, utilizationPercent: 10 },
        production: {
          estimatedMinutes: 180,
          estimateApproximate: false,
          latestSafeStartAt: new Date(Date.now() + 72 * 3600_000),
          deadlineAt: new Date(Date.now() + 96 * 3600_000),
          startedAt: null,
          readyPhotoRequired: false,
          photoAttached: false,
          checklistComplete: false,
        },
      })
    );
    expect(r.level).toBe("YELLOW");
  });

  it("RED: безопасное время старта прошло, производство не начато", () => {
    const r = computeOrderRisk(
      baseRisk({
        production: {
          estimatedMinutes: 180,
          estimateApproximate: false,
          latestSafeStartAt: new Date(Date.now() - 30 * 60_000),
          deadlineAt: new Date(Date.now() + 3 * 3600_000),
          startedAt: null,
          readyPhotoRequired: false,
          photoAttached: false,
          checklistComplete: false,
        },
      })
    );
    expect(r.reasons).toContain("PRODUCTION_NOT_STARTED");
    expect(r.level).toBe("RED");
  });

  it("ORANGE: перегруз кондитера (CAPACITY_EXCEEDED)", () => {
    const r = computeOrderRisk(
      baseRisk({
        hasReservation: false,
        capacity: { fits: false, utilizationPercent: 110 },
      })
    );
    expect(r.reasons).toContain("CAPACITY_EXCEEDED");
    expect(r.level).toBe("ORANGE");
  });

  it("NO_CONFECTIONER — жёсткая причина", () => {
    const r = computeOrderRisk(
      baseRisk({
        order: { status: "CONFIRMED", paymentStatus: "escrow", confectionerId: null, deliveryDate: "2026-10-10", deliveryType: "delivery" },
        capacity: { fits: null, utilizationPercent: null },
        hasReservation: false,
      })
    );
    expect(r.reasons).toContain("NO_CONFECTIONER");
    expect(["ORANGE", "RED"]).toContain(r.level);
  });

  it("LOW_STOCK → ORANGE", () => {
    const r = computeOrderRisk(baseRisk({ inventory: { shortageCount: 2 } }));
    expect(r.reasons).toContain("LOW_STOCK");
    expect(r.level).toBe("ORANGE");
  });

  it("терминальные статусы — GREEN", () => {
    for (const status of ["COMPLETED", "CANCELLED", "DELIVERED", "REFUNDED"]) {
      const r = computeOrderRisk(baseRisk({ order: { ...baseRisk().order, status } }));
      expect(r.level).toBe("GREEN");
    }
  });

  it("производство начато → PRODUCTION_NOT_STARTED не появляется", () => {
    const r = computeOrderRisk(
      baseRisk({
        production: {
          ...baseRisk().production,
          startedAt: new Date(Date.now() - 3600_000),
        },
      })
    );
    expect(r.reasons).not.toContain("PRODUCTION_NOT_STARTED");
  });
});

// ---------------------------------------------------------------------------
// State transitions (ТЗ §6)
// ---------------------------------------------------------------------------

describe("isTransitionAllowed", () => {
  it("разрешённые переходы", () => {
    expect(isTransitionAllowed("PENDING", "CONFIRMED")).not.toBeNull();
    expect(isTransitionAllowed("PENDING", "CANCELLED")).not.toBeNull();
    expect(isTransitionAllowed("CONFIRMED", "PREPARING")).not.toBeNull();
    expect(isTransitionAllowed("PREPARING", "READY")).not.toBeNull();
    expect(isTransitionAllowed("READY", "IN_DELIVERY")).not.toBeNull();
    expect(isTransitionAllowed("IN_DELIVERY", "DELIVERED")).not.toBeNull();
    expect(isTransitionAllowed("DELIVERED", "COMPLETED")).not.toBeNull();
    expect(isTransitionAllowed("DELIVERED", "REFUNDED")).not.toBeNull();
  });

  it("запрещённые переходы (ТЗ §6: created→completed, cancelled→in_production, refunded→completed)", () => {
    expect(isTransitionAllowed("PENDING", "COMPLETED")).toBeNull();
    expect(isTransitionAllowed("CANCELLED", "PREPARING")).toBeNull();
    expect(isTransitionAllowed("REFUNDED", "COMPLETED")).toBeNull();
    expect(isTransitionAllowed("PENDING", "IN_DELIVERY")).toBeNull();
    expect(isTransitionAllowed("COMPLETED", "PREPARING")).toBeNull();
    expect(isTransitionAllowed("READY", "CONFIRMED")).toBeNull();
  });

  it("самовывоз: READY→DELIVERED разрешён (ТЗ §36)", () => {
    expect(isTransitionAllowed("READY", "DELIVERED")).not.toBeNull();
  });
});

describe("deriveLifecycle (ТЗ §5)", () => {
  it("назначен + план → productionStatus=planned", () => {
    const d = deriveLifecycle({
      status: "CONFIRMED",
      paymentStatus: "escrow",
      confectionerId: "u1",
      hasReservation: true,
      startedAt: null,
      qcDone: false,
      productionCompleted: false,
      handoffRecorded: false,
      deliveryType: "delivery",
    });
    expect(d.businessStatus).toBe("confirmed");
    expect(d.productionStatus).toBe("planned");
    expect(d.assignmentStatus).toBe("assigned");
    expect(d.deliveryStatus).toBe("not_ready");
  });

  it("без плана → not_started; unassigned", () => {
    const d = deriveLifecycle({
      status: "CONFIRMED",
      paymentStatus: "pending",
      confectionerId: null,
      hasReservation: false,
      startedAt: null,
      qcDone: false,
      productionCompleted: false,
      handoffRecorded: false,
      deliveryType: "delivery",
    });
    expect(d.productionStatus).toBe("not_started");
    expect(d.assignmentStatus).toBe("unassigned");
  });

  it("PREPARING + QC → quality_check; READY → ready", () => {
    const d = deriveLifecycle({
      status: "PREPARING",
      paymentStatus: "escrow",
      confectionerId: "u1",
      hasReservation: true,
      startedAt: new Date(),
      qcDone: true,
      productionCompleted: false,
      handoffRecorded: false,
      deliveryType: "delivery",
    });
    expect(d.productionStatus).toBe("quality_check");

    const d2 = deriveLifecycle({
      status: "READY",
      paymentStatus: "escrow",
      confectionerId: "u1",
      hasReservation: false,
      startedAt: new Date(),
      qcDone: true,
      productionCompleted: true,
      handoffRecorded: false,
      deliveryType: "delivery",
    });
    expect(d2.productionStatus).toBe("ready");
    expect(d2.deliveryStatus).toBe("ready_for_handoff");
  });

  it("платёжный и бизнес статусы не смешиваются (ТЗ §5)", () => {
    const d = deriveLifecycle({
      status: "PENDING",
      paymentStatus: "escrow",
      confectionerId: null,
      hasReservation: false,
      startedAt: null,
      qcDone: false,
      productionCompleted: false,
      handoffRecorded: false,
      deliveryType: "delivery",
    });
    expect(d.businessStatus).toBe("created"); // бизнес: создан
    // платёжный остаётся escrow — отдельное поле, не входит в derived.businessStatus
  });
});

describe("deriveNextAction", () => {
  it("все ветки", () => {
    expect(deriveNextAction({ status: "PENDING", paymentStatus: "pending", confectionerId: null, hasReservation: false, qcDone: false, productionCompleted: false, readyPhotoRequired: false, photoAttached: false, deliveryType: null }).code).toBe("WAIT_PAYMENT");
    expect(deriveNextAction({ status: "PENDING", paymentStatus: "escrow", confectionerId: null, hasReservation: false, qcDone: false, productionCompleted: false, readyPhotoRequired: false, photoAttached: false, deliveryType: null }).code).toBe("ASSIGN");
    expect(deriveNextAction({ status: "CONFIRMED", paymentStatus: "escrow", confectionerId: "u", hasReservation: true, qcDone: false, productionCompleted: false, readyPhotoRequired: false, photoAttached: false, deliveryType: null }).code).toBe("START_PRODUCTION");
    expect(deriveNextAction({ status: "PREPARING", paymentStatus: "escrow", confectionerId: "u", hasReservation: true, qcDone: false, productionCompleted: false, readyPhotoRequired: false, photoAttached: false, deliveryType: null }).code).toBe("CONTINUE_PRODUCTION");
    expect(deriveNextAction({ status: "PREPARING", paymentStatus: "escrow", confectionerId: "u", hasReservation: true, qcDone: true, productionCompleted: false, readyPhotoRequired: true, photoAttached: false, deliveryType: null }).code).toBe("ATTACH_READY_PHOTO");
    expect(deriveNextAction({ status: "READY", paymentStatus: "escrow", confectionerId: "u", hasReservation: false, qcDone: true, productionCompleted: true, readyPhotoRequired: true, photoAttached: true, deliveryType: "pickup" }).code).toBe("HANDOFF_CUSTOMER");
    expect(deriveNextAction({ status: "IN_DELIVERY", paymentStatus: "escrow", confectionerId: "u", hasReservation: false, qcDone: true, productionCompleted: true, readyPhotoRequired: false, photoAttached: true, deliveryType: "delivery" }).code).toBe("CONFIRM_DELIVERY");
    expect(deriveNextAction({ status: "DELIVERED", paymentStatus: "escrow", confectionerId: "u", hasReservation: false, qcDone: true, productionCompleted: true, readyPhotoRequired: false, photoAttached: true, deliveryType: null }).code).toBe("COMPLETE");
  });
});

// ---------------------------------------------------------------------------
// Production time (ТЗ §10)
// ---------------------------------------------------------------------------

describe("production duration estimate", () => {
  it("product.production_time_hours приоритетен (configured)", () => {
    const e = estimateItemProductionMinutes({
      productProductionTimeHours: 4,
      recipePrepMinutes: 30,
      recipeCookMinutes: 60,
      categorySlug: "cakes",
    });
    expect(e.minutes).toBe(240);
    expect(e.source).toBe("product");
    expect(e.approximate).toBe(false);
  });

  it("recipe prep+cook второй приоритет", () => {
    const e = estimateItemProductionMinutes({
      productProductionTimeHours: null,
      recipePrepMinutes: 45,
      recipeCookMinutes: 75,
      categorySlug: "cakes",
    });
    expect(e.minutes).toBe(120);
    expect(e.source).toBe("recipe");
    expect(e.approximate).toBe(false);
  });

  it("category default — approximate", () => {
    const e = estimateItemProductionMinutes({
      productProductionTimeHours: null,
      recipePrepMinutes: null,
      recipeCookMinutes: null,
      categorySlug: "cupcakes",
    });
    expect(e.minutes).toBe(120);
    expect(e.source).toBe("category");
    expect(e.approximate).toBe(true);
  });

  it("ничего не известно → глобальный default approximate", () => {
    const e = estimateItemProductionMinutes({
      productProductionTimeHours: null,
      recipePrepMinutes: null,
      recipeCookMinutes: null,
      categorySlug: "unknown",
    });
    expect(e.source).toBe("default");
    expect(e.approximate).toBe(true);
  });

  it("партия: quantity 11 → коэффициент 1.4 (×2 полных пятерки сверх первой)", () => {
    const e = estimateOrderProductionMinutes([
      { quantity: 11, time: { productProductionTimeHours: 2, recipePrepMinutes: null, recipeCookMinutes: null, categorySlug: null } },
    ]);
    expect(e.minutes).toBe(Math.round(120 * 1.4));
  });

  it("max по позициям", () => {
    const e = estimateOrderProductionMinutes([
      { quantity: 1, time: { productProductionTimeHours: 1, recipePrepMinutes: null, recipeCookMinutes: null, categorySlug: null } },
      { quantity: 1, time: { productProductionTimeHours: 3, recipePrepMinutes: null, recipeCookMinutes: null, categorySlug: null } },
    ]);
    expect(e.minutes).toBe(180);
  });

  it("isProductTimeMissing — флаг админ-проблемы (ТЗ §30)", () => {
    expect(isProductTimeMissing({ productProductionTimeHours: null, recipePrepMinutes: null, recipeCookMinutes: null, categorySlug: "cakes" })).toBe(true);
    expect(isProductTimeMissing({ productProductionTimeHours: 2, recipePrepMinutes: null, recipeCookMinutes: null, categorySlug: null })).toBe(false);
    expect(isProductTimeMissing(null)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Matching weights (ТЗ §15) — конфигурация
// ---------------------------------------------------------------------------

describe("matching weights config", () => {
  it("сумма весов = 100", () => {
    const sum = Object.values(DEFAULT_MATCHING_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(sum).toBe(100);
  });
});
