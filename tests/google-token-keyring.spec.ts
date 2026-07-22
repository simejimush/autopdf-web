import { randomBytes } from "node:crypto";
import { expect, test } from "@playwright/test";
import {
  decryptGoogleToken,
  encryptGoogleToken,
  GoogleTokenCryptoError,
  type GoogleTokenCryptoErrorCode,
} from "../src/lib/security/googleTokenCrypto";
import {
  createGoogleTokenKeyringLoader,
  GOOGLE_TOKEN_KEYRING_ENV_NAMES,
  MAX_GOOGLE_TOKEN_KEYS,
  parseGoogleTokenKeyring,
} from "../src/lib/security/googleTokenKeyringCore";

const USER_ID = "33333333-3333-4333-8333-333333333333";
const OLD_KEY_ID = "old-2026-07";
const CURRENT_KEY_ID = "current-2026-08";

function createKey(byteLength = 32): string {
  return randomBytes(byteLength).toString("base64url");
}

function createKeysJson(
  keys: Array<{ id: string; key: string }>,
  extra: Record<string, unknown> = {},
): string {
  return JSON.stringify({ version: 1, keys, ...extra });
}

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
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

test("valid keyring selects the current and envelope keys", () => {
  const oldKey = createKey();
  const currentKey = createKey();
  const keyring = parseGoogleTokenKeyring({
    currentKeyId: CURRENT_KEY_ID,
    keysJson: createKeysJson([
      { id: OLD_KEY_ID, key: oldKey },
      { id: CURRENT_KEY_ID, key: currentKey },
    ]),
  });

  expect(keyring.getCurrentKey()).toEqual({
    keyId: CURRENT_KEY_ID,
    key: currentKey,
  });
  expect(keyring.getDecryptKey(OLD_KEY_ID)).toEqual({
    keyId: OLD_KEY_ID,
    key: oldKey,
  });
});

test("a keyring with exactly the maximum number of keys is valid", () => {
  const keys = Array.from({ length: MAX_GOOGLE_TOKEN_KEYS }, (_, index) => ({
    id: `maximum-key-${index}`,
    key: createKey(),
  }));
  const keyring = parseGoogleTokenKeyring({
    currentKeyId: keys[MAX_GOOGLE_TOKEN_KEYS - 1].id,
    keysJson: createKeysJson(keys),
  });

  expect(keyring.getCurrentKey()).toEqual({
    keyId: keys[MAX_GOOGLE_TOKEN_KEYS - 1].id,
    key: keys[MAX_GOOGLE_TOKEN_KEYS - 1].key,
  });
});

test("rotation keeps old ciphertext decryptable and uses the new current key", () => {
  const oldKey = createKey();
  const currentKey = createKey();
  const oldKeyring = parseGoogleTokenKeyring({
    currentKeyId: OLD_KEY_ID,
    keysJson: createKeysJson([{ id: OLD_KEY_ID, key: oldKey }]),
  });
  const oldWriteKey = oldKeyring.getCurrentKey();
  const oldCiphertext = encryptGoogleToken({
    token: "old-token-for-rotation-test",
    userId: USER_ID,
    tokenType: "refresh",
    keyId: oldWriteKey.keyId,
    key: oldWriteKey.key,
  });
  const rotatedKeyring = parseGoogleTokenKeyring({
    currentKeyId: CURRENT_KEY_ID,
    keysJson: createKeysJson([
      { id: OLD_KEY_ID, key: oldKey },
      { id: CURRENT_KEY_ID, key: currentKey },
    ]),
  });

  expect(
    decryptGoogleToken({
      token: oldCiphertext,
      userId: USER_ID,
      tokenType: "refresh",
      resolveKey: rotatedKeyring.getDecryptKey,
    }),
  ).toBe("old-token-for-rotation-test");

  const currentWriteKey = rotatedKeyring.getCurrentKey();
  const currentCiphertext = encryptGoogleToken({
    token: "current-token-for-rotation-test",
    userId: USER_ID,
    tokenType: "access",
    keyId: currentWriteKey.keyId,
    key: currentWriteKey.key,
  });

  expect(currentCiphertext.split(":")[2]).toBe(CURRENT_KEY_ID);
  expect(
    decryptGoogleToken({
      token: currentCiphertext,
      userId: USER_ID,
      tokenType: "access",
      resolveKey: rotatedKeyring.getDecryptKey,
    }),
  ).toBe("current-token-for-rotation-test");
});

test("invalid keyring configurations fail closed with safe codes", async () => {
  const validKey = createKey();
  const tooManyKeys = Array.from(
    { length: MAX_GOOGLE_TOKEN_KEYS + 1 },
    (_, index) => ({ id: `key-${index}`, key: createKey() }),
  );
  const cases: Array<{
    name: string;
    currentKeyId: string | undefined;
    keysJson: string | undefined;
    code: GoogleTokenCryptoErrorCode;
  }> = [
    {
      name: "missing current key ID",
      currentKeyId: undefined,
      keysJson: createKeysJson([{ id: CURRENT_KEY_ID, key: validKey }]),
      code: "GOOGLE_TOKEN_KEY_MISSING",
    },
    {
      name: "missing key JSON",
      currentKeyId: CURRENT_KEY_ID,
      keysJson: undefined,
      code: "GOOGLE_TOKEN_KEY_MISSING",
    },
    {
      name: "malformed JSON",
      currentKeyId: CURRENT_KEY_ID,
      keysJson: "{not-json",
      code: "GOOGLE_TOKEN_KEY_INVALID",
    },
    {
      name: "top-level null",
      currentKeyId: CURRENT_KEY_ID,
      keysJson: "null",
      code: "GOOGLE_TOKEN_KEY_INVALID",
    },
    {
      name: "top-level array",
      currentKeyId: CURRENT_KEY_ID,
      keysJson: "[]",
      code: "GOOGLE_TOKEN_KEY_INVALID",
    },
    {
      name: "top-level primitive",
      currentKeyId: CURRENT_KEY_ID,
      keysJson: "1",
      code: "GOOGLE_TOKEN_KEY_INVALID",
    },
    {
      name: "missing version",
      currentKeyId: CURRENT_KEY_ID,
      keysJson: JSON.stringify({
        keys: [{ id: CURRENT_KEY_ID, key: validKey }],
      }),
      code: "GOOGLE_TOKEN_KEY_INVALID",
    },
    {
      name: "unsupported version",
      currentKeyId: CURRENT_KEY_ID,
      keysJson: JSON.stringify({
        version: 2,
        keys: [{ id: CURRENT_KEY_ID, key: validKey }],
      }),
      code: "GOOGLE_TOKEN_KEY_INVALID",
    },
    {
      name: "unknown top-level field",
      currentKeyId: CURRENT_KEY_ID,
      keysJson: createKeysJson(
        [{ id: CURRENT_KEY_ID, key: validKey }],
        { unexpected: true },
      ),
      code: "GOOGLE_TOKEN_KEY_INVALID",
    },
    {
      name: "unknown key entry field",
      currentKeyId: CURRENT_KEY_ID,
      keysJson: JSON.stringify({
        version: 1,
        keys: [{ id: CURRENT_KEY_ID, key: validKey, unexpected: true }],
      }),
      code: "GOOGLE_TOKEN_KEY_INVALID",
    },
    {
      name: "missing keys",
      currentKeyId: CURRENT_KEY_ID,
      keysJson: JSON.stringify({ version: 1 }),
      code: "GOOGLE_TOKEN_KEY_INVALID",
    },
    {
      name: "keys is not an array",
      currentKeyId: CURRENT_KEY_ID,
      keysJson: JSON.stringify({ version: 1, keys: {} }),
      code: "GOOGLE_TOKEN_KEY_INVALID",
    },
    {
      name: "empty keyring",
      currentKeyId: CURRENT_KEY_ID,
      keysJson: createKeysJson([]),
      code: "GOOGLE_TOKEN_KEY_INVALID",
    },
    {
      name: "key count over limit",
      currentKeyId: tooManyKeys[0].id,
      keysJson: createKeysJson(tooManyKeys),
      code: "GOOGLE_TOKEN_KEY_INVALID",
    },
    {
      name: "duplicate key ID",
      currentKeyId: CURRENT_KEY_ID,
      keysJson: createKeysJson([
        { id: CURRENT_KEY_ID, key: validKey },
        { id: CURRENT_KEY_ID, key: createKey() },
      ]),
      code: "GOOGLE_TOKEN_KEY_INVALID",
    },
    {
      name: "entry is null",
      currentKeyId: CURRENT_KEY_ID,
      keysJson: JSON.stringify({ version: 1, keys: [null] }),
      code: "GOOGLE_TOKEN_KEY_INVALID",
    },
    {
      name: "entry is an array",
      currentKeyId: CURRENT_KEY_ID,
      keysJson: JSON.stringify({ version: 1, keys: [[]] }),
      code: "GOOGLE_TOKEN_KEY_INVALID",
    },
    {
      name: "entry is a primitive",
      currentKeyId: CURRENT_KEY_ID,
      keysJson: JSON.stringify({ version: 1, keys: [1] }),
      code: "GOOGLE_TOKEN_KEY_INVALID",
    },
    {
      name: "entry is missing id",
      currentKeyId: CURRENT_KEY_ID,
      keysJson: JSON.stringify({
        version: 1,
        keys: [{ key: validKey }],
      }),
      code: "GOOGLE_TOKEN_KEY_INVALID",
    },
    {
      name: "entry is missing key",
      currentKeyId: CURRENT_KEY_ID,
      keysJson: JSON.stringify({
        version: 1,
        keys: [{ id: CURRENT_KEY_ID }],
      }),
      code: "GOOGLE_TOKEN_KEY_INVALID",
    },
    {
      name: "entry id is not a string",
      currentKeyId: CURRENT_KEY_ID,
      keysJson: JSON.stringify({
        version: 1,
        keys: [{ id: 1, key: validKey }],
      }),
      code: "GOOGLE_TOKEN_KEY_INVALID",
    },
    {
      name: "entry key is not a string",
      currentKeyId: CURRENT_KEY_ID,
      keysJson: JSON.stringify({
        version: 1,
        keys: [{ id: CURRENT_KEY_ID, key: 1 }],
      }),
      code: "GOOGLE_TOKEN_KEY_INVALID",
    },
    {
      name: "invalid key ID",
      currentKeyId: CURRENT_KEY_ID,
      keysJson: createKeysJson([{ id: "bad:key", key: validKey }]),
      code: "GOOGLE_TOKEN_KEY_INVALID",
    },
    {
      name: "empty key ID",
      currentKeyId: CURRENT_KEY_ID,
      keysJson: createKeysJson([{ id: "", key: validKey }]),
      code: "GOOGLE_TOKEN_KEY_INVALID",
    },
    {
      name: "invalid current key ID",
      currentKeyId: "bad:key",
      keysJson: createKeysJson([{ id: CURRENT_KEY_ID, key: validKey }]),
      code: "GOOGLE_TOKEN_KEY_INVALID",
    },
    {
      name: "empty current key ID",
      currentKeyId: "",
      keysJson: createKeysJson([{ id: CURRENT_KEY_ID, key: validKey }]),
      code: "GOOGLE_TOKEN_KEY_INVALID",
    },
    {
      name: "current key absent",
      currentKeyId: CURRENT_KEY_ID,
      keysJson: createKeysJson([{ id: OLD_KEY_ID, key: validKey }]),
      code: "GOOGLE_TOKEN_KEY_INVALID",
    },
    {
      name: "invalid base64url character",
      currentKeyId: CURRENT_KEY_ID,
      keysJson: createKeysJson([{ id: CURRENT_KEY_ID, key: "secret+value" }]),
      code: "GOOGLE_TOKEN_KEY_INVALID",
    },
    {
      name: "base64url with slash",
      currentKeyId: CURRENT_KEY_ID,
      keysJson: createKeysJson([{ id: CURRENT_KEY_ID, key: "secret/value" }]),
      code: "GOOGLE_TOKEN_KEY_INVALID",
    },
    {
      name: "noncanonical padded base64url",
      currentKeyId: CURRENT_KEY_ID,
      keysJson: createKeysJson([
        { id: CURRENT_KEY_ID, key: `${validKey}=` },
      ]),
      code: "GOOGLE_TOKEN_KEY_INVALID",
    },
    {
      name: "31-byte key",
      currentKeyId: CURRENT_KEY_ID,
      keysJson: createKeysJson([{ id: CURRENT_KEY_ID, key: createKey(31) }]),
      code: "GOOGLE_TOKEN_KEY_INVALID",
    },
    {
      name: "33-byte key",
      currentKeyId: CURRENT_KEY_ID,
      keysJson: createKeysJson([{ id: CURRENT_KEY_ID, key: createKey(33) }]),
      code: "GOOGLE_TOKEN_KEY_INVALID",
    },
  ];

  for (const configCase of cases) {
    await test.step(configCase.name, () => {
      expectCryptoError(
        () =>
          parseGoogleTokenKeyring({
            currentKeyId: configCase.currentKeyId,
            keysJson: configCase.keysJson,
          }),
        configCase.code,
      );
    });
  }
});

test("env-backed loader caches, invalidates, recovers, and resets safely", async () => {
  const currentEnvName = GOOGLE_TOKEN_KEYRING_ENV_NAMES.currentKeyId;
  const keysEnvName = GOOGLE_TOKEN_KEYRING_ENV_NAMES.keysJson;
  const originalCurrentKeyId = process.env[currentEnvName];
  const originalKeysJson = process.env[keysEnvName];
  const firstKey = createKey();
  const secondKey = createKey();
  const replacementSecondKey = createKey();
  const loader = createGoogleTokenKeyringLoader(() => ({
    currentKeyId: process.env[currentEnvName],
    keysJson: process.env[keysEnvName],
  }));

  expect(currentEnvName).toBe("GOOGLE_TOKEN_ENCRYPTION_CURRENT_KEY_ID");
  expect(keysEnvName).toBe("GOOGLE_TOKEN_ENCRYPTION_KEYS_JSON");

  try {
    process.env[currentEnvName] = OLD_KEY_ID;
    process.env[keysEnvName] = createKeysJson([
      { id: OLD_KEY_ID, key: firstKey },
      { id: CURRENT_KEY_ID, key: secondKey },
    ]);

    const initial = loader.getCurrentKey();

    await test.step("unchanged env reuses the parsed result", () => {
      expect(loader.getCurrentKey()).toBe(initial);
    });

    await test.step("changing only current key ID reparses", () => {
      process.env[currentEnvName] = CURRENT_KEY_ID;
      const changed = loader.getCurrentKey();

      expect(changed).not.toBe(initial);
      expect(changed).toEqual({ keyId: CURRENT_KEY_ID, key: secondKey });
    });

    await test.step("changing only key JSON reparses", () => {
      const beforeJsonChange = loader.getCurrentKey();
      process.env[keysEnvName] = createKeysJson([
        { id: OLD_KEY_ID, key: firstKey },
        { id: CURRENT_KEY_ID, key: replacementSecondKey },
      ]);
      const changed = loader.getCurrentKey();

      expect(changed).not.toBe(beforeJsonChange);
      expect(changed).toEqual({
        keyId: CURRENT_KEY_ID,
        key: replacementSecondKey,
      });
    });

    await test.step("invalid env is not cached and corrected env recovers", () => {
      process.env[keysEnvName] = "{invalid-json";
      expectCryptoError(
        () => loader.getCurrentKey(),
        "GOOGLE_TOKEN_KEY_INVALID",
      );

      process.env[keysEnvName] = createKeysJson([
        { id: CURRENT_KEY_ID, key: secondKey },
      ]);
      expect(loader.getCurrentKey()).toEqual({
        keyId: CURRENT_KEY_ID,
        key: secondKey,
      });
    });

    await test.step("reset discards a cached parse result", () => {
      const beforeReset = loader.getCurrentKey();
      loader.resetForTests();
      expect(loader.getCurrentKey()).not.toBe(beforeReset);
    });
  } finally {
    loader.resetForTests();
    restoreEnv(currentEnvName, originalCurrentKeyId);
    restoreEnv(keysEnvName, originalKeysJson);
  }

  expect(process.env[currentEnvName] === originalCurrentKeyId).toBe(true);
  expect(process.env[keysEnvName] === originalKeysJson).toBe(true);
});

test("an envelope key ID absent from the keyring has a dedicated error", () => {
  const unknownKey = createKey();
  const ciphertext = encryptGoogleToken({
    token: "unknown-key-token",
    userId: USER_ID,
    tokenType: "access",
    keyId: "unknown-key-id",
    key: unknownKey,
  });
  const keyring = parseGoogleTokenKeyring({
    currentKeyId: CURRENT_KEY_ID,
    keysJson: createKeysJson([
      { id: CURRENT_KEY_ID, key: createKey() },
    ]),
  });

  expectCryptoError(
    () =>
      decryptGoogleToken({
        token: ciphertext,
        userId: USER_ID,
        tokenType: "access",
        resolveKey: keyring.getDecryptKey,
      }),
    "GOOGLE_TOKEN_KEY_ID_UNKNOWN",
  );
});

test("legacy plaintext does not resolve or require a keyring", () => {
  const legacyToken = "legacy-token-without-keyring-env";

  expect(
    decryptGoogleToken({
      token: legacyToken,
      userId: USER_ID,
      tokenType: "refresh",
      resolveKey: () => {
        throw new Error("resolver must not be called for legacy tokens");
      },
    }),
  ).toBe(legacyToken);
});

test("encrypted values require keyring configuration", () => {
  const key = createKey();
  const ciphertext = encryptGoogleToken({
    token: "encrypted-token-needs-keyring",
    userId: USER_ID,
    tokenType: "access",
    keyId: CURRENT_KEY_ID,
    key,
  });

  expectCryptoError(
    () =>
      decryptGoogleToken({
        token: ciphertext,
        userId: USER_ID,
        tokenType: "access",
        resolveKey: (keyId) =>
          parseGoogleTokenKeyring({
            currentKeyId: undefined,
            keysJson: undefined,
          }).getDecryptKey(keyId),
      }),
    "GOOGLE_TOKEN_KEY_MISSING",
  );
});

test("keyring errors do not expose secrets or authenticated data", () => {
  const secretKey = createKey();
  const secretJson = createKeysJson([
    { id: CURRENT_KEY_ID, key: secretKey },
  ]).replace('"version":1', '"version":2');
  const configError = expectCryptoError(
    () =>
      parseGoogleTokenKeyring({
        currentKeyId: CURRENT_KEY_ID,
        keysJson: secretJson,
      }),
    "GOOGLE_TOKEN_KEY_INVALID",
  );
  const unknownKey = createKey();
  const secretToken = "secret-token-for-error-test";
  const ciphertext = encryptGoogleToken({
    token: secretToken,
    userId: USER_ID,
    tokenType: "access",
    keyId: "retired-secret-key",
    key: unknownKey,
  });
  const keyring = parseGoogleTokenKeyring({
    currentKeyId: CURRENT_KEY_ID,
    keysJson: createKeysJson([
      { id: CURRENT_KEY_ID, key: createKey() },
    ]),
  });
  const decryptError = expectCryptoError(
    () =>
      decryptGoogleToken({
        token: ciphertext,
        userId: USER_ID,
        tokenType: "access",
        resolveKey: keyring.getDecryptKey,
      }),
    "GOOGLE_TOKEN_KEY_ID_UNKNOWN",
  );

  for (const error of [configError, decryptError]) {
    expect(error.message).not.toContain(secretJson);
    expect(error.message).not.toContain(secretKey);
    expect(error.message).not.toContain(unknownKey);
    expect(error.message).not.toContain(secretToken);
    expect(error.message).not.toContain(ciphertext);
    expect(error.message).not.toContain(USER_ID);
    expect(error.message).not.toContain(
      `autopdf|google-oauth|v1|${USER_ID}|access`,
    );
  }
});
