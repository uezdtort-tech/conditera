/**
 * Validation for browser Web Push endpoints.
 * Only public provider origins are accepted; arbitrary URLs would turn the
 * notification sender into an SSRF primitive.
 */

const ALLOWED_EXACT_HOSTS = new Set([
  "fcm.googleapis.com",
  "web.push.apple.com",
  "updates.push.services.mozilla.com",
  "push.services.mozilla.com",
]);

const ALLOWED_HOST_SUFFIXES = [
  ".push.services.mozilla.com",
  ".notify.windows.com",
];

export function isAllowedPushEndpoint(endpoint: string): boolean {
  try {
    const url = new URL(endpoint);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      (url.port && url.port !== "443") ||
      !url.hostname
    ) return false;

    const hostname = url.hostname.toLowerCase();
    if (ALLOWED_EXACT_HOSTS.has(hostname)) return true;
    return ALLOWED_HOST_SUFFIXES.some((suffix) => hostname.endsWith(suffix));
  } catch {
    return false;
  }
}
