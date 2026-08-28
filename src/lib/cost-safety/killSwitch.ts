import "server-only";

export const EXECUTION_DISABLED_ENV_NAME = "AUTOPDF_EXECUTION_DISABLED";

export function parseExecutionDisabled(value: unknown): boolean {
  return value !== "false";
}

export function readExecutionDisabledFromEnv(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return parseExecutionDisabled(environment[EXECUTION_DISABLED_ENV_NAME]);
}
