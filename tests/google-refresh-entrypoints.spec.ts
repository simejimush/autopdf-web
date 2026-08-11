import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

function source(path: string) {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

test("automatic Google refresh is operation-aware and has no callback bypass", () => {
  const auth = source("src/lib/google/auth.ts");
  const callback = source("app/api/google/callback/route.ts");

  expect(auth).toContain('from "@/lib/google/refreshOperation"');
  expect(auth).toContain("markGoogleRefreshProviderStarted");
  expect(auth).toContain("finalizeGoogleRefreshOperation");
  expect(source("src/lib/google/refreshOperation.ts")).toContain(
    "repository.inspect",
  );
  expect(auth).not.toContain("claimGoogleCredentialRefreshLease");
  expect(callback).not.toContain("getAccessToken(");
  expect(callback).toContain('grant_type: "authorization_code"');
  expect(callback).not.toContain('grant_type: "refresh_token"');
});

test("legacy lease remains limited to callback credential mutation and disconnect", () => {
  const callback = source("app/api/google/callback/route.ts");
  const tokenStore = source("src/lib/google/tokenStore.ts");

  expect(callback).toContain("claimGoogleCredentialRefreshLease");
  expect(tokenStore).toContain("disconnectGoogleConnection");
  expect(tokenStore).not.toContain("getAccessToken(");
  expect(tokenStore).not.toContain("refreshAccessToken(");
});

test("automatic refresh re-encrypts the preserved token without changing rotation semantics", () => {
  const authCore = source("src/lib/google/authCore.ts");
  const operation = source("src/lib/google/refreshOperation.ts");
  const repository = source("src/lib/google/refreshOperationRepository.ts");

  expect(authCore).toContain(
    "refreshToken: refreshed.refreshToken ?? refreshToken",
  );
  expect(authCore).toContain(
    "refreshTokenRotated: refreshed.refreshToken !== undefined",
  );
  expect(operation).toContain(
    'encryptGoogleTokenForStore(input.refreshToken, input.userId, "refresh")',
  );
  expect(operation).toContain(
    "refreshTokenPresent: input.refreshToken !== undefined",
  );
  expect(repository).toContain(
    "p_refresh_token_present: input.refreshTokenPresent",
  );
});
