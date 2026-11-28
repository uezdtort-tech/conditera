#!/usr/bin/env node
import { generateSupabaseJwt } from "./supabase-jwt.mjs";

const role = process.argv[2] || "anon";
try {
  process.stdout.write(generateSupabaseJwt(role, process.env.JWT_SECRET || ""));
} catch (error) {
  process.stderr.write(`[supabase-jwt] ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
