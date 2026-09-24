/**
 * DaData Party API integration — verification of Russian legal entities (ООО, ИП, ПАО, etc).
 *
 * Docs: https://dadata.ru/api/suggest/party/
 *
 * Use cases:
 *   1. Registration — verify the organization is ACTIVE before allowing a legal account
 *   2. Profile update — re-verify when confectioner changes INN
 *   3. Invoice/payout — verify before issuing a B2B invoice or processing a payout
 *   4. Cron (daily) — re-verify all active organizations to catch recent liquidations
 *
 * If DADATA_API_KEY is not set, all checks return a soft "unknown" result
 * (we don't block registration in dev mode).
 */
import { supabaseAdmin } from "./supabase/admin";

interface SupabaseError {
  message: string;
}

const DADATA_SUGGEST_URL = "https://suggestions.dadata.ru/suggestions/api/4_1/rs/suggest/party";
const DADATA_FIND_URL = "https://suggestions.dadata.ru/suggestions/api/4_1/rs/findById/party";

export interface DaDataParty {
  // Ключевые поля
  inn: string;
  kpp?: string;
  ogrn: string;
  name: {
    full?: string;
    short?: string;
  };
  opf: {
    type?: "LEGAL" | "INDIVIDUAL"; // юрлицо или ИП
    code?: string; // 12300 = ООО, 50102 = ИП
    full?: string;
    short?: string;
  };
  state: {
    status?: "ACTIVE" | "LIQUIDATING" | "LIQUIDATED" | "REORGANIZING";
    actuality_date?: number; // unix timestamp (ms)
    registration_date?: number;
    liquidation_date?: number;
  };
  address?: {
    value?: string;
    unrestricted_value?: string;
  };
  management?: {
    name?: string;
    post?: string;
  };
  // Доп. поля
  branch_type?: "MAIN" | "BRANCH";
  type?: "LEGAL" | "INDIVIDUAL";
  okved?: string;
  okveds?: Array<{ code: string; name: string }>;
  finance?: {
    tax_system?: string;
    income?: string;
    expense?: string;
  };
}

export interface VerificationResult {
  success: boolean;
  status: "ACTIVE" | "LIQUIDATING" | "LIQUIDATED" | "REORGANIZING" | "UNKNOWN";
  isAllowed: boolean; // true если организация действующая и можно регистрировать/выставлять счета
  reason?: string;
  party?: DaDataParty;
  // Подготовленные данные для записи в БД
  normalized?: {
    inn: string;
    ogrn?: string;
    kpp?: string;
    companyName: string;
    fullName?: string;
    opfCode?: string;
    opfShort?: string;
    managementName?: string;
    managementPost?: string;
    legalAddress?: string;
    registeredAt?: Date;
    liquidatedAt?: Date;
  };
}

/**
 * Check if DaData API key is configured.
 */
export function isDaDataConfigured(): boolean {
  return !!process.env.DADATA_API_KEY;
}

/**
 * Low-level: call DaData suggest/party API by INN or query.
 */
async function suggestParty(query: string): Promise<DaDataParty | null> {
  const apiKey = process.env.DADATA_API_KEY;
  if (!apiKey) {
    console.warn("[dadata] DADATA_API_KEY not set — skipping verification");
    return null;
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Accept": "application/json",
    "Authorization": `Token ${apiKey}`,
  };
  if (process.env.DADATA_SECRET_KEY) {
    headers["X-Secret"] = process.env.DADATA_SECRET_KEY;
  }

  try {
    const resp = await fetch(DADATA_SUGGEST_URL, {
      method: "POST",
      headers,
      body: JSON.stringify({ query, count: 1 }),
      signal: AbortSignal.timeout(10000),
    });

    if (!resp.ok) {
      console.error(`[dadata] suggest HTTP ${resp.status}: ${await resp.text()}`);
      return null;
    }

    const data = await resp.json();
    if (!data.suggestions || data.suggestions.length === 0) {
      return null;
    }
    return data.suggestions[0].data as DaDataParty;
  } catch (e) {
    console.error("[dadata] suggest error:", e);
    return null;
  }
}

/**
 * Low-level: call DaData findById/party API (more precise for INN lookup).
 */
async function findByIdParty(inn: string): Promise<DaDataParty | null> {
  const apiKey = process.env.DADATA_API_KEY;
  if (!apiKey) {
    return null;
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Accept": "application/json",
    "Authorization": `Token ${apiKey}`,
  };
  if (process.env.DADATA_SECRET_KEY) {
    headers["X-Secret"] = process.env.DADATA_SECRET_KEY;
  }

  try {
    const resp = await fetch(DADATA_FIND_URL, {
      method: "POST",
      headers,
      body: JSON.stringify({ query: inn, count: 1 }),
      signal: AbortSignal.timeout(10000),
    });

    if (!resp.ok) {
      console.error(`[dadata] findById HTTP ${resp.status}: ${await resp.text()}`);
      return null;
    }

    const data = await resp.json();
    if (!data.suggestions || data.suggestions.length === 0) {
      return null;
    }
    return data.suggestions[0].data as DaDataParty;
  } catch (e) {
    console.error("[dadata] findById error:", e);
    return null;
  }
}

/**
 * Validate INN checksum (10 or 12 digits).
 * Returns true if checksum is valid.
 */
export function validateInnChecksum(inn: string): boolean {
  if (!/^\d{10}$|^\d{12}$/.test(inn)) return false;

  // 10-digit INN (legal entities)
  if (inn.length === 10) {
    const weights = [2, 4, 10, 3, 5, 9, 4, 6, 8];
    let sum = 0;
    for (let i = 0; i < 9; i++) {
      sum += parseInt(inn[i]) * weights[i];
    }
    const control = sum % 11 % 10;
    return control === parseInt(inn[9]);
  }

  // 12-digit INN (individuals / ИП)
  if (inn.length === 12) {
    const weights1 = [7, 2, 4, 10, 3, 5, 9, 4, 6, 8];
    let sum1 = 0;
    for (let i = 0; i < 10; i++) {
      sum1 += parseInt(inn[i]) * weights1[i];
    }
    const control1 = sum1 % 11 % 10;
    if (control1 !== parseInt(inn[10])) return false;

    const weights2 = [3, 7, 2, 4, 10, 3, 5, 9, 4, 6, 8];
    let sum2 = 0;
    for (let i = 0; i < 11; i++) {
      sum2 += parseInt(inn[i]) * weights2[i];
    }
    const control2 = sum2 % 11 % 10;
    return control2 === parseInt(inn[11]);
  }

  return false;
}

/**
 * Main: verify an organization by INN.
 * Returns whether it's active and allowed to register / issue invoices.
 */
export async function verifyOrganization(inn: string): Promise<VerificationResult> {
  // Step 1: validate INN format + checksum
  if (!validateInnChecksum(inn)) {
    return {
      success: false,
      status: "UNKNOWN",
      isAllowed: false,
      reason: "Неверный ИНН (контрольная сумма не совпадает)",
    };
  }

  // Step 2: if DaData not configured — soft allow (dev mode)
  if (!isDaDataConfigured()) {
    console.warn("[dadata] not configured — allowing in dev mode");
    return {
      success: true,
      status: "UNKNOWN",
      isAllowed: true,
      reason: "DaData не настроена — проверка пропущена (dev mode)",
    };
  }

  // Step 3: query DaData
  const party = await findByIdParty(inn);
  if (!party) {
    return {
      success: false,
      status: "UNKNOWN",
      isAllowed: false,
      reason: "Организация не найдена в ЕГРЮЛ/ЕГРИП",
    };
  }

  // Step 4: check status
  const status = party.state?.status || "UNKNOWN";
  const isAllowed =
    status === "ACTIVE" || status === "REORGANIZING"; // reorganizing is still active

  const registeredAt = party.state?.registration_date
    ? new Date(party.state.registration_date)
    : undefined;
  const liquidatedAt = party.state?.liquidation_date
    ? new Date(party.state.liquidation_date)
    : undefined;

  let reason: string | undefined;
  if (status === "LIQUIDATED") {
    reason = `Организация ликвидирована${liquidatedAt ? ` (${liquidatedAt.toLocaleDateString("ru-RU")})` : ""}`;
  } else if (status === "LIQUIDATING") {
    reason = "Организация в процессе ликвидации";
  } else if (status === "UNKNOWN") {
    reason = "Статус организации неизвестен";
  }

  return {
    success: true,
    status,
    isAllowed,
    reason,
    party,
    normalized: {
      inn: party.inn,
      ogrn: party.ogrn,
      kpp: party.kpp,
      companyName: party.name?.short || party.name?.full || "",
      fullName: party.name?.full,
      opfCode: party.opf?.code,
      opfShort: party.opf?.short,
      managementName: party.management?.name,
      managementPost: party.management?.post,
      legalAddress: party.address?.unrestricted_value || party.address?.value,
      registeredAt,
      liquidatedAt,
    },
  };
}

/**
 * Persist verification result to DB and take action if needed.
 */
export async function recordVerification(
  result: VerificationResult,
  options: {
    userId?: string;
    confectionerId?: string;
    trigger:
      | "REGISTRATION"
      | "PROFILE_UPDATE"
      | "INVOICE_ISSUE"
      | "PAYOUT_REQUEST"
      | "CRON_PERIODIC"
      | "ADMIN_MANUAL";
    verifiedBy?: string;
  }
): Promise<{ id: string; actionTaken: string }> {
  // Determine action
  let actionTaken = "approved";
  if (!result.isAllowed) {
    if (options.trigger === "REGISTRATION") {
      actionTaken = "blocked";
    } else if (options.trigger === "CRON_PERIODIC") {
      // Mark as suspended — user/confectioner must re-verify
      actionTaken = "suspended";
      await suspendUserOrConfectioner(options.userId, options.confectionerId, result.reason);
    } else {
      actionTaken = "blocked";
    }
  }

  const { data: record, error: recErr } = await supabaseAdmin
    .from("organization_verifications")
    .insert({
      user_id: options.userId || null,
      confectioner_id: options.confectionerId || null,
      inn: result.normalized?.inn || "",
      ogrn: result.normalized?.ogrn || null,
      kpp: result.normalized?.kpp || null,
      company_name: result.normalized?.companyName || "",
      full_name: result.normalized?.fullName || null,
      opf_code: result.normalized?.opfCode || null,
      opf_short: result.normalized?.opfShort || null,
      status: result.status,
      management_name: result.normalized?.managementName || null,
      management_post: result.normalized?.managementPost || null,
      legal_address: result.normalized?.legalAddress || null,
      registered_at: result.normalized?.registeredAt?.toISOString() || null,
      liquidated_at: result.normalized?.liquidatedAt?.toISOString() || null,
      trigger: options.trigger,
      success: result.success,
      error_message: result.reason || null,
      raw_data: result.party ? (result.party as unknown as Record<string, unknown>) : null,
      action_taken: actionTaken,
      verified_by: options.verifiedBy || null,
      created_at: new Date().toISOString(),
    })
    .select("id")
    .single() as { data: { id: string } | null; error: SupabaseError | null };

  if (recErr || !record) {
    console.error("[dadata] verification record insert failed:", recErr?.message);
    return { id: `error-${Date.now()}`, actionTaken };
  }

  return { id: record.id, actionTaken };
}

/**
 * Block a user (mark as blocked with reason).
 * Used when organization is liquidated during periodic cron check.
 */
async function suspendUserOrConfectioner(
  userId: string | undefined,
  confectionerId: string | undefined,
  reason?: string
): Promise<void> {
  if (userId) {
    const { error } = await supabaseAdmin
      .from("profiles")
      .update({
        is_blocked: true,
        blocked_reason: `Организация признана недействующей: ${reason || ""}`.trim(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", userId);

    if (error) {
      console.error("[dadata] user suspend failed:", error.message);
    } else {
      console.warn(`[dadata] user ${userId} suspended: ${reason}`);
    }
  }

  if (confectionerId) {
    const { error } = await supabaseAdmin
      .from("confectioners")
      .update({
        verified: false,
        trust_level: "NEW",
        updated_at: new Date().toISOString(),
      })
      .eq("id", confectionerId);

    if (error) {
      console.error("[dadata] confectioner unverify failed:", error.message);
    } else {
      console.warn(`[dadata] confectioner ${confectionerId} unverified: ${reason}`);
    }
  }
}

/**
 * Bulk: find all users/confectioners with legal accounts that haven't been verified recently.
 * Used by the daily cron.
 */
export async function findOrganizationsNeedingRecheck(daysInterval = 30): Promise<
  Array<{ userId: string; confectionerId?: string; inn: string; lastVerifiedAt?: Date }>
> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - daysInterval);
  const cutoffIso = cutoff.toISOString();

  const result: Array<{ userId: string; confectionerId?: string; inn: string; lastVerifiedAt?: Date }> = [];

  // Find all confectioners with legal_info that haven't been re-checked recently
  try {
    const { data: confectioners, error } = await supabaseAdmin
      .from("confectioners")
      .select("id, user_id, legal_info")
      .not("legal_info", "is", null) as { data: Array<{ id: string; user_id: string; legal_info: unknown }> | null; error: SupabaseError | null };

    if (error) {
      console.warn("[dadata] confectioners lookup failed:", error.message);
    }

    for (const c of confectioners || []) {
      const legalInfo = c.legal_info as { inn?: string } | null;
      if (!legalInfo?.inn) continue;

      // Get last verification for this confectioner
      const { data: lastVer } = await supabaseAdmin
        .from("organization_verifications")
        .select("created_at")
        .eq("confectioner_id", c.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle() as { data: { created_at: string } | null; error: SupabaseError | null };

      const lastDate = lastVer ? new Date(lastVer.created_at) : undefined;
      if (lastDate && lastDate > cutoff) continue;

      result.push({
        userId: c.user_id,
        confectionerId: c.id,
        inn: legalInfo.inn,
        lastVerifiedAt: lastDate,
      });
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn("[dadata] confectioners recheck lookup failed:", msg);
  }

  // Find legal users (customers with legal accounts)
  try {
    const { data: legalUsers, error } = await supabaseAdmin
      .from("profiles")
      .select("id, legal_info")
      .eq("account_type", "legal")
      .not("legal_info", "is", null) as { data: Array<{ id: string; legal_info: unknown }> | null; error: SupabaseError | null };

    if (error) {
      console.warn("[dadata] legal users lookup failed:", error.message);
    }

    for (const u of legalUsers || []) {
      const legalInfo = u.legal_info as { inn?: string } | null;
      if (!legalInfo?.inn) continue;

      const { data: lastVer } = await supabaseAdmin
        .from("organization_verifications")
        .select("created_at")
        .eq("user_id", u.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle() as { data: { created_at: string } | null; error: SupabaseError | null };

      const lastDate = lastVer ? new Date(lastVer.created_at) : undefined;
      if (lastDate && lastDate > cutoff) continue;

      result.push({
        userId: u.id,
        inn: legalInfo.inn,
        lastVerifiedAt: lastDate,
      });
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn("[dadata] legal users recheck lookup failed:", msg);
  }

  return result;
}

/**
 * Auto-fill suggestion: when user types partial company name or INN,
 * return top matches from DaData for autocomplete.
 */
export async function suggestOrganizations(query: string): Promise<
  Array<{
    inn: string;
    ogrn?: string;
    kpp?: string;
    name: string;
    fullName?: string;
    opfShort?: string;
    status: string;
    managementName?: string;
    legalAddress?: string;
  }>
> {
  if (!isDaDataConfigured() || query.length < 2) {
    return [];
  }

  const party = await suggestParty(query);
  if (!party) return [];

  // suggestParty returns a single best match; for real autocomplete we'd return multiple
  return [
    {
      inn: party.inn,
      ogrn: party.ogrn,
      kpp: party.kpp,
      name: party.name?.short || party.name?.full || "",
      fullName: party.name?.full,
      opfShort: party.opf?.short,
      status: party.state?.status || "UNKNOWN",
      managementName: party.management?.name,
      legalAddress: party.address?.unrestricted_value || party.address?.value,
    },
  ];
}

/**
 * Verify that legalInfo provided by user matches what DaData returned.
 * Checks: INN (must match exactly), OGRN (must match), company name (case-insensitive contains).
 * Returns mismatches list.
 */
export function verifyLegalInfoMatches(
  userLegalInfo: {
    inn: string;
    ogrn?: string;
    companyName: string;
  },
  daDataNormalized: {
    inn: string;
    ogrn?: string;
    companyName: string;
    fullName?: string;
  }
): { matches: boolean; mismatches: string[] } {
  const mismatches: string[] = [];

  if (userLegalInfo.inn !== daDataNormalized.inn) {
    mismatches.push(`ИНН не совпадает: указан ${userLegalInfo.inn}, в ЕГРЮЛ ${daDataNormalized.inn}`);
  }

  if (userLegalInfo.ogrn && daDataNormalized.ogrn && userLegalInfo.ogrn !== daDataNormalized.ogrn) {
    mismatches.push(`ОГРН не совпадает: указан ${userLegalInfo.ogrn}, в ЕГРЮЛ ${daDataNormalized.ogrn}`);
  }

  // Name check — case-insensitive, ignore punctuation differences
  const normalize = (s: string) => s.toLowerCase().replace(/[«»"'ё]/g, (m) => m === "ё" ? "е" : "").replace(/[^a-zа-я0-9 ]/gi, " ").trim();
  const userName = normalize(userLegalInfo.companyName);
  const daDataName = normalize(daDataNormalized.companyName);
  const daDataFullName = daDataNormalized.fullName ? normalize(daDataNormalized.fullName) : "";

  if (userName && daDataName && !userName.includes(daDataName) && !daDataName.includes(userName) &&
      (!daDataFullName || (!userName.includes(daDataFullName) && !daDataFullName.includes(userName)))) {
    mismatches.push(`Наименование не совпадает: указано "${userLegalInfo.companyName}", в ЕГРЮЛ "${daDataNormalized.companyName}"`);
  }

  return { matches: mismatches.length === 0, mismatches };
}
