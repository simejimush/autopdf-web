import "server-only";

import { createHash, randomBytes } from "node:crypto";
import {
  createProcessedEmailReservationRepository,
  type ProcessedEmailReservationSupabaseClient,
} from "@/lib/runs/processedEmailReservationRepositoryCore";

const processedEmailRepository = createProcessedEmailReservationRepository({
  async getClient() {
    const { supabaseAdmin } = await import("@/lib/supabase/admin");
    return supabaseAdmin as unknown as ProcessedEmailReservationSupabaseClient;
  },
  createReservationIdHash: () =>
    createHash("sha256").update(randomBytes(32)).digest("hex"),
});

export const reserveProcessedEmail =
  processedEmailRepository.reserveProcessedEmail;
export const markProcessedEmailDriveStarted =
  processedEmailRepository.markProcessedEmailDriveStarted;
export const completeProcessedEmail =
  processedEmailRepository.completeProcessedEmail;
