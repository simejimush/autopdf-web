// @ts-expect-error Node's built-in TypeScript runner requires the explicit suffix.
import { runPreviewSupabaseIdentityPreflightCli } from "./preview-supabase-identity-preflight.ts";

async function main() {
  process.exitCode = await runPreviewSupabaseIdentityPreflightCli({
    environment: process.env,
    argv: process.argv.slice(2),
    stdout: process.stdout,
    stderr: process.stderr,
  });
}

void main();
