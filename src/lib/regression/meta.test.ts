/**
 * src/lib/regression/meta.test.ts — unit-тесты хелперов regression-runner
 * (scripts/regression/lib/meta.mjs, Task Z31-3-a).
 *
 * Импорт .mjs по относительному пути — модуль намеренно plain Node ESM
 * (без @/ алиасов), чтобы его использовали и node-скрипты, и vitest.
 */
import { describe, expect, it } from "vitest";
import {
  classifyExit,
  computeFileFingerprint,
  errorCodeForCheck,
  extractVitestFailures,
  filterChangedSources,
  normalizeForFingerprint,
  severityForCheck,
  tail,
} from "../../../scripts/regression/lib/meta.mjs";

describe("normalizeForFingerprint", () => {
  it("replaces UUIDs with <uuid>", () => {
    const out = normalizeForFingerprint(
      "request 550e8400-e29b-41d4-a716-446655440000 failed"
    );
    expect(out).toContain("<uuid>");
    expect(out).not.toContain("550e8400");
  });

  it("replaces hex runs >= 16 chars with <hex>", () => {
    const out = normalizeForFingerprint("sha deadbeefdeadbeef mismatch");
    expect(out).toContain("<hex>");
    expect(out).not.toContain("deadbeefdeadbeef");
  });

  it("replaces numbers >= 4 digits with <num>", () => {
    expect(normalizeForFingerprint("took 1234 ms")).toContain("<num>");
    // 3 знака — не число-плейсхолдер
    expect(normalizeForFingerprint("took 123 ms")).not.toContain("<num>");
    expect(normalizeForFingerprint("took 123 ms")).toContain("123");
  });

  it("lowercases, collapses whitespace and trims", () => {
    expect(normalizeForFingerprint("  A   b  ")).toBe("a b");
  });

  it("caps the result at 300 chars", () => {
    const out = normalizeForFingerprint("x".repeat(500));
    expect(out.length).toBe(300);
  });
});

describe("computeFileFingerprint", () => {
  it("is deterministic for the same parts", () => {
    expect(computeFileFingerprint(["vitest", "regression_vitest_failed"])).toBe(
      computeFileFingerprint(["vitest", "regression_vitest_failed"])
    );
  });

  it("returns 40 hex chars", () => {
    const fp = computeFileFingerprint(["a", "b"]);
    expect(fp).toMatch(/^[0-9a-f]{40}$/);
  });

  it("differs for different parts", () => {
    expect(computeFileFingerprint(["a", "b"])).not.toBe(
      computeFileFingerprint(["a", "c"])
    );
  });
});

describe("severityForCheck / errorCodeForCheck", () => {
  it.each([
    ["typecheck", "error"],
    ["vitest", "error"],
    ["route-error-coverage", "error"],
    ["build", "error"],
    ["eslint", "warning"],
    ["custom-check", "info"],
  ])("severityForCheck(%s) === %s", (name, expected) => {
    expect(severityForCheck(name)).toBe(expected);
  });

  it.each([
    ["typecheck", "regression_typecheck_failed"],
    ["vitest", "regression_vitest_failed"],
    ["eslint", "regression_eslint_failed"],
    ["route-error-coverage", "regression_route_error_coverage_failed"],
    ["build", "regression_build_failed"],
    ["My Check", "regression_my_check_failed"],
  ])("errorCodeForCheck(%s) === %s", (name, expected) => {
    expect(errorCodeForCheck(name)).toBe(expected);
  });
});

describe("classifyExit", () => {
  it("marks exit code 0 as passed", () => {
    expect(classifyExit("vitest", 0)).toEqual({ passed: true });
  });

  it("marks non-zero exit code as failed", () => {
    expect(classifyExit("vitest", 1)).toEqual({ passed: false });
    expect(classifyExit("typecheck", -1)).toEqual({ passed: false });
  });
});

describe("extractVitestFailures", () => {
  it("extracts the test chain from vitest default reporter FAIL lines", () => {
    const output = [
      " RUN  v4.1.0 /repo",
      "",
      " FAIL  src/app/api/checkout/snapshot-write.test.ts > snapshot write > persists snapshot",
      "   ✓ some passing test",
    ].join("\n");
    const failures = extractVitestFailures(output);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toBe("snapshot write > persists snapshot");
    expect(failures[0]).toContain("persists snapshot");
  });

  it("returns [] when no line matches FAIL", () => {
    const output = " PASS  src/lib/a.test.ts > suite > ok\n Tests  1 passed (1)\n";
    expect(extractVitestFailures(output)).toEqual([]);
  });

  it("dedupes repeated failures and keeps unique names", () => {
    const output = [
      " FAIL  src/a.test.ts > suite > one",
      " FAIL  src/a.test.ts > suite > one",
      " FAIL  src/b.test.ts > suite > two",
    ].join("\n");
    expect(extractVitestFailures(output)).toEqual(["suite > one", "suite > two"]);
  });

  it("returns [] for empty input", () => {
    expect(extractVitestFailures("")).toEqual([]);
    expect(extractVitestFailures(null)).toEqual([]);
    expect(extractVitestFailures(undefined)).toEqual([]);
  });

  it("handles legacy FAIL lines without a chain", () => {
    expect(extractVitestFailures("FAIL src/lib/legacy.test.ts\n")).toEqual([
      "src/lib/legacy.test.ts",
    ]);
  });
});

describe("tail", () => {
  it("returns the last max chars", () => {
    expect(tail("abcdef", 4)).toBe("cdef");
  });

  it("returns the whole string when shorter than max", () => {
    expect(tail("abc", 10)).toBe("abc");
    expect(tail("abc")).toBe("abc");
  });

  it("returns empty string for null/undefined", () => {
    expect(tail(null)).toBe("");
    expect(tail(undefined)).toBe("");
    expect(tail(null, 4)).toBe("");
  });
});

describe("filterChangedSources", () => {
  it("keeps only non-test ts/tsx sources and dedupes", () => {
    const input = [
      "src/lib/a.ts",
      "src/lib/a.test.ts",
      "src/components/b.tsx",
      "src/components/b.test.tsx",
      "node_modules/pkg/c.ts",
      ".next/cache/d.ts",
      "docs/e.md",
      "src/lib/a.ts",
    ];
    expect(filterChangedSources(input)).toEqual(["src/lib/a.ts", "src/components/b.tsx"]);
  });

  it("returns [] for empty input", () => {
    expect(filterChangedSources([])).toEqual([]);
  });
});
