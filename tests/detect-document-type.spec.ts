import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { expect, test } from "@playwright/test";
import ts from "typescript";

const AI_PATH = resolve(process.cwd(), "src/lib/ai/detectDocumentType.ts");

function loadAiDetector(options?: { responseOk?: boolean }) {
  const source = readFileSync(AI_PATH, "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: AI_PATH,
  }).outputText;
  const fetchCalls: Array<[string, RequestInit]> = [];
  const loadedModule = {
    exports: {} as {
      detectDocumentTypeWithAi: (params: unknown) => Promise<string | null>;
    },
  };

  runInNewContext(compiled, {
    exports: loadedModule.exports,
    module: loadedModule,
    require(specifier: string) {
      if (specifier === "@/lib/ai/logAiUsage") return { async logAiUsage() {} };
      if (specifier === "@/lib/cost-safety/limits") {
        return {
          OPENAI_MAX_INPUT_TOKENS: 4_000,
          OPENAI_MAX_OUTPUT_TOKENS: 20,
          OPENAI_TIMEOUT_MS: 8_000,
        };
      }
      throw new Error(`Unexpected AI dependency: ${specifier}`);
    },
    process: { env: { OPENAI_API_KEY: "test-only" } },
    fetch: async (url: string, init: RequestInit) => {
      fetchCalls.push([url, init]);
      return {
        ok: options?.responseOk ?? true,
        async json() {
          return { output_text: "請求書", usage: {} };
        },
      };
    },
    AbortController,
    setTimeout,
    clearTimeout,
    Buffer,
    JSON,
    Math,
    Number,
  });

  return { detect: loadedModule.exports.detectDocumentTypeWithAi, fetchCalls };
}

test("uses one bounded OpenAI request with signal, output cap, and final input byte cap", async () => {
  for (const params of [
    {
      subject: "invoice".repeat(1_000),
      bodyText: "body".repeat(10_000),
      attachmentFilenames: Array.from({ length: 5 }, () =>
        "file.pdf".repeat(100),
      ),
    },
    {
      subject: "請求書😀".repeat(1_000),
      bodyText: '本文\\"\\n😀'.repeat(10_000),
      attachmentFilenames: Array.from({ length: 5 }, () =>
        '添付\\"😀.pdf'.repeat(100),
      ),
    },
  ]) {
    const harness = loadAiDetector();
    const result = await harness.detect({ ...params, timeoutMs: 7_000 });

    expect(result).toBe("請求書");
    expect(harness.fetchCalls).toHaveLength(1);
    const [, init] = harness.fetchCalls[0];
    const payload = JSON.parse(String(init.body));
    expect(payload.max_output_tokens).toBe(20);
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(
      Buffer.byteLength(JSON.stringify(payload.input), "utf8"),
    ).toBeLessThanOrEqual(2_000);
  }
});

test("preserves the null fallback after a failed OpenAI response without retry", async () => {
  const harness = loadAiDetector({ responseOk: false });

  await expect(harness.detect({ bodyText: "本文" })).resolves.toBeNull();
  expect(harness.fetchCalls).toHaveLength(1);
});
