#!/usr/bin/env node
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";

const importDir = process.env.N8N_WORKFLOWS_DIR || "/imports";
const userFolder = process.env.N8N_USER_FOLDER || "/home/node/.n8n";
const databasePath = join(userFolder, "database.sqlite");
const markerPath = join(userFolder, ".conditera-workflow-hash");
// Only the backup workflow has a verified server-side contract and restore-tested execution.
// Other repository workflows remain deliberately unimported until their API/auth contracts pass.
const activeWorkflowFiles = new Set(["04-backup.json"]);

function runCli(args) {
  const result = spawnSync("n8n", args, { encoding: "utf8", stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error("n8n " + args.join(" ") + " exited with status " + result.status);
}

function readExport(path) {
  const parsed = JSON.parse(readFileSync(path, "utf8"));
  const workflows = Array.isArray(parsed) ? parsed : (parsed.workflows || parsed.data || []);
  if (!Array.isArray(workflows)) throw new Error("n8n export did not contain a workflow array");
  return workflows;
}

async function bootstrapDatabase() {
  if (existsSync(databasePath)) return;
  mkdirSync(userFolder, { recursive: true });
  console.info("[n8n] Initializing the persistent workflow database...");
  const child = spawn("n8n", ["start"], { stdio: "ignore" });
  let ready = false;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (existsSync(databasePath)) { ready = true; break; }
    if (child.exitCode !== null) throw new Error("n8n exited before creating its SQLite database");
    await delay(1000);
  }
  if (!ready) {
    child.kill("SIGTERM");
    throw new Error("Timed out waiting for n8n SQLite database initialization");
  }
  child.kill("SIGTERM");
  await once(child, "exit");
}

function loadSourceWorkflows() {
  if (!existsSync(importDir)) throw new Error("n8n workflow source directory is missing: " + importDir);
  const files = readdirSync(importDir).filter((name) => name.endsWith(".json")).sort();
  if (files.length === 0) throw new Error("No n8n workflow JSON files found in " + importDir);
  const ids = new Set();
  const byFile = new Map();
  for (const name of files) {
    const workflow = JSON.parse(readFileSync(join(importDir, name), "utf8"));
    if (!workflow.id || typeof workflow.id !== "string") throw new Error("Workflow has no stable string id: " + name);
    if (!workflow.name || !Array.isArray(workflow.nodes) || !workflow.connections) throw new Error("Workflow structure is incomplete: " + name);
    if (ids.has(workflow.id)) throw new Error("Duplicate n8n workflow id: " + workflow.id);
    ids.add(workflow.id);
    byFile.set(name, workflow);
  }
  for (const name of activeWorkflowFiles) {
    if (!byFile.has(name)) throw new Error("Allowlisted production workflow is missing: " + name);
  }
  return { files, byFile, sourceIds: ids };
}

function importAllowlistedWorkflows(source) {
  const stageDir = mkdtempSync(join(tmpdir(), "conditera-n8n-import-"));
  const stateDir = mkdtempSync(join(tmpdir(), "conditera-n8n-state-"));
  try {
    const hash = createHash("sha256").update("conditera-production-allowlist-v1\n");
    for (const name of [...activeWorkflowFiles].sort()) {
      const original = source.byFile.get(name);
      const raw = readFileSync(join(importDir, name));
      hash.update(name + "\n").update(raw);
      const staged = { ...original, active: false };
      writeFileSync(join(stageDir, name), JSON.stringify(staged, null, 2) + "\n", { mode: 0o600 });
    }
    const currentHash = hash.digest("hex");
    const allowlistedIds = new Set([...activeWorkflowFiles].map((name) => String(source.byFile.get(name).id)));
    const previousHash = existsSync(markerPath) ? readFileSync(markerPath, "utf8").trim() : "";
    if (currentHash !== previousHash) {
      console.info("[n8n] Importing only explicitly allowlisted production workflows...");
      runCli(["import:workflow", "--separate", "--input", stageDir]);
    } else {
      console.info("[n8n] Verified workflow source is unchanged; import skipped.");
    }

    const afterImportPath = join(stateDir, "after-import.json");
    runCli(["export:workflow", "--all", "--output", afterImportPath]);
    const afterImport = readExport(afterImportPath);
    const currentById = new Map(afterImport.map((workflow) => [String(workflow.id), workflow]));
    for (const id of source.sourceIds) {
      const workflow = currentById.get(id);
      if (!workflow) continue;
      const shouldBeActive = allowlistedIds.has(id);
      if (Boolean(workflow.active) !== shouldBeActive) {
        runCli(["update:workflow", "--id", id, "--active=" + String(shouldBeActive)]);
      }
    }
    const verifiedPath = join(stateDir, "verified-workflows.json");
    runCli(["export:workflow", "--all", "--output", verifiedPath]);
    const verified = readExport(verifiedPath);
    const verifiedById = new Map(verified.map((workflow) => [String(workflow.id), workflow]));
    for (const id of allowlistedIds) {
      const workflow = verifiedById.get(id);
      if (!workflow || workflow.active !== true) throw new Error("Allowlisted backup workflow is not active after import: " + id);
    }
    for (const id of source.sourceIds) {
      const workflow = verifiedById.get(id);
      if (workflow && !allowlistedIds.has(id) && workflow.active === true) {
        throw new Error("Unverified repository workflow is active in production n8n: " + workflow.name);
      }
    }
    writeFileSync(markerPath, currentHash + "\n", { mode: 0o600 });
  } finally {
    rmSync(stageDir, { recursive: true, force: true });
    rmSync(stateDir, { recursive: true, force: true });
  }
}

async function main() {
  await bootstrapDatabase();
  const source = loadSourceWorkflows();
  importAllowlistedWorkflows(source);
  console.info("[n8n] Production workflow allowlist verified; starting n8n.");
  const child = spawn("n8n", ["start"], { stdio: "inherit" });
  process.on("SIGTERM", () => child.kill("SIGTERM"));
  process.on("SIGINT", () => child.kill("SIGINT"));
  child.on("error", (error) => { console.error("[n8n] start failed:", error); process.exitCode = 1; });
  const [code, signal] = await once(child, "exit");
  if (signal) process.exit(1);
  process.exit(typeof code === "number" ? code : 1);
}

main().catch((error) => {
  console.error("[n8n] Production workflow bootstrap failed:", error?.message || error);
  process.exit(1);
});
