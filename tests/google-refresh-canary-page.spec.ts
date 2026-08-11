import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { expect, test } from "@playwright/test";

import { evaluateGoogleRefreshCanaryGate } from "../src/lib/google/refreshCanaryCore";

const PAGE_PATH = resolve(
  process.cwd(),
  "app/(app)/settings/refresh-canary/page.tsx",
);
const FORM_PATH = resolve(
  process.cwd(),
  "app/(app)/settings/refresh-canary/CanarySubmitForm.tsx",
);

const pageSource = readFileSync(PAGE_PATH, "utf8");
const formSource = readFileSync(FORM_PATH, "utf8");
const ALLOWED_HOST = "autopdf-preview.example.test";

test("shared gate hides the page outside the exact enabled Preview host", () => {
  for (const input of [
    { vercelEnv: "production", enabled: "true", requestHost: ALLOWED_HOST },
    { vercelEnv: "preview", enabled: "false", requestHost: ALLOWED_HOST },
    {
      vercelEnv: "preview",
      enabled: "true",
      requestHost: "other-preview.example.test",
    },
  ]) {
    expect(
      evaluateGoogleRefreshCanaryGate({
        ...input,
        allowedHost: ALLOWED_HOST,
      }).ok,
    ).toBe(false);
  }

  expect(
    evaluateGoogleRefreshCanaryGate({
      vercelEnv: "preview",
      enabled: "true",
      allowedHost: ALLOWED_HOST,
      requestHost: ALLOWED_HOST,
    }),
  ).toEqual({ ok: true });
});

test("page authenticates before applying the shared fail-closed canary gate", () => {
  expect(pageSource).toContain("supabase.auth.getUser()");
  expect(pageSource).toContain("if (authError || !user) notFound()");
  expect(pageSource.indexOf("supabase.auth.getUser()")).toBeLessThan(
    pageSource.indexOf("evaluateGoogleRefreshCanaryGate({"),
  );
  expect(pageSource).toContain("vercelEnv: process.env.VERCEL_ENV");
  expect(pageSource).toContain(
    "enabled: process.env.GOOGLE_REFRESH_CANARY_ENABLED",
  );
  expect(pageSource).toContain(
    "allowedHost: process.env.GOOGLE_REFRESH_CANARY_ALLOWED_HOST",
  );
  expect(pageSource).toContain('requestHost: requestHeaders.get("host") ?? ""');
  expect(pageSource).toContain("if (!gate.ok) notFound()");
});

test("page exposes only a native POST to the existing canary route", () => {
  expect(formSource).toContain('action="/api/google/refresh-canary"');
  expect(formSource).toContain('method="post"');
  expect(formSource).not.toContain("fetch(");
  expect(formSource).not.toContain("axios");
  expect(formSource).not.toContain("retry");
  expect(pageSource).not.toContain("refreshGoogleCredentialsForCanary");
});

test("form blocks duplicate submits without retrying the request", () => {
  expect(formSource).toContain("const submitted = useRef(false)");
  expect(formSource).toContain("if (submitted.current)");
  expect(formSource).toContain("event.preventDefault()");
  expect(formSource).toContain("submitted.current = true");
  expect(formSource).toContain("disabled={pending}");
});

test("page copy remains Preview-only and does not expose credential data", () => {
  expect(pageSource).toContain("Preview refresh canary");
  expect(pageSource).toContain("Preview only");
  for (const forbidden of [
    "access_token",
    "refresh_token",
    "ciphertext",
    "user.email",
    "client_secret",
    "session cookie",
    "encryption key",
  ]) {
    expect(pageSource.toLowerCase()).not.toContain(forbidden);
    expect(formSource.toLowerCase()).not.toContain(forbidden);
  }
});
