import { supabaseAdmin } from "@/lib/supabase/admin";
import { emailToPdfBytes } from "@/lib/pdf/emailToPdf";
import {
  searchGmail,
  getGmailMessage,
  getGmailAttachment,
  type GmailAttachment,
} from "@/lib/google/gmail";
import { uploadFileToDrive, uploadPdfToDrive } from "@/lib/google/drive";
import { getRunErrorMessage } from "@/lib/runs/getRunErrorMessage";
import { normalizeRunErrorCode } from "@/lib/runs/normalizeRunErrorCode";
import { finalizeGuardedExecution } from "@/lib/runs/guardedExecutionRepository";
import {
  getProcessedEmailState,
  recordProcessedEmail,
} from "@/lib/runs/processedEmailRepository";
import { updateGoogleConnectionHealth } from "@/lib/monitoring/updateGoogleConnectionHealth";
import { notifySlack } from "@/lib/monitoring/notifySlack";
import { notifyUser } from "@/lib/monitoring/notifyUser";
import { detectDocumentTypeWithAi } from "@/lib/ai/detectDocumentType";
import { resolveEffectivePlan } from "@/lib/billing/resolveEffectivePlan";
import { checkFreeMonthlyPdfSaveLimit } from "@/lib/rules/freePlanLimit";
import {
  normalizeFileNameFormat,
  normalizeFileNameFormatForPlan,
  type FileNameFormat,
} from "@/lib/rules/fileNameFormat";
import {
  DRIVE_CUMULATIVE_TIMEOUT_MS,
  EXECUTION_ABSOLUTE_DEADLINE_MS,
  GMAIL_CUMULATIVE_TIMEOUT_MS,
  OPENAI_TIMEOUT_MS,
} from "@/lib/cost-safety/limits";
import { getAllowedStageTimeoutMs } from "@/lib/cost-safety/deadline";
import { readExecutionDisabledFromEnv } from "@/lib/cost-safety/killSwitch";
import {
  areAttachmentMetadataWithinLimits,
  isGeneratedPdfWithinLimit,
  isRawEmailBodyWithinLimit,
  isTotalDriveWriteWithinLimit,
} from "@/lib/cost-safety/sizeLimits";

type ExecuteRuleParams = {
  ruleId: string;
  userId: string;
  runId: string;
  leaseIdHash: string;
  trigger: "manual" | "cron";
};

type ExecuteResult = {
  ok: boolean;
  processedCount: number;
  savedCount: number;
  skippedCount: number;
  errorCode: string | null;
  message: string;
};

const SLACK_NOTIFY_ERROR_CODES = new Set([
  "GOOGLE_TOKEN_INVALID",
  "GOOGLE_REFRESH_OUTCOME_UNKNOWN",
  "GOOGLE_PERMISSION_DENIED",
  "DRIVE_FOLDER_INVALID",
  "DRIVE_UPLOAD_FAILED",
  "DB_INSERT_FAILED",
  "TIMEOUT",
  "UNKNOWN",
]);

const USER_NOTIFY_ERROR_CODES = new Set<string>([
  "GOOGLE_TOKEN_INVALID",
  "GOOGLE_REFRESH_OUTCOME_UNKNOWN",
  "GOOGLE_PERMISSION_DENIED",
]);

const SAFE_RUN_ERROR_STAGES = new Set([
  "drive_create_auth",
  "drive_lookup_complete",
  "drive_existing_match",
  "drive_media_prepare",
  "drive_create_request",
]);

function getSafeRunErrorStage(error: unknown) {
  if (!error || typeof error !== "object") return "execute_rule";

  try {
    const stage = "stage" in error ? error.stage : undefined;
    return typeof stage === "string" && SAFE_RUN_ERROR_STAGES.has(stage)
      ? stage
      : "execute_rule";
  } catch {
    return "execute_rule";
  }
}

const ALLOWED_ATTACHMENT_EXTENSIONS = new Set([".pdf", ".csv", ".xlsx"]);

const ALLOWED_ATTACHMENT_MIME_TYPES = new Set([
  "application/pdf",
  "text/csv",
  "application/csv",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);

const FREE_MONTHLY_LIMIT_MESSAGE =
  "Freeプランの今月のPDF保存上限（10件）に達しています。翌月まで待つか、Proプランへの変更をご検討ください。";

function createCostSafetyError(
  code:
    | "EMAIL_SIZE_LIMIT_EXCEEDED"
    | "ATTACHMENT_COUNT_LIMIT_EXCEEDED"
    | "EXECUTION_DISABLED"
    | "TIMEOUT",
) {
  return Object.assign(new Error(code), { code });
}

function getRemainingStageTimeoutMs(params: {
  executionStartedAtMs: number;
  stageStartedAtMs: number;
  stageBudgetMs: number;
}): number | null {
  const elapsedMs = Date.now() - params.stageStartedAtMs;
  const stageRemainingMs = params.stageBudgetMs - elapsedMs;

  return getAllowedStageTimeoutMs({
    executionStartedAtMs: params.executionStartedAtMs,
    currentTimeMs: Date.now(),
    stageRemainingMs,
  });
}

function getRequiredStageTimeoutMs(params: {
  executionStartedAtMs: number;
  stageStartedAtMs: number;
  stageBudgetMs: number;
}): number {
  const timeout = getRemainingStageTimeoutMs(params);
  if (timeout === null) throw createCostSafetyError("TIMEOUT");
  return timeout;
}

function getAttachmentMetadataBytes(attachments: GmailAttachment[]) {
  return attachments.map((attachment) => attachment.size);
}

function getTotalByteLength(bytes: readonly Uint8Array[]) {
  let total = 0;

  for (const value of bytes) {
    total += value.byteLength;
    if (!Number.isSafeInteger(total)) return null;
  }

  return total;
}

async function finalizeFreeMonthlyLimit(params: {
  runId: string;
  userId: string;
  ruleId: string;
  leaseIdHash: string;
}): Promise<ExecuteResult> {
  await finalizeGuardedExecution({
    runId: params.runId,
    userId: params.userId,
    ruleId: params.ruleId,
    leaseIdHash: params.leaseIdHash,
    finalization: {
      status: "error",
      errorCode: "FREE_MONTHLY_LIMIT_EXCEEDED",
      resetCounts: true,
      message: FREE_MONTHLY_LIMIT_MESSAGE,
    },
  });

  return {
    ok: false,
    processedCount: 0,
    savedCount: 0,
    skippedCount: 0,
    errorCode: "FREE_MONTHLY_LIMIT_EXCEEDED",
    message: FREE_MONTHLY_LIMIT_MESSAGE,
  };
}

function sanitizeFilename(value?: string | null, fallback = "file") {
  const cleaned = (value ?? fallback)
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, " ")
    .trim();

  return (cleaned || fallback).slice(0, 120);
}

function getLowerExtension(filename: string) {
  const index = filename.lastIndexOf(".");
  if (index < 0) return "";
  return filename.slice(index).toLowerCase();
}

function isAllowedAttachment(attachment: GmailAttachment) {
  const ext = getLowerExtension(attachment.filename);
  const mimeType = attachment.mimeType.toLowerCase();

  return (
    ALLOWED_ATTACHMENT_EXTENSIONS.has(ext) ||
    ALLOWED_ATTACHMENT_MIME_TYPES.has(mimeType)
  );
}

function formatEmailDateForFilename(value?: string | null) {
  if (!value) return "unknown-date";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "unknown-date";
  }

  return date.toISOString().slice(0, 10);
}

function getShortMessageId(messageId: string) {
  return sanitizeFilename(messageId, "message").slice(0, 8);
}

const GENERIC_SENDER_NAMES = new Set([
  "no-reply",
  "noreply",
  "no_reply",
  "donotreply",
  "do-not-reply",
  "notification",
  "notifications",
  "mail",
  "info",
  "support",
]);

const IGNORED_DOMAIN_PARTS = new Set([
  "com",
  "net",
  "org",
  "jp",
  "co",
  "ne",
  "ac",
  "go",
  "or",
  "io",
  "mail",
  "email",
  "smtp",
  "mx",
  "www",
]);

function normalizeSenderToken(value: string) {
  return value
    .toLowerCase()
    .replace(/[\s._]+/g, "-")
    .trim();
}

function isGenericSenderName(value?: string | null) {
  const normalized = normalizeSenderToken(value ?? "");

  if (!normalized) {
    return true;
  }

  return GENERIC_SENDER_NAMES.has(normalized);
}

function extractEmailAddressFromFromHeader(source: string) {
  const angleEmail = source.match(/<([^>]+)>/)?.[1]?.trim();

  if (angleEmail) {
    return angleEmail;
  }

  return (
    source.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0]?.trim() ?? null
  );
}

function getDomainSenderName(email?: string | null) {
  const domain = email?.split("@")[1]?.toLowerCase();

  if (!domain) {
    return null;
  }

  const candidates = domain
    .split(".")
    .map((part) => part.trim())
    .filter((part) => part && !IGNORED_DOMAIN_PARTS.has(part));

  return candidates.at(-1) ?? null;
}

function getSenderNameForFilename(from?: string | null) {
  const source = (from ?? "").trim();

  if (!source) {
    return "送信元不明";
  }

  const nameMatch = source.match(/^"?([^"<]+)"?\s*</);
  const displayName = nameMatch?.[1]?.replace(/^"+|"+$/g, "").trim() ?? null;
  const email = extractEmailAddressFromFromHeader(source);

  const sender =
    displayName && !isGenericSenderName(displayName)
      ? displayName
      : (getDomainSenderName(email) ?? displayName ?? email ?? source);

  return sanitizeFilename(sender || "送信元不明", "送信元不明").slice(0, 40);
}

function detectDocumentTypeForFilename(params: {
  subject?: string | null;
  bodyText?: string | null;
}) {
  const source = `${params.subject ?? ""} ${params.bodyText ?? ""}`;

  if (/領収書|レシート|receipt/i.test(source)) return "領収書";
  if (/請求書|invoice/i.test(source)) return "請求書";
  if (/見積書|見積|quotation|quote/i.test(source)) return "見積書";
  if (/納品書|delivery note/i.test(source)) return "納品書";

  return "書類";
}

function buildPdfFilename(params: {
  emailDate: string;
  safeSubject: string;
  safeSender: string;
  documentType: string;
  shortMessageId: string;
  filenameFormat: FileNameFormat;
}) {
  if (params.filenameFormat === "ai_sender_doc") {
    return `${params.emailDate}_${params.safeSender}_${params.documentType}_${params.shortMessageId}.pdf`;
  }

  if (params.filenameFormat === "ai_doc_sender") {
    return `${params.documentType}_${params.emailDate}_${params.safeSender}_${params.shortMessageId}.pdf`;
  }

  return `${params.emailDate}_${params.safeSubject}_${params.shortMessageId}.pdf`;
}

function shouldUseAiDocumentType(filenameFormat: FileNameFormat) {
  return (
    filenameFormat === "ai_sender_doc" || filenameFormat === "ai_doc_sender"
  );
}

function buildAttachmentFilename(params: {
  emailDate: string;
  safeSubject: string;
  index: number;
  attachmentFilename: string;
}) {
  const safeAttachmentName = sanitizeFilename(
    params.attachmentFilename,
    `attachment-${params.index + 1}`,
  );

  return `${params.emailDate}_${params.safeSubject}_添付${
    params.index + 1
  }_${safeAttachmentName}`;
}

export async function executeRule(
  params: ExecuteRuleParams,
): Promise<ExecuteResult> {
  const executionStartedAtMs = Date.now();
  const gmailStageStartedAtMs = executionStartedAtMs;

  try {
    const { data: rule } = await supabaseAdmin
      .from("rules")
      .select("id, user_id, gmail_query, drive_folder_id, file_name_format")
      .eq("id", params.ruleId)
      .eq("user_id", params.userId)
      .single();

    if (!rule || rule.id !== params.ruleId || rule.user_id !== params.userId) {
      throw new Error("rule not found");
    }

    let effectivePlan: "free" | "pro" | "pro_plus" = "free";

    const { data: profile, error: profileError } = await supabaseAdmin
      .from("user_profiles")
      .select("plan, billing_status, current_period_end")
      .eq("user_id", params.userId)
      .maybeSingle();

    if (profileError) {
      console.error("[executeRule] failed to fetch user profile:", {
        code: "USER_PROFILE_FETCH_FAILED",
        dbCode:
          typeof profileError.code === "string" ? profileError.code : undefined,
        location: "fetch_user_profile",
      });
    } else {
      effectivePlan = resolveEffectivePlan(profile);
    }

    if (readExecutionDisabledFromEnv()) {
      throw createCostSafetyError("EXECUTION_DISABLED");
    }

    const messageIds = await searchGmail({
      userId: params.userId,
      query: rule.gmail_query,
      maxResults: 1,
      budget: {
        getTimeoutMs: () =>
          getRemainingStageTimeoutMs({
            executionStartedAtMs,
            stageStartedAtMs: gmailStageStartedAtMs,
            stageBudgetMs: GMAIL_CUMULATIVE_TIMEOUT_MS,
          }),
      },
    });

    if (!messageIds.length) {
      const message = "No emails found";

      await finalizeGuardedExecution({
        runId: params.runId,
        userId: params.userId,
        ruleId: params.ruleId,
        leaseIdHash: params.leaseIdHash,
        finalization: {
          status: "success",
          processedCount: 0,
          savedCount: 0,
          skippedCount: 0,
          message,
        },
      });

      await updateGoogleConnectionHealth({
        userId: params.userId,
        event: "success",
      });

      return {
        ok: true,
        processedCount: 0,
        savedCount: 0,
        skippedCount: 0,
        errorCode: null,
        message,
      };
    }

    const messageId = messageIds[0];

    const processedEmailState = await getProcessedEmailState({
      userId: params.userId,
      ruleId: rule.id,
      gmailMessageId: messageId,
    });

    if (processedEmailState.exists) {
      const message = "Skipped 1 already processed email";

      await finalizeGuardedExecution({
        runId: params.runId,
        userId: params.userId,
        ruleId: params.ruleId,
        leaseIdHash: params.leaseIdHash,
        finalization: {
          status: "success",
          processedCount: 0,
          savedCount: 0,
          skippedCount: 1,
          message,
        },
      });

      await updateGoogleConnectionHealth({
        userId: params.userId,
        event: "success",
      });

      return {
        ok: true,
        processedCount: 0,
        savedCount: 0,
        skippedCount: 1,
        errorCode: null,
        message,
      };
    }

    const monthlyLimit = await checkFreeMonthlyPdfSaveLimit(params.userId);

    if (!monthlyLimit.ok) {
      return finalizeFreeMonthlyLimit({
        runId: params.runId,
        userId: params.userId,
        ruleId: params.ruleId,
        leaseIdHash: params.leaseIdHash,
      });
    }

    const message = await getGmailMessage({
      userId: params.userId,
      messageId,
      budget: {
        getTimeoutMs: () =>
          getRemainingStageTimeoutMs({
            executionStartedAtMs,
            stageStartedAtMs: gmailStageStartedAtMs,
            stageBudgetMs: GMAIL_CUMULATIVE_TIMEOUT_MS,
          }),
      },
    });

    const bodyText =
      "bodyText" in message && typeof message.bodyText === "string"
        ? message.bodyText
        : "";

    if (!isRawEmailBodyWithinLimit(bodyText)) {
      throw createCostSafetyError("EMAIL_SIZE_LIMIT_EXCEEDED");
    }

    const emailDate = formatEmailDateForFilename(message.date);
    const safeSubject = sanitizeFilename(message.subject, "email").slice(0, 80);
    const safeSender = getSenderNameForFilename(message.from);
    const shortMessageId = getShortMessageId(messageId);
    const normalizedStoredFormat = normalizeFileNameFormat(
      rule.file_name_format,
    );
    const filenameFormat = normalizeFileNameFormatForPlan(
      normalizedStoredFormat,
      effectivePlan,
    );

    const attachments = Array.isArray(message.attachments)
      ? message.attachments
      : [];

    const attachmentMetadataBytes = getAttachmentMetadataBytes(attachments);
    const totalAttachmentMetadataBytes = attachmentMetadataBytes.reduce(
      (total, size) => total + size,
      0,
    );

    if (attachments.length > 5) {
      throw createCostSafetyError("ATTACHMENT_COUNT_LIMIT_EXCEEDED");
    }

    if (
      !areAttachmentMetadataWithinLimits({
        count: attachments.length,
        declaredByteSizes: attachmentMetadataBytes,
        totalDeclaredBytes: totalAttachmentMetadataBytes,
      })
    ) {
      throw createCostSafetyError("EMAIL_SIZE_LIMIT_EXCEEDED");
    }

    const downloadedAttachments: Array<{
      attachment: GmailAttachment;
      bytes: Uint8Array;
    }> = [];

    for (const attachment of attachments) {
      if (!isAllowedAttachment(attachment)) continue;

      const attachmentBytes = await getGmailAttachment({
        userId: params.userId,
        messageId,
        attachmentId: attachment.attachmentId,
        budget: {
          getTimeoutMs: () =>
            getRemainingStageTimeoutMs({
              executionStartedAtMs,
              stageStartedAtMs: gmailStageStartedAtMs,
              stageBudgetMs: GMAIL_CUMULATIVE_TIMEOUT_MS,
            }),
        },
      });

      if (attachmentBytes.byteLength !== attachment.size) {
        throw createCostSafetyError("EMAIL_SIZE_LIMIT_EXCEEDED");
      }

      downloadedAttachments.push({ attachment, bytes: attachmentBytes });
    }

    const downloadedAttachmentBytes = getTotalByteLength(
      downloadedAttachments.map(({ bytes }) => bytes),
    );
    if (
      downloadedAttachmentBytes === null ||
      downloadedAttachmentBytes > totalAttachmentMetadataBytes
    ) {
      throw createCostSafetyError("EMAIL_SIZE_LIMIT_EXCEEDED");
    }

    const fallbackDocumentType = detectDocumentTypeForFilename({
      subject: message.subject,
      bodyText,
    });

    const aiDocumentType = shouldUseAiDocumentType(filenameFormat)
      ? await detectDocumentTypeWithAi({
          userId: params.userId,
          ruleId: params.ruleId,
          runId: params.runId,
          subject: message.subject,
          from: message.from,
          bodyText,
          attachmentFilenames: attachments.map(
            (attachment) => attachment.filename,
          ),
          timeoutMs: getRequiredStageTimeoutMs({
            executionStartedAtMs,
            stageStartedAtMs: executionStartedAtMs,
            stageBudgetMs: OPENAI_TIMEOUT_MS,
          }),
        })
      : null;

    const documentType = aiDocumentType ?? fallbackDocumentType;

    getRequiredStageTimeoutMs({
      executionStartedAtMs,
      stageStartedAtMs: executionStartedAtMs,
      stageBudgetMs: EXECUTION_ABSOLUTE_DEADLINE_MS,
    });

    const pdfBytes = await emailToPdfBytes({
      subject: message.subject,
      from: message.from,
      date: message.date,
      snippet: message.snippet,
      bodyText,
    });

    if (!isGeneratedPdfWithinLimit(pdfBytes.byteLength)) {
      throw createCostSafetyError("EMAIL_SIZE_LIMIT_EXCEEDED");
    }

    const totalDriveWriteBytes =
      pdfBytes.byteLength + downloadedAttachmentBytes;
    if (
      !Number.isSafeInteger(totalDriveWriteBytes) ||
      !isTotalDriveWriteWithinLimit(totalDriveWriteBytes)
    ) {
      throw createCostSafetyError("EMAIL_SIZE_LIMIT_EXCEEDED");
    }

    const filename = buildPdfFilename({
      emailDate,
      safeSubject,
      safeSender,
      documentType,
      shortMessageId,
      filenameFormat,
    });

    const uploadLimit = await checkFreeMonthlyPdfSaveLimit(params.userId);

    if (!uploadLimit.ok) {
      return finalizeFreeMonthlyLimit({
        runId: params.runId,
        userId: params.userId,
        ruleId: params.ruleId,
        leaseIdHash: params.leaseIdHash,
      });
    }

    const driveStageStartedAtMs = Date.now();
    const driveBudget = {
      getTimeoutMs: () =>
        getRemainingStageTimeoutMs({
          executionStartedAtMs,
          stageStartedAtMs: driveStageStartedAtMs,
          stageBudgetMs: DRIVE_CUMULATIVE_TIMEOUT_MS,
        }),
    };

    const driveResult = await uploadPdfToDrive({
      userId: params.userId,
      folderId: rule.drive_folder_id,
      filename,
      pdfBytes,
      budget: driveBudget,
    });

    let savedAttachmentCount = 0;
    const skippedAttachmentCount = attachments.filter(
      (attachment) => !isAllowedAttachment(attachment),
    ).length;

    for (const [index, entry] of downloadedAttachments.entries()) {
      const { attachment, bytes: attachmentBytes } = entry;

      const attachmentFilename = buildAttachmentFilename({
        emailDate,
        safeSubject,
        index,
        attachmentFilename: attachment.filename,
      });

      await uploadFileToDrive({
        userId: params.userId,
        folderId: rule.drive_folder_id,
        filename: attachmentFilename,
        bytes: attachmentBytes,
        mimeType: attachment.mimeType || "application/octet-stream",
        budget: driveBudget,
      });

      savedAttachmentCount += 1;
    }

    const savedCount = 1 + savedAttachmentCount;

    try {
      await recordProcessedEmail({
        userId: params.userId,
        ruleId: rule.id,
        gmailMessageId: messageId,
        drive: {
          fileId: driveResult.fileId,
          webViewLink: driveResult.webViewLink,
          fileName: filename,
        },
      });
    } catch {
      console.error("[executeRule] processed_emails insert failed:", {
        code: "PROCESSED_EMAIL_INSERT_FAILED",
        location: "insert_processed_email",
      });

      throw Object.assign(new Error("Processed email storage failed"), {
        code: "DB_INSERT_FAILED",
      });
    }

    const successMessage =
      savedAttachmentCount > 0
        ? `Saved ${savedCount} files to Drive`
        : "Saved 1 PDF to Drive";

    await finalizeGuardedExecution({
      runId: params.runId,
      userId: params.userId,
      ruleId: params.ruleId,
      leaseIdHash: params.leaseIdHash,
      finalization: {
        status: "success",
        processedCount: 1,
        savedCount,
        skippedCount: skippedAttachmentCount,
        message: successMessage,
      },
    });

    await updateGoogleConnectionHealth({
      userId: params.userId,
      event: "success",
    });

    return {
      ok: true,
      processedCount: 1,
      savedCount,
      skippedCount: skippedAttachmentCount,
      errorCode: null,
      message: successMessage,
    };
  } catch (error) {
    const errorCode = normalizeRunErrorCode(error);
    console.error("[executeRule] failed", {
      code: errorCode,
      errorName: error instanceof Error ? error.name : "UnknownError",
      stage: getSafeRunErrorStage(error),
    });
    const userFacing = getRunErrorMessage(errorCode);

    const detail = (userFacing.action ?? userFacing.message ?? "").trim();

    const safeMessage = detail
      ? `${userFacing.title}。${detail}`
      : userFacing.title;

    await finalizeGuardedExecution({
      runId: params.runId,
      userId: params.userId,
      ruleId: params.ruleId,
      leaseIdHash: params.leaseIdHash,
      finalization: {
        status: "error",
        errorCode,
        resetCounts: false,
        message: safeMessage,
      },
    });

    if (SLACK_NOTIFY_ERROR_CODES.has(errorCode)) {
      try {
        await notifySlack({
          errorCode,
          message: safeMessage,
          userId: params.userId,
          ruleId: params.ruleId,
          trigger: params.trigger,
          occurredAt: new Date().toISOString(),
        });
      } catch (notifyError) {
        console.error("[monitoring] Slack notify failed", {
          code: "SLACK_NOTIFY_FAILED",
          errorName:
            notifyError instanceof Error ? notifyError.name : "UnknownError",
          location: "execute_rule_error_notification",
        });
      }
    }

    await updateGoogleConnectionHealth({
      userId: params.userId,
      event: "error",
      errorCode,
    });

    if (USER_NOTIFY_ERROR_CODES.has(errorCode)) {
      try {
        await notifyUser({
          userId: params.userId,
          ruleId: params.ruleId,
          errorCode:
            errorCode === "GOOGLE_TOKEN_INVALID"
              ? "GOOGLE_TOKEN_INVALID"
              : errorCode === "GOOGLE_REFRESH_OUTCOME_UNKNOWN"
                ? "GOOGLE_REFRESH_OUTCOME_UNKNOWN"
                : "GOOGLE_PERMISSION_DENIED",
          message: safeMessage,
          trigger: params.trigger,
          occurredAt: new Date().toISOString(),
        });
      } catch (notifyError) {
        console.error("[monitoring] User notify failed", {
          code: "USER_NOTIFY_FAILED",
          errorName:
            notifyError instanceof Error ? notifyError.name : "UnknownError",
          location: "execute_rule_error_notification",
        });
      }
    }

    return {
      ok: false,
      processedCount: 0,
      savedCount: 0,
      skippedCount: 0,
      errorCode,
      message: safeMessage,
    };
  }
}
