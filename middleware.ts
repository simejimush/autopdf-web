import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

function redirectTo(req: NextRequest, pathname: string) {
  const url = req.nextUrl.clone();
  url.pathname = pathname;
  url.search = ""; // ループ要因になるので一旦クリア（必要なら残してOK）
  return url;
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // 触らないもの（ここは超重要）
  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/api") ||
    pathname === "/favicon.ico"
  ) {
    return NextResponse.next();
  }

  let res = NextResponse.next({ request: { headers: req.headers } });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return req.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            res.cookies.set(name, value, options);
          });
        },
      },
    },
  );

  // セッション同期（これで cookie 更新される）
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const isProtected =
    pathname.startsWith("/dashboard") ||
    pathname.startsWith("/rules") ||
    pathname.startsWith("/me");

  const isLogin = pathname === "/login";

  // 未ログインで保護ページ => /login
  if (isProtected && !user) {
    const url = redirectTo(req, "/login");
    return NextResponse.redirect(url);
  }

  // ログイン済で /login => /dashboard
  if (isLogin && user) {
    const url = redirectTo(req, "/dashboard");
    return NextResponse.redirect(url);
  }

  return res;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};