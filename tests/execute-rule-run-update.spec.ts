import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { expect, test } from "@playwright/test";
import ts from "typescript";

const EXECUTE_PATH = resolve(process.cwd(), "src/lib/runs/executeRule.ts");
const USER_ID = "44444444-4444-4444-8444-444444444444";
const OTHER_USER_ID = "55555555-5555-4555-8555-555555555555";
const RULE_ID = "66666666-6666-4666-8666-666666666666";
const RUN_ID = "88888888-8888-4888-8888-888888888888";
const MESSAGE_ID = "gmail-message-id";

type Trigger = "manual" | "cron";

type FinalizeCall = {
  runId: string;
  userId: string;
  finalization:
    | {
        status: "success";
        processedCount: number;
        savedCount: number;
        skippedCount: number;
        message: string;
      }
    | {
        status: "error";
        errorCode: string;
        resetCounts: boolean;
        message: string;
      };
};

type ProcessedEmailCall = {
  userId: string;
  ruleId: string;
  gmailMessageId: string;
  drive: {
    fileId: string | null;
    webViewLink: string | null;
    fileName: string;
  };
};

function codedError(code: string) {
  return Object.assign(new Error(`raw ${code} detail`), { code });
}

function loadExecuteRule(options?: {
  trigger?: Trigger;
  messageIds?: string[];
  existingProcessed?: boolean;
  limitOk?: boolean;
  attachments?: Array<{
    filename: string;
    mimeType: string;
    attachmentId: string;
  }>;
  failAt?: "rule" | "search" | "pdf" | "drive";
  errorCode?: string;
  processedInsertError?: boolean;
  finalizeError?: Error;
  slackError?: Error;
  userNotifyError?: Error;
  returnedRuleId?: string;
  returnedRuleOwnerId?: string;
}) {
  const source = readFileSync(EXECUTE_PATH, "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: EXECUTE_PATH,
  }).outputText;
  const calls = {
    order: [] as string[],
    ruleSelect: [] as string[],
    ruleEq: [] as Array<{ column: string; value: string }>,
    finalizations: [] as FinalizeCall[],
    processedEmails: [] as ProcessedEmailCall[],
    forbiddenProcessedInserts: [] as unknown[],
    forbiddenRunQueries: [] as string[],
    health: [] as unknown[],
    slack: [] as unknown[],
    userNotify: [] as unknown[],
    attachmentUploads: 0,
  };
  const errorCode = options?.errorCode ?? "UNKNOWN";
  const supabaseAdmin = {
    auth: {
      admin: {
        async getUserById() {
          return {
            data: { user: { email: "owner@example.com" } },
            error: null,
          };
        },
      },
    },
    from(table: string) {
      if (table === "runs") {
        calls.forbiddenRunQueries.push(table);
        throw new Error("executeRule must not query runs directly");
      }
      if (table === "rules") {
        return {
          select(columns: string) {
            calls.ruleSelect.push(columns);
            return {
              eq(column: string, value: string) {
                calls.ruleEq.push({ column, value });
                return {
                  eq(secondColumn: string, secondValue: string) {
                    calls.ruleEq.push({
                      column: secondColumn,
                      value: secondValue,
                    });
                    return {
                      async single() {
                        if (options?.failAt === "rule") {
                          throw codedError(errorCode);
                        }
                        return {
                          data: {
                            id: options?.returnedRuleId ?? RULE_ID,
                            user_id: options?.returnedRuleOwnerId ?? USER_ID,
                            gmail_query: "from:billing@example.com",
                            drive_folder_id: "drive-folder-id",
                            file_name_format: "date_subject",
                          },
                        };
                      },
                    };
                  },
                };
              },
            };
          },
        };
      }
      if (table === "user_profiles") {
        return {
          select() {
            return {
              eq() {
                return {
                  async maybeSingle() {
                    return { data: null, error: null };
                  },
                };
              },
            };
          },
        };
      }
      if (table === "processed_emails") {
        return {
          select() {
            return {
              eq() {
                return {
                  eq() {
                    return {
                      eq() {
                        return {
                          async maybeSingle() {
                            return {
                              data: options?.existingProcessed
                                ? { id: "processed-id" }
                                : null,
                            };
                          },
                        };
                      },
                    };
                  },
                };
              },
            };
          },
          insert(payload: unknown) {
            calls.forbiddenProcessedInserts.push(payload);
            throw new Error(
              "executeRule must not insert processed_emails directly",
            );
          },
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    },
  };
  const loadedModule = {
    exports: {} as {
      executeRule: (input: {
        ruleId: string;
        userId: string;
        runId: string;
        trigger: Trigger;
      }) => Promise<{
        ok: boolean;
        processedCount: number;
        savedCount: number;
        skippedCount: number;
        errorCode: string | null;
        message: string;
      }>;
    },
  };
  const localRequire = (specifier: string) => {
    if (specifier === "@/lib/supabase/admin") return { supabaseAdmin };
    if (specifier === "@/lib/runs/runUpdateRepository") {
      return {
        async finalizeRunForUser(input: FinalizeCall) {
          calls.order.push(`run:${input.finalization.status}`);
          calls.finalizations.push(input);
          if (options?.finalizeError) throw options.finalizeError;
        },
      };
    }
    if (specifier === "@/lib/runs/processedEmailRepository") {
      return {
        async recordProcessedEmail(input: ProcessedEmailCall) {
          calls.order.push("processed_email:record");
          calls.processedEmails.push(input);
          if (options?.processedInsertError) {
            throw new Error("Processed email storage failed");
          }
          return { id: "99999999-9999-4999-8999-999999999999" };
        },
      };
    }
    if (specifier === "@/lib/google/gmail") {
      return {
        async searchGmail() {
          if (options?.failAt === "search") throw codedError(errorCode);
          return options?.messageIds ?? [];
        },
        async getGmailMessage() {
          return {
            subject: "Invoice",
            from: "Billing <billing@example.com>",
            date: "2026-08-04T00:00:00.000Z",
            snippet: "snippet",
            bodyText: "invoice body",
            attachments: options?.attachments ?? [],
          };
        },
        async getGmailAttachment() {
          return new Uint8Array([1, 2, 3]);
        },
      };
    }
    if (specifier === "@/lib/pdf/emailToPdf") {
      return {
        async emailToPdfBytes() {
          if (options?.failAt === "pdf") throw codedError(errorCode);
          return new Uint8Array([1, 2, 3]);
        },
      };
    }
    if (specifier === "@/lib/google/drive") {
      return {
        async uploadPdfToDrive() {
          if (options?.failAt === "drive") throw codedError(errorCode);
          calls.order.push("drive:pdf");
          return { fileId: "file-id", webViewLink: "https://safe.invalid" };
        },
        async uploadFileToDrive() {
          calls.order.push("drive:attachment");
          calls.attachmentUploads += 1;
        },
      };
    }
    if (specifier === "@/lib/runs/normalizeRunErrorCode") {
      return {
        normalizeRunErrorCode(error: unknown) {
          if (
            error &&
            typeof error === "object" &&
            "code" in error &&
            typeof error.code === "string"
          ) {
            return error.code;
          }
          return options?.processedInsertError ? "DB_INSERT_FAILED" : "UNKNOWN";
        },
      };
    }
    if (specifier === "@/lib/runs/getRunErrorMessage") {
      return {
        getRunErrorMessage(code: string) {
          return {
            title: `Safe ${code}`,
            message: "Safe message",
            action: "Safe action",
          };
        },
      };
    }
    if (specifier === "@/lib/monitoring/updateGoogleConnectionHealth") {
      return {
        async updateGoogleConnectionHealth(input: unknown) {
          calls.health.push(input);
        },
      };
    }
    if (specifier === "@/lib/monitoring/notifySlack") {
      return {
        async notifySlack(input: unknown) {
          calls.slack.push(input);
          if (options?.slackError) throw options.slackError;
        },
      };
    }
    if (specifier === "@/lib/monitoring/notifyUser") {
      return {
        async notifyUser(input: unknown) {
          calls.userNotify.push(input);
          if (options?.userNotifyError) throw options.userNotifyError;
        },
      };
    }
    if (specifier === "@/lib/ai/detectDocumentType") {
      return {
        async detectDocumentTypeWithAi() {
          return null;
        },
      };
    }
    if (specifier === "@/lib/billing/resolveEffectivePlan") {
      return {
        resolveEffectivePlan() {
          return "free";
        },
      };
    }
    if (specifier === "@/lib/rules/freePlanLimit") {
      return {
        async checkFreeMonthlyPdfSaveLimit() {
          return { ok: options?.limitOk ?? true };
        },
      };
    }
    if (specifier === "@/lib/rules/fileNameFormat") {
      return {
        normalizeFileNameFormat() {
          return "date_subject";
        },
        normalizeFileNameFormatForPlan() {
          return "date_subject";
        },
      };
    }
    throw new Error(`Unexpected executeRule dependency: ${specifier}`);
  };

  runInNewContext(compiled, {
    exports: loadedModule.exports,
    module: loadedModule,
    require: localRequire,
    console: { log() {}, error() {} },
    Uint8Array,
    Date,
    Set,
  });

  return {
    executeRule: loadedModule.exports.executeRule,
    calls,
    source,
    input: {
      ruleId: RULE_ID,
      userId: USER_ID,
      runId: RUN_ID,
      trigger: options?.trigger ?? "manual",
    },
  };
}

test("manual and cron no-message success finalize the owned run with zero counts", async () => {
  for (const trigger of ["manual", "cron"] as const) {
    const harness = loadExecuteRule({ trigger, messageIds: [] });
    const result = await harness.executeRule(harness.input);

    expect(result).toEqual({
      ok: true,
      processedCount: 0,
      savedCount: 0,
      skippedCount: 0,
      errorCode: null,
      message: "No emails found",
    });
    expect(harness.calls.finalizations).toEqual([
      {
        runId: RUN_ID,
        userId: USER_ID,
        finalization: {
          status: "success",
          processedCount: 0,
          savedCount: 0,
          skippedCount: 0,
          message: "No emails found",
        },
      },
    ]);
  }
});

test("already-processed and Free-limit outcomes preserve counts and messages", async () => {
  const skipped = loadExecuteRule({
    messageIds: [MESSAGE_ID],
    existingProcessed: true,
  });
  const skippedResult = await skipped.executeRule(skipped.input);
  expect(skippedResult.skippedCount).toBe(1);
  expect(skipped.calls.finalizations[0].finalization).toMatchObject({
    status: "success",
    processedCount: 0,
    savedCount: 0,
    skippedCount: 1,
    message: "Skipped 1 already processed email",
  });

  const limited = loadExecuteRule({
    messageIds: [MESSAGE_ID],
    limitOk: false,
  });
  const limitedResult = await limited.executeRule(limited.input);
  expect(limitedResult).toMatchObject({
    ok: false,
    processedCount: 0,
    savedCount: 0,
    skippedCount: 0,
    errorCode: "FREE_MONTHLY_LIMIT_EXCEEDED",
  });
  expect(limited.calls.finalizations[0]).toMatchObject({
    runId: RUN_ID,
    userId: USER_ID,
    finalization: {
      status: "error",
      errorCode: "FREE_MONTHLY_LIMIT_EXCEEDED",
      resetCounts: true,
    },
  });
});

test("normal and partially-saved success finalize exact owner counts", async () => {
  const harness = loadExecuteRule({
    messageIds: [MESSAGE_ID],
    attachments: [
      {
        filename: "invoice.pdf",
        mimeType: "application/pdf",
        attachmentId: "attachment-1",
      },
      {
        filename: "unsafe.exe",
        mimeType: "application/octet-stream",
        attachmentId: "attachment-2",
      },
    ],
  });
  const result = await harness.executeRule(harness.input);

  expect(result).toMatchObject({
    ok: true,
    processedCount: 1,
    savedCount: 2,
    skippedCount: 1,
    errorCode: null,
    message: "Saved 2 files to Drive",
  });
  expect(harness.calls.attachmentUploads).toBe(1);
  expect(harness.calls.processedEmails).toEqual([
    {
      userId: USER_ID,
      ruleId: RULE_ID,
      gmailMessageId: MESSAGE_ID,
      drive: {
        fileId: "file-id",
        webViewLink: "https://safe.invalid",
        fileName: "2026-08-04_Invoice_gmail-me.pdf",
      },
    },
  ]);
  expect(harness.calls.order).toEqual([
    "drive:pdf",
    "drive:attachment",
    "processed_email:record",
    "run:success",
  ]);
  expect(harness.calls.forbiddenProcessedInserts).toHaveLength(0);
  expect(harness.calls.finalizations).toEqual([
    {
      runId: RUN_ID,
      userId: USER_ID,
      finalization: {
        status: "success",
        processedCount: 1,
        savedCount: 2,
        skippedCount: 1,
        message: "Saved 2 files to Drive",
      },
    },
  ]);
});

test("manual and cron successes pass the same owned processed-email identity", async () => {
  for (const trigger of ["manual", "cron"] as const) {
    const harness = loadExecuteRule({
      trigger,
      messageIds: [MESSAGE_ID],
    });
    const result = await harness.executeRule(harness.input);

    expect(result).toMatchObject({ ok: true, savedCount: 1 });
    expect(harness.calls.processedEmails).toHaveLength(1);
    expect(harness.calls.processedEmails[0]).toMatchObject({
      userId: USER_ID,
      ruleId: RULE_ID,
      gmailMessageId: MESSAGE_ID,
    });
  }
});

test("service-role rule lookup fixes ID and owner and rejects mismatched returned identity", async () => {
  const otherRuleId = "77777777-7777-4777-8777-777777777777";
  for (const options of [
    { returnedRuleId: otherRuleId },
    { returnedRuleOwnerId: OTHER_USER_ID },
  ]) {
    const harness = loadExecuteRule({ messageIds: [MESSAGE_ID], ...options });
    const result = await harness.executeRule(harness.input);

    expect(harness.calls.ruleSelect).toEqual([
      "id, user_id, gmail_query, drive_folder_id, file_name_format",
    ]);
    expect(harness.calls.ruleEq).toEqual([
      { column: "id", value: RULE_ID },
      { column: "user_id", value: USER_ID },
    ]);
    expect(result).toMatchObject({ ok: false, errorCode: "UNKNOWN" });
    expect(harness.calls.processedEmails).toHaveLength(0);
    expect(harness.calls.finalizations[0]).toMatchObject({
      runId: RUN_ID,
      userId: USER_ID,
      finalization: { status: "error", errorCode: "UNKNOWN" },
    });
  }
});

test("Google reauth, Gmail, PDF, Drive, DB, and unexpected failures share safe owned finalization", async () => {
  const scenarios = [
    { failAt: "search", errorCode: "GOOGLE_TOKEN_INVALID" },
    { failAt: "search", errorCode: "GMAIL_QUERY_INVALID" },
    { failAt: "pdf", errorCode: "TEMPORARY_UNAVAILABLE" },
    { failAt: "drive", errorCode: "DRIVE_UPLOAD_FAILED" },
    { processedInsertError: true, errorCode: "DB_INSERT_FAILED" },
    { failAt: "rule", errorCode: "UNKNOWN" },
  ] as const;

  for (const scenario of scenarios) {
    const harness = loadExecuteRule({
      messageIds: [MESSAGE_ID],
      ...scenario,
    });
    const result = await harness.executeRule(harness.input);

    expect(result).toMatchObject({ ok: false, errorCode: scenario.errorCode });
    expect(result.message).not.toContain(`raw ${scenario.errorCode} detail`);
    expect(harness.calls.finalizations).toHaveLength(1);
    expect(harness.calls.finalizations[0]).toMatchObject({
      runId: RUN_ID,
      userId: USER_ID,
      finalization: {
        status: "error",
        errorCode: scenario.errorCode,
        resetCounts: false,
      },
    });
  }
});

test("Google reauth notifications remain after finalization and notifier failures stay non-fatal", async () => {
  const harness = loadExecuteRule({
    trigger: "cron",
    messageIds: [MESSAGE_ID],
    failAt: "search",
    errorCode: "GOOGLE_TOKEN_INVALID",
    slackError: new Error("raw Slack failure"),
    userNotifyError: new Error("raw mail failure"),
  });
  const result = await harness.executeRule(harness.input);

  expect(result).toMatchObject({
    ok: false,
    errorCode: "GOOGLE_TOKEN_INVALID",
  });
  expect(harness.calls.finalizations).toHaveLength(1);
  expect(harness.calls.slack).toHaveLength(1);
  expect(harness.calls.userNotify).toHaveLength(1);
  expect(harness.calls.health).toEqual([
    {
      userId: USER_ID,
      event: "error",
      errorCode: "GOOGLE_TOKEN_INVALID",
    },
  ]);
});

test("processed-email repository failure records run error after Drive save without raw details", async () => {
  const harness = loadExecuteRule({
    trigger: "cron",
    messageIds: [MESSAGE_ID],
    processedInsertError: true,
  });
  const result = await harness.executeRule(harness.input);

  expect(result).toMatchObject({
    ok: false,
    processedCount: 0,
    savedCount: 0,
    skippedCount: 0,
    errorCode: "DB_INSERT_FAILED",
  });
  expect(result.message).not.toContain("Processed email storage failed");
  expect(harness.calls.processedEmails).toHaveLength(1);
  expect(harness.calls.order).toEqual([
    "drive:pdf",
    "processed_email:record",
    "run:error",
  ]);
  expect(harness.calls.finalizations[0]).toMatchObject({
    runId: RUN_ID,
    userId: USER_ID,
    finalization: {
      status: "error",
      errorCode: "DB_INSERT_FAILED",
      resetCounts: false,
    },
  });
});

test("repository failure cannot be reported as success and executeRule has no direct Runs query", async () => {
  const harness = loadExecuteRule({
    messageIds: [],
    finalizeError: new Error("Run update failed"),
  });

  await expect(harness.executeRule(harness.input)).rejects.toThrow(
    "Run update failed",
  );
  expect(harness.calls.finalizations).toHaveLength(2);
  expect(harness.calls.forbiddenRunQueries).toHaveLength(0);
  expect(harness.source).not.toContain('.from("runs")');
  expect(harness.source).not.toContain(".insert({\n        user_id:");
  expect(harness.source).not.toContain("raw service-role run update details");
});

test("the authenticated owner is never replaced by a request-style alternate owner", async () => {
  const harness = loadExecuteRule({ messageIds: [] });
  await harness.executeRule({
    ...harness.input,
    userId: USER_ID,
    requestUserId: OTHER_USER_ID,
  } as Parameters<typeof harness.executeRule>[0]);

  expect(harness.calls.finalizations[0].userId).toBe(USER_ID);
  expect(harness.calls.finalizations[0].userId).not.toBe(OTHER_USER_ID);
});
