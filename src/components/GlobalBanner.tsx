// src/components/GlobalBanner.tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { GlobalBanner as Banner } from "@/lib/ui/globalBanner";

export function GlobalBanner({ banner }: { banner: Banner | null }) {
  const pathname = usePathname();
  if (!banner) return null;

  //A+B:　/rulesのときはsuccessをミニ化（本文・ボタン無）
  const isRulesPage = pathname.startsWith("/rules");
  const b =
    banner.variant === "success" && isRulesPage
      ? { ...banner, body: undefined, ctaHref: undefined, ctaLabel: undefined }
      : banner;

  const base =
    "w-full rounded-xl px-4 py-3 flex items-start justify-between gap-3 border";
  const tone =
    b.variant === "error"
      ? "bg-red-50 border-red-200 text-red-900"
      : b.variant === "warning"
        ? "bg-amber-50 border-amber-200 text-amber-900"
        : b.variant === "success"
          ? "bg-emerald-50 border-emerald-200 text-emerald-900"
          : "bg-slate-50 border-slate-200 text-slate-900";

  return (
    <div className={`${base} ${tone}`}>
      <div className="min-w-0">
        <div className="font-semibold leading-snug">{b.title}</div>
        {b.body ? (
          <div className="text-sm opacity-90 mt-0.5">{b.body}</div>
        ) : null}
      </div>

      {b.ctaHref && b.ctaLabel ? (
        <Link
          href={b.ctaHref}
          className="shrink-0 rounded-lg px-3 py-2 text-sm font-medium bg-white/70 border border-black/10 hover:bg-white"
        >
          {b.ctaLabel}
        </Link>
      ) : null}
    </div>
  );
}
