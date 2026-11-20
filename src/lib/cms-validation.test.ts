import { describe, expect, it } from "vitest";
import { areValidCmsNavigationRoles, getSafeCmsMediaExtension, hasValidCmsMediaSignature, isSafeCmsNavigationTarget, isSafeCmsUrl, isValidCmsDateTime, isValidCmsSchedule, isValidCmsSlug, validateCmsPageInput } from "./cms-validation";

describe("CMS validation", () => {
  it("allows HTTPS and same-origin paths only for CMS URLs", () => {
    expect(isSafeCmsUrl("https://cdn.example.com/banner.webp")).toBe(true);
    expect(isSafeCmsUrl("/images/banner.webp")).toBe(true);
    expect(isSafeCmsUrl("javascript:alert(1)")).toBe(false);
    expect(isSafeCmsUrl("//evil.example/path")).toBe(false);
    expect(isSafeCmsUrl("/\\\\evil.example/path")).toBe(false);
    expect(isSafeCmsUrl("https://user:pass@example.com/path")).toBe(false);
    expect(isSafeCmsUrl("http://example.com")).toBe(false);
    expect(isSafeCmsUrl("data:text/html,hello")).toBe(false);
    expect(isSafeCmsUrl("x".repeat(2049))).toBe(false);
  });

  it("validates banner dates and chronological order", () => {
    expect(isValidCmsDateTime(null)).toBe(true);
    expect(isValidCmsDateTime("not-a-date")).toBe(false);
    expect(isValidCmsSchedule("2026-01-01T10:00:00Z", "2026-01-01T11:00:00Z")).toBe(true);
    expect(isValidCmsSchedule("2026-01-01T12:00:00Z", "2026-01-01T11:00:00Z")).toBe(false);
  });

  it("validates internal navigation targets and known role names", () => {
    expect(isSafeCmsNavigationTarget("/catalog")).toBe(true);
    expect(isSafeCmsNavigationTarget("catalog")).toBe(true);
    expect(isSafeCmsNavigationTarget("//evil.example")).toBe(false);
    expect(isSafeCmsNavigationTarget("/\\\\evil.example")).toBe(false);
    expect(isSafeCmsNavigationTarget("https://external.example")).toBe(false);
    expect(areValidCmsNavigationRoles(["CUSTOMER", "CONFECTIONER"])).toBe(true);
    expect(areValidCmsNavigationRoles(["ROOT"])).toBe(false);
    expect(areValidCmsNavigationRoles(Array(31).fill("CUSTOMER"))).toBe(false);
  });

  it("allows only supported CMS media types and checks file signatures", () => {
    expect(getSafeCmsMediaExtension("image/png")).toBe("png");
    expect(getSafeCmsMediaExtension("image/svg+xml")).toBeNull();
    expect(hasValidCmsMediaSignature("image/png", new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(true);
    expect(hasValidCmsMediaSignature("image/png", new Uint8Array([0x25, 0x50, 0x44, 0x46]))).toBe(false);
    expect(hasValidCmsMediaSignature("application/pdf", new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]))).toBe(true);
    expect(hasValidCmsMediaSignature("video/webm", new Uint8Array([0x1a, 0x45, 0xdf, 0xa3]))).toBe(true);
  });

  it("accepts safe latin and Cyrillic slugs and rejects path tricks", () => {
    expect(isValidCmsSlug("about-us")).toBe(true);
    expect(isValidCmsSlug("доставка-и-оплата")).toBe(true);
    expect(isValidCmsSlug("hello_etc")).toBe(false);
    expect(isValidCmsSlug("../admin")).toBe(false);
    expect(isValidCmsSlug("Uppercase")).toBe(false);
    expect(isValidCmsSlug("a".repeat(121))).toBe(false);
  });

  it("validates complete page creation payloads", () => {
    expect(validateCmsPageInput({
      slug: "about-us",
      title: "О компании",
      content: "# Conditera",
      status: "draft",
    })).toBeNull();
    expect(validateCmsPageInput({ slug: "../x", title: "x", content: "x" })).not.toBeNull();
    expect(validateCmsPageInput({ slug: "ok", title: " ", content: "x" })).not.toBeNull();
    expect(validateCmsPageInput({ slug: "ok", title: "Title", content: "x", status: "deleted" })).not.toBeNull();
  });

  it("validates partial updates and bounds all user-controlled fields", () => {
    expect(validateCmsPageInput({ status: "published" }, true)).toBeNull();
    expect(validateCmsPageInput({ menuOrder: -1 }, true)).not.toBeNull();
    expect(validateCmsPageInput({ seoKeywords: Array(31).fill("keyword") }, true)).not.toBeNull();
    expect(validateCmsPageInput({ content: "x".repeat(100001) }, true)).not.toBeNull();
    expect(validateCmsPageInput({ isInMenu: "yes" }, true)).not.toBeNull();
  });
});
