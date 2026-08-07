import {
  RUN_CREATION_SELECT,
  RunCreationRepositoryError,
  createRunCreationRepository,
  type CreatedRun,
  type RunCreationInsertPayload,
  type RunCreationRepositoryErrorCode,
  type RunCreationSupabaseClient,
} from "@/lib/runs/runCreationRepositoryCore";

export const CRON_RUN_SELECT = RUN_CREATION_SELECT;

export type CronRunRepositoryErrorCode = RunCreationRepositoryErrorCode;

const SAFE_ERROR_MESSAGES: Readonly<
  Record<CronRunRepositoryErrorCode, string>
> = Object.freeze({
  RUN_STORE_INPUT_INVALID: "Cron run input is invalid",
  RUN_STORE_FAILED: "Cron run creation failed",
  RUN_STORE_RESULT_MISSING: "Created cron run was not returned",
  RUN_STORE_RESULT_DUPLICATE: "Cron run creation returned multiple rows",
  RUN_STORE_RESULT_MISMATCH: "Created cron run did not match its input",
});

export class CronRunRepositoryError extends Error {
  readonly code: CronRunRepositoryErrorCode;

  constructor(code: CronRunRepositoryErrorCode) {
    super(SAFE_ERROR_MESSAGES[code]);
    this.name = "CronRunRepositoryError";
    this.code = code;
  }
}

export type CronRunInsertPayload = RunCreationInsertPayload<"cron">;
export type CreatedCronRun = CreatedRun;
export type CronRunSupabaseClient = RunCreationSupabaseClient<"cron">;

export function createCronRunRepository(
  dependencies: Readonly<{
    getClient: () => CronRunSupabaseClient | Promise<CronRunSupabaseClient>;
    now: () => string;
  }>,
) {
  const repository = createRunCreationRepository({
    ...dependencies,
    trigger: "cron",
  });

  async function createCronRun(
    input: Parameters<typeof repository.createRun>[0],
  ): Promise<CreatedCronRun> {
    try {
      return await repository.createRun(input);
    } catch (error) {
      if (error instanceof RunCreationRepositoryError) {
        throw new CronRunRepositoryError(error.code);
      }
      throw new CronRunRepositoryError("RUN_STORE_FAILED");
    }
  }

  return Object.freeze({ createCronRun });
}
