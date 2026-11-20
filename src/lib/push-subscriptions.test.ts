import { describe, expect, it } from "vitest";
import { isAllowedPushEndpoint } from "./push-subscriptions";

describe("isAllowedPushEndpoint", () => {
  it.each([
    "https://fcm.googleapis.com/fcm/send/example",
    "https://updates.push.services.mozilla.com/wpush/v2/example",
    "https://web.push.apple.com/Q/example",
    "https://wns2-par02p.notify.windows.com/?token=example",
  ])("accepts public browser push provider %s", (endpoint) => {
    expect(isAllowedPushEndpoint(endpoint)).toBe(true);
  });

  it.each([
    "http://fcm.googleapis.com/fcm/send/example",
    "https://127.0.0.1/push",
    "https://localhost/push",
    "https://169.254.169.254/latest/meta-data",
    "https://evil.example/push",
    "https://fcm.googleapis.com.evil.example/push",
    "https://user:pass@fcm.googleapis.com/push",
    "https://fcm.googleapis.com:8443/push",
    "not-a-url",
  ])("rejects unsafe push endpoint %s", (endpoint) => {
    expect(isAllowedPushEndpoint(endpoint)).toBe(false);
  });
});
