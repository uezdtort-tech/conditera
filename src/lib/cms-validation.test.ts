import { describe, expect, it } from "vitest";
import { isSafeCmsUrl, isValidCmsSlug, validateCmsPageInput } from "./cms-validation";

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
