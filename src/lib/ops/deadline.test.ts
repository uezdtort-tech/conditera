/**
 * Unit-тесты Deadline Engine (ТЗ P0.5 §45).
 * Пример ТЗ §11: 18:00 − 30m − 15m − 20m − 15m − 3h = 13:55
 */

import { describe, expect, it } from "vitest";
import {
  computeDeadlineAt,
  computeLatestSafeStart,
  marginMinutes,
  minuteToHHMM,
  parseDeadlineMinuteOfDay,
  parseFirstTime,
  parseTimeToMinute,
  parseWindowEnd,
  dateAtMinute,
  formatDuration,
} from "./deadline";
import { DEFAULT_DEADLINE_BUFFERS } from "./lifecycle-config";

describe("parseTimeToMinute", () => {
  it("парсит HH:MM", () => {
    expect(parseTimeToMinute("18:00")).toBe(1080);
    expect(parseTimeToMinute("9:30")).toBe(570);
    expect(parseTimeToMinute("00:00")).toBe(0);
  });

  it("мусор → null", () => {
    expect(parseTimeToMinute("abc")).toBeNull();
    expect(parseTimeToMinute("25:00")).toBeNull();
    expect(parseTimeToMinute("12:99")).toBeNull();
  });
});

describe("parseWindowEnd", () => {
  it("'10:00-14:00' → 840 (конец окна)", () => {
    expect(parseWindowEnd("10:00-14:00")).toBe(840);
  });

  it("разные разделители тире", () => {
    expect(parseWindowEnd("10:00–14:00")).toBe(840);
    expect(parseWindowEnd("10:00—14:00")).toBe(840);
  });

  it("null/мусор → null", () => {
    expect(parseWindowEnd(null)).toBeNull();
    expect(parseWindowEnd("14:00")).toBeNull(); // нет конца окна
  });
});

describe("parseFirstTime", () => {
  it("первое вхождение в свободном тексте", () => {
    expect(parseFirstTime("после 18:30")).toBe(1110);
    expect(parseFirstTime("к 9.00")).toBe(540);
  });

  it("мусор → null", () => {
    expect(parseFirstTime("когда-нибудь")).toBeNull();
    expect(parseFirstTime(null)).toBeNull();
  });
});

describe("parseDeadlineMinuteOfDay", () => {
  it("приоритет: окно → delivery_time → default 18:00", () => {
    expect(parseDeadlineMinuteOfDay("10:00-14:00", "19:00")).toBe(840);
    expect(parseDeadlineMinuteOfDay(null, "19:00")).toBe(1140);
    expect(parseDeadlineMinuteOfDay(null, null)).toBe(1080);
  });
});

describe("computeDeadlineAt", () => {
  it("дата + окно → Date конца окна", () => {
    const d = computeDeadlineAt("2026-10-10", "15:00-18:00", "20:00");
    expect(d).not.toBeNull();
    expect(d!.getHours()).toBe(18);
    expect(d!.getMinutes()).toBe(0);
    expect(d!.getFullYear()).toBe(2026);
    expect(d!.getMonth()).toBe(9);
    expect(d!.getDate()).toBe(10);
  });

  it("нет даты → null", () => {
    expect(computeDeadlineAt(null, "10:00-14:00", null)).toBeNull();
  });

  it("24:00 окно → конец суток", () => {
    const d = computeDeadlineAt("2026-10-10", "00:00-24:00", null);
    expect(d!.getHours()).toBe(0);
    expect(d!.getDate()).toBe(11); // 1440 минут = полночь следующего дня
  });
});

describe("computeLatestSafeStart — пример ТЗ §11", () => {
  it("18:00 − 30m(delivery) − 20m(pack) − 15m(QC) − 3h = 13:55", () => {
    const deadline = dateAtMinute("2026-10-10", 1080); // 18:00
    const res = computeLatestSafeStart({
      deadlineAt: deadline,
      productionMinutes: 180,
      buffers: {
        deliveryBufferMinutes: 30,
        handoffBufferMinutes: 0,
        packagingMinutes: 20,
        qualityCheckMinutes: 15,
      },
    });
    expect(minuteToHHMM(res.latestSafeStartAt.getHours() * 60 + res.latestSafeStartAt.getMinutes())).toBe("13:55");
    expect(res.totalBackoffMinutes).toBe(30 + 20 + 15 + 180);
  });

  it("дефолтные буферы применяются", () => {
    const deadline = dateAtMinute("2026-10-10", 1080);
    const res = computeLatestSafeStart({ deadlineAt: deadline, productionMinutes: 60 });
    const total =
      DEFAULT_DEADLINE_BUFFERS.deliveryBufferMinutes +
      DEFAULT_DEADLINE_BUFFERS.handoffBufferMinutes +
      DEFAULT_DEADLINE_BUFFERS.packagingMinutes +
      DEFAULT_DEADLINE_BUFFERS.qualityCheckMinutes +
      60;
    expect(res.totalBackoffMinutes).toBe(total);
  });

  it("отрицательное производство → только буферы", () => {
    const deadline = dateAtMinute("2026-10-10", 600);
    const res = computeLatestSafeStart({ deadlineAt: deadline, productionMinutes: -5 });
    expect(res.totalBackoffMinutes).toBe(
      DEFAULT_DEADLINE_BUFFERS.deliveryBufferMinutes +
        DEFAULT_DEADLINE_BUFFERS.handoffBufferMinutes +
        DEFAULT_DEADLINE_BUFFERS.packagingMinutes +
        DEFAULT_DEADLINE_BUFFERS.qualityCheckMinutes
    );
  });
});

describe("marginMinutes", () => {
  it("положительный запас / отрицательный просрочка", () => {
    const now = new Date(2026, 9, 10, 12, 0);
    const later = dateAtMinute("2026-10-10", 13 * 60); // 13:00
    const earlier = dateAtMinute("2026-10-10", 11 * 60); // 11:00
    expect(marginMinutes(later, now)).toBe(60);
    expect(marginMinutes(earlier, now)).toBe(-60);
  });
});

describe("minuteToHHMM / formatDuration", () => {
  it("нормализация минут", () => {
    expect(minuteToHHMM(540)).toBe("09:00");
    expect(minuteToHHMM(1080)).toBe("18:00");
    expect(minuteToHHMM(0)).toBe("00:00");
  });

  it("формат длительности", () => {
    expect(formatDuration(150)).toBe("2ч 30м");
    expect(formatDuration(60)).toBe("1ч");
    expect(formatDuration(45)).toBe("45м");
    expect(formatDuration(-90)).toBe("-1ч 30м");
  });
});
