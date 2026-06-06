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

type ExecuteRuleParams = {
  ruleId: string;
  userId: string;
  runId: string;
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

async function getUserEmail(userId: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin.auth.admin.getUserById(userId);

  if (error || !data?.user?.email) {
    return null;
  }

  return data.user.email;
}

const SLACK_NOTIFY_ERROR_CODES = new Set([
  "GOOGLE_TOKEN_INVALID",
  "GOOGLE_PERMISSION_DENIED",
  "DRIVE_FOLDER_INVALID",
  "DRIVE_UPLOAD_FAILED",
  "DB_INSERT_FAILED",
  "UNKNOWN",
]);

const USER_NOTIFY_ERROR_CODES = new Set<string>([
  "GOOGLE_TOKEN_INVALID",
  "GOOGLE_PERMISSION_DENIED",
]);

const ALLOWED_ATTACHMENT_EXTENSIONS = new Set([".pdf", ".csv", ".xlsx"]);

const ALLOWED_ATTACHMENT_MIME_TYPES = new Set([
  "application/pdf",
  "text/csv",
  "application/csv",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);

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
  try {
    const { data: rule } = await supabaseAdmin
      .from("rules")
      .select("id, gmail_query, drive_folder_id, file_name_format")
      .eq("id", params.ruleId)
      .single();

    if (!rule) {
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
        userId: params.userId,
        message: profileError.message,
      });
    } else {
      effectivePlan = resolveEffectivePlan(profile);
    }

    const messageIds = await searchGmail({
      userId: params.userId,
      query: rule.gmail_query,
      maxResults: 1,
    });

    if (!messageIds.length) {
      const message = "No emails found";

      await supabaseAdmin
        .from("runs")
        .update({
          status: "success",
          processed_count: 0,
          saved_count: 0,
          skipped_count: 0,
          message,
          finished_at: new Date().toISOString(),
        })
        .eq("id", params.runId)
        .eq("user_id", params.userId);

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

    const { data: existingProcessed } = await supabaseAdmin
      .from("processed_emails")
      .select("id")
      .eq("user_id", params.userId)
      .eq("rule_id", params.ruleId)
      .eq("gmail_message_id", messageId)
      .maybeSingle();

    if (existingProcessed) {
      const message = "Skipped 1 already processed email";

      await supabaseAdmin
        .from("runs")
        .update({
          status: "success",
          processed_count: 0,
          saved_count: 0,
          skipped_count: 1,
          message,
          finished_at: new Date().toISOString(),
        })
        .eq("id", params.runId)
        .eq("user_id", params.userId);

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
      const message =
        "Freeプランの今月のPDF保存上限（10件）に達しています。翌月まで待つか、Proプランへの変更をご検討ください。";

      await supabaseAdmin
        .from("runs")
        .update({
          status: "error",
          error_code: "FREE_MONTHLY_LIMIT_EXCEEDED",
          processed_count: 0,
          saved_count: 0,
          skipped_count: 0,
          message,
          finished_at: new Date().toISOString(),
        })
        .eq("id", params.runId)
        .eq("user_id", params.userId);

      return {
        ok: false,
        processedCount: 0,
        savedCount: 0,
        skippedCount: 0,
        errorCode: "FREE_MONTHLY_LIMIT_EXCEEDED",
        message,
      };
    }

    const message = await getGmailMessage({
      userId: params.userId,
      messageId,
    });

    const bodyText =
      "bodyText" in message && typeof message.bodyText === "string"
        ? message.bodyText
        : "";

    const pdfBytes = await emailToPdfBytes({
      subject: message.subject,
      from: message.from,
      date: message.date,
      snippet: message.snippet,
      bodyText,
    });

    const emailDate = formatEmailDateForFilename(message.date);
    const safeSubject = sanitizeFilename(message.subject, "email").slice(0, 80);
    const safeSender = getSenderNameForFilename(message.from);
    const shortMessageId = getShortMessageId(messageId);
    const normalizedStoredFormat = normalizeFileNameFormat(rule.file_name_format);
    const filenameFormat = normalizeFileNameFormatForPlan(
      normalizedStoredFormat,
      effectivePlan,
    );

    const attachments = Array.isArray(message.attachments)
      ? message.attachments
      : [];

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
        })
      : null;

    const documentType = aiDocumentType ?? fallbackDocumentType;

    const filename = buildPdfFilename({
      emailDate,
      safeSubject,
      safeSender,
      documentType,
      shortMessageId,
      filenameFormat,
    });

    const driveResult = await uploadPdfToDrive({
      userId: params.userId,
      folderId: rule.drive_folder_id,
      filename,
      pdfBytes,
    });

    let savedAttachmentCount = 0;
    let skippedAttachmentCount = 0;

    for (const [index, attachment] of attachments.entries()) {
      if (!isAllowedAttachment(attachment)) {
        skippedAttachmentCount += 1;
        continue;
      }

      const attachmentBytes = await getGmailAttachment({
        userId: params.userId,
        messageId,
        attachmentId: attachment.attachmentId,
      });

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
      });

      savedAttachmentCount += 1;
    }

    const savedCount = 1 + savedAttachmentCount;

    const { error: processedInsertError } = await supabaseAdmin
      .from("processed_emails")
      .insert({
        user_id: params.userId,
        rule_id: rule.id,
        gmail_message_id: messageId,
        drive_file_id:
          typeof driveResult === "object" &&
          driveResult &&
          "fileId" in driveResult
            ? driveResult.fileId
            : null,
        drive_web_view_link:
          typeof driveResult === "object" &&
          driveResult &&
          "webViewLink" in driveResult
            ? driveResult.webViewLink
            : null,
        drive_file_name: filename,
        saved_at: new Date().toISOString(),
      });

    if (processedInsertError) {
      console.error("[executeRule] processed_emails insert failed:", {
        code: processedInsertError.code,
        message: processedInsertError.message,
      });

      throw new Error("DB_INSERT_FAILED");
    }

    const successMessage =
      savedAttachmentCount > 0
        ? `Saved ${savedCount} files to Drive`
        : "Saved 1 PDF to Drive";

    await supabaseAdmin
      .from("runs")
      .update({
        status: "success",
        processed_count: 1,
        saved_count: savedCount,
        skipped_count: skippedAttachmentCount,
        message: successMessage,
        finished_at: new Date().toISOString(),
      })
      .eq("id", params.runId);

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
    console.error("[executeRule] raw error:", error);
    const errorCode = normalizeRunErrorCode(error);
    const userFacing = getRunErrorMessage(errorCode);

    const detail = (userFacing.action ?? userFacing.message ?? "").trim();

    const safeMessage = detail
      ? `${userFacing.title}。${detail}`
      : userFacing.title;

    await supabaseAdmin
      .from("runs")
      .update({
        status: "error",
        error_code: errorCode,
        message: safeMessage,
        finished_at: new Date().toISOString(),
      })
      .eq("id", params.runId);

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
        const notifyMessage =
          notifyError instanceof Error
            ? notifyError.message
            : "Unknown Slack notify error";

        console.error("[monitoring] Slack notify failed:", notifyMessage);
      }
    }

    await updateGoogleConnectionHealth({
      userId: params.userId,
      event: "error",
      errorCode,
    });

    if (USER_NOTIFY_ERROR_CODES.has(errorCode)) {
      try {
        const userEmail = await getUserEmail(params.userId);

        if (userEmail) {
          await notifyUser({
            userId: params.userId,
            userEmail,
            ruleId: params.ruleId,
            errorCode:
              errorCode === "GOOGLE_TOKEN_INVALID"
                ? "GOOGLE_TOKEN_INVALID"
                : "GOOGLE_PERMISSION_DENIED",
            message: safeMessage,
            trigger: params.trigger,
            occurredAt: new Date().toISOString(),
          });
        }
      } catch (notifyError) {
        const notifyMessage =
          notifyError instanceof Error
            ? notifyError.message
            : "Unknown user notify error";

        console.error("[monitoring] User notify failed:", notifyMessage);
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
