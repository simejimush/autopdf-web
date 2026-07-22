import { randomBytes } from "node:crypto";
import { expect, test } from "@playwright/test";
import {
  decryptGoogleToken,
  encryptGoogleToken,
  GoogleTokenCryptoError,
  isEncryptedGoogleToken,
  type GoogleTokenCryptoErrorCode,
  type GoogleTokenType,
} from "../src/lib/security/googleTokenCrypto";
import { getRunErrorMessage } from "../src/lib/runs/getRunErrorMessage";
import { normalizeRunErrorCode } from "../src/lib/runs/normalizeRunErrorCode";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_USER_ID = "22222222-2222-4222-8222-222222222222";
const KEY_ID = "primary-2026-07";

function createKey(): string {
  return randomBytes(32).toString("base64url");
}

function encrypt(params?: {
  token?: string;
  userId?: string;
  tokenType?: GoogleTokenType;
  keyId?: string;
  key?: string;
}) {
  return encryptGoogleToken({
    token: params?.token ?? "test-token-value",
    userId: params?.userId ?? USER_ID,
    tokenType: params?.tokenType ?? "access",
    keyId: params?.keyId ?? KEY_ID,
    key: params?.key ?? createKey(),
  });
}

function expectCryptoError(
  action: () => unknown,
  code: GoogleTokenCryptoErrorCode,
): GoogleTokenCryptoError {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(GoogleTokenCryptoError);
    expect((error as GoogleTokenCryptoError).code).toBe(code);
    return error as GoogleTokenCryptoError;
  }

  throw new Error(`Expected ${code}`);
}

function replaceEnvelopePart(
  encryptedToken: string,
  index: number,
  value: string,
): string {
  const parts = encryptedToken.split(":");
  parts[index] = value;
  return parts.join(":");
}

function mutateBase64Url(value: string): string {
  const first = value[0];
  const replacement = first === "A" ? "B" : "A";
  return `${replacement}${value.slice(1)}`;
}

test("encrypt/decrypt round trip", () => {
  const key = createKey();
  const encrypted = encrypt({ token: "round-trip-token", key });

  expect(isEncryptedGoogleToken(encrypted)).toBe(true);
  expect(
    decryptGoogleToken({
      token: encrypted,
      userId: USER_ID,
      tokenType: "access",
      keyId: KEY_ID,
      key,
    }),
  ).toBe("round-trip-token");
});

test("同じ平文でも毎回異なるIVと暗号文になる", () => {
  const key = createKey();
  const first = encrypt({ key });
  const second = encrypt({ key });
  const firstParts = first.split(":");
  const secondParts = second.split(":");

  expect(firstParts[3]).not.toBe(secondParts[3]);
  expect(firstParts[5]).not.toBe(secondParts[5]);
  expect(first).not.toBe(second);
});

test("accessとrefreshは異なるAAD境界で保護される", () => {
  const key = createKey();
  const accessToken = encrypt({ key, tokenType: "access" });
  const refreshToken = encrypt({ key, tokenType: "refresh" });

  expect(
    decryptGoogleToken({
      token: accessToken,
      userId: USER_ID,
      tokenType: "access",
      keyId: KEY_ID,
      key,
    }),
  ).toBe("test-token-value");
  expect(
    decryptGoogleToken({
      token: refreshToken,
      userId: USER_ID,
      tokenType: "refresh",
      keyId: KEY_ID,
      key,
    }),
  ).toBe("test-token-value");
  expectCryptoError(
    () =>
      decryptGoogleToken({
        token: accessToken,
        userId: USER_ID,
        tokenType: "refresh",
        keyId: KEY_ID,
        key,
      }),
    "GOOGLE_TOKEN_DECRYPT_FAILED",
  );
});

test("user ID違いでは復号に失敗する", () => {
  const key = createKey();
  const encrypted = encrypt({ key });

  expectCryptoError(
    () =>
      decryptGoogleToken({
        token: encrypted,
        userId: OTHER_USER_ID,
        tokenType: "access",
        keyId: KEY_ID,
        key,
      }),
    "GOOGLE_TOKEN_DECRYPT_FAILED",
  );
});

test("token種別違いでは復号に失敗する", () => {
  const key = createKey();
  const encrypted = encrypt({ key, tokenType: "refresh" });

  expectCryptoError(
    () =>
      decryptGoogleToken({
        token: encrypted,
        userId: USER_ID,
        tokenType: "access",
        keyId: KEY_ID,
        key,
      }),
    "GOOGLE_TOKEN_DECRYPT_FAILED",
  );
});

test("wrong keyでは復号に失敗する", () => {
  const encrypted = encrypt({ key: createKey() });

  expectCryptoError(
    () =>
      decryptGoogleToken({
        token: encrypted,
        userId: USER_ID,
        tokenType: "access",
        keyId: KEY_ID,
        key: createKey(),
      }),
    "GOOGLE_TOKEN_DECRYPT_FAILED",
  );
});

test("ciphertext改ざんでは復号に失敗する", () => {
  const key = createKey();
  const encrypted = encrypt({ key });
  const parts = encrypted.split(":");
  const tampered = replaceEnvelopePart(
    encrypted,
    5,
    mutateBase64Url(parts[5]),
  );

  expectCryptoError(
    () =>
      decryptGoogleToken({
        token: tampered,
        userId: USER_ID,
        tokenType: "access",
        keyId: KEY_ID,
        key,
      }),
    "GOOGLE_TOKEN_DECRYPT_FAILED",
  );
});

test("tag改ざんでは復号に失敗する", () => {
  const key = createKey();
  const encrypted = encrypt({ key });
  const parts = encrypted.split(":");
  const tampered = replaceEnvelopePart(
    encrypted,
    4,
    mutateBase64Url(parts[4]),
  );

  expectCryptoError(
    () =>
      decryptGoogleToken({
        token: tampered,
        userId: USER_ID,
        tokenType: "access",
        keyId: KEY_ID,
        key,
      }),
    "GOOGLE_TOKEN_DECRYPT_FAILED",
  );
});

test("IV不正では形式エラーになる", () => {
  const key = createKey();
  const encrypted = encrypt({ key });
  const invalidIv = randomBytes(11).toString("base64url");

  expectCryptoError(
    () =>
      decryptGoogleToken({
        token: replaceEnvelopePart(encrypted, 3, invalidIv),
        userId: USER_ID,
        tokenType: "access",
        keyId: KEY_ID,
        key,
      }),
    "GOOGLE_TOKEN_FORMAT_UNSUPPORTED",
  );
});

test("未知versionでは形式エラーになる", () => {
  const key = createKey();
  const encrypted = encrypt({ key });

  expectCryptoError(
    () =>
      decryptGoogleToken({
        token: replaceEnvelopePart(encrypted, 1, "v2"),
        userId: USER_ID,
        tokenType: "access",
        keyId: KEY_ID,
        key,
      }),
    "GOOGLE_TOKEN_FORMAT_UNSUPPORTED",
  );
});

test("不正key IDを含む暗号文では形式エラーになる", () => {
  const key = createKey();
  const encrypted = encrypt({ key });

  expectCryptoError(
    () =>
      decryptGoogleToken({
        token: replaceEnvelopePart(encrypted, 2, "invalid key id"),
        userId: USER_ID,
        tokenType: "access",
        keyId: KEY_ID,
        key,
      }),
    "GOOGLE_TOKEN_FORMAT_UNSUPPORTED",
  );
});

test("strict parserはsegment・空値・base64url・tag長の不正を拒否する", async () => {
  const key = createKey();
  const encrypted = encrypt({ key });
  const parts = encrypted.split(":");
  const cases = [
    {
      name: "segment数不足",
      token: parts.slice(0, 5).join(":"),
    },
    {
      name: "segment数超過",
      token: `${encrypted}:extra`,
    },
    {
      name: "空key ID",
      token: replaceEnvelopePart(encrypted, 2, ""),
    },
    {
      name: "空IV",
      token: replaceEnvelopePart(encrypted, 3, ""),
    },
    {
      name: "空tag",
      token: replaceEnvelopePart(encrypted, 4, ""),
    },
    {
      name: "空ciphertext",
      token: replaceEnvelopePart(encrypted, 5, ""),
    },
    {
      name: "base64url不正文字",
      token: replaceEnvelopePart(encrypted, 3, "invalid+iv"),
    },
    {
      name: "非canonical base64url",
      token: replaceEnvelopePart(encrypted, 3, `${parts[3]}=`),
    },
    {
      name: "tag長不正",
      token: replaceEnvelopePart(
        encrypted,
        4,
        randomBytes(15).toString("base64url"),
      ),
    },
  ];

  for (const testCase of cases) {
    await test.step(testCase.name, () => {
      const error = expectCryptoError(
        () =>
          decryptGoogleToken({
            token: testCase.token,
            userId: USER_ID,
            tokenType: "access",
            keyId: KEY_ID,
            key,
          }),
        "GOOGLE_TOKEN_FORMAT_UNSUPPORTED",
      );

      expect(error.message).not.toContain(testCase.token);
      expect(error.message).not.toContain(encrypted);
      expect(error.message).not.toContain(key);
    });
  }
});

test("形式上有効だが未知のkey IDはfail closedになる", () => {
  const key = createKey();
  const encrypted = encrypt({ key });
  const unknownKeyToken = replaceEnvelopePart(
    encrypted,
    2,
    "unknown-2026-07",
  );
  const error = expectCryptoError(
    () =>
      decryptGoogleToken({
        token: unknownKeyToken,
        userId: USER_ID,
        tokenType: "access",
        keyId: KEY_ID,
        key,
      }),
    "GOOGLE_TOKEN_KEY_MISSING",
  );

  expect(error.message).not.toContain(unknownKeyToken);
  expect(error.message).not.toContain(encrypted);
  expect(error.message).not.toContain(key);
});

test("暗号文prefixを持つ壊れた値はlegacyへfallbackしない", () => {
  const malformed = "autopdf-token:not-an-envelope";
  const key = createKey();
  const error = expectCryptoError(
    () =>
      decryptGoogleToken({
        token: malformed,
        userId: USER_ID,
        tokenType: "access",
        keyId: KEY_ID,
        key,
      }),
    "GOOGLE_TOKEN_FORMAT_UNSUPPORTED",
  );

  expect(error.message).not.toContain(malformed);
  expect(error.message).not.toContain(key);
});

test("不正な設定key IDでは鍵エラーになる", () => {
  expectCryptoError(
    () =>
      encryptGoogleToken({
        token: "test-token-value",
        userId: USER_ID,
        tokenType: "access",
        keyId: "invalid key id",
        key: createKey(),
      }),
    "GOOGLE_TOKEN_KEY_INVALID",
  );
});

test("legacy値は鍵なしでそのまま読める", () => {
  const legacy = "legacy-plain-token";

  expect(isEncryptedGoogleToken(legacy)).toBe(false);
  expect(
    decryptGoogleToken({
      token: legacy,
      userId: USER_ID,
      tokenType: "refresh",
    }),
  ).toBe(legacy);
});

test("delimiterのないopaque legacy値は暗号文として扱わない", () => {
  const legacy = "autopdf-token-legacy-value";

  expect(isEncryptedGoogleToken(legacy)).toBe(false);
  expect(
    decryptGoogleToken({
      token: legacy,
      userId: USER_ID,
      tokenType: "access",
    }),
  ).toBe(legacy);
});

test("legacy空文字と空白のみは鍵なしでそのまま読める", () => {
  for (const legacy of ["", "   "]) {
    expect(isEncryptedGoogleToken(legacy)).toBe(false);
    expect(
      decryptGoogleToken({
        token: legacy,
        userId: USER_ID,
        tokenType: "refresh",
      }),
    ).toBe(legacy);
  }
});

test("暗号文で鍵未設定なら専用エラーになる", () => {
  const encrypted = encrypt({ key: createKey() });

  expectCryptoError(
    () =>
      decryptGoogleToken({
        token: encrypted,
        userId: USER_ID,
        tokenType: "access",
      }),
    "GOOGLE_TOKEN_KEY_MISSING",
  );
});

test("鍵長不正なら専用エラーになる", () => {
  const encrypted = encrypt({ key: createKey() });

  expectCryptoError(
    () =>
      decryptGoogleToken({
        token: encrypted,
        userId: USER_ID,
        tokenType: "access",
        keyId: KEY_ID,
        key: randomBytes(31).toString("base64url"),
      }),
    "GOOGLE_TOKEN_KEY_INVALID",
  );
});

test("暗号文を二重暗号化しない", () => {
  const key = createKey();
  const encrypted = encrypt({ key });

  expectCryptoError(
    () => encrypt({ token: encrypted, key }),
    "GOOGLE_TOKEN_FORMAT_UNSUPPORTED",
  );
});

test("エラー文にtoken、暗号文、鍵を含めない", () => {
  const token = "highly-sensitive-token-value";
  const key = createKey();
  const encrypted = encrypt({ token, key });
  const error = expectCryptoError(
    () =>
      decryptGoogleToken({
        token: encrypted,
        userId: OTHER_USER_ID,
        tokenType: "access",
        keyId: KEY_ID,
        key,
      }),
    "GOOGLE_TOKEN_DECRYPT_FAILED",
  );

  expect(error.message).not.toContain(token);
  expect(error.message).not.toContain(encrypted);
  expect(error.message).not.toContain(key);
  expect(error.message).not.toContain(USER_ID);
});

test("専用エラーをtoken invalidや再接続文言へ誤分類しない", () => {
  const codes: GoogleTokenCryptoErrorCode[] = [
    "GOOGLE_TOKEN_KEY_MISSING",
    "GOOGLE_TOKEN_KEY_INVALID",
    "GOOGLE_TOKEN_FORMAT_UNSUPPORTED",
    "GOOGLE_TOKEN_DECRYPT_FAILED",
  ];

  for (const code of codes) {
    const error = new GoogleTokenCryptoError(code);
    const normalized = normalizeRunErrorCode(error);
    const userFacing = getRunErrorMessage(normalized);

    expect(normalized).toBe(code);
    expect(userFacing.action).not.toContain("再接続");
  }
});
