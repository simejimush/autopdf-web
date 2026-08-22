// @ts-expect-error Node's built-in TypeScript runner requires the explicit suffix.
import { OperatorError, runOperator } from "./preview-stripe-webhook-smoke.ts";

async function main() {
  try {
    const result = await runOperator(process.env, process.argv.slice(2));
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    const code =
      error instanceof OperatorError ? error.code : "OPERATOR_UNEXPECTED_ERROR";
    process.stderr.write(
      `${JSON.stringify({ ok: false, error_code: code })}\n`,
    );
    process.exitCode = 1;
  }
}

void main();
