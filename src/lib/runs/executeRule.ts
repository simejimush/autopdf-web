import { supabaseAdmin } from "@/lib/supabase/admin";
import { emailToPdfBytes } from "@/lib/pdf/emailToPdf";
import {
  searchGmail,
  getGmailMessage,
  getGmailAttachment,
  type GmailAttachment,
} from "@/lib/google/gmail";
import {
  DriveUploadOutcomeUnknownError,
  uploadFileToDrive,
  uploadPdfToDrive,
} from "@/lib/google/drive";
import { getRunErrorMessage } from "@/lib/runs/getRunErrorMessage";
import { normalizeRunErrorCode } from "@/lib/runs/normalizeRunErrorCode";
import { finalizeGuardedExecution } from "@/lib/runs/guardedExecutionRepository";
import {
  completeProcessedEmail,
  markProcessedEmailDriveStarted,
  reserveProcessedEmail,
} from "@/lib/runs/processedEmailRepository";
import { updateGoogleConnectionHealth } from "@/lib/monitoring/updateGoogleConnectionHealth";
import { notifySlack } from "@/lib/monitoring/notifySlack";
import { notifyUser } from "@/lib/monitoring/notifyUser";
import { detectDocumentTypeWithAi } from "@/lib/ai/detectDocumentType";
import { resolveEffectivePlan } from "@/lib/billing/resolveEffectivePlan";
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
  TOTAL_DRIVE_WRITE_PER_EMAIL_LIMIT_BYTES,
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

type TerminalOutcome = {
  result: ExecuteResult;
  finalization: Parameters<typeof finalizeGuardedExecution>[0]["finalization"];
};

const SLACK_NOTIFY_ERROR_CODES = new Set([
  "GOOGLE_TOKEN_INVALID",
  "GOOGLE_REFRESH_OUTCOME_UNKNOWN",
  "GOOGLE_PERMISSION_DENIED",
  "DRIVE_FOLDER_INVALID",
  "DRIVE_UPLOAD_FAILED",
  "DRIVE_UPLOAD_OUTCOME_UNKNOWN",
  "DB_INSERT_FAILED",
  "TIMEOUT",
  "UNKNOWN",
]);

const USER_NOTIFY_ERROR_CODES = new Set<string>([
  "GOOGLE_TOKEN_INVALID",
  "GOOGLE_REFRESH_OUTCOME_UNKNOWN",
  "GOOGLE_PERMISSION_DENIED",
]);

const RESET_COUNT_ERROR_CODES = new Set([
  "FREE_MONTHLY_LIMIT_EXCEEDED",
  "DAILY_PROCESSED_EMAIL_LIMIT_EXCEEDED",
  "MONTHLY_PROCESSED_EMAIL_LIMIT_EXCEEDED",
  "DRIVE_BYTE_LIMIT_EXCEEDED",
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
  let terminalFinalizeAttempted = false;
  let terminalFinalizeSucceeded = false;
  let terminalOutcome: TerminalOutcome | null = null;

  async function finalizeTerminal(outcome: TerminalOutcome): Promise<void> {
    if (terminalFinalizeAttempted) {
      throw Object.assign(
        new Error("Execution finalization state is unknown"),
        {
          code: "GUARD_STORE_FAILED",
        },
      );
    }

    terminalFinalizeAttempted = true;
    terminalOutcome = outcome;

    try {
      await finalizeGuardedExecution({
        runId: params.runId,
        userId: params.userId,
        ruleId: params.ruleId,
        leaseIdHash: params.leaseIdHash,
        finalization: outcome.finalization,
      });
      terminalFinalizeSucceeded = true;
    } catch (error) {
      console.error("[executeRule] terminal finalize failed", {
        code: "GUARD_STORE_FAILED",
        errorName: error instanceof Error ? error.name : "UnknownError",
        stage: "terminal_finalize",
      });
      throw Object.assign(
        new Error("Execution finalization state is unknown"),
        {
          code: "GUARD_STORE_FAILED",
        },
      );
    }
  }

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

      const outcome: TerminalOutcome = {
        finalization: {
          status: "success",
          processedCount: 0,
          savedCount: 0,
          skippedCount: 0,
          message,
        },
        result: {
          ok: true,
          processedCount: 0,
          savedCount: 0,
          skippedCount: 0,
          errorCode: null,
          message,
        },
      };

      await finalizeTerminal(outcome);

      await updateGoogleConnectionHealth({
        userId: params.userId,
        event: "success",
      });

      return outcome.result;
    }

    const messageId = messageIds[0];

    let reservation: Awaited<ReturnType<typeof reserveProcessedEmail>>;
    try {
      reservation = await reserveProcessedEmail({
        runId: params.runId,
        userId: params.userId,
        ruleId: rule.id,
        gmailMessageId: messageId,
        executionLeaseIdHash: params.leaseIdHash,
        reservedBytes: TOTAL_DRIVE_WRITE_PER_EMAIL_LIMIT_BYTES,
      });
    } catch {
      throw Object.assign(new Error("Processed email reservation failed"), {
        code: "DB_INSERT_FAILED",
      });
    }

    if (!reservation.reserved && reservation.completed) {
      const message = "Skipped 1 already processed email";

      const outcome: TerminalOutcome = {
        finalization: {
          status: "success",
          processedCount: 0,
          savedCount: 0,
          skippedCount: 1,
          message,
        },
        result: {
          ok: true,
          processedCount: 0,
          savedCount: 0,
          skippedCount: 1,
          errorCode: null,
          message,
        },
      };

      await finalizeTerminal(outcome);

      await updateGoogleConnectionHealth({
        userId: params.userId,
        event: "success",
      });

      return outcome.result;
    }

    if (
      !reservation.reserved &&
      reservation.errorCode === "ACTIVE_RESERVATION"
    ) {
      const message = "Skipped 1 email reserved by another run";
      const outcome: TerminalOutcome = {
        finalization: {
          status: "success",
          processedCount: 0,
          savedCount: 0,
          skippedCount: 1,
          message,
        },
        result: {
          ok: true,
          processedCount: 0,
          savedCount: 0,
          skippedCount: 1,
          errorCode: null,
          message,
        },
      };
      await finalizeTerminal(outcome);
      await updateGoogleConnectionHealth({
        userId: params.userId,
        event: "success",
      });
      return outcome.result;
    }

    if (!reservation.reserved) {
      throw Object.assign(new Error(reservation.errorCode), {
        code:
          reservation.errorCode === "OUTCOME_UNKNOWN"
            ? "DRIVE_UPLOAD_OUTCOME_UNKNOWN"
            : reservation.errorCode,
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

    const driveStageStartedAtMs = Date.now();
    const driveBudget = {
      getTimeoutMs: () =>
        getRemainingStageTimeoutMs({
          executionStartedAtMs,
          stageStartedAtMs: driveStageStartedAtMs,
          stageBudgetMs: DRIVE_CUMULATIVE_TIMEOUT_MS,
        }),
    };

    let driveWriteStarted = false;
    let actualWrittenBytes = 0;
    const markDriveWriteStarted = async () => {
      if (driveWriteStarted) return;
      await markProcessedEmailDriveStarted({
        runId: params.runId,
        userId: params.userId,
        ruleId: rule.id,
        gmailMessageId: messageId,
        reservationIdHash: reservation.reservationIdHash,
      });
      driveWriteStarted = true;
    };

    const driveResult = await uploadPdfToDrive({
      userId: params.userId,
      folderId: rule.drive_folder_id,
      filename,
      pdfBytes,
      budget: driveBudget,
      onCreateRequestStarted: markDriveWriteStarted,
    });
    if (driveResult.created) actualWrittenBytes += pdfBytes.byteLength;

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

      try {
        const attachmentResult = await uploadFileToDrive({
          userId: params.userId,
          folderId: rule.drive_folder_id,
          filename: attachmentFilename,
          bytes: attachmentBytes,
          mimeType: attachment.mimeType || "application/octet-stream",
          budget: driveBudget,
          onCreateRequestStarted: markDriveWriteStarted,
        });
        if (attachmentResult.created) {
          actualWrittenBytes += attachmentBytes.byteLength;
        }
      } catch (error) {
        if (
          actualWrittenBytes > 0 &&
          normalizeRunErrorCode(error) !== "DRIVE_UPLOAD_OUTCOME_UNKNOWN"
        ) {
          throw new DriveUploadOutcomeUnknownError();
        }
        throw error;
      }

      savedAttachmentCount += 1;
    }

    const savedCount = 1 + savedAttachmentCount;

    try {
      await completeProcessedEmail({
        runId: params.runId,
        userId: params.userId,
        ruleId: rule.id,
        gmailMessageId: messageId,
        reservationIdHash: reservation.reservationIdHash,
        driveFileId: driveResult.fileId,
        driveWebViewLink: driveResult.webViewLink,
        driveFileName: filename,
        writtenBytes: actualWrittenBytes,
      });
    } catch {
      console.error("[executeRule] processed email completion failed:", {
        code: "PROCESSED_EMAIL_COMPLETE_FAILED",
        location: "complete_processed_email",
      });

      if (actualWrittenBytes > 0) {
        throw new DriveUploadOutcomeUnknownError();
      }
      throw Object.assign(new Error("Processed email storage failed"), {
        code: "DB_INSERT_FAILED",
      });
    }

    const successMessage =
      savedAttachmentCount > 0
        ? `Saved ${savedCount} files to Drive`
        : "Saved 1 PDF to Drive";

    const outcome: TerminalOutcome = {
      finalization: {
        status: "success",
        processedCount: 1,
        savedCount,
        skippedCount: skippedAttachmentCount,
        message: successMessage,
      },
      result: {
        ok: true,
        processedCount: 1,
        savedCount,
        skippedCount: skippedAttachmentCount,
        errorCode: null,
        message: successMessage,
      },
    };

    await finalizeTerminal(outcome);

    await updateGoogleConnectionHealth({
      userId: params.userId,
      event: "success",
    });

    return outcome.result;
  } catch (error) {
    const finalizedOutcome = terminalOutcome as TerminalOutcome | null;
    if (terminalFinalizeAttempted) {
      if (!terminalFinalizeSucceeded || !finalizedOutcome) throw error;

      console.error("[monitoring] Google connection health update failed", {
        code: "GOOGLE_CONNECTION_HEALTH_UPDATE_FAILED",
        errorName: error instanceof Error ? error.name : "UnknownError",
        location: "execute_rule_success_health",
      });
      return finalizedOutcome.result;
    }

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

    const outcome: TerminalOutcome = {
      finalization: {
        status: "error",
        errorCode,
        resetCounts: RESET_COUNT_ERROR_CODES.has(errorCode),
        message: safeMessage,
      },
      result: {
        ok: false,
        processedCount: 0,
        savedCount: 0,
        skippedCount: 0,
        errorCode,
        message: safeMessage,
      },
    };

    await finalizeTerminal(outcome);

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

    try {
      await updateGoogleConnectionHealth({
        userId: params.userId,
        event: "error",
        errorCode,
      });
    } catch (healthError) {
      console.error("[monitoring] Google connection health update failed", {
        code: "GOOGLE_CONNECTION_HEALTH_UPDATE_FAILED",
        errorName:
          healthError instanceof Error ? healthError.name : "UnknownError",
        location: "execute_rule_error_health",
      });
    }

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

    return outcome.result;
  }
}
