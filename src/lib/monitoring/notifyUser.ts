import { supabaseAdmin } from "@/lib/supabase/admin";
import { sendEmail } from "@/lib/email/sendEmail";

type UserNotificationPayload = {
  userId: string;
  userEmail: string;
  ruleId: string;
  errorCode: "GOOGLE_TOKEN_INVALID" | "GOOGLE_PERMISSION_DENIED";
  message: string;
  trigger: "manual" | "cron";
  occurredAt: string;
};

type NotifyUserResult = {
  sent: boolean;
  skipped: boolean;
  reason?: "cooldown" | "not_found" | "disabled";
};

const COOLDOWN_HOURS = 24;

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

  if (fetchErr || !connection) {
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

  await sendEmail({
    to: payload.userEmail,
    subject: buildReconnectMailSubject(),
    text: buildReconnectMailText(),
  });

  const updateNow = now.toISOString();

  await supabaseAdmin
    .from("google_connections")
    .update({
      last_user_notified_at: updateNow,
      last_user_notified_error_code: payload.errorCode,
      updated_at: updateNow,
    })
    .eq("user_id", payload.userId);

  return {
    sent: true,
    skipped: false,
  };
}
