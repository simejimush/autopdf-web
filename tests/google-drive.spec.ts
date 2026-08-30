import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Readable } from "node:stream";
import { runInNewContext } from "node:vm";
import { expect, test } from "@playwright/test";
import ts from "typescript";

const DRIVE_PATH = resolve(process.cwd(), "src/lib/google/drive.ts");

type DriveRequest = {
  requestBody: {
    name: string;
    parents: string[];
    mimeType: string;
  };
  media: {
    mimeType: string;
    body: Readable;
  };
  fields: string;
};

function loadDrive(options?: {
  existing?: boolean;
  authError?: unknown;
  createError?: unknown;
}) {
  const source = readFileSync(DRIVE_PATH, "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: DRIVE_PATH,
  }).outputText;
  const calls = {
    auth: 0,
    drive: 0,
    list: 0,
    listOptions: [] as unknown[],
    create: [] as DriveRequest[],
    createOptions: [] as unknown[],
    uploadedBytes: [] as Buffer[],
    info: [] as unknown[][],
  };
  const driveClient = {
    files: {
      async list(...args: unknown[]) {
        calls.list += 1;
        calls.listOptions.push(args[1]);
        return {
          data: {
            files: options?.existing
              ? [{ id: "existing-file", webViewLink: null }]
              : [],
          },
        };
      },
      async create(request: DriveRequest, requestOptions?: unknown) {
        calls.create.push(request);
        calls.createOptions.push(requestOptions);
        if (options?.createError) throw options.createError;

        const chunks: Buffer[] = [];
        for await (const chunk of request.media.body) {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        }
        calls.uploadedBytes.push(Buffer.concat(chunks));

        return {
          data: { id: "created-file", webViewLink: "https://safe.invalid" },
        };
      },
    },
  };
  const loadedModule = {
    exports: {} as {
      uploadFileToDrive: (input: {
        userId: string;
        folderId: string;
        filename: string;
        bytes: Uint8Array | Buffer;
        mimeType: string;
      }) => Promise<{ fileId: string; webViewLink: string | null }>;
      uploadPdfToDrive: (input: {
        userId: string;
        folderId: string;
        filename: string;
        pdfBytes: Uint8Array;
        budget?: { getTimeoutMs: () => number | null };
      }) => Promise<{ fileId: string; webViewLink: string | null }>;
    },
  };

  const localRequire = (specifier: string) => {
    if (specifier === "googleapis") {
      return {
        google: {
          drive() {
            calls.drive += 1;
            return driveClient;
          },
        },
      };
    }
    if (specifier === "./auth") {
      return {
        async getOAuthClientForUser() {
          calls.auth += 1;
          if (options?.authError) throw options.authError;
          return { kind: "oauth-client" };
        },
      };
    }
    if (specifier === "node:stream") return { Readable };
    throw new Error(`Unexpected Drive dependency: ${specifier}`);
  };

  runInNewContext(compiled, {
    exports: loadedModule.exports,
    module: loadedModule,
    require: localRequire,
    console: {
      info(...args: unknown[]) {
        calls.info.push(args);
      },
    },
    Buffer,
    Error,
    Set,
  });

  return { ...loadedModule.exports, calls };
}

test("uploads Uint8Array and Buffer without mutation using one OAuth client", async () => {
  for (const inputBytes of [
    new Uint8Array([1, 2, 3]),
    Buffer.from([4, 5, 6]),
  ]) {
    const original = Buffer.from(inputBytes);
    const harness = loadDrive();

    await harness.uploadFileToDrive({
      userId: "user-id",
      folderId: "private-folder-marker",
      filename: "private-filename-marker.pdf",
      bytes: inputBytes,
      mimeType: "application/pdf",
    });

    expect(harness.calls.auth).toBe(1);
    expect(harness.calls.drive).toBe(1);
    expect(harness.calls.list).toBe(1);
    expect(harness.calls.create).toHaveLength(1);
    expect(harness.calls.create[0].requestBody.parents).toEqual([
      "private-folder-marker",
    ]);
    expect(harness.calls.create[0].requestBody.mimeType).toBe(
      "application/pdf",
    );
    expect(harness.calls.create[0].media.mimeType).toBe("application/pdf");
    expect(harness.calls.create[0].media.body).toBeInstanceOf(Readable);
    expect(harness.calls.uploadedBytes[0]).toEqual(original);
    expect(Buffer.from(inputBytes)).toEqual(original);
  }
});

test("uploadPdfToDrive fixes the PDF media contract", async () => {
  const harness = loadDrive();

  await harness.uploadPdfToDrive({
    userId: "user-id",
    folderId: "private-folder-marker",
    filename: "private-filename-marker.pdf",
    pdfBytes: new Uint8Array([7, 8, 9]),
  });

  expect(harness.calls.create[0].requestBody.mimeType).toBe("application/pdf");
  expect(harness.calls.create[0].media.mimeType).toBe("application/pdf");
  expect(harness.calls.create[0].requestBody.parents).toHaveLength(1);
});

test("uses bounded lookup retry and never retries Drive create", async () => {
  const harness = loadDrive();
  const budget = { getTimeoutMs: () => 12_345 };

  await harness.uploadPdfToDrive({
    userId: "user-id",
    folderId: "private-folder-marker",
    filename: "private-filename-marker.pdf",
    pdfBytes: new Uint8Array([7, 8, 9]),
    budget,
  });

  expect(harness.calls.listOptions).toEqual([
    {
      timeout: 12_345,
      retry: true,
      retryConfig: { retry: 1, noResponseRetries: 1, totalTimeout: 12_345 },
    },
  ]);
  expect(harness.calls.createOptions).toEqual([
    {
      timeout: 12_345,
      retry: false,
      retryConfig: { retry: 0, noResponseRetries: 0, totalTimeout: 12_345 },
    },
  ]);
  expect(harness.calls.create).toHaveLength(1);
});

test("an existing file skips create and records only safe booleans", async () => {
  const harness = loadDrive({ existing: true });

  const result = await harness.uploadPdfToDrive({
    userId: "user-id",
    folderId: "private-folder-marker",
    filename: "private-filename-marker.pdf",
    pdfBytes: new Uint8Array([1]),
  });

  expect(result.fileId).toBe("existing-file");
  expect(harness.calls.auth).toBe(1);
  expect(harness.calls.list).toBe(1);
  expect(harness.calls.create).toHaveLength(0);
  expect(harness.calls.info).toContainEqual([
    "[drive] upload stage",
    { stage: "drive_lookup_complete", existingMatch: true },
  ]);
  expect(JSON.stringify(harness.calls.info)).not.toContain(
    "private-folder-marker",
  );
  expect(JSON.stringify(harness.calls.info)).not.toContain(
    "private-filename-marker",
  );
});

test("media preparation fails closed before create with a fixed safe error", async () => {
  const harness = loadDrive();

  const error = await harness
    .uploadFileToDrive({
      userId: "user-id",
      folderId: "private-folder-marker",
      filename: "private-filename-marker.pdf",
      bytes: {} as never,
      mimeType: "application/pdf",
    })
    .catch((caught) => caught);

  expect(error).toMatchObject({
    name: "DriveUploadError",
    code: "DRIVE_UPLOAD_FAILED",
    stage: "drive_media_prepare",
    message: "DRIVE_UPLOAD_FAILED",
  });
  expect(harness.calls.create).toHaveLength(0);
  expect(JSON.stringify(error)).not.toContain("private-folder-marker");
  expect(JSON.stringify(error)).not.toContain("private-filename-marker");
});

test("create failures hide raw provider details and preserve credential codes", async () => {
  const rawMarker = "raw-provider-request-secret-marker";
  const failed = loadDrive({ createError: new Error(rawMarker) });
  const safeError = await failed
    .uploadPdfToDrive({
      userId: "user-id",
      folderId: "private-folder-marker",
      filename: "private-filename-marker.pdf",
      pdfBytes: new Uint8Array([1, 2, 3]),
    })
    .catch((caught) => caught);

  expect(safeError).toMatchObject({
    code: "DRIVE_UPLOAD_FAILED",
    stage: "drive_create_request",
  });
  expect(safeError.message).not.toContain(rawMarker);
  expect(JSON.stringify(safeError)).not.toContain(rawMarker);

  for (const code of [
    "GOOGLE_TOKEN_INVALID",
    "GOOGLE_PERMISSION_DENIED",
    "GOOGLE_TOKEN_DECRYPT_FAILED",
  ]) {
    const credentialError = Object.assign(
      new Error("private credential detail"),
      {
        code,
      },
    );
    const preserved = loadDrive({ createError: credentialError });
    const caught = await preserved
      .uploadPdfToDrive({
        userId: "user-id",
        folderId: "private-folder-marker",
        filename: "private-filename-marker.pdf",
        pdfBytes: new Uint8Array([1]),
      })
      .catch((error) => error);

    expect(caught).toBe(credentialError);
  }
});
