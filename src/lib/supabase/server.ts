// autopdf-web/src/lib/supabase/server.ts
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

/**
 * Server Components からも呼ばれる Supabase Server Client。
 * Next.js の制約で「Server Component / Layout のレンダリング中」は cookies の書き込みが禁止。
 * そのため setAll は try/catch で握りつぶし、Route Handler / Server Action 側での書き込みに任せる。
 */
export async function createSupabaseServerClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => {
              cookieStore.set(name, value, options);
            });
          } catch {
            // Next.js: Server Components / Layout render 中は cookies の書き込みができない
            // Route Handler / Server Action 側でのみ書き込めるので、ここでは no-op
          }
        },
      },
    },
  );
}