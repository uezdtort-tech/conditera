// GET /api/auth/oauth/[provider]/callback
// OAuth callback endpoint (stub implementation).
//
// Receives `code` and `state` query params from the OAuth provider.
// In stub mode (no real credentials configured), returns a JSON stub
// response. In production mode, would exchange the code for an access
// token, fetch user profile, and create/login the user.

import { NextRequest, NextResponse } from "next/server";

type Provider = "google" | "yandex" | "vk" | "telegram";

const SUPPORTED_PROVIDERS: Provider[] = ["google", "yandex", "vk", "telegram"];

/**
 * Returns true if a credential value is missing or set to a `stub_*` placeholder.
 */
function isStubValue(value: string | undefined): boolean {
  return !value || value.trim() === "" || value.startsWith("stub_");
}

/**
 * Determines whether real OAuth credentials are configured for the provider.
 */
function isProviderConfigured(provider: Provider): boolean {
  switch (provider) {
    case "google":
      return (
        !isStubValue(process.env.GOOGLE_CLIENT_ID) &&
        !isStubValue(process.env.GOOGLE_OAUTH_REDIRECT)
      );
    case "yandex":
      return (
        !isStubValue(process.env.YANDEX_CLIENT_ID) &&
        !isStubValue(process.env.YANDEX_OAUTH_REDIRECT)
      );
    case "vk":
      return (
        !isStubValue(process.env.VK_CLIENT_ID) &&
        !isStubValue(process.env.VK_OAUTH_REDIRECT)
      );
    case "telegram":
      return !isStubValue(process.env.TELEGRAM_OAUTH_REDIRECT);
    default:
      return false;
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

  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");

  // OAuth providers also send `error` if the user declined.
  const oauthError = searchParams.get("error");
  if (oauthError) {
    return NextResponse.json(
      {
        error: "OAuth provider returned an error",
        provider,
        providerError: oauthError,
        stub: false,
      },
      { status: 400 }
    );
  }

  if (!code || !state) {
    return NextResponse.json(
      {
        error: "Missing required OAuth callback parameters (code, state)",
        provider,
        stub: false,
      },
      { status: 400 }
    );
  }

  // Stub mode — no real credentials configured.
  if (!isProviderConfigured(provider)) {
    return NextResponse.json(
      {
        error: "OAuth callback not configured",
        provider,
        stub: true,
      },
      { status: 501 }
    );
  }

  // Production mode — would:
  //   1. Validate `state` against the value stored at initiation (CSRF).
  //   2. POST to the provider's token endpoint with `code`, `client_id`,
  //      `client_secret`, `redirect_uri` to receive an access token.
  //   3. Call the provider's user-info endpoint with the access token.
  //   4. Upsert the user in the DB (linking the OAuth identity).
  //   5. Issue our own JWT access/refresh tokens and return them.
  //
  // This stub returns a placeholder so the frontend can wire up the flow.
  return NextResponse.json({
    provider,
    received: { code, state },
    stub: true,
    message:
      "OAuth callback received. Token exchange & user upsert not implemented in stub mode.",
  });
}
