import { NextResponse } from "next/server";

import { refreshGoogleCredentialsForCanary } from "@/lib/google/auth";
import { evaluateGoogleRefreshCanaryGate } from "@/lib/google/refreshCanaryCore";
import { GoogleTokenStoreError } from "@/lib/google/tokenStoreCore";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = Object.freeze({ "Cache-Control": "no-store" });

function jsonError(errorCode: string, status: number) {
  return NextResponse.json(
    { ok: false, error_code: errorCode },
    { status, headers: NO_STORE_HEADERS },
  );
}

export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) {
    return jsonError("AUTH_REQUIRED", 401);
  }

  const gate = evaluateGoogleRefreshCanaryGate({
    vercelEnv: process.env.VERCEL_ENV,
    enabled: process.env.GOOGLE_REFRESH_CANARY_ENABLED,
    allowedHost: process.env.GOOGLE_REFRESH_CANARY_ALLOWED_HOST,
    requestHost: new URL(request.url).hostname,
  });
  if (!gate.ok) {
    const status =
      gate.errorCode === "PREVIEW_ONLY" ||
      gate.errorCode === "CANARY_HOST_FORBIDDEN"
        ? 404
        : 503;
    return jsonError(gate.errorCode, status);
  }

  try {
    const result = await refreshGoogleCredentialsForCanary(user.id);
    console.info("[google.refresh-canary.audit]", {
      event: "google_refresh_canary_completed",
      operation_id: result.operationId,
      previous_credential_version: result.previousCredentialVersion,
      result_credential_version: result.resultCredentialVersion,
      refresh_token_handling: result.refreshTokenRotated
        ? "rotated"
        : "preserved",
    });
    return NextResponse.json(
      { ok: true, state: "completed", ...result },
      { status: 200, headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    if (error instanceof GoogleTokenStoreError) {
      if (error.code === "GOOGLE_TOKEN_REFRESH_IN_PROGRESS") {
        return jsonError("REFRESH_IN_PROGRESS", 409);
      }
      if (error.code === "GOOGLE_REFRESH_OUTCOME_UNKNOWN") {
        return jsonError("REFRESH_OUTCOME_UNKNOWN", 409);
      }
      if (
        error.code === "GOOGLE_TOKEN_ROW_NOT_FOUND" ||
        error.code === "GOOGLE_TOKEN_ROW_DUPLICATE" ||
        error.code === "GOOGLE_REFRESH_CANARY_NOT_ELIGIBLE"
      ) {
        return jsonError("CANARY_NOT_ELIGIBLE", 409);
      }
    }

    return jsonError("REFRESH_CANARY_FAILED", 500);
  }
}
