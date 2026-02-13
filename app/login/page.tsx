"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const router = useRouter();
  const supabase = createSupabaseClient();

  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) router.replace("/dashboard");
      setLoading(false);
    });
  }, [router, supabase]);

  const signIn = async () => {
    setErrorMsg(null);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${location.origin}/auth/callback` },
    });
    if (error) setErrorMsg(error.message);
  };

  if (loading) return <main style={{ padding: 24 }}>loading...</main>;

  return (
    <main style={{ padding: 24 }}>
      <h1>Login</h1>
      {errorMsg && <pre>{errorMsg}</pre>}
      <button onClick={signIn} style={{ padding: "10px 14px" }}>
        Googleでログイン
      </button>
    </main>
  );
}
