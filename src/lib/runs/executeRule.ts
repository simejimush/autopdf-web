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
      .select("id, gmail_query, drive_folder_id")
      .eq("id", params.ruleId)
      .single();

    if (!rule) {
      throw new Error("rule not found");
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
        .eq("id", params.runId);

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
        .eq("id", params.runId);

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
    const shortMessageId = getShortMessageId(messageId);

    const filename = `${emailDate}_${safeSubject}_${shortMessageId}.pdf`;

    const driveResult = await uploadPdfToDrive({
      userId: params.userId,
      folderId: rule.drive_folder_id,
      filename,
      pdfBytes,
    });

    const attachments = Array.isArray(message.attachments)
      ? message.attachments
      : [];

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
