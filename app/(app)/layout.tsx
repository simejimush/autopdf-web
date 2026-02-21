// app/(app)/layout.tsx
import React from "react";
import AppTopbar from "./AppTopbar";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="appPage">
      <style>{styles}</style>
      <AppTopbar />
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