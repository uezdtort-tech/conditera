import { readFileSync } from "node:fs";

const activeWorkflows = new Map([
  ["n8n-workflows/01-abandoned-cart.json", "0 * * * *"],
  ["n8n-workflows/02-weekly-digest.json", "0 10 * * 1"],
  ["n8n-workflows/03-expiring-bonuses.json", "0 9 * * *"],
  ["n8n-workflows/04-backup.json", "0 3 * * *"],
  ["n8n-workflows/05-cleanup.json", "0 4 * * *"],
]);

const disabledWorkflows = [
  "n8n-workflows/06-content-moderation.json",
  "n8n-workflows/07-crm-integration.json",
  "n8n-workflows/08-demand-forecasting.json",
  "n8n-workflows/09-delivery-management.json",
  "n8n-workflows/10-dynamic-pricing.json",
  "n8n-workflows/11-image-processing.json",
  "n8n-workflows/12-inventory-management.json",
  "n8n-workflows/13-order-processing.json",
  "n8n-workflows/14-user-reenagement.json",
  "n8n-workflows/15-report-generation.json",
  "n8n-workflows/16-review-analysis.json",
];

for (const [file, expectedCron] of activeWorkflows) {
  const workflow = JSON.parse(readFileSync(file, "utf8"));
  if (workflow.active !== true) throw new Error(`${file}: verified production workflow must remain active`);
  if (!Array.isArray(workflow.nodes) || workflow.nodes.length === 0) {
    throw new Error(`${file}: workflow has no nodes`);
  }

  const schedules = workflow.nodes.filter((node) => node.type === "n8n-nodes-base.scheduleTrigger");
  if (schedules.length !== 1) throw new Error(`${file}: expected exactly one schedule trigger`);
  const interval = schedules[0].parameters?.rule?.interval || [];
  if (interval.length !== 1 || interval[0].field !== "cronExpression" || interval[0].expression !== expectedCron) {
    throw new Error(`${file}: expected deterministic schedule ${expectedCron}`);
  }

  const httpNodes = workflow.nodes.filter((node) => node.type === "n8n-nodes-base.httpRequest");
  if (httpNodes.length === 0) throw new Error(`${file}: no HTTP request nodes found`);

  for (const node of httpNodes) {
    const params = node.parameters || {};
    const url = String(params.url || "");
    if (!url.includes("/api/")) continue;
    if (params.authentication) {
      throw new Error(`${file} / ${node.name}: must not reference an unprovisioned n8n credential`);
    }
    const headers = params.headerParameters?.parameters || [];
    const cronHeader = headers.find((header) => header.name === "X-Cron-Secret");
    if (!params.sendHeaders || !cronHeader || !String(cronHeader.value).includes("CRON_SECRET")) {
      throw new Error(`${file} / ${node.name}: X-Cron-Secret header is missing`);
    }
    if (url.includes("/api/notifications/send")) {
      const body = String(params.jsonBody || "");
      if (!body.includes("dedupKey")) {
        throw new Error(`${file} / ${node.name}: notification delivery must carry an idempotency key`);
      }
    }
  }
  console.log(`PASS ${file}: ${httpNodes.length} HTTP nodes, cron auth, idempotency and schedule verified`);
}

for (const file of disabledWorkflows) {
  const workflow = JSON.parse(readFileSync(file, "utf8"));
  if (workflow.active !== false) {
    throw new Error(`${file}: unverified automation must stay disabled until its endpoint and E2E contract are proven`);
  }
}
console.log(`PASS: ${disabledWorkflows.length} unverified workflows remain disabled`);
