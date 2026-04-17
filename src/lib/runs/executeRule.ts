import { supabaseAdmin } from "@/lib/supabase/admin";
import { searchGmail, getGmailMessage } from "@/lib/google/gmail";
import { emailToPdfBytes } from "@/lib/pdf/emailToPdf";
import { uploadPdfToDrive } from "@/lib/google/drive";
import { getRunErrorMessage } from "@/lib/runs/getRunErrorMessage";
import { normalizeRunErrorCode } from "@/lib/runs/normalizeRunErrorCode";
import { updateGoogleConnectionHealth } from "@/lib/monitoring/updateGoogleConnectionHealth";
import { notifySlack } from "@/lib/monitoring/notifySlack";

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

const SLACK_NOTIFY_ERROR_CODES = new Set([
  "GOOGLE_TOKEN_INVALID",
  "GOOGLE_PERMISSION_DENIED",
  "DRIVE_FOLDER_INVALID",
  "DRIVE_UPLOAD_FAILED",
  "DB_INSERT_FAILED",
  "UNKNOWN",
]);

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

    const safeSubject = (message.subject ?? "email")
      .replace(/[\\/:*?"<>|]/g, "_")
      .slice(0, 80);

    const filename = `${safeSubject}_${messageId}.pdf`;

    const driveResult = await uploadPdfToDrive({
      userId: params.userId,
      folderId: rule.drive_folder_id,
      filename,
      pdfBytes,
    });

    await supabaseAdmin.from("processed_emails").insert({
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

    await supabaseAdmin
      .from("runs")
      .update({
        status: "success",
        processed_count: 1,
        saved_count: 1,
        skipped_count: 0,
        message: "Saved 1 PDF to Drive",
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
      savedCount: 1,
      skippedCount: 0,
      errorCode: null,
      message: "Saved 1 PDF to Drive",
    };
  } catch (error) {
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
      console.log("[monitoring] notifySlack target:", {
        errorCode,
        ruleId: params.ruleId,
        trigger: params.trigger,
      });
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
