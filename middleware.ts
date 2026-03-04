// autopdf-web/middleware.ts
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

export function middleware(_req: NextRequest) {
  return NextResponse.next();
}

// もし matcher を使ってたならここに書く。
// export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
