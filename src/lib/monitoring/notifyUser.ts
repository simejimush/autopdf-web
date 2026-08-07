import { supabaseAdmin } from "@/lib/supabase/admin";
import { sendEmail } from "@/lib/email/sendEmail";

type UserNotificationPayload = {
  userId: string;
  ruleId: string;
  errorCode: "GOOGLE_TOKEN_INVALID" | "GOOGLE_PERMISSION_DENIED";
  message: string;
  trigger: "manual" | "cron";
  occurredAt: string;
};

export type NotifyUserReason =
  | "cooldown"
  | "not_found"
  | "disabled"
  | "auth_user_not_found"
  | "auth_email_missing"
  | "auth_lookup_failed"
  | "send_failed"
  | "state_update_failed";

export type NotifyUserResult =
  | Readonly<{
      sent: true;
      skipped: false;
      reason?: "state_update_failed";
    }>
  | Readonly<{
      sent: false;
      skipped: true;
      reason:
        | "cooldown"
        | "not_found"
        | "disabled"
        | "auth_user_not_found"
        | "auth_email_missing";
    }>
  | Readonly<{
      sent: false;
      skipped: false;
      reason: "auth_lookup_failed" | "send_failed";
    }>;

const COOLDOWN_HOURS = 24;
const NOTIFICATION_STATE_SELECT = "id, user_id";

function logUserNotificationFailure(reason: NotifyUserReason) {
  console.error("[monitoring] User notify failed", {
    code: "USER_NOTIFY_FAILED",
    reason,
    location: "notify_user",
  });
}

function buildReconnectMailSubject(): string {
  return "【AutoPDF】Google連携の再接続が必要です";
}

function buildReconnectMailText(): string {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim() || "";
  const settingsUrl = appUrl ? `${appUrl}/settings` : "/settings";

  return [
    "AutoPDF で Google 連携の認証切れが発生しました。",
    "",
    "現在、一部の自動PDF保存が正常に実行できない状態です。",
    "お手数ですが、AutoPDF にログインして Google アカウントを再接続してください。",
    "",
    `設定ページ: ${settingsUrl}`,
    "",
    "再接続後は自動処理が再開されます。",
  ].join("\n");
}

function isWithinCooldown(lastNotifiedAt: string | null, now: Date): boolean {
  if (!lastNotifiedAt) return false;

  const last = new Date(lastNotifiedAt);
  if (Number.isNaN(last.getTime())) return false;

  const diffMs = now.getTime() - last.getTime();
  const cooldownMs = COOLDOWN_HOURS * 60 * 60 * 1000;

  return diffMs < cooldownMs;
}

function isExpectedUpdatedConnection(value: unknown, userId: string): boolean {
  if (!value || typeof value !== "object") return false;

  const row = value as Record<string, unknown>;
  return typeof row.id === "string" && row.user_id === userId;
}

export async function notifyUser(
  payload: UserNotificationPayload,
): Promise<NotifyUserResult> {
  const now = new Date();

  const { data: connection, error: fetchErr } = await supabaseAdmin
    .from("google_connections")
    .select(
      "user_id, reauth_required, last_user_notified_at, last_user_notified_error_code",
    )
    .eq("user_id", payload.userId)
    .maybeSingle();

  if (
    fetchErr ||
    !connection ||
    connection.user_id !== payload.userId ||
    (connection.last_user_notified_at !== null &&
      typeof connection.last_user_notified_at !== "string")
  ) {
    return {
      sent: false,
      skipped: true,
      reason: "not_found",
    };
  }

  if (!connection.reauth_required) {
    return {
      sent: false,
      skipped: true,
      reason: "disabled",
    };
  }

  if (isWithinCooldown(connection.last_user_notified_at, now)) {
    return {
      sent: false,
      skipped: true,
      reason: "cooldown",
    };
  }

  let authResult: Awaited<
    ReturnType<typeof supabaseAdmin.auth.admin.getUserById>
  >;
  try {
    authResult = await supabaseAdmin.auth.admin.getUserById(payload.userId);
  } catch {
    logUserNotificationFailure("auth_lookup_failed");
    return {
      sent: false,
      skipped: false,
      reason: "auth_lookup_failed",
    };
  }

  if (authResult.error?.code === "user_not_found") {
    logUserNotificationFailure("auth_user_not_found");
    return {
      sent: false,
      skipped: true,
      reason: "auth_user_not_found",
    };
  }

  if (authResult.error) {
    logUserNotificationFailure("auth_lookup_failed");
    return {
      sent: false,
      skipped: false,
      reason: "auth_lookup_failed",
    };
  }

  const authUser = authResult.data?.user;
  if (!authUser || authUser.id !== payload.userId) {
    logUserNotificationFailure("auth_user_not_found");
    return {
      sent: false,
      skipped: true,
      reason: "auth_user_not_found",
    };
  }

  const recipientEmail = authUser.email?.trim();
  if (!recipientEmail) {
    logUserNotificationFailure("auth_email_missing");
    return {
      sent: false,
      skipped: true,
      reason: "auth_email_missing",
    };
  }

  try {
    await sendEmail({
      to: recipientEmail,
      subject: buildReconnectMailSubject(),
      text: buildReconnectMailText(),
    });
  } catch {
    logUserNotificationFailure("send_failed");
    return {
      sent: false,
      skipped: false,
      reason: "send_failed",
    };
  }

  const updateNow = now.toISOString();

  try {
    const updateQuery = supabaseAdmin
      .from("google_connections")
      .update({
        last_user_notified_at: updateNow,
        last_user_notified_error_code: payload.errorCode,
        updated_at: updateNow,
      })
      .eq("user_id", payload.userId)
      .eq("reauth_required", true);

    const updateResult =
      connection.last_user_notified_at === null
        ? await updateQuery
            .is("last_user_notified_at", null)
            .select(NOTIFICATION_STATE_SELECT)
        : await updateQuery
            .eq("last_user_notified_at", connection.last_user_notified_at)
            .select(NOTIFICATION_STATE_SELECT);

    if (
      updateResult.error ||
      !Array.isArray(updateResult.data) ||
      updateResult.data.length !== 1 ||
      !isExpectedUpdatedConnection(updateResult.data[0], payload.userId)
    ) {
      logUserNotificationFailure("state_update_failed");
      return {
        sent: true,
        skipped: false,
        reason: "state_update_failed",
      };
    }
  } catch {
    logUserNotificationFailure("state_update_failed");
    return {
      sent: true,
      skipped: false,
      reason: "state_update_failed",
    };
  }

  return {
    sent: true,
    skipped: false,
  };
}
