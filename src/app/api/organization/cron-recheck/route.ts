/**
 * GET /api/organization/cron-recheck — daily cron: re-verify legal organizations.
 *
 * Auth: X-Cron-Secret
 */
import { NextRequest, NextResponse } from "next/server";
import { verifyCronSecret, cronUnauthorized } from "@/lib/cron-auth";
import { verifyOrganization, recordVerification, findOrganizationsNeedingRecheck } from "@/lib/dadata";

export const runtime = "nodejs";

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!verifyCronSecret(req)) {
    return new NextResponse(cronUnauthorized().body, { status: 401, headers: { "Content-Type": "application/json" } });
  }

  try {
    const toRecheck = await findOrganizationsNeedingRecheck(30);
    console.log(`[cron:org-recheck] ${toRecheck.length} organizations to re-verify`);

    const results = { checked: 0, blocked: 0, errors: 0 };

    for (const item of toRecheck) {
      try {
        const verifyResult = await verifyOrganization(item.inn);
        await recordVerification(verifyResult, { userId: item.userId, trigger: "CRON_PERIODIC" as any });
        results.checked++;

        if (!verifyResult.isAllowed && verifyResult.status !== "UNKNOWN") {
          results.blocked++;
          // Block user if organization is liquidated
          // await supabaseAdmin.from("profiles").update({ is_blocked: true }).eq("id", item.userId);
        }
      } catch (e: any) {
        console.warn(`[cron:org-recheck] failed for ${item.inn}:`, e?.message);
        results.errors++;
      }
    }

    return NextResponse.json(results);
  } catch (error: any) {
    console.error("[cron:org-recheck] error:", error?.message);
    return NextResponse.json({ error: "Internal error", detail: error?.message }, { status: 500 });
  }
}
