type SlackErrorNotification = {
  errorCode: string;
  message: string;
  userId: string;
  ruleId: string;
  trigger: "manual" | "cron";
  occurredAt: string;
};

function buildSlackText(payload: SlackErrorNotification): string {
  return [
    "🚨 AutoPDF Error",
    `error_code: ${payload.errorCode}`,
    `message: ${payload.message}`,
    `user_id: ${payload.userId}`,
    `rule_id: ${payload.ruleId}`,
    `trigger: ${payload.trigger}`,
    `occurred_at: ${payload.occurredAt}`,
  ].join("\n");
}

export async function notifySlack(
  payload: SlackErrorNotification,
): Promise<void> {
  const webhookUrl = process.env.SLACK_ERROR_WEBHOOK_URL?.trim();

  if (!webhookUrl) {
    throw new Error("SLACK_ERROR_WEBHOOK_URL is not set");
  }

  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      text: buildSlackText(payload),
    }),
    cache: "no-store",
  });

  if (!response.ok) {
    const bodyText = await response.text().catch(() => "");
    throw new Error(
      `Slack webhook failed: ${response.status} ${bodyText.slice(0, 200)}`,
    );
  }
}
