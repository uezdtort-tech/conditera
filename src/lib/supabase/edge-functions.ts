import "server-only";

import { isAdminConfigured, supabaseAdmin } from "@/lib/supabase/admin";

export const INTERNAL_EDGE_FUNCTIONS = new Set([
  "send-notification",
  "auto-close-tenders",
]);

export const ADMIN_MANUAL_RUNNABLE_EDGE_FUNCTIONS = new Set([
  "auto-close-tenders",
]);

/**
 * Invoke an internal Edge Function through the server-side Supabase admin
 * client. This client resolves SUPABASE_INTERNAL_URL inside Docker and sends
 * the service_role apikey/Authorization headers; never call this from browser
 * code or expose the service-role key to a client.
 */
export async function invokeInternalEdgeFunction<T = unknown>(
  functionName: string,
  body: Record<string, unknown>,
): Promise<T> {
  if (!INTERNAL_EDGE_FUNCTIONS.has(functionName)) {
    throw new Error(`Edge Function is not enabled for application invocation: ${functionName}`);
  }
  if (!isAdminConfigured()) {
    throw new Error("Supabase service-role client is not configured");
  }

  const { data, error } = await supabaseAdmin.functions.invoke(functionName, { body });
  if (error) {
    console.error(`[edge-functions] ${functionName} failed:`, error.message);
    throw new Error(`Edge Function ${functionName} failed`);
  }
  return data as T;
}
