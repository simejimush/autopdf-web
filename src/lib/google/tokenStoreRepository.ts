import type {
  GoogleConnectionWritePayload,
  GoogleTokenConnectionRow,
  GoogleTokenReadColumn,
  GoogleTokenRepository,
} from "@/lib/google/tokenStoreCore";
import {
  createGoogleCredentialVersion,
  type GoogleCredentialVersion,
} from "@/lib/google/tokenStoreCore";

type QueryResult = Readonly<{ data: unknown; error: unknown }>;

type GoogleConnectionsTable = Readonly<{
  select(columns: string): Readonly<{
    eq(
      column: "user_id",
      value: string,
    ): Readonly<{
      limit(count: 2): PromiseLike<QueryResult>;
    }>;
  }>;
  insert(payload: Record<string, unknown>): Readonly<{
    select(columns: "id,credential_version"): PromiseLike<QueryResult>;
  }>;
  update(payload: GoogleConnectionWritePayload): Readonly<{
    eq(
      column:
        | "user_id"
        | "status"
        | "credential_version"
        | "refresh_lease_id_hash",
      value: string,
    ): GoogleConnectionUpdateFilter;
    is(column: "status", value: null): GoogleConnectionUpdateFilter;
  }>;
}>;

type GoogleConnectionUpdateFilter = Readonly<{
  eq(
    column:
      | "user_id"
      | "status"
      | "credential_version"
      | "refresh_lease_id_hash",
    value: string,
  ): GoogleConnectionUpdateFilter;
  is(column: "status", value: null): GoogleConnectionUpdateFilter;
  select(columns: "id,credential_version"): PromiseLike<QueryResult>;
}>;

export type GoogleTokenSupabaseClient = Readonly<{
  from(table: "google_connections"): GoogleConnectionsTable;
  rpc(
    functionName: "claim_google_credential_refresh_lease",
    args: Readonly<{
      p_user_id: string;
      p_expected_status: string | null;
      p_expected_credential_version: string;
      p_lease_id_hash: string;
    }>,
  ): PromiseLike<QueryResult>;
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseConnectionRow(
  value: unknown,
  columns: readonly GoogleTokenReadColumn[],
): GoogleTokenConnectionRow | null {
  if (!isRecord(value)) {
    return null;
  }

  const row: {
    accessTokenStored?: string | null;
    refreshTokenStored?: string | null;
    statusStored?: string | null;
    tokenExpiryAtStored?: string | null;
    scopesStored?: string | null;
    credentialVersionStored?: GoogleCredentialVersion;
    reauthRequiredStored?: boolean;
  } = {};

  for (const column of columns) {
    if (!Object.prototype.hasOwnProperty.call(value, column)) {
      return null;
    }

    const storedValue = value[column];
    if (column === "credential_version") {
      try {
        row.credentialVersionStored = createGoogleCredentialVersion(
          storedValue as string | number,
        );
      } catch {
        return null;
      }
      continue;
    }

    if (column === "reauth_required") {
      if (typeof storedValue !== "boolean") {
        return null;
      }
      row.reauthRequiredStored = storedValue;
      continue;
    }

    if (storedValue !== null && typeof storedValue !== "string") {
      return null;
    }

    if (column === "access_token_enc") {
      row.accessTokenStored = storedValue;
    } else if (column === "refresh_token_enc") {
      row.refreshTokenStored = storedValue;
    } else if (column === "status") {
      row.statusStored = storedValue;
    } else if (column === "token_expiry_at") {
      row.tokenExpiryAtStored = storedValue;
    } else if (column === "scopes") {
      row.scopesStored = storedValue;
    }
  }

  return Object.freeze(row);
}

function parseWriteCredentialVersions(
  data: unknown,
): readonly GoogleCredentialVersion[] | null {
  if (!Array.isArray(data)) {
    return null;
  }

  const versions: GoogleCredentialVersion[] = [];
  for (const value of data) {
    if (
      !isRecord(value) ||
      typeof value.id !== "string" ||
      value.id.length === 0
    ) {
      return null;
    }

    try {
      versions.push(
        createGoogleCredentialVersion(
          value.credential_version as string | number,
        ),
      );
    } catch {
      return null;
    }
  }

  return Object.freeze(versions);
}

export function createGoogleTokenRepository(
  getClient: () => Promise<GoogleTokenSupabaseClient>,
): GoogleTokenRepository {
  return Object.freeze({
    async selectConnectionsByUserId(input) {
      let result: QueryResult;
      try {
        const client = await getClient();
        result = await client
          .from("google_connections")
          .select(input.columns.join(","))
          .eq("user_id", input.userId)
          .limit(2);
      } catch {
        return { ok: false } as const;
      }

      const { data, error } = result;

      if (error || !Array.isArray(data)) {
        return { ok: false } as const;
      }

      const rows: GoogleTokenConnectionRow[] = [];
      for (const value of data as unknown[]) {
        const row = parseConnectionRow(value, input.columns);
        if (!row) {
          return { ok: false } as const;
        }
        rows.push(row);
      }

      return { ok: true, rows: Object.freeze(rows) } as const;
    },
    async insertConnection(input) {
      let result: QueryResult;
      try {
        const client = await getClient();
        result = await client
          .from("google_connections")
          .insert({ ...input.payload, user_id: input.userId })
          .select("id,credential_version");
      } catch {
        return { ok: false } as const;
      }

      const { data, error } = result;

      const credentialVersions = parseWriteCredentialVersions(data);
      if (error || credentialVersions === null) {
        return { ok: false } as const;
      }

      return { ok: true, credentialVersions } as const;
    },
    async updateConnectionByCredentialVersion(input) {
      if (Object.prototype.hasOwnProperty.call(input.payload, "user_id")) {
        return { ok: false } as const;
      }

      let result: QueryResult;
      try {
        const client = await getClient();
        let query = client
          .from("google_connections")
          .update(input.payload)
          .eq("user_id", input.userId)
          .eq("credential_version", input.expectedCredentialVersion);
        query =
          input.expectedStatus === null
            ? query.is("status", null)
            : query.eq("status", input.expectedStatus);
        if (input.expectedRefreshLeaseIdHash !== undefined) {
          query = query.eq(
            "refresh_lease_id_hash",
            input.expectedRefreshLeaseIdHash,
          );
        }
        result = await query.select("id,credential_version");
      } catch {
        return { ok: false } as const;
      }

      const { data, error } = result;

      const credentialVersions = parseWriteCredentialVersions(data);
      if (error || credentialVersions === null) {
        return { ok: false } as const;
      }

      return { ok: true, credentialVersions } as const;
    },
    async claimGoogleCredentialRefreshLease(input) {
      let result: QueryResult;
      try {
        const client = await getClient();
        result = await client.rpc("claim_google_credential_refresh_lease", {
          p_user_id: input.userId,
          p_expected_status: input.expectedStatus,
          p_expected_credential_version: input.expectedCredentialVersion,
          p_lease_id_hash: input.leaseIdHash,
        });
      } catch {
        return { ok: false } as const;
      }

      const { data, error } = result;
      const credentialVersions = parseWriteCredentialVersions(data);
      if (error || credentialVersions === null) {
        return { ok: false } as const;
      }

      return { ok: true, credentialVersions } as const;
    },
  });
}
