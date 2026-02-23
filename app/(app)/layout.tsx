// app/(app)/layout.tsx
import React from "react";
import { redirect } from "next/navigation";
import AppTopbar from "./AppTopbar";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { GlobalBanner } from "@/src/components/GlobalBanner";
import { buildGlobalBanner } from "@/src/lib/ui/globalBanner";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // ✅ 未ログインならログインへ
  if (!user) redirect("/login");
  // --- banner data (Step3-1) ---
  const { data: gc } = await supabase
    .from("google_connections")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();

  const isGoogleConnected = !!gc;

  const { data: rules } = await supabase
    .from("rules")
    .select("id, is_active")
    .eq("user_id", user.id);

  const activeRuleCount = (rules ?? []).filter((r) => r.is_active).length;
  const ruleIds = (rules ?? []).map((r) => r.id);

  let lastRunStatus: "success" | "error" | "running" | "skipped" | null = null;
  let lastRunErrorCode: string | null = null;
  let lastRunMessage: string | null = null;

  if (ruleIds.length > 0) {
    const { data: lastRun } = await supabase
      .from("runs")
      .select("status, error_code, message, finished_at, started_at")
      .in("rule_id", ruleIds)
      .order("finished_at", { ascending: false })
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (lastRun?.status) {
      lastRunStatus = lastRun.status;
      lastRunErrorCode = lastRun.error_code ?? null;
      lastRunMessage = lastRun.message ?? null;
    }
  }

  const banner = buildGlobalBanner({
    isGoogleConnected,
    activeRuleCount,
    lastRunStatus,
    lastRunErrorCode,
    lastRunMessage,
  });

  return (
    <div className="appPage">
      <style>{styles}</style>
      <AppTopbar />

      <div
        className="appContainer"
        style={{ paddingTop: 12, paddingBottom: 0 }}
      >
        <GlobalBanner banner={banner} />
      </div>

      <main className="appContainer">{children}</main>
    </div>
  );
}

const styles = `
:root{
  --bg:#f7f8fb;
  --surface:#ffffff;
  --border:#e5e7eb;
  --text:#111827;
  --muted:#6b7280;
  --primary:#2563eb;
}

.appPage{
  min-height:100vh;
  background:var(--bg);
  color:var(--text);
}

.appContainer{
  max-width:1100px;
  margin:0 auto;
  padding:20px 16px 40px;
}

@media (max-width:768px){
  .appContainer{ padding:16px 12px 32px; }
}
`;
