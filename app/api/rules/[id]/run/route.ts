import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { searchGmail, getGmailMessage } from "@/lib/google/gmail";
import { uploadPdfToDrive } from "@/lib/google/drive";
import { PDFDocument } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { readFile } from "node:fs/promises";
import path from "node:path";

export const runtime = "nodejs";

function ok(data: any, status = 200) {
  return NextResponse.json(data, { status });
}
function ng(step: string, err: unknown, status = 500) {
  const e =
    err instanceof Error
      ? { name: err.name, message: err.message, stack: err.stack }
      : { err };
  return ok({ ok: false, step, ...e }, status);
}

function isUuid(v: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    v ?? "",
  );
}

function sanitizeFilename(name: string) {
  return (
    name
      .replace(/[\\/:*?"<>|]/g, "_")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 120) || "email"
  );
}

function wrapLines(text: string, maxChars = 90) {
  const lines: string[] = [];
  for (const raw of (text ?? "").split("\n")) {
    let s = raw;
    while (s.length > maxChars) {
      lines.push(s.slice(0, maxChars));
      s = s.slice(maxChars);
    }
    lines.push(s);
  }
  return lines;
}

let _jpFontBytes: Uint8Array | null = null;

async function getJpFontBytes() {
  if (_jpFontBytes) return _jpFontBytes;
  const p = path.join(process.cwd(), "public", "fonts", "NotoSansJP-Regular.ttf");
  const buf = await readFile(p);
  _jpFontBytes = new Uint8Array(buf);
  return _jpFontBytes;
}

async function buildEmailPdf(params: {
  title: string;
  meta: Record<string, any>;
  body: string;
}) {
  const { title, meta, body } = params;

  const pdfDoc = await PDFDocument.create();
  pdfDoc.registerFontkit(fontkit);
  const fontBytes = await getJpFontBytes();
  const font = await pdfDoc.embedFont(fontBytes, { subset: true });

  const fontSize = 11;
  const lineHeight = 14;
  const margin = 50;

  let page = pdfDoc.addPage();
  let { height } = page.getSize();
  let y = height - margin;

  const drawLine = (line: string) => {
    if (y < margin) {
      page = pdfDoc.addPage();
      ({ height } = page.getSize());
      y = height - margin;
    }
    page.drawText(line, { x: margin, y, size: fontSize, font });
    y -= lineHeight;
  };

  drawLine(`Subject: ${title}`);
  drawLine("");

  for (const [k, v] of Object.entries(meta ?? {})) {
    drawLine(`${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`);
  }

  drawLine("");
  drawLine("----");
  drawLine("");

  const lines = wrapLines(body ?? "", 95);
  for (const l of lines) drawLine(l);

  const bytes = await pdfDoc.save();
  return bytes; // Uint8Array
}

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const startedAt = Date.now();
  const stepLog = (s: string, extra?: any) => {
    console.log(`[run] ${s}`, extra ?? "");
  };

  // runs更新用（catchでも参照する）
  let runId: string | null = null;

  try {
    // 0) Auth（未ログインは即終了）
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
      error: userErr,
    } = await supabase.auth.getUser();

    if (userErr || !user) {
      return ok({ ok: false, step: "00 auth", message: "Unauthorized" }, 401);
    }

    const { id } = await ctx.params;
    stepLog("00 params", { id, user_id: user.id });

    if (!isUuid(id)) {
      return ok(
        { ok: false, step: "00 params", message: "invalid rule id" },
        400,
      );
    }

    // 1) ルール取得（service roleで取ってOK。ただし所有者チェック必須）
    stepLog("10 fetch rule start");
    const { data: rule, error: ruleErr } = await supabaseAdmin
      .from("rules")
      .select("*")
      .eq("id", id)
      .single();

    if (ruleErr) return ng("10 fetch rule", ruleErr, 500);
    if (!rule) {
      return ok(
        { ok: false, step: "10 fetch rule", message: "rule not found" },
        404,
      );
    }

    // ★認可：自分の rule 以外は実行不可
    if (rule.user_id !== user.id) {
      return ok(
        { ok: false, step: "10 fetch rule", message: "Forbidden" },
        403,
      );
    }

    stepLog("11 fetch rule ok", {
      user_id: rule.user_id,
      gmail_query: rule.gmail_query,
    });

    // 2) runs を開始（rule取得直後）
    stepLog("12 insert run start");
    const { data: runRow, error: runInsertErr } = await supabaseAdmin
      .from("runs")
      .insert({
        user_id: rule.user_id,
        rule_id: rule.id,
        trigger: "manual",
        status: "running",
        message: "started",
        started_at: new Date().toISOString(),
      })
      .select("id")
      .single();

    if (runInsertErr) return ng("12 insert run", runInsertErr, 500);
    runId = (runRow as any)?.id ?? null;
    stepLog("13 insert run ok", { runId });

    // 3) google_connections 取得（接続チェック用途）
    stepLog("20 fetch google_connections start");
    const { data: conn, error: connErr } = await supabaseAdmin
      .from("google_connections")
      .select("*")
      .eq("user_id", rule.user_id)
      .single();

    if (connErr) return ng("20 fetch google_connections", connErr, 500);
    if (!conn) {
      return ok(
        {
          ok: false,
          step: "20 fetch google_connections",
          message: "google_connections not found",
        },
        400,
      );
    }

    stepLog("21 fetch google_connections ok", {
      has_refresh: !!(conn as any).refresh_token_enc,
      has_access: !!(conn as any).access_token_enc,
    });

    // 4) Gmail検索
    const query = (rule.gmail_query ?? "").trim();
    stepLog("30 searchGmail start", { query });

    const ids = await searchGmail({
      userId: rule.user_id,
      query,
      maxResults: 5,
    });

    stepLog("31 searchGmail ok", { count: ids.length });

    if (ids.length === 0) {
      // runs success 更新（0件でも成功）
      try {
        if (runId) {
          await supabaseAdmin
            .from("runs")
            .update({
              status: "success",
              message: "processed=0 skipped=0 saved=0",
              processed_count: 0,
              saved_count: 0,
              finished_at: new Date().toISOString(),
            })
            .eq("id", runId)
            .eq("user_id", user.id); // 念のため
        }
      } catch (e) {
        console.error("[run] failed to update runs(success/0)", e);
      }

      return ok({
        ok: true,
        step: "31 searchGmail ok",
        count: 0,
        summary: "processed=0 skipped=0 saved=0",
        saved_count: 0,
        drive_file_ids: [],
        processed_subjects: [],
        elapsed_ms: Date.now() - startedAt,
      });
    }

    // 5) 重複判定ループ（ids を全件処理）
    stepLog("35 dedup loop start", { ids_count: ids.length });

    let processed = 0;
    let skipped = 0;
    let saved = 0;

    const processed_subjects: string[] = [];
    const drive_file_ids: string[] = [];

    // 保存先フォルダ（rules側に入ってる想定）
    const folderId = (rule.drive_folder_id ?? "").trim();
    if (!folderId) throw new Error("drive_folder_id is empty on rules");

    for (const gmailMessageId of ids) {
      // まずは重複防止用に insert（新規だけ進む）
      const { data: peRow, error: insertErr } = await supabaseAdmin
        .from("processed_emails")
        .insert({
          user_id: rule.user_id,
          rule_id: rule.id,
          gmail_message_id: gmailMessageId,
        })
        .select("id")
        .single();

      if (insertErr) {
        if ((insertErr as any)?.code === "23505") {
          skipped++;
          continue;
        }
        console.error("[run] processed_emails insert unexpected error:", {
          gmail_message_id: gmailMessageId,
          code: (insertErr as any)?.code,
          message: (insertErr as any)?.message,
        });
        throw insertErr;
      }

      // 新規だけここに来る
      const msg: any = await getGmailMessage({
        userId: rule.user_id,
        messageId: gmailMessageId,
      });

      const subject = msg.subject ?? "";
      processed_subjects.push(subject);

      const bodyText =
        msg.body ?? msg.text ?? msg.snippet ?? JSON.stringify(msg, null, 2);

      const pdfBytes = await buildEmailPdf({
        title: subject || "(no subject)",
        meta: {
          gmail_message_id: gmailMessageId,
          from: msg.from ?? "",
          to: msg.to ?? "",
          date: msg.date ?? "",
        },
        body: bodyText,
      });

      const safeSubject = sanitizeFilename(subject || "email");
      const fileName = `${gmailMessageId}_${safeSubject}.pdf`;

      // Drive保存
      const uploaded: any = await uploadPdfToDrive({
        userId: rule.user_id,
        folderId,
        filename: fileName,
        pdfBytes,
      });

      if (uploaded?.fileId) {
        drive_file_ids.push(uploaded.fileId);

        // processed_emails に drive_file_id を保存
        if (peRow?.id) {
          const { error: updErr } = await supabaseAdmin
            .from("processed_emails")
            .update({ drive_file_id: uploaded.fileId })
            .eq("id", peRow.id)
            .eq("user_id", user.id); // 念のため

          if (updErr) {
            console.error("[run] drive_file_id update error:", {
              id: peRow.id,
              drive_file_id: uploaded.fileId,
              code: (updErr as any)?.code,
              message: (updErr as any)?.message,
            });
          }
        }
      }

      saved++;
      processed++;
    }

    stepLog("36 dedup loop ok", { processed, skipped, saved });

    // runs success 更新（通常）
    try {
      if (runId) {
        await supabaseAdmin
          .from("runs")
          .update({
            status: "success",
            message: `processed=${processed} skipped=${skipped} saved=${saved}`,
            processed_count: processed,
            saved_count: saved,
            finished_at: new Date().toISOString(),
          })
          .eq("id", runId)
          .eq("user_id", user.id); // 念のため
      }
    } catch (e) {
      console.error("[run] failed to update runs(success)", e);
    }

    return ok({
      ok: true,
      step: "36 dedup loop ok",
      count: ids.length,
      summary: `processed=${processed} skipped=${skipped} saved=${saved}`,
      saved_count: saved,
      drive_file_ids,
      processed_subjects,
      elapsed_ms: Date.now() - startedAt,
    });
  } catch (e) {
    // runs error 更新
    try {
      if (runId) {
        await supabaseAdmin
          .from("runs")
          .update({
            status: "error",
            message: e instanceof Error ? e.message : "unknown error",
            error_code: (e as any)?.code ?? null,
            finished_at: new Date().toISOString(),
          })
          .eq("id", runId);
      }
    } catch (e2) {
      console.error("[run] failed to update runs(error)", e2);
    }

    return ng("99 catch", e, 500);
  }
}
