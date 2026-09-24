// GET /api/auth/oauth/[provider]
// OAuth initiation endpoint (stub implementation).
//
// Supported providers: google, yandex, vk, telegram.
// In stub mode (env vars unset or set to placeholder `stub_*` values),
// returns a JSON stub response. In production mode (real credentials
// configured), constructs and returns the provider's authorization URL.

import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";

type Provider = "google" | "yandex" | "vk" | "telegram";

const SUPPORTED_PROVIDERS: Provider[] = ["google", "yandex", "vk", "telegram"];

/**
 * Returns true if a credential value is missing or set to a `stub_*` placeholder.
 * We treat `stub_*` values as "not configured" so developers can ship the
 * skeleton .env without accidentally hitting real OAuth endpoints.
 */
function isStubValue(value: string | undefined): boolean {
  return !value || value.trim() === "" || value.startsWith("stub_");
}

/**
 * Reads OAuth credentials for a provider from env vars.
 * Returns `null` if any required value is missing or stubbed.
 */
function getProviderConfig(provider: Provider): {
  clientId: string;
  redirectUri: string;
} | null {
  switch (provider) {
    case "google": {
      const clientId = process.env.GOOGLE_CLIENT_ID;
      const redirectUri = process.env.GOOGLE_OAUTH_REDIRECT;
      if (isStubValue(clientId) || isStubValue(redirectUri)) return null;
      return { clientId: clientId!, redirectUri: redirectUri! };
    }
    case "yandex": {
      const clientId = process.env.YANDEX_CLIENT_ID;
      const redirectUri = process.env.YANDEX_OAUTH_REDIRECT;
      if (isStubValue(clientId) || isStubValue(redirectUri)) return null;
      return { clientId: clientId!, redirectUri: redirectUri! };
    }
    case "vk": {
      const clientId = process.env.VK_CLIENT_ID;
      const redirectUri = process.env.VK_OAUTH_REDIRECT;
      if (isStubValue(clientId) || isStubValue(redirectUri)) return null;
      return { clientId: clientId!, redirectUri: redirectUri! };
    }
    case "telegram": {
      // Telegram OAuth uses the bot token + redirect URI configured in the
      // Telegram login widget. We don't expose the bot token to the browser.
      const redirectUri = process.env.TELEGRAM_OAUTH_REDIRECT;
      if (isStubValue(redirectUri)) return null;
      return { clientId: "telegram", redirectUri: redirectUri! };
    }
    default:
      return null;
  }
}

/**
 * Builds the authorization URL for the given provider.
 * Production implementation — would actually redirect the browser.
 */
function buildAuthorizationUrl(
  provider: Provider,
  config: { clientId: string; redirectUri: string },
  state: string
): string {
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: "code",
    state,
  });

  switch (provider) {
    case "google": {
      params.set("scope", "openid email profile");
      params.set("access_type", "offline");
      params.set("prompt", "consent");
      return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
    }
    case "yandex": {
      params.set("scope", "login:email login:info");
      return `https://oauth.yandex.ru/authorize?${params.toString()}`;
    }
    case "vk": {
      params.set("scope", "email");
      params.set("v", "5.199");
      return `https://oauth.vk.com/authorize?${params.toString()}`;
    }
    case "telegram": {
      // Telegram Login Widget uses a JS-based flow; here we return the bot
      // login page URL as a fallback for direct-browser flows.
      const botToken = process.env.TELEGRAM_BOT_TOKEN || "";
      const botUsername = botToken.split(":")[0] ? "your_bot" : "your_bot";
      return `https://oauth.telegram.org/auth?bot_id=${botUsername}&origin=${encodeURIComponent(
        config.redirectUri
      )}&request_access=write&return_to=${encodeURIComponent(config.redirectUri)}`;
    }
    default:
      return "";
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ provider: string }> }
) {
  const { provider: rawProvider } = await params;
  const provider = rawProvider.toLowerCase() as Provider;

  if (!SUPPORTED_PROVIDERS.includes(provider)) {
    return NextResponse.json(
      {
        error: "Unsupported OAuth provider",
        provider: rawProvider,
        supported: SUPPORTED_PROVIDERS,
      },
      { status: 400 }
    );
  }

  const config = getProviderConfig(provider);

  // Stub mode — no real credentials configured.
  if (!config) {
    return NextResponse.json(
      {
        error: "OAuth provider not configured",
        provider,
        stub: true,
      },
      { status: 501 }
    );
  }

  // Production mode — construct the authorization URL.
  // `state` is a CSRF token linking the initiation to the callback.
  const state = randomBytes(16).toString("hex");
  const redirectUrl = buildAuthorizationUrl(provider, config, state);

  return NextResponse.json({
    provider,
    redirectUrl,
    state,
    stub: false,
  });
}
