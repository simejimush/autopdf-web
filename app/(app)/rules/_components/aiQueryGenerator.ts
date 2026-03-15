export type AiQueryGenerateResult = {
  query: string;
};

function cleanupInput(input: string) {
  return input
    .trim()
    .replace(/\r\n/g, "\n")
    .replace(/\u3000/g, " ")
    .replace(/[ \t]+/g, " ");
}

function normalizeSpaces(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function uniq(parts: string[]) {
  return Array.from(new Set(parts.filter(Boolean)));
}

function hasAny(text: string, words: string[]) {
  return words.some((word) => text.includes(word));
}

function pushIf(parts: string[], condition: boolean, value: string) {
  if (condition) parts.push(value);
}

function formatDateForGmail(date: Date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}/${m}/${d}`;
}

function addDays(base: Date, days: number) {
  const next = new Date(base);
  next.setDate(next.getDate() + days);
  return next;
}

function startOfMonth(base: Date) {
  return new Date(base.getFullYear(), base.getMonth(), 1);
}

function startOfNextMonth(base: Date) {
  return new Date(base.getFullYear(), base.getMonth() + 1, 1);
}

function startOfPrevMonth(base: Date) {
  return new Date(base.getFullYear(), base.getMonth() - 1, 1);
}

function extractQuotedKeyword(input: string) {
  const match =
    input.match(/["「](.+?)["」]/) ||
    input.match(/『(.+?)』/) ||
    input.match(/“(.+?)”/);
  return match?.[1]?.trim() ?? "";
}

type SenderAlias = {
  aliases: string[];
  value: string;
  strong?: boolean;
};

const senderAliasMap: SenderAlias[] = [
  { aliases: ["Amazon", "amazon", "アマゾン"], value: "amazon", strong: true },
  { aliases: ["Stripe", "stripe"], value: "stripe", strong: true },
  { aliases: ["PayPal", "paypal", "ペイパル"], value: "paypal", strong: true },
  { aliases: ["BASE", "base"], value: "base", strong: true },
  { aliases: ["STORES", "stores"], value: "stores", strong: true },
  { aliases: ["楽天", "rakuten"], value: "rakuten", strong: true },
  { aliases: ["Yahoo", "yahoo", "ヤフー"], value: "yahoo", strong: true },
  { aliases: ["メルカリ", "mercari"], value: "mercari", strong: true },

  // 汎用プロバイダ系は weak 扱い
  {
    aliases: ["Google", "google", "Gmail", "gmail"],
    value: "google",
    strong: false,
  },
  {
    aliases: ["Outlook", "outlook", "Microsoft", "microsoft"],
    value: "outlook",
    strong: false,
  },
  { aliases: ["Yahoo Mail", "Yahooメール"], value: "yahoo", strong: false },
];

const weakSenderWords = new Set([
  "google",
  "gmail",
  "outlook",
  "microsoft",
  "mail",
  "email",
  "メール",
  "noreply",
  "no-reply",
  "info",
  "support",
  "admin",
  "notification",
  "notifications",
]);

function cleanSenderToken(raw: string) {
  return raw
    .trim()
    .replace(/^["'「『（(]+/, "")
    .replace(/["'」』）)、。,．:\s]+$/, "");
}

function normalizeSenderValue(raw: string): string | null {
  const cleaned = cleanSenderToken(raw);
  if (!cleaned) return null;

  for (const item of senderAliasMap) {
    if (
      item.aliases.some(
        (alias) => cleaned.toLowerCase() === alias.toLowerCase(),
      )
    ) {
      if (item.strong === false) return null;
      return item.value;
    }
  }

  const lower = cleaned.toLowerCase();
  if (weakSenderWords.has(lower)) return null;

  if (/^[a-z0-9._-]{2,40}$/i.test(cleaned)) {
    return lower;
  }

  return null;
}

function extractSenderCandidate(text: string): string | null {
  const patterns = [
    /差出人[は:：\s]*([A-Za-z0-9._-]+|[^\s、。]{2,20})/,
    /差出人が([A-Za-z0-9._-]+|[^\s、。]{2,20})/,
    /from[は:：\s]*([A-Za-z0-9._-]+|[^\s、。]{2,20})/i,
    /([A-Za-z0-9._-]+|[^\s、。]{2,20})から届いた/,
    /([A-Za-z0-9._-]+|[^\s、。]{2,20})のメール/,
    /([A-Za-z0-9._-]+|[^\s、。]{2,20})からのメール/,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    const candidate = match?.[1];
    const normalized = candidate ? normalizeSenderValue(candidate) : null;
    if (normalized) return normalized;
  }

  for (const item of senderAliasMap) {
    if (!item.strong) continue;
    if (
      item.aliases.some((alias) =>
        text.toLowerCase().includes(alias.toLowerCase()),
      )
    ) {
      return item.value;
    }
  }

  return null;
}

function buildSenderQuery(normalizedText: string) {
  const senderValue = extractSenderCandidate(normalizedText);
  return senderValue ? `from:${senderValue}` : "";
}

function buildSubjectQuery(normalizedText: string) {
  const explicitKeyword = extractQuotedKeyword(normalizedText);
  if (explicitKeyword) {
    return `subject:(${explicitKeyword})`;
  }

  if (hasAny(normalizedText, ["注文確認", "注文確認メール"])) {
    return "subject:(注文確認)";
  }

  if (hasAny(normalizedText, ["利用明細", "ご利用明細"])) {
    return "subject:(利用明細)";
  }

  if (hasAny(normalizedText, ["支払い明細", "支払明細", "お支払い明細"])) {
    return "subject:(支払い明細)";
  }

  if (hasAny(normalizedText, ["契約書", "契約"])) {
    return "subject:(契約書)";
  }

  if (hasAny(normalizedText, ["返金", "返金明細", "払い戻し"])) {
    return "subject:(返金)";
  }

  if (hasAny(normalizedText, ["申込書", "申込", "申し込み"])) {
    return "subject:(申込書)";
  }

  if (hasAny(normalizedText, ["請求書", "請求"])) return "subject:(請求書)";
  if (hasAny(normalizedText, ["領収書", "領収"])) return "subject:(領収書)";
  if (hasAny(normalizedText, ["見積書", "見積"])) return "subject:(見積)";
  if (hasAny(normalizedText, ["納品書", "納品"])) return "subject:(納品書)";
  if (hasAny(normalizedText, ["注文書", "注文"])) return "subject:(注文書)";
  if (hasAny(normalizedText, ["発注書", "発注"])) return "subject:(発注書)";

  return "";
}

function buildAttachmentQuery(normalizedText: string) {
  const parts: string[] = [];
  const lowerText = normalizedText.toLowerCase();

  const isPdf =
    /\bpdf\b/i.test(normalizedText) ||
    normalizedText.includes("ＰＤＦ") ||
    lowerText.includes("pdfファイル") ||
    lowerText.includes("pdf添付") ||
    lowerText.includes("pdfメール");

  const isCsv =
    /\bcsv\b/i.test(normalizedText) ||
    normalizedText.includes("ＣＳＶ") ||
    lowerText.includes("csvファイル") ||
    lowerText.includes("csv添付") ||
    lowerText.includes("csvメール") ||
    hasAny(normalizedText, ["csv明細", "CSV明細", "csvの明細", "CSVの明細"]);

  const hasAttachmentIntent =
    hasAny(normalizedText, [
      "添付",
      "添付ファイル",
      "ファイル付き",
      "添付あり",
      "ファイルあり",
    ]) ||
    lowerText.includes("ファイル") ||
    isPdf ||
    isCsv;

  pushIf(parts, hasAttachmentIntent, "has:attachment");
  pushIf(parts, isPdf, "filename:pdf");
  pushIf(parts, isCsv, "filename:csv");

  return uniq(parts).join(" ");
}

function buildStatusQuery(normalizedText: string) {
  const parts: string[] = [];

  pushIf(parts, hasAny(normalizedText, ["未読"]), "is:unread");
  pushIf(parts, hasAny(normalizedText, ["既読"]), "is:read");
  pushIf(parts, hasAny(normalizedText, ["スター付き", "スター"]), "is:starred");

  return uniq(parts).join(" ");
}

function buildDateQuery(normalizedText: string) {
  const now = new Date();

  if (hasAny(normalizedText, ["今日だけ", "本日だけ"])) {
    const start = formatDateForGmail(now);
    const end = formatDateForGmail(addDays(now, 1));
    return `after:${start} before:${end}`;
  }

  if (hasAny(normalizedText, ["昨日だけ"])) {
    const yesterday = addDays(now, -1);
    const start = formatDateForGmail(yesterday);
    const end = formatDateForGmail(now);
    return `after:${start} before:${end}`;
  }

  if (hasAny(normalizedText, ["今月"])) {
    const start = formatDateForGmail(startOfMonth(now));
    const end = formatDateForGmail(startOfNextMonth(now));
    return `after:${start} before:${end}`;
  }

  if (hasAny(normalizedText, ["先月"])) {
    const start = formatDateForGmail(startOfPrevMonth(now));
    const end = formatDateForGmail(startOfMonth(now));
    return `after:${start} before:${end}`;
  }

  if (hasAny(normalizedText, ["3か月以内", "3ヶ月以内", "90日以内"])) {
    return "newer_than:90d";
  }

  if (hasAny(normalizedText, ["2週間以内", "14日以内"])) {
    return "newer_than:14d";
  }

  if (hasAny(normalizedText, ["今日", "本日"])) return "newer_than:1d";
  if (hasAny(normalizedText, ["昨日"])) return "newer_than:2d";
  if (hasAny(normalizedText, ["直近3日", "3日以内"])) return "newer_than:3d";
  if (hasAny(normalizedText, ["直近7日", "7日以内", "1週間以内"])) {
    return "newer_than:7d";
  }
  if (
    hasAny(normalizedText, ["直近30日", "30日以内", "1か月以内", "1ヶ月以内"])
  ) {
    return "newer_than:30d";
  }

  return "";
}

function buildExcludeQuery(normalizedText: string) {
  const parts: string[] = [];

  const hasExcludeIntent = hasAny(normalizedText, [
    "除く",
    "除外",
    "含めない",
    "いらない",
    "不要",
  ]);

  if (!hasExcludeIntent) {
    return "";
  }

  pushIf(parts, hasAny(normalizedText, ["広告"]), "-subject:(広告)");

  pushIf(
    parts,
    hasAny(normalizedText, ["メルマガ", "メールマガジン"]),
    "-subject:(メルマガ)",
  );

  pushIf(parts, hasAny(normalizedText, ["販促"]), "-subject:(販促)");

  pushIf(
    parts,
    hasAny(normalizedText, ["プロモーション", "promotion", "promo"]),
    "category:primary",
  );

  pushIf(parts, hasAny(normalizedText, ["通知"]), "-subject:(通知)");

  return uniq(parts).join(" ");
}

export function generateAiQuery(input: string): AiQueryGenerateResult {
  const cleaned = cleanupInput(input);

  if (!cleaned) {
    return { query: "" };
  }

  const normalizedText = normalizeSpaces(cleaned);

  const senderQuery = buildSenderQuery(normalizedText);
  const subjectQuery = buildSubjectQuery(normalizedText);
  const attachmentQuery = buildAttachmentQuery(normalizedText);
  const statusQuery = buildStatusQuery(normalizedText);
  const dateQuery = buildDateQuery(normalizedText);
  const excludeQuery = buildExcludeQuery(normalizedText);

  const query = uniq([
    senderQuery,
    subjectQuery,
    attachmentQuery,
    statusQuery,
    dateQuery,
    excludeQuery,
  ]).join(" ");

  return {
    query: query.trim(),
  };
}
