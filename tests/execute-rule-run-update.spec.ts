import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { expect, test } from "@playwright/test";
import ts from "typescript";
import { getRunErrorMessage } from "../src/lib/runs/getRunErrorMessage";
import { normalizeRunErrorCode } from "../src/lib/runs/normalizeRunErrorCode";

const EXECUTE_PATH = resolve(process.cwd(), "src/lib/runs/executeRule.ts");
const USER_ID = "44444444-4444-4444-8444-444444444444";
const OTHER_USER_ID = "55555555-5555-4555-8555-555555555555";
const RULE_ID = "66666666-6666-4666-8666-666666666666";
const RUN_ID = "88888888-8888-4888-8888-888888888888";
const MESSAGE_ID = "gmail-message-id";
const LEASE_ID_HASH = "a".repeat(64);

type Trigger = "manual" | "cron";

type FinalizeCall = {
  runId: string;
  userId: string;
  ruleId: string;
  leaseIdHash: string;
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
  processedLookupError?: Error;
  limitOk?: boolean;
  limitResults?: boolean[];
  limitErrorAt?: number;
  attachments?: Array<{
    filename: string;
    mimeType: string;
    attachmentId: string;
    size?: number;
  }>;
  bodyText?: string;
  pdfBytes?: Uint8Array;
  executionDisabled?: boolean;
  failAt?: "rule" | "search" | "pdf" | "drive";
  errorCode?: string;
  errorStage?: string;
  processedInsertError?: boolean;
  finalizeError?: Error;
  healthError?: Error;
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
    processedLookups: [] as Array<{
      userId: string;
      ruleId: string;
      gmailMessageId: string;
    }>,
    forbiddenProcessedQueries: [] as unknown[],
    forbiddenRunQueries: [] as string[],
    health: [] as unknown[],
    slack: [] as unknown[],
    userNotify: [] as unknown[],
    attachmentUploads: 0,
    gmailSearches: 0,
    gmailFetches: 0,
    gmailAttachmentDownloads: 0,
    killSwitchReads: 0,
    pdfCalls: 0,
    aiCalls: 0,
    limitChecks: [] as string[],
    consoleErrors: [] as unknown[][],
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
        calls.forbiddenProcessedQueries.push(table);
        throw new Error("executeRule must not query processed_emails directly");
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
        leaseIdHash: string;
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
    if (specifier === "@/lib/runs/guardedExecutionRepository") {
      return {
        async finalizeGuardedExecution(input: FinalizeCall) {
          calls.order.push(`run:${input.finalization.status}`);
          calls.finalizations.push(input);
          if (options?.finalizeError) throw options.finalizeError;
        },
      };
    }
    if (specifier === "@/lib/runs/processedEmailRepository") {
      return {
        async getProcessedEmailState(input: {
          userId: string;
          ruleId: string;
          gmailMessageId: string;
        }) {
          calls.order.push("processed_email:lookup");
          calls.processedLookups.push(input);
          if (options?.processedLookupError) {
            throw options.processedLookupError;
          }
          return { exists: options?.existingProcessed ?? false };
        },
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
          calls.gmailSearches += 1;
          if (options?.failAt === "search") throw codedError(errorCode);
          return options?.messageIds ?? [];
        },
        async getGmailMessage() {
          calls.gmailFetches += 1;
          return {
            subject: "Invoice",
            from: "Billing <billing@example.com>",
            date: "2026-08-04T00:00:00.000Z",
            snippet: "snippet",
            bodyText: options?.bodyText ?? "invoice body",
            attachments: (options?.attachments ?? []).map((attachment) => ({
              ...attachment,
              size: attachment.size ?? 3,
            })),
          };
        },
        async getGmailAttachment() {
          calls.gmailAttachmentDownloads += 1;
          return new Uint8Array([1, 2, 3]);
        },
      };
    }
    if (specifier === "@/lib/pdf/emailToPdf") {
      return {
        async emailToPdfBytes() {
          calls.pdfCalls += 1;
          if (options?.failAt === "pdf") throw codedError(errorCode);
          return options?.pdfBytes ?? new Uint8Array([1, 2, 3]);
        },
      };
    }
    if (specifier === "@/lib/google/drive") {
      return {
        async uploadPdfToDrive() {
          if (options?.failAt === "drive") {
            throw Object.assign(codedError(errorCode), {
              ...(options?.errorStage ? { stage: options.errorStage } : {}),
            });
          }
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
      return { normalizeRunErrorCode };
    }
    if (specifier === "@/lib/runs/getRunErrorMessage") {
      return { getRunErrorMessage };
    }
    if (specifier === "@/lib/monitoring/updateGoogleConnectionHealth") {
      return {
        async updateGoogleConnectionHealth(input: unknown) {
          calls.health.push(input);
          if (options?.healthError) throw options.healthError;
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
          calls.aiCalls += 1;
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
          const checkIndex = calls.limitChecks.length;
          calls.limitChecks.push(USER_ID);
          if (options?.limitErrorAt === checkIndex) {
            throw new Error("raw quota count failure");
          }
          return {
            ok: options?.limitResults?.[checkIndex] ?? options?.limitOk ?? true,
          };
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
    if (specifier === "@/lib/cost-safety/limits") {
      return {
        DRIVE_CUMULATIVE_TIMEOUT_MS: 30_000,
        EXECUTION_ABSOLUTE_DEADLINE_MS: 60_000,
        GMAIL_CUMULATIVE_TIMEOUT_MS: 15_000,
        OPENAI_TIMEOUT_MS: 8_000,
      };
    }
    if (specifier === "@/lib/cost-safety/deadline") {
      return {
        getAllowedStageTimeoutMs({
          stageRemainingMs,
        }: {
          stageRemainingMs: number;
        }) {
          return stageRemainingMs > 0 ? stageRemainingMs : null;
        },
      };
    }
    if (specifier === "@/lib/cost-safety/killSwitch") {
      return {
        readExecutionDisabledFromEnv() {
          calls.killSwitchReads += 1;
          return options?.executionDisabled ?? false;
        },
      };
    }
    if (specifier === "@/lib/cost-safety/sizeLimits") {
      return {
        areAttachmentMetadataWithinLimits(input: {
          count: number;
          declaredByteSizes: number[];
          totalDeclaredBytes: number;
        }) {
          return (
            input.count <= 5 &&
            input.declaredByteSizes.every(
              (size) =>
                Number.isSafeInteger(size) &&
                size >= 0 &&
                size <= 10 * 1024 * 1024,
            ) &&
            input.declaredByteSizes.reduce((total, size) => total + size, 0) ===
              input.totalDeclaredBytes &&
            input.totalDeclaredBytes <= 25 * 1024 * 1024
          );
        },
        isGeneratedPdfWithinLimit(size: number) {
          return size <= 10 * 1024 * 1024;
        },
        isRawEmailBodyWithinLimit(value: string) {
          return Buffer.byteLength(value, "utf8") <= 100 * 1024;
        },
        isTotalDriveWriteWithinLimit(size: number) {
          return size <= 35 * 1024 * 1024;
        },
      };
    }
    throw new Error(`Unexpected executeRule dependency: ${specifier}`);
  };

  runInNewContext(compiled, {
    exports: loadedModule.exports,
    module: loadedModule,
    require: localRequire,
    console: {
      log() {},
      error(...args: unknown[]) {
        calls.consoleErrors.push(args);
      },
    },
    Uint8Array,
    Date,
    Error,
    Set,
    Number,
    Buffer,
  });

  return {
    executeRule: loadedModule.exports.executeRule,
    calls,
    source,
    input: {
      ruleId: RULE_ID,
      userId: USER_ID,
      runId: RUN_ID,
      leaseIdHash: LEASE_ID_HASH,
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
        ruleId: RULE_ID,
        leaseIdHash: LEASE_ID_HASH,
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
  for (const trigger of ["manual", "cron"] as const) {
    const skipped = loadExecuteRule({
      trigger,
      messageIds: [MESSAGE_ID],
      existingProcessed: true,
    });
    const skippedResult = await skipped.executeRule(skipped.input);
    expect(skippedResult).toMatchObject({
      ok: true,
      processedCount: 0,
      savedCount: 0,
      skippedCount: 1,
      errorCode: null,
      message: "Skipped 1 already processed email",
    });
    expect(skipped.calls.processedLookups).toEqual([
      {
        userId: USER_ID,
        ruleId: RULE_ID,
        gmailMessageId: MESSAGE_ID,
      },
    ]);
    expect(skipped.calls.order).toEqual([
      "processed_email:lookup",
      "run:success",
    ]);
    expect(skipped.calls.health).toEqual([
      { userId: USER_ID, event: "success" },
    ]);
    expect(skipped.calls.processedEmails).toHaveLength(0);
    expect(skipped.calls.attachmentUploads).toBe(0);
  }

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
  expect(limited.calls.limitChecks).toEqual([USER_ID]);
});

test("a final Free-limit recheck stops before any Drive upload", async () => {
  const harness = loadExecuteRule({
    messageIds: [MESSAGE_ID],
    limitResults: [true, false],
  });

  const result = await harness.executeRule(harness.input);

  expect(result).toMatchObject({
    ok: false,
    errorCode: "FREE_MONTHLY_LIMIT_EXCEEDED",
    processedCount: 0,
    savedCount: 0,
  });
  expect(harness.calls.limitChecks).toEqual([USER_ID, USER_ID]);
  expect(harness.calls.order).toEqual(["processed_email:lookup", "run:error"]);
  expect(harness.calls.processedEmails).toHaveLength(0);
  expect(harness.calls.attachmentUploads).toBe(0);
  expect(harness.calls.finalizations).toEqual([
    {
      runId: RUN_ID,
      userId: USER_ID,
      ruleId: RULE_ID,
      leaseIdHash: LEASE_ID_HASH,
      finalization: {
        status: "error",
        errorCode: "FREE_MONTHLY_LIMIT_EXCEEDED",
        resetCounts: true,
        message:
          "Freeプランの今月のPDF保存上限（10件）に達しています。翌月まで待つか、Proプランへの変更をご検討ください。",
      },
    },
  ]);
});

test("a failed final quota count fails closed before Drive upload", async () => {
  const harness = loadExecuteRule({
    messageIds: [MESSAGE_ID],
    limitErrorAt: 1,
  });

  const result = await harness.executeRule(harness.input);

  expect(result).toMatchObject({ ok: false, errorCode: "UNKNOWN" });
  expect(harness.calls.limitChecks).toEqual([USER_ID, USER_ID]);
  expect(harness.calls.order).toEqual(["processed_email:lookup", "run:error"]);
  expect(harness.calls.processedEmails).toHaveLength(0);
  expect(harness.calls.attachmentUploads).toBe(0);
  expect(result.message).not.toContain("raw quota count failure");
});

test("lookup failure fails closed before Gmail fetch, PDF, or Drive and records run error", async () => {
  const rawError = "raw processed lookup DB details";
  const harness = loadExecuteRule({
    trigger: "cron",
    messageIds: [MESSAGE_ID],
    attachments: [
      {
        filename: "invoice.pdf",
        mimeType: "application/pdf",
        attachmentId: "attachment-1",
      },
    ],
    processedLookupError: new Error(rawError),
  });
  const result = await harness.executeRule(harness.input);

  expect(result).toMatchObject({
    ok: false,
    processedCount: 0,
    savedCount: 0,
    skippedCount: 0,
    errorCode: "UNKNOWN",
  });
  expect(result.message).not.toContain(rawError);
  expect(harness.calls.order).toEqual(["processed_email:lookup", "run:error"]);
  expect(harness.calls.processedEmails).toHaveLength(0);
  expect(harness.calls.attachmentUploads).toBe(0);
  expect(harness.calls.slack).toHaveLength(1);
  expect(harness.calls.health).toEqual([
    { userId: USER_ID, event: "error", errorCode: "UNKNOWN" },
  ]);
});

test("only the first Gmail search result is looked up and processed", async () => {
  const harness = loadExecuteRule({
    messageIds: [MESSAGE_ID, "second-gmail-message"],
  });
  const result = await harness.executeRule(harness.input);

  expect(result).toMatchObject({ ok: true, processedCount: 1, savedCount: 1 });
  expect(harness.calls.processedLookups).toEqual([
    { userId: USER_ID, ruleId: RULE_ID, gmailMessageId: MESSAGE_ID },
  ]);
  expect(harness.calls.processedEmails[0].gmailMessageId).toBe(MESSAGE_ID);
});

test("size guards stop before AI, PDF, and Drive with safe run codes", async () => {
  const oversizedBody = loadExecuteRule({
    messageIds: [MESSAGE_ID],
    bodyText: "a".repeat(100 * 1024 + 1),
  });
  const bodyResult = await oversizedBody.executeRule(oversizedBody.input);

  expect(bodyResult).toMatchObject({
    ok: false,
    errorCode: "EMAIL_SIZE_LIMIT_EXCEEDED",
  });
  expect(oversizedBody.calls.aiCalls).toBe(0);
  expect(oversizedBody.calls.pdfCalls).toBe(0);
  expect(oversizedBody.calls.order).not.toContain("drive:pdf");

  const tooManyAttachments = loadExecuteRule({
    messageIds: [MESSAGE_ID],
    attachments: Array.from({ length: 6 }, (_, index) => ({
      filename: `invoice-${index}.pdf`,
      mimeType: "application/pdf",
      attachmentId: `attachment-${index}`,
      size: 3,
    })),
  });
  const attachmentResult = await tooManyAttachments.executeRule(
    tooManyAttachments.input,
  );

  expect(attachmentResult).toMatchObject({
    ok: false,
    errorCode: "ATTACHMENT_COUNT_LIMIT_EXCEEDED",
  });
  expect(tooManyAttachments.calls.pdfCalls).toBe(0);
  expect(tooManyAttachments.calls.order).not.toContain("drive:pdf");
});

test("kill switch stops both execution triggers before every high-cost stage", async () => {
  for (const trigger of ["manual", "cron"] as const) {
    const harness = loadExecuteRule({
      trigger,
      executionDisabled: true,
      messageIds: [MESSAGE_ID],
    });

    const result = await harness.executeRule(harness.input);

    expect(result).toMatchObject({
      ok: false,
      errorCode: "EXECUTION_DISABLED",
    });
    expect(harness.calls.killSwitchReads).toBe(1);
    expect(harness.calls.gmailSearches).toBe(0);
    expect(harness.calls.gmailFetches).toBe(0);
    expect(harness.calls.gmailAttachmentDownloads).toBe(0);
    expect(harness.calls.aiCalls).toBe(0);
    expect(harness.calls.pdfCalls).toBe(0);
    expect(harness.calls.attachmentUploads).toBe(0);
    expect(harness.calls.processedLookups).toHaveLength(0);
    expect(harness.calls.processedEmails).toHaveLength(0);
    expect(harness.calls.limitChecks).toHaveLength(0);
    expect(harness.calls.order).toEqual(["run:error"]);
    expect(harness.calls.slack).toHaveLength(0);
    expect(harness.calls.userNotify).toHaveLength(0);
    expect(harness.calls.finalizations[0]).toMatchObject({
      runId: RUN_ID,
      userId: USER_ID,
      finalization: {
        status: "error",
        errorCode: "EXECUTION_DISABLED",
        resetCounts: false,
      },
    });
  }
});

test("kill switch OFF preserves the existing execution path", async () => {
  const harness = loadExecuteRule({
    executionDisabled: false,
    messageIds: [MESSAGE_ID],
  });

  const result = await harness.executeRule(harness.input);

  expect(result).toMatchObject({ ok: true, processedCount: 1, savedCount: 1 });
  expect(harness.calls.killSwitchReads).toBe(1);
  expect(harness.calls.gmailSearches).toBe(1);
  expect(harness.calls.pdfCalls).toBe(1);
  expect(harness.calls.order).toContain("drive:pdf");
});

test("only TIMEOUT is Slack-notified among the new cost safety run codes", async () => {
  const sizeCases = [
    loadExecuteRule({
      messageIds: [MESSAGE_ID],
      bodyText: "a".repeat(100 * 1024 + 1),
    }),
    loadExecuteRule({
      messageIds: [MESSAGE_ID],
      attachments: Array.from({ length: 6 }, (_, index) => ({
        filename: `invoice-${index}.pdf`,
        mimeType: "application/pdf",
        attachmentId: `attachment-${index}`,
        size: 3,
      })),
    }),
  ];

  for (const harness of sizeCases) {
    await harness.executeRule(harness.input);
    expect(harness.calls.slack).toHaveLength(0);
    expect(harness.calls.userNotify).toHaveLength(0);
  }

  const timeout = loadExecuteRule({
    messageIds: [MESSAGE_ID],
    failAt: "search",
    errorCode: "TIMEOUT",
  });
  await timeout.executeRule(timeout.input);
  expect(timeout.calls.slack).toHaveLength(1);
  expect(timeout.calls.userNotify).toHaveLength(0);
});

test("generated PDF size guard stops before Drive", async () => {
  const harness = loadExecuteRule({
    messageIds: [MESSAGE_ID],
    pdfBytes: new Uint8Array(10 * 1024 * 1024 + 1),
  });

  const result = await harness.executeRule(harness.input);

  expect(result).toMatchObject({
    ok: false,
    errorCode: "EMAIL_SIZE_LIMIT_EXCEEDED",
  });
  expect(harness.calls.pdfCalls).toBe(1);
  expect(harness.calls.order).not.toContain("drive:pdf");
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
    "processed_email:lookup",
    "drive:pdf",
    "drive:attachment",
    "processed_email:record",
    "run:success",
  ]);
  expect(harness.calls.forbiddenProcessedQueries).toHaveLength(0);
  expect(harness.calls.finalizations).toEqual([
    {
      runId: RUN_ID,
      userId: USER_ID,
      ruleId: RULE_ID,
      leaseIdHash: LEASE_ID_HASH,
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

test("known Google, DB, and unexpected failures share safe owned finalization", async () => {
  const scenarios = [
    { failAt: "search", errorCode: "GOOGLE_TOKEN_INVALID" },
    { failAt: "search", errorCode: "GOOGLE_TOKEN_REFRESH_FAILED" },
    { failAt: "drive", errorCode: "GOOGLE_PERMISSION_DENIED" },
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

test("Drive diagnostics log only an allowlisted stage and Slack failure stays secondary", async () => {
  const rawDriveMarker = "raw DRIVE_UPLOAD_FAILED detail";
  const rawSlackMarker = "raw Slack provider detail";
  const harness = loadExecuteRule({
    messageIds: [MESSAGE_ID],
    failAt: "drive",
    errorCode: "DRIVE_UPLOAD_FAILED",
    errorStage: "drive_media_prepare",
    slackError: new Error(rawSlackMarker),
  });

  const result = await harness.executeRule(harness.input);

  expect(result).toMatchObject({
    ok: false,
    processedCount: 0,
    savedCount: 0,
    skippedCount: 0,
    errorCode: "DRIVE_UPLOAD_FAILED",
  });
  expect(result.message).not.toContain(rawDriveMarker);
  expect(harness.calls.finalizations).toHaveLength(1);
  expect(harness.calls.finalizations[0]).toMatchObject({
    runId: RUN_ID,
    userId: USER_ID,
    finalization: {
      status: "error",
      errorCode: "DRIVE_UPLOAD_FAILED",
      resetCounts: false,
    },
  });
  expect(harness.calls.slack).toHaveLength(1);

  const executeLog = harness.calls.consoleErrors.find(
    ([message]) => message === "[executeRule] failed",
  );
  expect(executeLog).toEqual([
    "[executeRule] failed",
    {
      code: "DRIVE_UPLOAD_FAILED",
      errorName: "Error",
      stage: "drive_media_prepare",
    },
  ]);

  const serializedLogs = JSON.stringify(harness.calls.consoleErrors);
  expect(serializedLogs).not.toContain(rawDriveMarker);
  expect(serializedLogs).not.toContain(rawSlackMarker);
});

test("untrusted error stages fall back to execute_rule", async () => {
  const harness = loadExecuteRule({
    messageIds: [MESSAGE_ID],
    failAt: "drive",
    errorCode: "DRIVE_UPLOAD_FAILED",
    errorStage: "private-folder-id",
  });

  await harness.executeRule(harness.input);

  const executeLog = harness.calls.consoleErrors.find(
    ([message]) => message === "[executeRule] failed",
  );
  expect(executeLog?.[1]).toMatchObject({
    code: "DRIVE_UPLOAD_FAILED",
    stage: "execute_rule",
  });
  expect(JSON.stringify(executeLog)).not.toContain("private-folder-id");
});

test("manual and cron preserve explicit Google OAuth run codes", async () => {
  for (const trigger of ["manual", "cron"] as const) {
    const harness = loadExecuteRule({
      trigger,
      messageIds: [MESSAGE_ID],
      failAt: "search",
      errorCode: "GOOGLE_TOKEN_REFRESH_FAILED",
    });

    const result = await harness.executeRule(harness.input);

    expect(result).toMatchObject({
      ok: false,
      errorCode: "GOOGLE_TOKEN_REFRESH_FAILED",
    });
    expect(harness.calls.finalizations[0]).toMatchObject({
      runId: RUN_ID,
      userId: USER_ID,
      finalization: {
        status: "error",
        errorCode: "GOOGLE_TOKEN_REFRESH_FAILED",
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
  expect(harness.calls.userNotify[0]).toMatchObject({
    userId: USER_ID,
    errorCode: "GOOGLE_TOKEN_INVALID",
  });
  expect(harness.calls.userNotify[0]).not.toHaveProperty("userEmail");
  expect(harness.calls.health).toEqual([
    {
      userId: USER_ID,
      event: "error",
      errorCode: "GOOGLE_TOKEN_INVALID",
    },
  ]);
  expect(harness.source).not.toContain("getUserEmail");
  expect(harness.source).not.toContain("auth.admin.getUserById");
});

test("all fail-closed Google reauth codes trigger user notification", async () => {
  for (const errorCode of [
    "GOOGLE_TOKEN_INVALID",
    "GOOGLE_PERMISSION_DENIED",
    "GOOGLE_REFRESH_OUTCOME_UNKNOWN",
  ] as const) {
    const harness = loadExecuteRule({
      trigger: "cron",
      messageIds: [MESSAGE_ID],
      failAt: "search",
      errorCode,
    });

    const result = await harness.executeRule(harness.input);

    expect(result).toMatchObject({ ok: false, errorCode });
    expect(harness.calls.userNotify).toHaveLength(1);
    expect(harness.calls.userNotify[0]).toMatchObject({
      userId: USER_ID,
      errorCode,
    });
  }

  const otherError = loadExecuteRule({
    trigger: "cron",
    messageIds: [MESSAGE_ID],
    failAt: "search",
    errorCode: "GOOGLE_TOKEN_REFRESH_FAILED",
  });

  const result = await otherError.executeRule(otherError.input);

  expect(result).toMatchObject({
    ok: false,
    errorCode: "GOOGLE_TOKEN_REFRESH_FAILED",
  });
  expect(otherError.calls.userNotify).toHaveLength(0);
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
    "processed_email:lookup",
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

test("success finalizer failure stays uncertain and never attempts a second finalize", async () => {
  const harness = loadExecuteRule({
    messageIds: [],
    finalizeError: new Error("raw run update failure"),
  });

  await expect(harness.executeRule(harness.input)).rejects.toMatchObject({
    code: "GUARD_STORE_FAILED",
    message: "Execution finalization state is unknown",
  });
  expect(harness.calls.finalizations).toHaveLength(1);
  expect(JSON.stringify(harness.calls.consoleErrors)).not.toContain(
    "raw run update failure",
  );
  expect(harness.calls.forbiddenRunQueries).toHaveLength(0);
  expect(harness.calls.forbiddenProcessedQueries).toHaveLength(0);
  expect(harness.source).not.toContain('.from("runs")');
  expect(harness.source).not.toContain('.from("processed_emails")');
  expect(harness.source).not.toContain(".insert({\n        user_id:");
  expect(harness.source).not.toContain("raw service-role run update details");
});

test("error finalizer failure stays uncertain and never attempts a second finalize", async () => {
  const harness = loadExecuteRule({
    messageIds: [MESSAGE_ID],
    failAt: "search",
    errorCode: "TIMEOUT",
    finalizeError: new Error("raw error finalize failure"),
  });

  await expect(harness.executeRule(harness.input)).rejects.toMatchObject({
    code: "GUARD_STORE_FAILED",
    message: "Execution finalization state is unknown",
  });
  expect(harness.calls.finalizations).toHaveLength(1);
  expect(harness.calls.finalizations[0].finalization.status).toBe("error");
  expect(JSON.stringify(harness.calls.consoleErrors)).not.toContain(
    "raw error finalize failure",
  );
});

test("success health failure cannot rewrite the finalized terminal outcome", async () => {
  const harness = loadExecuteRule({
    messageIds: [],
    healthError: new Error("raw success health failure"),
  });

  await expect(harness.executeRule(harness.input)).resolves.toMatchObject({
    ok: true,
    errorCode: null,
    message: "No emails found",
  });
  expect(harness.calls.finalizations).toHaveLength(1);
  expect(harness.calls.finalizations[0].finalization.status).toBe("success");
  expect(JSON.stringify(harness.calls.consoleErrors)).not.toContain(
    "raw success health failure",
  );
});

test("error health failure stays secondary to the finalized business error", async () => {
  const harness = loadExecuteRule({
    messageIds: [MESSAGE_ID],
    failAt: "search",
    errorCode: "GOOGLE_TOKEN_INVALID",
    healthError: new Error("raw error health failure"),
  });

  await expect(harness.executeRule(harness.input)).resolves.toMatchObject({
    ok: false,
    errorCode: "GOOGLE_TOKEN_INVALID",
  });
  expect(harness.calls.finalizations).toHaveLength(1);
  expect(harness.calls.finalizations[0].finalization.status).toBe("error");
  expect(JSON.stringify(harness.calls.consoleErrors)).not.toContain(
    "raw error health failure",
  );
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
