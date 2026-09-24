import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

/**
 * GET /api/auth/callback — server-side OAuth callback для API.
 *
 * Используется когда OAuth redirect идёт на /api/auth/callback (например, для
 * server-side обмена кода на session, без открытия клиентского компонента).
 *
 * В большинстве случаев лучше использовать /auth/callback (Page route),
 * но этот endpoint нужен для API-only OAuth flows.
 */

export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");
  const returnTo = searchParams.get("returnTo") || "/dashboard";

  if (!code) {
    return NextResponse.json({ error: "No code parameter" }, { status: 400 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    return NextResponse.json(
      { error: "Supabase env vars not set" },
      { status: 500 }
    );
  }

  const response = NextResponse.redirect(`${origin}${returnTo}`);

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
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

  try {
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return response;
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error).message },
      { status: 500 }
    );
  }
}
