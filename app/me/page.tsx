import { createSupabaseServerClient } from "@/lib/supabase/server";

export default async function MePage() {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getUser();

  return (
    <main style={{ padding: 24 }}>
      <h1>/me</h1>

      {error ? (
        <pre>error: {error.message}</pre>
      ) : (
        <>
          <pre>{JSON.stringify(data.user, null, 2)}</pre>

          <a href="/api/google/connect">
            <button style={{ padding: "10px 14px", marginTop: 12 }}>
              Google接続
            </button>
          </a>
        </>
      )}
    </main>
  );
}
