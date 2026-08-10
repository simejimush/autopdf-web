import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

const SETTINGS_PATH = resolve(process.cwd(), "app/(app)/settings/page.tsx");
const GLOBAL_BANNER_PATH = resolve(
  process.cwd(),
  "src/components/GlobalBanner.tsx",
);
const GLOBAL_BANNER_MODEL_PATH = resolve(
  process.cwd(),
  "src/lib/ui/globalBanner.ts",
);

test("Google connect links remain clickable without render-time prefetch", () => {
  const settingsSource = readFileSync(SETTINGS_PATH, "utf8");
  const bannerSource = readFileSync(GLOBAL_BANNER_PATH, "utf8");
  const bannerModelSource = readFileSync(GLOBAL_BANNER_MODEL_PATH, "utf8");

  expect(settingsSource).toMatch(
    /<Link\s+href="\/api\/google\/connect"\s+prefetch=\{false\}/,
  );
  expect(bannerSource).toMatch(
    /<Link\s+href=\{b\.ctaHref\}\s+prefetch=\{false\}/,
  );
  expect(bannerModelSource).toContain('ctaHref: "/api/google/connect"');
});
