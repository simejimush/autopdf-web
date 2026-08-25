// @ts-expect-error Node's built-in TypeScript runner requires the explicit suffix.
import { createRealPreviewCheckoutRuntimeDependencies } from "./preview-stripe-checkout-runtime-dependencies.ts";
// @ts-expect-error Node's built-in TypeScript runner requires the explicit suffix.
import { runPreviewCheckoutConcurrencyRuntimeCli } from "./preview-stripe-checkout-runtime.ts";

async function main() {
  process.exitCode = await runPreviewCheckoutConcurrencyRuntimeCli({
    environment: process.env,
    argv: process.argv.slice(2),
    dependencies: createRealPreviewCheckoutRuntimeDependencies(),
    stdout: process.stdout,
    stderr: process.stderr,
  });
}

void main();
