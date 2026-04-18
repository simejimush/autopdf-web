type SendEmailInput = {
  to: string;
  subject: string;
  text: string;
};

type ResendSendEmailResponse = {
  id?: string;
  message?: string;
};

export async function sendEmail(input: SendEmailInput): Promise<{ ok: true }> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.EMAIL_FROM?.trim();

  if (!apiKey) {
    throw new Error("RESEND_API_KEY is not set");
  }

  if (!from) {
    throw new Error("EMAIL_FROM is not set");
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [input.to],
      subject: input.subject,
      text: input.text,
    }),
    cache: "no-store",
  });

  if (!response.ok) {
    const body = (await response.text().catch(() => "")).slice(0, 300);
    throw new Error(`Resend send failed: ${response.status} ${body}`);
  }

  const data = (await response
    .json()
    .catch(() => ({}))) as ResendSendEmailResponse;

  if (!data || typeof data !== "object") {
    throw new Error("Resend send failed: invalid response");
  }

  return { ok: true };
}
