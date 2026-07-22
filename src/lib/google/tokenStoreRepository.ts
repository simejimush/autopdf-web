import type {
  GoogleConnectionWritePayload,
  GoogleTokenConnectionRow,
  GoogleTokenReadColumn,
  GoogleTokenRepository,
} from "@/lib/google/tokenStoreCore";

type QueryResult = Readonly<{ data: unknown; error: unknown }>;

type GoogleConnectionsTable = Readonly<{
  select(columns: string): Readonly<{
    eq(column: "user_id", value: string): Readonly<{
      limit(count: 2): PromiseLike<QueryResult>;
    }>;
  }>;
  insert(payload: Record<string, unknown>): Readonly<{
    select(columns: "id"): PromiseLike<QueryResult>;
  }>;
  update(payload: GoogleConnectionWritePayload): Readonly<{
    eq(column: "user_id", value: string): Readonly<{
      select(columns: "id"): PromiseLike<QueryResult>;
    }>;
  }>;
}>;

export type GoogleTokenSupabaseClient = Readonly<{
  from(table: "google_connections"): GoogleConnectionsTable;
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
  } = {};

  for (const column of columns) {
    if (!Object.prototype.hasOwnProperty.call(value, column)) {
      return null;
    }

    const token = value[column];
    if (token !== null && typeof token !== "string") {
      return null;
    }

    if (column === "access_token_enc") {
      row.accessTokenStored = token;
    } else {
      row.refreshTokenStored = token;
    }
  }

  return Object.freeze(row);
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
          .select("id");
      } catch {
        return { ok: false } as const;
      }

      const { data, error } = result;

      if (error || !Array.isArray(data)) {
        return { ok: false } as const;
      }

      return { ok: true, count: data.length } as const;
    },
    async updateConnectionByUserId(input) {
      if (Object.prototype.hasOwnProperty.call(input.payload, "user_id")) {
        return { ok: false } as const;
      }

      let result: QueryResult;
      try {
        const client = await getClient();
        result = await client
          .from("google_connections")
          .update(input.payload)
          .eq("user_id", input.userId)
          .select("id");
      } catch {
        return { ok: false } as const;
      }

      const { data, error } = result;

      if (error || !Array.isArray(data)) {
        return { ok: false } as const;
      }

      return { ok: true, count: data.length } as const;
    },
  });
}
