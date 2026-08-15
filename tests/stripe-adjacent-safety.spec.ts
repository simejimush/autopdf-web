import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

const successPage = readFileSync(
  resolve(process.cwd(), "app/billing/success/page.tsx"),
  "utf8",
);
const billingRoute = readFileSync(
  resolve(process.cwd(), "app/api/billing/route.ts"),
  "utf8",
);

test("Checkout success requires current authenticated ownership", () => {
  expect(successPage).toContain("createSupabaseServerClient");
  expect(successPage).toContain("supabase.auth.getUser()");
  expect(successPage).toContain("session.client_reference_id");
  expect(successPage).toContain("session.metadata?.user_id");
  expect(successPage).toContain("ownerId !== user.id");
  expect(successPage.indexOf("ownerId !== user.id")).toBeLessThan(
    successPage.indexOf("<ClientStatus"),
  );
});

test("billing API never serializes raw database details", () => {
  expect(billingRoute).toContain(
    'jsonError("Failed to load billing profile", 500)',
  );
  expect(billingRoute).not.toContain("details?: unknown");
  expect(billingRoute).not.toContain("{ error: message, details }");
});
