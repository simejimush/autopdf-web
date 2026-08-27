// @ts-expect-error Node's built-in TypeScript runner requires the explicit suffix.
import { createRealPreviewCheckoutFixtureDiagnosticDependencies } from "./preview-stripe-checkout-fixture-diagnostic-dependencies.ts";
// @ts-expect-error Node's built-in TypeScript runner requires the explicit suffix.
import { runPreviewCheckoutFixtureDiagnosticCli } from "./preview-stripe-checkout-fixture-diagnostic.ts";

process.exitCode = await runPreviewCheckoutFixtureDiagnosticCli({
  environment: process.env,
  argv: process.argv.slice(2),
  dependencies: createRealPreviewCheckoutFixtureDiagnosticDependencies(),
  stdout: process.stdout,
});
