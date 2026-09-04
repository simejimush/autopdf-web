import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import AppToaster from "../components/providers/AppToaster";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "AutoPDF｜メールで届く書類を自動でGoogle Driveへ保存",
  description:
    "Gmailに届く請求書・領収書などを自動でPDF化し、Google Driveへ保存。メール書類の整理作業を自動化できます。",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const supabase = await createSupabaseServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  let isGoogleConnected = false;
  let hasActiveRule = false;

  // ✅ これを追加（returnの前に必ず存在させる）

  if (user) {
    // Google接続判定
    const { data: gc } = await supabase
      .from("google_connections")
      .select("id")
      .eq("user_id", user.id)
      .maybeSingle();

    isGoogleConnected = !!gc;

    // ルール一覧（1回だけ取得）
    const { data: myRules } = await supabase
      .from("rules")
      .select("id, is_active")
      .eq("user_id", user.id);

    const rulesArr = myRules ?? [];

    // 有効ルール判定（ここで確定）
    hasActiveRule = rulesArr.some((r) => r.is_active === true);
  }
  return (
    <html lang="ja" suppressHydrationWarning>
      <head>
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined"
        />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
        <AppToaster />

        <script
          dangerouslySetInnerHTML={{
            __html: `
      (function () {
        try {
          var saved = localStorage.getItem("theme");
          var theme = saved === "dark" ? "dark" : "light";
          document.documentElement.dataset.theme = theme;
        } catch (e) {}
      })();
    `,
          }}
        />
      </body>
    </html>
  );
}
