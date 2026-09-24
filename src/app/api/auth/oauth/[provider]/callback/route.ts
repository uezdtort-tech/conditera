// GET /api/auth/oauth/[provider]/callback
//
// Реальный OAuth-callback для Yandex и Google (+ stub-режим для остальных).
//
// Флоу:
//   1. Сверяем state (query) с httpOnly-cookie oauth_state_<provider> (CSRF).
//   2. Обмениваем code на access_token (token endpoint провайдера).
//   3. Забираем профиль (email, имя, аватар).
//   4. Находим/создаём пользователя в GoTrue через Admin API
//      (email_confirm=true, случайный пароль), синхронизируем profiles
//      и роль CUSTOMER.
//   5. Server-side signInWithPassword → валидная GoTrue-сессия.
//   6. Передаём сессию в браузер через одноразовый httpOnly-cookie
//      (60 сек) → /oauth/finish → /api/auth/oauth/handoff →
//      supabaseBrowser.auth.setSession() (тот же стейт, что после обычного
//      входа: useAuth, роли, Storage-аплоады).
//
// Провайдеры без реальных кредов работают как раньше — JSON-заглушка 501.

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { randomBytes } from "crypto";

type Provider = "google" | "yandex" | "vk" | "telegram";

const SUPPORTED_PROVIDERS: Provider[] = ["google", "yandex", "vk", "telegram"];

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
      // У Яндекса confidential-клиент требует secret; public-клиент — нет.
      return { clientId: clientId!, clientSecret: isStubValue(clientSecret) ? undefined : clientSecret, redirectUri: redirectUri! };
    }
    default:
      return null; // vk/telegram — пока только заглушка
  }
}

interface OAuthProfile {
  email: string;
  name: string;
  avatarUrl: string | null;
}

async function exchangeYandex(config: ReturnType<typeof getProviderConfig>, code: string): Promise<string> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    client_id: config!.clientId,
    redirect_uri: config!.redirectUri,
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
  };
  const email = json.default_email || (json.login?.includes("@") ? json.login : `${json.login}@yandex.ru`);
  if (!email) throw new Error("Yandex profile: email not available");
  const name = json.real_name || json.display_name || "Пользователь Яндекса";
  const avatarUrl =
    !json.is_avatar_empty && json.default_avatar_id
      ? `https://avatars.yandex.net/get-yapic/${json.default_avatar_id}/islands-200`
      : null;
  return { email: email.toLowerCase(), name, avatarUrl };
}

async function exchangeGoogle(config: ReturnType<typeof getProviderConfig>, code: string): Promise<string> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: config!.clientId,
      client_secret: config!.clientSecret!,
      redirect_uri: config!.redirectUri,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const json = (await res.json()) as { access_token?: string; error_description?: string };
  if (!res.ok || !json.access_token) {
    throw new Error(`Google token: ${json.error_description || res.status}`);
  }
  return json.access_token;
}

async function fetchGoogleProfile(accessToken: string): Promise<OAuthProfile> {
  const res = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(15_000),
  });
  const json = (await res.json()) as { email?: string; name?: string; picture?: string };
  if (!json.email) throw new Error("Google profile: email not available");
  return { email: json.email.toLowerCase(), name: json.name || "Пользователь Google", avatarUrl: json.picture || null };
}

function finishRedirect(error?: string): NextResponse {
  const url = error
    ? new URL(`/oauth/finish?error=${encodeURIComponent(error)}`, process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000")
    : new URL("/oauth/finish", process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000");
  return NextResponse.redirect(url, { status: 302 });
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ provider: string }> }
) {
  const { provider: rawProvider } = await params;
  const provider = rawProvider.toLowerCase() as Provider;

  if (!SUPPORTED_PROVIDERS.includes(provider)) {
    return finishRedirect(`Неподдерживаемый провайдер: ${rawProvider}`);
  }

  const { searchParams } = new URL(request.url);

  // Пользователь отказался в диалоге провайдера.
  const oauthError = searchParams.get("error");
  if (oauthError) {
    return finishRedirect(`Провайдер вернул ошибку: ${oauthError}`);
  }

  const config = getProviderConfig(provider);

  // Заглушка (vk/telegram/нет кредов) — прежнее JSON-поведение.
  if (!config || !["yandex", "google"].includes(provider)) {
    const code = searchParams.get("code");
    const state = searchParams.get("state");
    if (!code || !state) {
      return NextResponse.json({ error: "Missing required OAuth callback parameters (code, state)", provider, stub: true }, { status: 400 });
    }
    return NextResponse.json({
      provider,
      received: { code, state },
      stub: true,
      message: "OAuth callback received. Token exchange not implemented for this provider.",
    });
  }

  // ---- Реальный флоу (yandex / google) ----
  try {
    // 1. CSRF: state из query === state из httpOnly-cookie.
    const code = searchParams.get("code");
    const state = searchParams.get("state");
    const cookieState = request.cookies.get(`oauth_state_${provider}`)?.value;
    if (!code || !state || !cookieState || state !== cookieState) {
      return finishRedirect("Неверный state — повторите вход");
    }

    // 2-3. Обмен кода + профиль.
    const accessToken =
      provider === "yandex" ? await exchangeYandex(config, code) : await exchangeGoogle(config, code);
    const profile =
      provider === "yandex" ? await fetchYandexProfile(accessToken) : await fetchGoogleProfile(accessToken);

    // 4. GoTrue Admin API: найти или создать пользователя.
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!supabaseUrl || !serviceRole || !anonKey) {
      throw new Error("Supabase env vars not configured");
    }

    const tempPassword = randomBytes(24).toString("base64url");
    let userId: string;

    const adminRes = await fetch(`${supabaseUrl}/admin/users?page=1&per_page=1&email=${encodeURIComponent(profile.email)}`, {
      headers: { Authorization: `Bearer ${serviceRole}`, apikey: serviceRole },
      signal: AbortSignal.timeout(15_000),
    });
    const adminList = (await adminRes.json()) as { users?: Array<{ id: string; email?: string }> };
    const existing = (adminList.users || []).find((u) => u.email?.toLowerCase() === profile.email);

    if (existing) {
      userId = existing.id;
      // Обновляем пароль на известный нам → сможем signInWithPassword ниже.
      await fetch(`${supabaseUrl}/admin/users/${userId}`, {
        method: "PUT",
        headers: { Authorization: `Bearer ${serviceRole}`, apikey: serviceRole, "Content-Type": "application/json" },
        body: JSON.stringify({ password: tempPassword }),
        signal: AbortSignal.timeout(15_000),
      });
    } else {
      const createRes = await fetch(`${supabaseUrl}/admin/users`, {
        method: "POST",
        headers: { Authorization: `Bearer ${serviceRole}`, apikey: serviceRole, "Content-Type": "application/json" },
        body: JSON.stringify({
          email: profile.email,
          password: tempPassword,
          email_confirm: true,
          user_metadata: { full_name: profile.name, avatar_url: profile.avatarUrl, oauth_provider: provider },
        }),
        signal: AbortSignal.timeout(15_000),
      });
      const created = (await createRes.json()) as { id?: string; msg?: string };
      if (!createRes.ok || !created.id) {
        throw new Error(`GoTrue create user: ${created.msg || createRes.status}`);
      }
      userId = created.id;
    }

    // 4b. Профиль + роль CUSTOMER (идемпотентно).
    const { supabaseAdmin } = await import("@/lib/supabase/admin");
    await supabaseAdmin.from("profiles").upsert({
      id: userId,
      email: profile.email,
      name: profile.name,
      account_type: "individual",
    }, { onConflict: "id", ignoreDuplicates: false });

    const { data: rolesData } = await supabaseAdmin
      .from("user_roles")
      .select("id")
      .eq("user_id", userId)
      .eq("role", "CUSTOMER")
      .limit(1);
    if (!rolesData || rolesData.length === 0) {
      await supabaseAdmin.from("user_roles").insert({ user_id: userId, role: "CUSTOMER", is_active: true });
    }

    // 5. Server-side GoTrue-сессия.
    const ssr = createClient(supabaseUrl, anonKey, { auth: { persistSession: false } });
    const { data: sessionData, error: signInErr } = await ssr.auth.signInWithPassword({
      email: profile.email,
      password: tempPassword,
    });
    if (signInErr || !sessionData.session) {
      throw new Error(`GoTrue signIn: ${signInErr?.message || "no session"}`);
    }

    // 6. Одноразовый handoff-cookie → /oauth/finish.
    const handoff = {
      accessToken: sessionData.session.access_token,
      refreshToken: sessionData.session.refresh_token,
      expiresAt: sessionData.session.expires_at,
      email: profile.email,
      name: profile.name,
    };
    const response = finishRedirect();
    response.cookies.set("oauth_handoff", Buffer.from(JSON.stringify(handoff)).toString("base64"), {
      httpOnly: true,
      sameSite: "lax",
      secure: false,
      maxAge: 60,
      path: "/",
    });
    return response;
  } catch (error: unknown) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error(`[oauth/${provider}/callback]`, detail);
    return finishRedirect(detail);
  }
}
