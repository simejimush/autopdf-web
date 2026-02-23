// src/components/GlobalBanner.tsx
import Link from "next/link";
import type { GlobalBanner as Banner } from "@/src/lib/ui/globalBanner";

export function GlobalBanner({ banner }: { banner: Banner | null }) {
  if (!banner) return null;

  const base =
    "w-full rounded-xl px-4 py-3 flex items-start justify-between gap-3 border";
  const tone =
    banner.variant === "error"
      ? "bg-red-50 border-red-200 text-red-900"
      : banner.variant === "warning"
        ? "bg-amber-50 border-amber-200 text-amber-900"
        : banner.variant === "success"
          ? "bg-emerald-50 border-emerald-200 text-emerald-900"
          : "bg-slate-50 border-slate-200 text-slate-900";

  return (
    <div className={`${base} ${tone}`}>
      <div className="min-w-0">
        <div className="font-semibold leading-snug">{banner.title}</div>
        {banner.body ? (
          <div className="text-sm opacity-90 mt-0.5">{banner.body}</div>
        ) : null}
      </div>

      {banner.ctaHref && banner.ctaLabel ? (
        <Link
          href={banner.ctaHref}
          className="shrink-0 rounded-lg px-3 py-2 text-sm font-medium bg-white/70 border border-black/10 hover:bg-white"
        >
          {banner.ctaLabel}
        </Link>
      ) : null}
    </div>
  );
}