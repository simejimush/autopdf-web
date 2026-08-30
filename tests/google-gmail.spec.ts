import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { expect, test } from "@playwright/test";
import ts from "typescript";

const GMAIL_PATH = resolve(process.cwd(), "src/lib/google/gmail.ts");

function loadGmail() {
  const source = readFileSync(GMAIL_PATH, "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: GMAIL_PATH,
  }).outputText;
  const calls: unknown[][] = [];
  const loadedModule = {
    exports: {} as {
      searchGmail: (params: unknown) => Promise<string[]>;
    },
  };

  runInNewContext(compiled, {
    exports: loadedModule.exports,
    module: loadedModule,
    require(specifier: string) {
      if (specifier === "googleapis") {
        return {
          google: {
            gmail() {
              return {
                users: {
                  messages: {
                    async list(...args: unknown[]) {
                      calls.push(args);
                      return { data: { messages: [] } };
                    },
                  },
                },
              };
            },
          },
        };
      }
      if (specifier === "./auth") {
        return {
          async getOAuthClientForUser() {
            return {};
          },
        };
      }
      throw new Error(`Unexpected Gmail dependency: ${specifier}`);
    },
    Buffer,
    Error,
    Object,
  });

  return { searchGmail: loadedModule.exports.searchGmail, calls };
}

test("passes the bounded Gmail timeout and one-retry policy to gaxios", async () => {
  const harness = loadGmail();

  await harness.searchGmail({
    userId: "user-id",
    query: "from:billing@example.com",
    budget: { getTimeoutMs: () => 15_000 },
  });

  expect(harness.calls).toEqual([
    [
      { userId: "me", q: "from:billing@example.com", maxResults: 10 },
      {
        timeout: 15_000,
        retry: true,
        retryConfig: { retry: 1, noResponseRetries: 1, totalTimeout: 15_000 },
      },
    ],
  ]);
});

test("does not start Gmail when its remaining deadline budget is exhausted", async () => {
  const harness = loadGmail();

  const error = await harness
    .searchGmail({
      userId: "user-id",
      query: "from:billing@example.com",
      budget: { getTimeoutMs: () => null },
    })
    .catch((caught: unknown) => caught);

  expect(error).toMatchObject({ code: "TIMEOUT" });
  expect(harness.calls).toHaveLength(0);
});
