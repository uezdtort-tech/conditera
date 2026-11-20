import { describe, expect, it } from "vitest";
import { resolveCmsNavigationView } from "./cms-navigation";

describe("resolveCmsNavigationView", () => {
  it.each([
    ["/", "home"],
    ["/catalog", "catalog"],
    ["catalog", "catalog"],
    ["/cake-builder", "cake-builder"],
    ["/dashboard-admin", "dashboard-admin"],
    ["chat", "chat"],
  ])("maps %s to app view %s", (url, expected) => {
    expect(resolveCmsNavigationView(url)).toBe(expected);
  });

  it.each(["/pages/about", "/api/cms/pages", "https://example.com", "//evil.example", "not-a-view"])(
    "does not treat %s as an app view",
    (url) => {
      expect(resolveCmsNavigationView(url)).toBeNull();
    },
  );
});
