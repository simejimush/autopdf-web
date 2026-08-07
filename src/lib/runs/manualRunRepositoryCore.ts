import {
  RUN_CREATION_SELECT,
  RunCreationRepositoryError,
  createRunCreationRepository,
  type CreatedRun,
  type RunCreationInsertPayload,
  type RunCreationRepositoryErrorCode,
  type RunCreationSupabaseClient,
} from "@/lib/runs/runCreationRepositoryCore";

export const MANUAL_RUN_SELECT = RUN_CREATION_SELECT;

export type ManualRunRepositoryErrorCode = RunCreationRepositoryErrorCode;

const SAFE_ERROR_MESSAGES: Readonly<
  Record<ManualRunRepositoryErrorCode, string>
> = Object.freeze({
  RUN_STORE_INPUT_INVALID: "Manual run input is invalid",
  RUN_STORE_FAILED: "Manual run creation failed",
  RUN_STORE_RESULT_MISSING: "Created manual run was not returned",
  RUN_STORE_RESULT_DUPLICATE: "Manual run creation returned multiple rows",
  RUN_STORE_RESULT_MISMATCH: "Created manual run did not match its input",
});

export class ManualRunRepositoryError extends Error {
  readonly code: ManualRunRepositoryErrorCode;

  constructor(code: ManualRunRepositoryErrorCode) {
    super(SAFE_ERROR_MESSAGES[code]);
    this.name = "ManualRunRepositoryError";
    this.code = code;
  }
}

export type ManualRunInsertPayload = RunCreationInsertPayload<"manual">;
export type CreatedManualRun = CreatedRun;
export type ManualRunSupabaseClient = RunCreationSupabaseClient<"manual">;

export function createManualRunRepository(
  dependencies: Readonly<{
    getClient: () => ManualRunSupabaseClient | Promise<ManualRunSupabaseClient>;
    now: () => string;
  }>,
) {
  const repository = createRunCreationRepository({
    ...dependencies,
    trigger: "manual",
  });

  async function createManualRun(
    input: Parameters<typeof repository.createRun>[0],
  ): Promise<CreatedManualRun> {
    try {
      return await repository.createRun(input);
    } catch (error) {
      if (error instanceof RunCreationRepositoryError) {
        throw new ManualRunRepositoryError(error.code);
      }
      throw new ManualRunRepositoryError("RUN_STORE_FAILED");
    }
  }

  return Object.freeze({ createManualRun });
}
