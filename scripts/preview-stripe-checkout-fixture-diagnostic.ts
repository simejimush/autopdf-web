// @ts-expect-error Node's built-in TypeScript runner requires the explicit suffix.
import * as FixtureContract from "./preview-stripe-checkout-fixture-contract.ts";

const { evaluatePreviewCheckoutFixtureObservation, unknownFixtureObservation } =
  FixtureContract;
type PreviewCheckoutFixtureObservation =
  FixtureContract.PreviewCheckoutFixtureObservation;
type PreviewCheckoutFixtureDiagnosticErrorCode =
  FixtureContract.PreviewCheckoutFixtureDiagnosticErrorCode;
type PreviewCheckoutFixtureDiagnosticReport =
  FixtureContract.PreviewCheckoutFixtureDiagnosticReport;

const EXECUTE_APPROVAL = "APPROVED_PREVIEW_FIXTURE_READ_DIAGNOSTIC";

export const PREVIEW_FIXTURE_DIAGNOSTIC_ENV_NAMES = Object.freeze({
  execute: "AUTOPDF_PREVIEW_HARNESS_FIXTURE_DIAGNOSTIC_EXECUTE",
} as const);

type HarnessEnvironment = Readonly<Record<string, string | undefined>>;

export type PreviewCheckoutFixtureDiagnosticDependencies = Readonly<{
  inspect(input: {
    environment: HarnessEnvironment;
  }): Promise<PreviewCheckoutFixtureObservation>;
}>;

export class PreviewCheckoutFixtureDiagnosticError extends Error {
  constructor(
    readonly code:
      | "FIXTURE_DIAGNOSTIC_PREFLIGHT_FAILED"
      | "FIXTURE_DIAGNOSTIC_DB_READ_FAILED"
      | "FIXTURE_DIAGNOSTIC_STRIPE_READ_FAILED",
  ) {
    super(code);
    this.name = "PreviewCheckoutFixtureDiagnosticError";
  }
}

function blockedUnknownReport(
  errorCode: PreviewCheckoutFixtureDiagnosticErrorCode,
): PreviewCheckoutFixtureDiagnosticReport {
  return Object.freeze({
    ...evaluatePreviewCheckoutFixtureObservation(unknownFixtureObservation()),
    verdict: "BLOCKED",
    error_code: errorCode,
  });
}

export async function executePreviewCheckoutFixtureDiagnostic(input: {
  environment: HarnessEnvironment;
  argv: readonly string[];
  dependencies: PreviewCheckoutFixtureDiagnosticDependencies;
}): Promise<PreviewCheckoutFixtureDiagnosticReport> {
  if (
    input.argv.length !== 0 ||
    input.environment[PREVIEW_FIXTURE_DIAGNOSTIC_ENV_NAMES.execute] !==
      EXECUTE_APPROVAL
  ) {
    return blockedUnknownReport("FIXTURE_DIAGNOSTIC_PREFLIGHT_FAILED");
  }

  try {
    const observation = await input.dependencies.inspect({
      environment: input.environment,
    });
    return evaluatePreviewCheckoutFixtureObservation(observation);
  } catch (error) {
    return blockedUnknownReport(
      error instanceof PreviewCheckoutFixtureDiagnosticError
        ? error.code
        : "FIXTURE_DIAGNOSTIC_INTERNAL_FAILED",
    );
  }
}

export async function runPreviewCheckoutFixtureDiagnosticCli(input: {
  environment: HarnessEnvironment;
  argv: readonly string[];
  dependencies: PreviewCheckoutFixtureDiagnosticDependencies;
  stdout: Pick<NodeJS.WriteStream, "write">;
}) {
  const report = await executePreviewCheckoutFixtureDiagnostic(input);
  input.stdout.write(`${JSON.stringify(report)}\n`);
  return report.verdict === "READY" ? 0 : 1;
}
