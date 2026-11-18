// GET /api/auth/oauth/[provider]/callback
//
// Серверный OAuth callback для Yandex ID, VK ID и Google OIDC.
//
// Флоу:
//   1. Сверяем state с HttpOnly-cookie; все три провайдера используют PKCE.
//   2. Проверяем профиль/subject провайдера; Google дополнительно проверяется как OIDC ID token.
//   3. Не объединяем существующие аккаунты только по совпадению email.
//   4. Для нового аккаунта требуем отдельные согласия ПД и условий, создаём GoTrue user,
//      профиль, роль CUSTOMER и append-only записи согласий.
//   5. Привязываем provider_subject и выдаём единый Conditera app-JWT в cd_session/cd_refresh.
//   6. Возвращаем пользователя на исходный внутренний маршрут.
//
// Неподдерживаемые/ненастроенные провайдеры завершаются безопасной ошибкой.

import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { resolveSupabaseServerUrl } from "@/lib/supabase/url";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { createAccessToken, createRefreshToken } from "@/lib/auth";
import { setSessionCookies } from "@/lib/session-cookies";

type Provider = "google" | "yandex" | "vk";

const SUPPORTED_PROVIDERS: Provider[] = ["google", "yandex", "vk"];

function isStubValue(value: string | undefined): boolean {
  return !value || value.trim() === "" || value.startsWith("stub_");
}

function getProviderConfig(provider: Provider): {
  clientId: string;
  clientSecret?: string;
  redirectUri: string;
} | null {
  switch (provider) {
    case "google": {
      const clientId = process.env.GOOGLE_CLIENT_ID;
      const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
      const redirectUri = process.env.GOOGLE_OAUTH_REDIRECT;
      if (isStubValue(clientId) || isStubValue(redirectUri) || isStubValue(clientSecret)) return null;
      return { clientId: clientId!, clientSecret: clientSecret!, redirectUri: redirectUri! };
    }
    case "yandex": {
      const clientId = process.env.YANDEX_CLIENT_ID;
      const clientSecret = process.env.YANDEX_CLIENT_SECRET;
      const redirectUri = process.env.YANDEX_OAUTH_REDIRECT;
      if (isStubValue(clientId) || isStubValue(redirectUri)) return null;
      return { clientId: clientId!, clientSecret: isStubValue(clientSecret) ? undefined : clientSecret, redirectUri: redirectUri! };
    }
    case "vk": {
      const clientId = process.env.VK_CLIENT_ID;
      const redirectUri = process.env.VK_OAUTH_REDIRECT;
      if (isStubValue(clientId) || isStubValue(redirectUri)) return null;
      return { clientId: clientId!, redirectUri: redirectUri! };
    }
    default:
      return null; // Telegram не включён в текущий релиз
  }
}

interface OAuthProfile {
  subject: string;
  email: string;
  name: string;
  avatarUrl: string | null;
}

async function exchangeYandex(config: ReturnType<typeof getProviderConfig>, code: string, codeVerifier: string): Promise<string> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    client_id: config!.clientId,
    code_verifier: codeVerifier,
  });
  if (config!.clientSecret) body.set("client_secret", config!.clientSecret);
  const res = await fetch("https://oauth.yandex.ru/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    signal: AbortSignal.timeout(15_000),
  });
  const json = (await res.json()) as { access_token?: string; error_description?: string };
  if (!res.ok || !json.access_token) {
    throw new Error(`Yandex token: ${json.error_description || res.status}`);
  }
  return json.access_token;
}

async function fetchYandexProfile(accessToken: string): Promise<OAuthProfile> {
  const res = await fetch("https://login.yandex.ru/info?format=json", {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(15_000),
  });
  const json = (await res.json()) as {
    default_email?: string;
    login?: string;
    display_name?: string;
    real_name?: string;
    is_avatar_empty?: boolean;
    default_avatar_id?: string;
    id?: string | number;
  };
  const email = json.default_email;
  if (!email) throw new Error("Yandex profile: provider did not return an email address");
  const name = json.real_name || json.display_name || "Пользователь Яндекса";
  const avatarUrl =
    !json.is_avatar_empty && json.default_avatar_id
      ? `https://avatars.yandex.net/get-yapic/${json.default_avatar_id}/islands-200`
      : null;
  if (json.id === undefined || json.id === null) throw new Error("Yandex profile: subject is missing");
  return { subject: String(json.id), email: email.toLowerCase(), name, avatarUrl };
}

async function exchangeGoogle(config: ReturnType<typeof getProviderConfig>, code: string, codeVerifier: string): Promise<{ accessToken: string; idToken: string }> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: config!.clientId,
      client_secret: config!.clientSecret!,
      redirect_uri: config!.redirectUri,
      code_verifier: codeVerifier,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const json = (await res.json()) as { access_token?: string; id_token?: string; error_description?: string };
  if (!res.ok || !json.access_token || !json.id_token) {
    throw new Error("Google token exchange failed: " + (json.error_description || res.status));
  }
  return { accessToken: json.access_token, idToken: json.id_token };
}

async function fetchGoogleProfile(idToken: string, expectedNonce: string, clientId: string): Promise<OAuthProfile> {
  const jwks = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));
  const { payload } = await jwtVerify(idToken, jwks, {
    issuer: ["https://accounts.google.com", "accounts.google.com"],
    audience: clientId,
  });
  if (payload.nonce !== expectedNonce || typeof payload.sub !== "string" ||
      typeof payload.email !== "string" || payload.email_verified !== true) {
    throw new Error("Google ID token claims/nonce validation failed");
  }
  return {
    subject: payload.sub,
    email: payload.email.toLowerCase(),
    name: typeof payload.name === "string" ? payload.name : "Пользователь Google",
    avatarUrl: typeof payload.picture === "string" ? payload.picture : null,
  };
}

async function exchangeVK(
  config: ReturnType<typeof getProviderConfig>,
  code: string,
  deviceId: string,
  state: string,
  codeVerifier: string
): Promise<{ accessToken: string; userId: string }> {
  const params = new URLSearchParams({
    grant_type: "authorization_code",
    redirect_uri: config!.redirectUri,
    client_id: config!.clientId,
    code_verifier: codeVerifier,
    state,
    device_id: deviceId,
  });
  const res = await fetch("https://id.vk.ru/oauth2/auth?" + params.toString(), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code }),
    signal: AbortSignal.timeout(15_000),
  });
  const json = (await res.json()) as { access_token?: string; user_id?: number | string; state?: string; error?: string; error_description?: string };
  if (!res.ok || !json.access_token || json.user_id === undefined || json.state !== state) {
    throw new Error("VK ID token exchange failed: " + (json.error_description || json.error || res.status));
  }
  return { accessToken: json.access_token, userId: String(json.user_id) };
}

async function fetchVKProfile(accessToken: string, clientId: string, expectedUserId: string): Promise<OAuthProfile> {
  const url = new URL("https://id.vk.ru/oauth2/user_info");
  url.searchParams.set("client_id", clientId);
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ access_token: accessToken }),
    signal: AbortSignal.timeout(15_000),
  });
  const json = (await res.json()) as { user?: { user_id?: string | number; email?: string; first_name?: string; last_name?: string; avatar?: string } };
  const user = json.user;
  if (!res.ok || !user?.email || user.user_id === undefined || String(user.user_id) !== expectedUserId) {
    throw new Error("VK ID profile: verified email or matching user identifier is missing");
  }
  return {
    subject: String(user.user_id),
    email: user.email.toLowerCase(),
    name: [user.first_name, user.last_name].filter(Boolean).join(" ") || "Пользователь VK ID",
    avatarUrl: user.avatar || null,
  };
}


async function rollbackOAuthUser(userId: string): Promise<void> {
  const { supabaseAdmin } = await import("@/lib/supabase/admin");
  const { error } = await supabaseAdmin.auth.admin.deleteUser(userId);
  if (!error) return;

  if (process.env.NODE_ENV === "development") {
    const { getPool } = await import("@/lib/postgrest/pool");
    await getPool().query("DELETE FROM auth.users WHERE id = $1", [userId]);
    return;
  }
  throw error;
}

function readRequestCookie(request: NextRequest, name: string): string | undefined {
  const direct = request.cookies.get(name)?.value;
  if (direct !== undefined) return direct;
  const raw = request.headers.get("cookie") || "";
  for (const part of raw.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() === name) return part.slice(separator + 1).trim();
  }
  return undefined;
}

function finishRedirect(
  error?: string,
  provider?: Provider,
  returnTo: string = "/dashboard",
  secureCookies = process.env.NODE_ENV === "production"
): NextResponse {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  const url = new URL(error ? "/login" : returnTo, baseUrl);
  if (error) {
    url.searchParams.set("oauthError", error);
    url.searchParams.set("returnTo", returnTo);
  }
  const response = NextResponse.redirect(url, { status: 302 });

  if (provider) {
    const cookieOptions = {
      httpOnly: true,
      sameSite: "lax" as const,
      secure: secureCookies,
      maxAge: 0,
      path: "/api/auth/oauth",
    };
    response.cookies.set("oauth_state_" + provider, "", cookieOptions);
    response.cookies.set("oauth_verifier_" + provider, "", cookieOptions);
    response.cookies.set("oauth_return_to_" + provider, "", cookieOptions);
    response.cookies.set("oauth_consent_pd_" + provider, "", cookieOptions);
    response.cookies.set("oauth_consent_terms_" + provider, "", cookieOptions);
    response.cookies.set("oauth_consent_offer_" + provider, "", cookieOptions);
    if (provider === "google") response.cookies.set("oauth_nonce_google", "", cookieOptions);
  }
  response.headers.set("Cache-Control", "no-store, no-cache, must-revalidate, private");
  return response;
}

async function handleOAuthCallback(
  request: NextRequest,
  { params }: { params: Promise<{ provider: string }> }
): Promise<NextResponse> {
  const routeParams = params ? await params : undefined;
  const pathSegments = new URL(request.url).pathname.split("/").filter(Boolean);
  const rawProvider = routeParams?.provider || pathSegments[pathSegments.length - 2] || "";
  const provider = rawProvider.toLowerCase() as Provider;

  if (!SUPPORTED_PROVIDERS.includes(provider)) {
    return finishRedirect("Неподдерживаемый OAuth-провайдер");
  }

  const { searchParams } = new URL(request.url);
  const storedReturnTo = readRequestCookie(request, "oauth_return_to_" + provider);
  const secureCookies = request.nextUrl.protocol === "https:" || request.headers.get("x-forwarded-proto") === "https";
  let requestedReturnTo = "/dashboard";
  if (storedReturnTo) {
    try {
      // Next.js cookie API отдаёт percent-encoded value из Set-Cookie.
      requestedReturnTo = decodeURIComponent(storedReturnTo);
    } catch {
      requestedReturnTo = "/dashboard";
    }
  }
  const returnTo = requestedReturnTo.startsWith("/") &&
    !requestedReturnTo.startsWith("//") &&
    !requestedReturnTo.includes("\\") &&
    !/[\\r\\n]/.test(requestedReturnTo)
    ? requestedReturnTo
    : "/dashboard";

  const oauthError = searchParams.get("error");
  if (oauthError) return finishRedirect("Вход отменён или отклонён провайдером", provider, returnTo, secureCookies);

  const config = getProviderConfig(provider);
  if (!config) return finishRedirect("Провайдер не настроен", provider, returnTo, secureCookies);

  let createdUserForRollback: string | null = null;
  try {
    const code = searchParams.get("code");
    const state = searchParams.get("state");
    const cookieState = request.cookies.get("oauth_state_" + provider)?.value;
    if (!code || !state || !cookieState || state !== cookieState) {
      return finishRedirect("Неверный state — повторите вход", provider, returnTo, secureCookies);
    }

    let profile: OAuthProfile;
    if (provider === "yandex") {
      const verifier = request.cookies.get("oauth_verifier_yandex")?.value;
      if (!verifier) throw new Error("Yandex PKCE verifier is missing");
      const accessToken = await exchangeYandex(config, code, verifier);
      profile = await fetchYandexProfile(accessToken);
    } else if (provider === "google") {
      const nonce = request.cookies.get("oauth_nonce_google")?.value;
      const verifier = request.cookies.get("oauth_verifier_google")?.value;
      if (!nonce || !verifier) throw new Error("Google OIDC nonce/PKCE verifier is missing");
      const tokens = await exchangeGoogle(config, code, verifier);
      profile = await fetchGoogleProfile(tokens.idToken, nonce, config.clientId);
    } else {
      const deviceId = searchParams.get("device_id");
      const verifier = request.cookies.get("oauth_verifier_vk")?.value;
      if (!deviceId || !verifier) throw new Error("VK ID device_id/PKCE verifier is missing");
      const tokens = await exchangeVK(config, code, deviceId, state, verifier);
      profile = await fetchVKProfile(tokens.accessToken, config.clientId, tokens.userId);
    }

    const { supabaseAdmin } = await import("@/lib/supabase/admin");
    const { data: identityLink, error: identityLookupError } = await supabaseAdmin
      .from("oauth_identity_links")
      .select("user_id")
      .eq("provider", provider)
      .eq("provider_subject", profile.subject)
      .maybeSingle();
    if (identityLookupError) throw new Error("Не удалось проверить связь OAuth-аккаунта");

    let userId: string;
    let createdNewUser = false;
    let localAuthFallback = false;
    if (identityLink?.user_id) {
      userId = identityLink.user_id;
    } else {
      const consentPd = request.cookies.get("oauth_consent_pd_" + provider)?.value === "1";
      const consentTerms = request.cookies.get("oauth_consent_terms_" + provider)?.value === "1";
      if (!consentPd || !consentTerms) {
        return finishRedirect(
          "Для создания нового аккаунта необходимо отдельно согласиться на обработку персональных данных и принять пользовательское соглашение.",
          provider,
          returnTo,
          secureCookies
        );
      }
      // Не объединяем существующие аккаунты только по совпадению email.
      const { data: emailOwner, error: emailLookupError } = await supabaseAdmin
        .from("profiles")
        .select("id")
        .eq("email", profile.email)
        .maybeSingle();
      if (emailLookupError) throw new Error("Не удалось проверить существующую учётную запись");
      if (emailOwner) {
        return finishRedirect(
          "Для этого email уже есть аккаунт. Войдите привычным способом; привязка этого провайдера пока не включена.",
          provider,
          returnTo,
          secureCookies
        );
      }

      const metadata = {
        name: profile.name,
        full_name: profile.name,
        avatar_url: profile.avatarUrl,
        oauth_provider: provider,
        oauth_subject: profile.subject,
        consent_pd_accepted_at: new Date().toISOString(),
        consent_terms_accepted_at: new Date().toISOString(),
        consent_pd_version: process.env.LEGAL_PRIVACY_VERSION || "2026-11-18.1",
        consent_terms_version: process.env.LEGAL_TERMS_VERSION || "2026-11-18.1",
      };
      const { data: authData, error: authCreateError } = await supabaseAdmin.auth.admin.createUser({
        email: profile.email,
        email_confirm: true,
        user_metadata: metadata,
      });

      if (authCreateError || !authData.user?.id) {
        // Локальный Conditera runtime может использовать auth.users compatibility
        // shim без GoTrue. Production обязан иметь рабочий GoTrue Admin API.
        if (process.env.NODE_ENV !== "development") {
          throw new Error("Не удалось создать пользователя в Supabase Auth");
        }
        localAuthFallback = true;
        userId = crypto.randomUUID();
        const { getPool } = await import("@/lib/postgrest/pool");
        await getPool().query(
          "INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at, raw_user_meta_data, created_at, updated_at) VALUES ($1, $2, '', now(), $3::jsonb, now(), now()) ON CONFLICT (id) DO NOTHING",
          [userId, profile.email, JSON.stringify(metadata)]
        );
      } else {
        userId = authData.user.id;
      }
      createdNewUser = true;
      createdUserForRollback = userId;

      const { error: profileUpsertError } = await supabaseAdmin.from("profiles").upsert({
        id: userId,
        email: profile.email,
        name: profile.name,
        phone: null,
        account_type: "individual",
        legal_info: null,
        loyalty_level: "BRONZE",
        bonus_balance: 0,
        is_blocked: false,
        is_verified: false,
      }, { onConflict: "id" });
      if (profileUpsertError) throw new Error("Не удалось создать профиль пользователя");
    }

    const { data: profileRow, error: profileError } = await supabaseAdmin
      .from("profiles")
      .select("id, email, name, account_type, is_blocked")
      .eq("id", userId)
      .maybeSingle();
    if (profileError || !profileRow) throw new Error("Профиль пользователя не найден");
    if (profileRow.is_blocked) {
      return finishRedirect("Вход в аккаунт ограничен. Обратитесь в поддержку.", provider, returnTo, secureCookies);
    }

    const { data: rolesData, error: rolesError } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", userId)
      .eq("is_active", true);
    if (rolesError) throw new Error("Не удалось загрузить роли пользователя");
    let roles = (rolesData || []).map((item: { role: string }) => item.role);
    if (roles.length === 0) {
      const { error: roleInsertError } = await supabaseAdmin
        .from("user_roles")
        .insert({ user_id: userId, role: "CUSTOMER", is_active: true });
      if (roleInsertError) throw new Error("Не удалось назначить роль покупателя");
      roles = ["CUSTOMER"];
    }

    if (createdNewUser) {
      const forwardedFor = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
      const ipAddress = (forwardedFor || request.headers.get("x-real-ip") || "").slice(0, 64) || null;
      const userAgent = request.headers.get("user-agent")?.slice(0, 512) || null;
      const { error: consentInsertError } = await supabaseAdmin.from("user_consent_events").insert([
        {
          user_id: userId,
          event_type: "grant",
          consent_type: "personal_data",
          document_version: process.env.LEGAL_PRIVACY_VERSION || "2026-11-18.1",
          source: "oauth",
          provider,
          ip_address: ipAddress,
          user_agent: userAgent,
        },
        {
          user_id: userId,
          event_type: "grant",
          consent_type: "terms",
          document_version: process.env.LEGAL_TERMS_VERSION || "2026-11-18.1",
          source: "oauth",
          provider,
          ip_address: ipAddress,
          user_agent: userAgent,
        },
      ]);
      if (consentInsertError) {
        throw new Error("Не удалось зафиксировать обязательные согласия. Аккаунт не активирован.");
      }
    }

    if (!identityLink?.user_id) {
      const { error: identityInsertError } = await supabaseAdmin
        .from("oauth_identity_links")
        .insert({
          provider,
          provider_subject: profile.subject,
          user_id: userId,
          provider_email: profile.email,
        });
      if (identityInsertError) {
        const { data: racedLink, error: racedLookupError } = await supabaseAdmin
          .from("oauth_identity_links")
          .select("user_id")
          .eq("provider", provider)
          .eq("provider_subject", profile.subject)
          .maybeSingle();
        if (racedLookupError || racedLink?.user_id !== userId) {
          throw new Error("Этот OAuth-аккаунт уже связан с другой учётной записью");
        }
      }
    } else {
      const { error: touchError } = await supabaseAdmin
        .from("oauth_identity_links")
        .update({ last_authenticated_at: new Date().toISOString() })
        .eq("provider", provider)
        .eq("provider_subject", profile.subject)
        .eq("user_id", userId);
      if (touchError) throw new Error("Не удалось обновить OAuth-связь");
    }

    const email = profileRow.email || profile.email;
    const name = profileRow.name || profile.name;
    const accountType = profileRow.account_type || "individual";
    // Создаём GoTrue-сессию без изменения пароля пользователя.
    // Это сохраняет совместимость с Supabase JS/RLS/Storage-клиентами,
    // а app-JWT остаётся каноничной сессией API Conditera.
    const response = finishRedirect(undefined, provider, returnTo);
    if (!localAuthFallback) {
      const supabaseUrl = resolveSupabaseServerUrl();
      const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
      if (!supabaseUrl || !anonKey) {
        throw new Error("Supabase URL/anon key is not configured for OAuth session handoff");
      }
      const { data: generatedLink, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
        type: "magiclink",
        email,
      });
      const tokenHash = generatedLink?.properties?.hashed_token;
      if (linkError || !tokenHash) {
        throw new Error("Не удалось подготовить Supabase-сессию после OAuth");
      }

      const supabaseSessionClient = createServerClient(supabaseUrl, anonKey, {
        cookies: {
          getAll() {
            return request.cookies.getAll();
          },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value, options }) => {
              response.cookies.set(name, value, options);
            });
          },
        },
      });
      const { error: verifyOtpError } = await supabaseSessionClient.auth.verifyOtp({
        type: "magiclink",
        token_hash: tokenHash,
      });
      if (verifyOtpError) {
        throw new Error("Не удалось выпустить Supabase-сессию после OAuth");
      }
    } else if (process.env.NODE_ENV !== "development") {
      throw new Error("GoTrue недоступен вне локальной разработки");
    }

    const accessToken = await createAccessToken({ userId, email, name, roles, accountType });
    const refreshToken = await createRefreshToken({ userId, email, name, roles, accountType });
    const finalResponse = setSessionCookies(response, { accessToken, refreshToken });
    createdUserForRollback = null;
    return finalResponse;
  } catch (error: unknown) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error("[oauth/" + provider + "/callback]", detail);
    if (createdUserForRollback) {
      try {
        await rollbackOAuthUser(createdUserForRollback);
      } catch (cleanupError) {
        console.error("[oauth/" + provider + "/callback] rollback failed", cleanupError);
      }
    }
    return finishRedirect("Не удалось завершить вход. Попробуйте ещё раз.", provider, returnTo, secureCookies);
  }
}


// Последний защитный рубеж: даже непредвиденная ошибка в очистке cookies,
// разборе callback или сборке ответа не должна оставлять пользователя на 500.
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ provider: string }> }
): Promise<NextResponse> {
  try {
    return await handleOAuthCallback(request, context);
  } catch (error: unknown) {
    console.error(
      "[oauth/callback] unhandled failure:",
      error instanceof Error ? error.message : String(error)
    );
    const target = new URL("/login", request.url);
    target.searchParams.set("oauthError", "Не удалось завершить вход. Попробуйте ещё раз.");
    const response = NextResponse.redirect(target, 302);
    response.headers.set("Cache-Control", "no-store, no-cache, must-revalidate, private");
    return response;
  }
}
