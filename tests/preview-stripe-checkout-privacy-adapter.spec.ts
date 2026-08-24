import { expect, test } from "@playwright/test";

import {
  createPreviewCheckoutHarnessAdapter,
  PREVIEW_HARNESS_PROCESS_ENV_NAMES,
  PreviewHarnessAdapterError,
  type PreviewHarnessAdapterDependencies,
  type PreviewHarnessFixtureRow,
} from "../scripts/preview-stripe-checkout-privacy-adapter";

const URL_MARKER = "https://synthetic-preview.supabase.co";
const ANON_MARKER = "synthetic-preview-anon-secret";
const SERVICE_MARKER = "synthetic-preview-service-secret";
const COOKIE_MARKER = "synthetic-preview-cookie";
const OWNER_MARKER = "synthetic-preview-owner";
const OTHER_OWNER_MARKER = "synthetic-other-owner";
const SENSITIVE_MARKERS = [
  URL_MARKER,
  ANON_MARKER,
  SERVICE_MARKER,
  COOKIE_MARKER,
  OWNER_MARKER,
  OTHER_OWNER_MARKER,
];

type OwnerHandle = PreviewHarnessFixtureRow["ownerHandle"];

function owner(value = OWNER_MARKER) {
  return value as OwnerHandle;
}

function environment(
  overrides: Record<string, string | undefined> = {},
): Record<string, string | undefined> {
  return {
    [PREVIEW_HARNESS_PROCESS_ENV_NAMES.supabaseUrl]: URL_MARKER,
    [PREVIEW_HARNESS_PROCESS_ENV_NAMES.anonKey]: ANON_MARKER,
    [PREVIEW_HARNESS_PROCESS_ENV_NAMES.serviceRoleKey]: SERVICE_MARKER,
    ...overrides,
  };
}

function fixture(
  overrides: Partial<PreviewHarnessFixtureRow> = {},
): PreviewHarnessFixtureRow {
  return {
    ownerHandle: owner(),
    plan: "free",
    billingStatus: "none",
    paid: false,
    activeOrTrialingSubscriptionCount: 0,
    activeCheckoutAttemptCount: 0,
    customerCount: 0,
    checkoutSessionCount: 0,
    subscriptionCount: 0,
    ...overrides,
  };
}

function dependencies(
  overrides: Partial<PreviewHarnessAdapterDependencies> = {},
) {
  const calls = {
    identity: 0,
    auth: 0,
    fixture: 0,
    prepare: 0,
    cleanup: 0,
    postState: 0,
  };
  const value: PreviewHarnessAdapterDependencies = {
    async verifyIdentity() {
      calls.identity += 1;
      return {
        urlMatchesExpectedPreview: true,
        anonKeyMatchesExpectedPreview: true,
        serviceRoleKeyMatchesExpectedPreview: true,
        productionIdentity: false,
      };
    },
    async acquireSession() {
      calls.auth += 1;
      return { ownerHandle: owner(), cookieHeader: COOKIE_MARKER };
    },
    async inspectFixture() {
      calls.fixture += 1;
      return [fixture()];
    },
    async prepareFixture() {
      calls.prepare += 1;
      return {
        artifactHandle: "synthetic-artifact-handle" as never,
      };
    },
    async cleanupFixture() {
      calls.cleanup += 1;
    },
    async inspectPostState() {
      calls.postState += 1;
      return {
        activeAttemptMax: 1,
        activeAttemptCount: 0,
        customerCreatedCount: 1,
        sessionCreatedCount: 1,
        subscriptionCreatedCount: 0,
        productionOperations: 0,
        liveOperations: 0,
        billingProfilePaidMutation: false,
        fixtureFree: true,
        fixtureUnsubscribed: true,
      };
    },
    ...overrides,
  };
  return { calls, value };
}

function expectSafeError(error: unknown, code: string) {
  expect(error).toBeInstanceOf(PreviewHarnessAdapterError);
  const safe = error as Error;
  expect(safe.message).toBe(code);
  for (const marker of SENSITIVE_MARKERS) {
    expect(safe.message).not.toContain(marker);
    expect(safe.stack ?? "").not.toContain(marker);
  }
}

test("three explicit process-memory credentials create the adapter", async () => {
  const harness = dependencies();
  const adapter = await createPreviewCheckoutHarnessAdapter({
    environment: environment(),
    dependencies: harness.value,
  });

  await expect(adapter.verifyFixture()).resolves.toEqual({
    fixture_fresh: true,
    fixture_free: true,
    fixture_unsubscribed: true,
  });
  expect(harness.calls).toEqual({
    identity: 1,
    auth: 1,
    fixture: 1,
    prepare: 0,
    cleanup: 0,
    postState: 0,
  });
});

for (const missing of Object.values(PREVIEW_HARNESS_PROCESS_ENV_NAMES)) {
  test(`missing ${missing} fails before identity or data access`, async () => {
    const harness = dependencies();
    try {
      await createPreviewCheckoutHarnessAdapter({
        environment: environment({ [missing]: undefined }),
        dependencies: harness.value,
      });
      throw new Error("expected adapter creation to fail");
    } catch (error) {
      expectSafeError(error, "HARNESS_CREDENTIAL_MISSING");
    }
    expect(harness.calls).toEqual({
      identity: 0,
      auth: 0,
      fixture: 0,
      prepare: 0,
      cleanup: 0,
      postState: 0,
    });
  });
}

test("Development env names are never an implicit fallback", async () => {
  const harness = dependencies();
  await expect(
    createPreviewCheckoutHarnessAdapter({
      environment: {
        NEXT_PUBLIC_SUPABASE_URL: URL_MARKER,
        NEXT_PUBLIC_SUPABASE_ANON_KEY: ANON_MARKER,
        SUPABASE_SERVICE_ROLE_KEY: SERVICE_MARKER,
      },
      dependencies: harness.value,
    }),
  ).rejects.toMatchObject({ code: "HARNESS_CREDENTIAL_MISSING" });
  expect(harness.calls.identity).toBe(0);
});

test("credential project mismatch fails before auth, DB, or Stripe", async () => {
  for (const mismatch of [
    "urlMatchesExpectedPreview",
    "anonKeyMatchesExpectedPreview",
    "serviceRoleKeyMatchesExpectedPreview",
  ] as const) {
    const harness = dependencies({
      async verifyIdentity() {
        harness.calls.identity += 1;
        return {
          urlMatchesExpectedPreview: true,
          anonKeyMatchesExpectedPreview: true,
          serviceRoleKeyMatchesExpectedPreview: true,
          productionIdentity: false,
          [mismatch]: false,
        };
      },
    });
    await expect(
      createPreviewCheckoutHarnessAdapter({
        environment: environment(),
        dependencies: harness.value,
      }),
    ).rejects.toMatchObject({
      code: "HARNESS_CREDENTIAL_IDENTITY_MISMATCH",
    });
    expect(harness.calls).toEqual({
      identity: 1,
      auth: 0,
      fixture: 0,
      prepare: 0,
      cleanup: 0,
      postState: 0,
    });
  }
});

test("Production identity fails before auth, DB, or Stripe", async () => {
  const harness = dependencies({
    async verifyIdentity() {
      harness.calls.identity += 1;
      return {
        urlMatchesExpectedPreview: true,
        anonKeyMatchesExpectedPreview: true,
        serviceRoleKeyMatchesExpectedPreview: true,
        productionIdentity: true,
      };
    },
  });
  await expect(
    createPreviewCheckoutHarnessAdapter({
      environment: environment(),
      dependencies: harness.value,
    }),
  ).rejects.toMatchObject({
    code: "HARNESS_PRODUCTION_IDENTITY_FORBIDDEN",
  });
  expect(harness.calls).toEqual({
    identity: 1,
    auth: 0,
    fixture: 0,
    prepare: 0,
    cleanup: 0,
    postState: 0,
  });
});

test("credential-bearing dependency failures are always sanitized", async () => {
  const harness = dependencies({
    async verifyIdentity() {
      throw new Error(`${ANON_MARKER}:${SERVICE_MARKER}:${URL_MARKER}`);
    },
  });
  try {
    await createPreviewCheckoutHarnessAdapter({
      environment: environment(),
      dependencies: harness.value,
    });
    throw new Error("expected adapter creation to fail");
  } catch (error) {
    expectSafeError(error, "HARNESS_CREDENTIAL_IDENTITY_MISMATCH");
  }
});

for (const [name, rows, code] of [
  ["zero fixture rows", [], "HARNESS_FIXTURE_NOT_FOUND"],
  ["multiple fixture rows", [fixture(), fixture()], "HARNESS_FIXTURE_MULTIPLE"],
  [
    "owner mismatch",
    [fixture({ ownerHandle: owner(OTHER_OWNER_MARKER) })],
    "HARNESS_FIXTURE_OWNER_MISMATCH",
  ],
] as const) {
  test(`${name} fails closed`, async () => {
    const harness = dependencies({
      async inspectFixture() {
        harness.calls.fixture += 1;
        return rows;
      },
    });
    const adapter = await createPreviewCheckoutHarnessAdapter({
      environment: environment(),
      dependencies: harness.value,
    });
    await expect(adapter.verifyFixture()).rejects.toMatchObject({ code });
  });
}

test("non-Free, subscribed, active-attempt, and non-fresh fixtures fail", async () => {
  for (const row of [
    fixture({ plan: "pro" }),
    fixture({ billingStatus: "active" }),
    fixture({ paid: true }),
    fixture({ activeOrTrialingSubscriptionCount: 1 }),
    fixture({ activeCheckoutAttemptCount: 1 }),
    fixture({ customerCount: 1 }),
    fixture({ checkoutSessionCount: 1 }),
    fixture({ subscriptionCount: 1 }),
  ]) {
    const harness = dependencies({
      async inspectFixture() {
        return [row];
      },
    });
    const adapter = await createPreviewCheckoutHarnessAdapter({
      environment: environment(),
      dependencies: harness.value,
    });
    await expect(adapter.verifyFixture()).rejects.toMatchObject({
      code: "HARNESS_FIXTURE_STATE_INVALID",
    });
  }
});

test("two requests cross one barrier instead of running serially", async () => {
  const harness = dependencies();
  const adapter = await createPreviewCheckoutHarnessAdapter({
    environment: environment(),
    dependencies: harness.value,
  });
  let started = 0;
  let releaseBoth: (() => void) | undefined;
  const bothStarted = new Promise<void>((resolve) => {
    releaseBoth = resolve;
  });
  const result = await adapter.executeConcurrency({
    checkoutUrl: new URL("https://preview.invalid/api/stripe/checkout"),
    requestCount: 2,
    async fetchImpl(_input, init) {
      started += 1;
      const requestNumber = started;
      if (started === 2) releaseBoth?.();
      await bothStarted;
      expect(new Headers(init?.headers).get("cookie")).toBe(COOKIE_MARKER);
      return new Response(null, { status: requestNumber === 1 ? 200 : 409 });
    },
  });

  expect(result).toEqual({
    authenticated: true,
    request_count: 2,
    status_class: "mixed",
    winner_count: 1,
    loser_count: 1,
    active_attempt_count: 0,
    customer_created_count: 1,
    session_created_count: 1,
    subscription_created_count: 0,
    production_operations: 0,
    live_operations: 0,
    fixture_fresh: true,
    fixture_free: true,
    fixture_unsubscribed: true,
    active_attempt_max: 1,
    billing_profile_paid_mutation: false,
  });
  for (const marker of SENSITIVE_MARKERS) {
    expect(JSON.stringify(result)).not.toContain(marker);
  }
});

test("prepare and cleanup remain owner scoped and keep handles private", async () => {
  const order: string[] = [];
  const harness = dependencies({
    async verifyIdentity() {
      harness.calls.identity += 1;
      order.push("identity");
      return {
        urlMatchesExpectedPreview: true,
        anonKeyMatchesExpectedPreview: true,
        serviceRoleKeyMatchesExpectedPreview: true,
        productionIdentity: false,
      };
    },
    async prepareFixture() {
      harness.calls.prepare += 1;
      order.push("prepare");
      return {
        artifactHandle: "synthetic-artifact-handle" as never,
      };
    },
  });
  const adapter = await createPreviewCheckoutHarnessAdapter({
    environment: environment(),
    dependencies: harness.value,
  });

  const prepared = await adapter.prepareFixture();
  const cleaned = await adapter.cleanupCreatedFixtureArtifacts();
  expect(prepared).toEqual({
    fixture_fresh: true,
    fixture_free: true,
    fixture_unsubscribed: true,
  });
  expect(cleaned).toEqual(prepared);
  expect(order).toEqual(["identity", "prepare"]);
  expect(harness.calls).toEqual({
    identity: 1,
    auth: 1,
    fixture: 2,
    prepare: 1,
    cleanup: 1,
    postState: 0,
  });
  for (const marker of [...SENSITIVE_MARKERS, "synthetic-artifact-handle"]) {
    expect(JSON.stringify({ prepared, cleaned })).not.toContain(marker);
  }
});

test("cleanup cannot target artifacts that this adapter did not create", async () => {
  const harness = dependencies();
  const adapter = await createPreviewCheckoutHarnessAdapter({
    environment: environment(),
    dependencies: harness.value,
  });
  await expect(adapter.cleanupCreatedFixtureArtifacts()).rejects.toMatchObject({
    code: "HARNESS_FIXTURE_CLEANUP_SCOPE_MISSING",
  });
  expect(harness.calls.cleanup).toBe(0);
});

test("unsafe winner, duplicate, paid, Production, or live results fail closed", async () => {
  for (const postState of [
    { activeAttemptMax: 2 },
    { customerCreatedCount: 2 },
    { sessionCreatedCount: 2 },
    { subscriptionCreatedCount: 1 },
    { productionOperations: 1 },
    { liveOperations: 1 },
    { billingProfilePaidMutation: true },
    { fixtureFree: false },
    { fixtureUnsubscribed: false },
  ]) {
    const harness = dependencies({
      async inspectPostState() {
        return {
          activeAttemptMax: 1,
          activeAttemptCount: 0,
          customerCreatedCount: 1,
          sessionCreatedCount: 1,
          subscriptionCreatedCount: 0,
          productionOperations: 0,
          liveOperations: 0,
          billingProfilePaidMutation: false,
          fixtureFree: true,
          fixtureUnsubscribed: true,
          ...postState,
        };
      },
    });
    const adapter = await createPreviewCheckoutHarnessAdapter({
      environment: environment(),
      dependencies: harness.value,
    });
    let started = 0;
    await expect(
      adapter.executeConcurrency({
        checkoutUrl: new URL("https://preview.invalid/api/stripe/checkout"),
        requestCount: 2,
        async fetchImpl() {
          started += 1;
          return new Response(null, { status: started === 1 ? 200 : 409 });
        },
      }),
    ).rejects.toMatchObject({ code: "HARNESS_CONCURRENCY_RESULT_UNSAFE" });
  }
});

test("multiple Checkout winners fail closed", async () => {
  const harness = dependencies();
  const adapter = await createPreviewCheckoutHarnessAdapter({
    environment: environment(),
    dependencies: harness.value,
  });
  await expect(
    adapter.executeConcurrency({
      checkoutUrl: new URL("https://preview.invalid/api/stripe/checkout"),
      requestCount: 2,
      fetchImpl: async () => new Response(null, { status: 200 }),
    }),
  ).rejects.toMatchObject({ code: "HARNESS_CONCURRENCY_RESULT_UNSAFE" });
});

test("a serial request count is rejected before auth or fixture access", async () => {
  const harness = dependencies();
  const adapter = await createPreviewCheckoutHarnessAdapter({
    environment: environment(),
    dependencies: harness.value,
  });
  await expect(
    adapter.executeConcurrency({
      checkoutUrl: new URL("https://preview.invalid/api/stripe/checkout"),
      requestCount: 1,
      fetchImpl: async () => new Response(null, { status: 200 }),
    }),
  ).rejects.toMatchObject({ code: "HARNESS_CONCURRENCY_REQUIRED" });
  expect(harness.calls.auth).toBe(0);
  expect(harness.calls.fixture).toBe(0);
});
