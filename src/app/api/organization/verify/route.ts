/**
 * POST /api/organization/verify
 *
 * Verify an organization by INN through DaData Party API.
 * Returns the verification result + auto-filled data from EГРЮЛ/ЕГРИП.
 *
 * Auth: any authenticated user (for registration / profile update).
 * Body: { inn: string, trigger?: "REGISTRATION"|"PROFILE_UPDATE"|"INVOICE_ISSUE"|"PAYOUT_REQUEST"|"ADMIN_MANUAL" }
 */
import { NextRequest, NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/auth";
import { verifyOrganization, recordVerification } from "@/lib/dadata";

export async function POST(req: NextRequest) {
  try {
    const payload = await getUserFromRequest(req);
    if (!payload) {
      return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
    }

    const body = await req.json();
    const { inn, trigger = "PROFILE_UPDATE", legalInfoToMatch } = body as {
      inn: string;
      trigger?: "REGISTRATION" | "PROFILE_UPDATE" | "INVOICE_ISSUE" | "PAYOUT_REQUEST" | "ADMIN_MANUAL";
      legalInfoToMatch?: { inn: string; ogrn?: string; companyName: string };
    };

    if (!inn || !/^\d{10}$|^\d{12}$/.test(inn)) {
      return NextResponse.json(
        { error: "ИНН должен содержать 10 (юрлицо) или 12 (ИП) цифр" },
        { status: 400 }
      );
    }

    // Run verification
    const result = await verifyOrganization(inn);

    // If we have legalInfoToMatch — verify it matches DaData
    let matchResult: { matches: boolean; mismatches: string[] } | undefined;
    if (legalInfoToMatch && result.normalized) {
      const { verifyLegalInfoMatches } = await import("@/lib/dadata");
      matchResult = verifyLegalInfoMatches(legalInfoToMatch, result.normalized);
    }

    // Persist verification record (without taking blocking action — this is just a check)
    const recorded = await recordVerification(result, {
      userId: payload.userId as string,
      trigger,
      verifiedBy: payload.userId as string,
    });

    return NextResponse.json({
      verificationId: recorded.id,
      success: result.success,
      status: result.status,
      isAllowed: result.isAllowed,
      reason: result.reason,
      actionTaken: recorded.actionTaken,
      // Auto-filled data from DaData (for the form)
      normalized: result.normalized,
      // Match check (if requested)
      matches: matchResult?.matches,
      mismatches: matchResult?.mismatches,
    });
  } catch (error) {
    console.error("POST /api/organization/verify error:", error);
    return NextResponse.json(
      { error: "Внутренняя ошибка сервера", detail: (error as Error).message },
      { status: 500 }
    );
  }
}
