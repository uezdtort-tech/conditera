#!/usr/bin/env node
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const workflowsDir = join(root, "n8n-workflows");
const files = readdirSync(workflowsDir).filter((name) => name.endsWith(".json")).sort();
assert.ok(files.length > 0, "No n8n workflow JSON files found");
const ids = new Set();
const productionAllowlist = new Set(["04-backup.json"]);
const workflows = new Map();

for (const file of files) {
  const workflow = JSON.parse(readFileSync(join(workflowsDir, file), "utf8"));
  assert.equal(typeof workflow.id, "string", file + ": stable workflow id is required");
  assert.ok(workflow.id.length > 0, file + ": workflow id must not be empty");
  assert.ok(!ids.has(workflow.id), file + ": duplicate workflow id " + workflow.id);
  ids.add(workflow.id);
  assert.equal(typeof workflow.name, "string", file + ": workflow name is required");
  assert.ok(Array.isArray(workflow.nodes) && workflow.nodes.length > 0, file + ": nodes are required");
  assert.ok(workflow.connections && typeof workflow.connections === "object", file + ": connections object is required");
  const nodeNames = new Set();
  const nodeIds = new Set();
  for (const node of workflow.nodes) {
    assert.equal(typeof node.name, "string", file + ": every node needs a name");
    assert.equal(typeof node.type, "string", file + ": every node needs a type");
    assert.ok(!nodeNames.has(node.name), file + ": duplicate node name " + node.name);
    nodeNames.add(node.name);
    if (node.id) {
      assert.ok(!nodeIds.has(node.id), file + ": duplicate node id " + node.id);
      nodeIds.add(node.id);
    }
  }
  for (const [sourceName, outputs] of Object.entries(workflow.connections)) {
    assert.ok(nodeNames.has(sourceName), file + ": connection source does not exist: " + sourceName);
    for (const groups of Object.values(outputs || {})) {
      assert.ok(Array.isArray(groups), file + ": connection output must be an array");
      for (const group of groups) {
        for (const target of group || []) {
          assert.ok(nodeNames.has(target.node), file + ": connection target does not exist: " + target.node);
        }
      }
    }
  }
  workflows.set(file, workflow);
}

for (const name of productionAllowlist) assert.ok(workflows.has(name), "Production allowlist entry is missing: " + name);
const backup = workflows.get("04-backup.json");
assert.equal(backup.active, true, "Backup workflow must be enabled in its source definition");
const schedule = backup.nodes.find((node) => node.type === "n8n-nodes-base.scheduleTrigger");
assert.ok(schedule, "Backup workflow must have a Schedule Trigger");
assert.equal(schedule.parameters?.rule?.interval?.[0]?.field, "days");
assert.equal(schedule.parameters?.rule?.interval?.[0]?.daysInterval, 1);
assert.equal(schedule.parameters?.rule?.interval?.[0]?.triggerAtHour, 3, "Backup must run at 03:00 local time");
assert.equal(schedule.parameters?.rule?.interval?.[0]?.triggerAtMinute, 0);
const backupRequest = backup.nodes.find((node) => node.name === "Запустить backup");
assert.equal(backupRequest?.parameters?.method, "GET");
assert.match(backupRequest?.parameters?.url || "", /\/api\/cron\/backup$/);
assert.ok(backupRequest?.parameters?.headerParameters?.parameters?.some((header) => header.name === "X-Cron-Secret" && header.value === "={{ $env.CRON_SECRET }}"), "Backup request must authenticate with CRON_SECRET");
const statusRequest = backup.nodes.find((node) => node.name === "Записать статус");
assert.equal(statusRequest?.parameters?.method, "POST");
assert.match(statusRequest?.parameters?.url || "", /\/api\/cron\/status$/);
assert.ok(statusRequest?.parameters?.headerParameters?.parameters?.some((header) => header.name === "X-Cron-Secret" && header.value === "={{ $env.CRON_SECRET }}"), "Status request must authenticate with CRON_SECRET");

const entrypoint = readFileSync(join(root, "scripts/n8n-entrypoint.mjs"), "utf8");
assert.ok(entrypoint.includes('new Set(["04-backup.json"])'), "Runtime importer allowlist must match the verified workflow");
assert.ok(entrypoint.includes('"import:workflow"'), "Runtime importer must import workflows explicitly");
assert.ok(entrypoint.includes('"update:workflow"'), "Runtime importer must enforce activation state");
const compose = readFileSync(join(root, "docker-compose.supabase-single-container.yml"), "utf8");
assert.ok(compose.includes("conditera-n8n-entrypoint.mjs"), "PG17 runtime must use the controlled n8n entrypoint");
assert.ok(existsSync(join(root, "src/app/api/cron/backup/route.ts")), "Backup API route must exist");
assert.ok(existsSync(join(root, "src/app/api/cron/status/route.ts")), "Cron status API route must exist");

console.log("PASS: " + files.length + " n8n workflow definitions validated; only 04-backup.json is enabled for production activation.");
