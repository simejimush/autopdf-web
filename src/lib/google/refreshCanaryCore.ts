export type GoogleRefreshCanaryGateResult =
  | Readonly<{ ok: true }>
  | Readonly<{
      ok: false;
      errorCode:
        | "PREVIEW_ONLY"
        | "CANARY_DISABLED"
        | "CANARY_HOST_NOT_CONFIGURED"
        | "CANARY_HOST_FORBIDDEN";
    }>;

const SAFE_HOST_PATTERN =
  /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

function normalizeConfiguredHost(value: string | undefined): string | null {
  const host = value?.trim().toLowerCase() ?? "";
  return SAFE_HOST_PATTERN.test(host) ? host : null;
}

export function evaluateGoogleRefreshCanaryGate(
  input: Readonly<{
    vercelEnv: string | undefined;
    enabled: string | undefined;
    allowedHost: string | undefined;
    requestHost: string;
  }>,
): GoogleRefreshCanaryGateResult {
  if (input.vercelEnv !== "preview") {
    return { ok: false, errorCode: "PREVIEW_ONLY" };
  }
  if (input.enabled !== "true") {
    return { ok: false, errorCode: "CANARY_DISABLED" };
  }

  const allowedHost = normalizeConfiguredHost(input.allowedHost);
  if (!allowedHost) {
    return { ok: false, errorCode: "CANARY_HOST_NOT_CONFIGURED" };
  }
  if (input.requestHost.toLowerCase() !== allowedHost) {
    return { ok: false, errorCode: "CANARY_HOST_FORBIDDEN" };
  }

  return { ok: true };
}
