import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { expect, test } from "@playwright/test";
import ts from "typescript";
import type { NotifyUserResult } from "../src/lib/monitoring/notifyUser";

const NOTIFY_PATH = resolve(process.cwd(), "src/lib/monitoring/notifyUser.ts");
const USER_ID = "44444444-4444-4444-8444-444444444444";
const OTHER_USER_ID = "55555555-5555-4555-8555-555555555555";
const OWNER_EMAIL = "owner@example.test";
const ADMIN_EMAIL = "sencho96@gmail.com";

type Connection = Readonly<{
  user_id: string;
  reauth_required: boolean;
  last_user_notified_at: string | null;
  last_user_notified_error_code: string | null;
}>;

function defaultConnection(): Connection {
  return {
    user_id: USER_ID,
    reauth_required: true,
    last_user_notified_at: null,
    last_user_notified_error_code: null,
  };
}

function loadNotifyUser(options?: {
  connection?: Connection | null;
  connectionError?: unknown;
  authUser?: Readonly<{
    id: string;
    email?: string | null;
    user_metadata?: unknown;
  }> | null;
  authError?: unknown;
  authThrow?: Error;
  sendError?: Error;
  updateError?: unknown;
  updateThrow?: Error;
}) {
  const source = readFileSync(NOTIFY_PATH, "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: NOTIFY_PATH,
  }).outputText;
  const calls = {
    order: [] as string[],
    connectionSelect: [] as string[],
    connectionEq: [] as Array<{ column: string; value: string }>,
    authGetUserById: [] as string[],
    sendEmail: [] as Array<{
      to: string;
      subject: string;
      text: string;
    }>,
    update: [] as Array<Record<string, unknown>>,
    updateEq: [] as Array<{ column: string; value: string }>,
    logs: [] as unknown[][],
  };

  const supabaseAdmin = {
    auth: {
      admin: {
        async getUserById(userId: string) {
          calls.order.push("auth:get_user_by_id");
          calls.authGetUserById.push(userId);
          if (options?.authThrow) throw options.authThrow;
          return {
            data: {
              user:
                options?.authUser === undefined
                  ? { id: USER_ID, email: OWNER_EMAIL }
                  : options.authUser,
            },
            error: options?.authError ?? null,
          };
        },
      },
    },
    from(table: string) {
      expect(table).toBe("google_connections");
      return {
        select(columns: string) {
          calls.connectionSelect.push(columns);
          return {
            eq(column: string, value: string) {
              calls.connectionEq.push({ column, value });
              return {
                async maybeSingle() {
                  calls.order.push("connection:read");
                  return {
                    data:
                      options?.connection === undefined
                        ? defaultConnection()
                        : options.connection,
                    error: options?.connectionError ?? null,
                  };
                },
              };
            },
          };
        },
        update(payload: Record<string, unknown>) {
          calls.update.push(payload);
          return {
            async eq(column: string, value: string) {
              calls.order.push("connection:update");
              calls.updateEq.push({ column, value });
              if (options?.updateThrow) throw options.updateThrow;
              return { data: null, error: options?.updateError ?? null };
            },
          };
        },
      };
    },
  };

  const loadedModule = {
    exports: {} as {
      notifyUser: (
        payload: Record<string, unknown>,
      ) => Promise<NotifyUserResult>;
    },
  };
  const localRequire = (specifier: string) => {
    if (specifier === "@/lib/supabase/admin") return { supabaseAdmin };
    if (specifier === "@/lib/email/sendEmail") {
      return {
        async sendEmail(input: { to: string; subject: string; text: string }) {
          calls.order.push("email:send");
          calls.sendEmail.push(input);
          if (options?.sendError) throw options.sendError;
          return { ok: true as const };
        },
      };
    }
    throw new Error(`Unexpected notifyUser dependency: ${specifier}`);
  };

  runInNewContext(compiled, {
    exports: loadedModule.exports,
    module: loadedModule,
    require: localRequire,
    console: {
      error(...args: unknown[]) {
        calls.logs.push(args);
      },
    },
    process: {
      env: { NEXT_PUBLIC_APP_URL: "https://app.example" },
    },
  });

  const payload = {
    userId: USER_ID,
    ruleId: "66666666-6666-4666-8666-666666666666",
    errorCode: "GOOGLE_TOKEN_INVALID",
    message: "Safe user message",
    trigger: "cron",
    occurredAt: "2026-07-26T00:00:00.000Z",
  };

  return {
    notifyUser: loadedModule.exports.notifyUser,
    payload,
    calls,
    source,
  };
}

test("sends to the exact Auth user resolved by notification user ID", async () => {
  const harness = loadNotifyUser();

  const result = await harness.notifyUser(harness.payload);

  expect(result).toEqual({ sent: true, skipped: false });
  expect(harness.calls.authGetUserById).toEqual([USER_ID]);
  expect(harness.calls.sendEmail).toHaveLength(1);
  expect(harness.calls.sendEmail[0].to).toBe(OWNER_EMAIL);
  expect(harness.calls.sendEmail[0].to).not.toBe(ADMIN_EMAIL);
  expect(harness.calls.order).toEqual([
    "connection:read",
    "auth:get_user_by_id",
    "email:send",
    "connection:update",
  ]);
});

test("a mismatched Auth user cannot redirect mail to another user", async () => {
  const otherEmail = "other-user@example.test";
  const harness = loadNotifyUser({
    authUser: { id: OTHER_USER_ID, email: otherEmail },
  });

  const result = await harness.notifyUser(harness.payload);

  expect(result).toEqual({
    sent: false,
    skipped: true,
    reason: "auth_user_not_found",
  });
  expect(harness.calls.sendEmail).toHaveLength(0);
  expect(harness.calls.update).toHaveLength(0);
  expect(JSON.stringify(harness.calls.logs)).not.toContain(otherEmail);
});

test("missing Auth user skips without email or administrator fallback", async () => {
  for (const options of [
    { authUser: null },
    {
      authUser: null,
      authError: { code: "user_not_found", message: "private Auth detail" },
    },
  ]) {
    const harness = loadNotifyUser(options);

    const result = await harness.notifyUser(harness.payload);

    expect(result).toEqual({
      sent: false,
      skipped: true,
      reason: "auth_user_not_found",
    });
    expect(harness.calls.sendEmail).toHaveLength(0);
    expect(harness.calls.update).toHaveLength(0);
    expect(harness.source).not.toContain(ADMIN_EMAIL);
  }
});

test("missing or blank Auth email skips without administrator fallback", async () => {
  for (const email of [null, undefined, "   "]) {
    const harness = loadNotifyUser({
      authUser: { id: USER_ID, email },
    });

    const result = await harness.notifyUser(harness.payload);

    expect(result).toEqual({
      sent: false,
      skipped: true,
      reason: "auth_email_missing",
    });
    expect(harness.calls.sendEmail).toHaveLength(0);
    expect(harness.calls.update).toHaveLength(0);
  }
});

test("Auth lookup errors and exceptions remain non-fatal", async () => {
  for (const options of [
    { authError: { message: "private auth error" } },
    { authThrow: new Error("private auth exception") },
  ]) {
    const harness = loadNotifyUser(options);

    await expect(harness.notifyUser(harness.payload)).resolves.toEqual({
      sent: false,
      skipped: false,
      reason: "auth_lookup_failed",
    });
    expect(harness.calls.sendEmail).toHaveLength(0);
    expect(harness.calls.update).toHaveLength(0);
  }
});

test("provider failure remains non-fatal and never updates notification state", async () => {
  const harness = loadNotifyUser({
    sendError: new Error("private provider response with token"),
  });

  await expect(harness.notifyUser(harness.payload)).resolves.toEqual({
    sent: false,
    skipped: false,
    reason: "send_failed",
  });
  expect(harness.calls.sendEmail).toHaveLength(1);
  expect(harness.calls.update).toHaveLength(0);
});

test("notification state is written only after provider success", async () => {
  const harness = loadNotifyUser();

  await harness.notifyUser(harness.payload);

  expect(harness.calls.update).toHaveLength(1);
  expect(harness.calls.update[0]).toMatchObject({
    last_user_notified_error_code: "GOOGLE_TOKEN_INVALID",
  });
  expect(harness.calls.update[0].last_user_notified_at).toEqual(
    harness.calls.update[0].updated_at,
  );
  expect(harness.calls.updateEq).toEqual([
    { column: "user_id", value: USER_ID },
  ]);
});

test("state update failure is reported safely after a successful send", async () => {
  for (const options of [
    { updateError: { message: "private database error" } },
    { updateThrow: new Error("private database exception") },
  ]) {
    const harness = loadNotifyUser(options);

    await expect(harness.notifyUser(harness.payload)).resolves.toEqual({
      sent: true,
      skipped: false,
      reason: "state_update_failed",
    });
    expect(harness.calls.sendEmail).toHaveLength(1);
    expect(harness.calls.update).toHaveLength(1);
  }
});

test("connection skips do not look up Auth, send, or update notification state", async () => {
  const recent = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  for (const options of [
    { connection: null },
    {
      connection: { ...defaultConnection(), reauth_required: false },
    },
    {
      connection: {
        ...defaultConnection(),
        last_user_notified_at: recent,
      },
    },
  ]) {
    const harness = loadNotifyUser(options);

    const result = await harness.notifyUser(harness.payload);

    expect(result.sent).toBe(false);
    expect(result.skipped).toBe(true);
    expect(harness.calls.authGetUserById).toHaveLength(0);
    expect(harness.calls.sendEmail).toHaveLength(0);
    expect(harness.calls.update).toHaveLength(0);
  }
});

test("fixed logs and errors never expose email, token, secret, or metadata", async () => {
  const privateMetadata = { private: "private-user-metadata" };
  const harness = loadNotifyUser({
    authUser: {
      id: USER_ID,
      email: OWNER_EMAIL,
      user_metadata: privateMetadata,
    },
    sendError: new Error("private-token private-secret"),
  });

  const result = await harness.notifyUser(harness.payload);
  const resultText = JSON.stringify(result);
  const logText = JSON.stringify(harness.calls.logs);

  for (const secret of [
    OWNER_EMAIL,
    USER_ID,
    "private-token",
    "private-secret",
    "private-user-metadata",
  ]) {
    expect(resultText).not.toContain(secret);
    expect(logText).not.toContain(secret);
  }
  expect(logText).toContain("USER_NOTIFY_FAILED");
  expect(logText).toContain("send_failed");
});

test("implementation uses only exact Auth ID lookup and no caller email", () => {
  const harness = loadNotifyUser();

  expect(harness.source).toContain("auth.admin.getUserById(payload.userId)");
  expect(harness.source).not.toContain("listUsers");
  expect(harness.source).not.toContain("userEmail");
  expect(harness.source).not.toContain("user_metadata");
  expect(harness.source).not.toContain(ADMIN_EMAIL);
});
