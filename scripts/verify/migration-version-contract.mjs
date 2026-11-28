import { readdirSync } from "node:fs";
import path from "node:path";

const directory = path.resolve("supabase/migrations");
const files = readdirSync(directory).filter((name) => name.endsWith(".sql")).sort();
const versions = new Map();
const errors = [];

for (const file of files) {
  const match = file.match(/^(\d+[a-z]?)_/i);
  if (!match) {
    errors.push(file + ": migration filename has no sortable version prefix");
    continue;
  }
  const version = match[1].toLowerCase();
  const existing = versions.get(version) || [];
  existing.push(file);
  versions.set(version, existing);
}

for (const [version, names] of versions) {
  if (names.length > 1) errors.push("duplicate migration version " + version + ": " + names.join(", "));
}

for (let version = 88; version <= 109; version++) {
  const key = String(version).padStart(4, "0");
  if (!versions.has(key)) errors.push("consolidated migration " + key + " is missing");
}

if (errors.length) {
  console.error("Migration version contract: FAIL");
  for (const error of errors) console.error(" - " + error);
  process.exit(1);
}

console.log("Migration version contract: PASS (" + files.length + " files, no duplicate versions, 0088–0109 present)");
