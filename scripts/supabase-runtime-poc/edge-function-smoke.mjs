import fs from "node:fs";

const runtimeEnv = Object.fromEntries(
  fs.readFileSync("/tmp/runtime.env", "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const separator = line.indexOf("=");
      return [line.slice(0, separator), line.slice(separator + 1)];
    }),
);

const serviceRoleKey = runtimeEnv.SERVICE_ROLE_KEY;
if (!serviceRoleKey || serviceRoleKey.split(".").length !== 3) {
  throw new Error("Generated service-role JWT is malformed");
}

// The app migration changes legacy quoted CamelCase maintenance enums to
// lowercase PostgreSQL identifiers. Exercise the actual PostgREST schema cache
// and enum coercion, not only a direct SQL insert.
const maintenanceId = `pg17-postgrest-enum-smoke-${crypto.randomUUID()}`;
const maintenanceEndpoint = "http://127.0.0.1:18000/rest/v1/maintenance_logs";
const maintenanceHeaders = {
  apikey: serviceRoleKey,
  Authorization: "Bearer " + serviceRoleKey,
  "Content-Type": "application/json",
};
const maintenanceInsert = await fetch(`${maintenanceEndpoint}?select=id,type,status`, {
  method: "POST",
  headers: { ...maintenanceHeaders, Prefer: "return=representation" },
  body: JSON.stringify({ id: maintenanceId, type: "BACKUP_FULL", status: "queued" }),
  signal: AbortSignal.timeout(15_000),
});
const maintenanceBody = await maintenanceInsert.text();
console.log("PostgREST maintenance enum insert HTTP " + maintenanceInsert.status + ": " + maintenanceBody.slice(0, 400));
let maintenanceRows;
try {
  maintenanceRows = JSON.parse(maintenanceBody);
} catch {
  throw new Error("PostgREST maintenance enum response is not valid JSON");
}
if (!maintenanceInsert.ok ||
    !Array.isArray(maintenanceRows) ||
    maintenanceRows[0]?.id !== maintenanceId ||
    maintenanceRows[0]?.type !== "BACKUP_FULL" ||
    maintenanceRows[0]?.status !== "queued") {
  throw new Error("PostgREST cannot insert/read maintenance enum values on PostgreSQL 17");
}
const maintenanceDelete = await fetch(`${maintenanceEndpoint}?id=eq.${encodeURIComponent(maintenanceId)}`, {
  method: "DELETE",
  headers: { ...maintenanceHeaders, Prefer: "return=minimal" },
  signal: AbortSignal.timeout(15_000),
});
if (!maintenanceDelete.ok) {
  throw new Error("PostgREST maintenance enum smoke row cleanup failed: HTTP " + maintenanceDelete.status);
}
console.log("PASS: PostgREST maintenance enum insert/select/delete roundtrip");

const endpoint = "http://127.0.0.1:18000/functions/v1/auto-close-tenders";
const anonKey = runtimeEnv.ANON_KEY;
if (!anonKey || anonKey.split(".").length !== 3) {
  throw new Error("Generated anon JWT is malformed");
}

// A valid anon JWT must pass key-auth but be denied by the functions ACL.
const anonResponse = await fetch(endpoint, {
  method: "POST",
  headers: {
    apikey: anonKey,
    Authorization: "Bearer " + anonKey,
    "Content-Type": "application/json",
  },
  body: "{}",
  signal: AbortSignal.timeout(10_000),
});
const anonBody = await anonResponse.text();
console.log("Edge Function anon ACL HTTP " + anonResponse.status + ": " + anonBody.slice(0, 300));
if (anonResponse.status !== 403) {
  throw new Error("Edge Functions must deny anon consumer through Kong ACL (expected 403)");
}

let response;
try {
  response = await fetch(endpoint, {
    method: "POST",
    headers: {
      apikey: serviceRoleKey,
      Authorization: "Bearer " + serviceRoleKey,
      "Content-Type": "application/json",
    },
    body: "{}",
    signal: AbortSignal.timeout(30_000),
  });
} catch (error) {
  console.error("Edge Function connection failed:", error instanceof Error ? error.message : String(error));
  process.exit(1);
}

const body = await response.text();
console.log("Edge Function HTTP " + response.status + ": " + body.slice(0, 500));

let payload;
try {
  payload = JSON.parse(body);
} catch {
  throw new Error("Edge Function response is not valid JSON");
}

if (!response.ok || payload.ok !== true) {
  throw new Error("Edge Function returned an unexpected response");
}

// Exercise notification delivery without real credentials, and prove the two
// legacy provider webhook stubs cannot be mistaken for the live application routes.
for (const [slug, expectedStatus] of [
  ["send-notification", 503],
  ["abandoned-cart", 501],
  ["bonus-expiry", 501],
  ["daily-digest", 501],
  ["send-email", 501],
  ["send-push", 501],
  ["tasting-reminder", 501],
  ["telegram-webhook", 410],
  ["yookassa-webhook", 410],
]) {
  const workerResponse = await fetch(`http://127.0.0.1:18000/functions/v1/${slug}`, {
    method: "POST",
    headers: {
      apikey: serviceRoleKey,
      Authorization: "Bearer " + serviceRoleKey,
      "Content-Type": "application/json",
    },
    body: "{}",
    signal: AbortSignal.timeout(30_000),
  });
  const workerBody = await workerResponse.text();
  console.log(`${slug} HTTP ${workerResponse.status}: ${workerBody.slice(0, 300)}`);
  if (workerResponse.status !== expectedStatus) {
    throw new Error(`${slug} returned an unexpected status; expected fail-closed HTTP ${expectedStatus}`);
  }
}
