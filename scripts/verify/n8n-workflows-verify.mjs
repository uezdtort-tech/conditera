import { readFileSync } from "node:fs";

const files = [
  "n8n-workflows/01-abandoned-cart.json",
  "n8n-workflows/02-weekly-digest.json",
  "n8n-workflows/03-expiring-bonuses.json",
];

for (const file of files) {
  const workflow = JSON.parse(readFileSync(file, "utf8"));
  if (workflow.active !== true) throw new Error(`${file}: retention workflow must remain active in source`);
  if (!Array.isArray(workflow.nodes) || workflow.nodes.length === 0) {
    throw new Error(`${file}: workflow has no nodes`);
  }

  const httpNodes = workflow.nodes.filter((node) => node.type === "n8n-nodes-base.httpRequest");
  if (httpNodes.length === 0) throw new Error(`${file}: no HTTP request nodes found`);

  for (const node of httpNodes) {
    const params = node.parameters || {};
    const url = String(params.url || "");
    if (!url.includes("/api/")) continue;
    if (params.authentication) {
      throw new Error(`${file} / ${node.name}: must not reference a missing n8n credential; use explicit Cron Secret header`);
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
  console.log(`PASS ${file}: ${httpNodes.length} HTTP nodes use explicit Cron Secret and notification idempotency`);
}
