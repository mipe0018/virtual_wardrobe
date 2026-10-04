import type { SupabaseClient } from "@supabase/supabase-js";

export type GenerationType = "character" | "clothing" | "tryon";

export type GenerationReservation = {
  usedCount: number;
  freeLimit: number;
};

export type ClothingGenerationReservation = GenerationReservation & {
  reservationStartedAt: string;
};

export class GenerationLimitError extends Error {
  constructor(
    message: string,
    readonly status: 409 | 429
  ) {
    super(message);
    this.name = "GenerationLimitError";
  }
}

export async function reserveGeneration(
  client: SupabaseClient,
  type: GenerationType
): Promise<GenerationReservation> {
  const { data, error } = await client.rpc("reserve_ai_generation", {
    p_generation_type: type,
  });
  if (error) {
    console.error(`Could not reserve ${type} AI generation.`, error);
    throw new Error("Could not verify your generation limit. Please try again.");
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (
    !row ||
    typeof row.allowed !== "boolean" ||
    typeof row.used_count !== "number" ||
    typeof row.free_limit !== "number"
  ) {
    throw new Error("The generation-limit service returned an invalid response.");
  }
  if (!row.allowed) {
    if (row.reason === "already_in_progress") {
      throw new GenerationLimitError(
        "A generation of this type is already in progress. Please wait for it to finish.",
        409
      );
    }
    throw new GenerationLimitError(
      `You have used all ${row.free_limit} free ${type} generations. Previously saved results are still available.`,
      429
    );
  }

  return { usedCount: row.used_count, freeLimit: row.free_limit };
}

export async function reserveClothingGeneration(
  client: SupabaseClient
): Promise<ClothingGenerationReservation> {
  const { data, error } = await client.rpc("reserve_clothing_ai_generation");
  if (error) {
    console.error("Could not reserve clothing AI-ready generation.", error);
    throw new Error("Could not verify your clothing generation limit. Please try again.");
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (
    !row ||
    typeof row.allowed !== "boolean" ||
    typeof row.used_count !== "number" ||
    typeof row.free_limit !== "number" ||
    (row.reservation_started_at !== null &&
      typeof row.reservation_started_at !== "string")
  ) {
    throw new Error("The clothing generation-limit service returned an invalid response.");
  }
  if (!row.allowed) {
    if (row.reason === "already_in_progress") {
      throw new GenerationLimitError(
        "A clothing generation is already in progress. Please wait for it to finish.",
        409
      );
    }
    throw new GenerationLimitError(
      `You have used all ${row.free_limit} free clothing generations. Previously saved results are still available.`,
      429
    );
  }
  if (typeof row.reservation_started_at !== "string") {
    throw new Error("The clothing generation reservation did not include its token.");
  }

  return {
    usedCount: row.used_count,
    freeLimit: row.free_limit,
    reservationStartedAt: row.reservation_started_at,
  };
}

export async function finishClothingGeneration(
  client: SupabaseClient,
  userId: string,
  reservationStartedAt: string,
  succeeded: boolean
): Promise<void> {
  const { data, error } = await client.rpc("finish_clothing_ai_generation_server", {
    p_user_id: userId,
    p_reservation_started_at: reservationStartedAt,
    p_succeeded: succeeded,
  });
  if (error) {
    console.error(
      `Could not ${succeeded ? "commit" : "roll back"} the clothing generation reservation.`,
      error
    );
    throw new Error("Could not finalize the clothing generation quota. Please check your quota before retrying.");
  }
  if (data !== true) {
    throw new Error("The clothing generation reservation expired before it could be finalized.");
  }
}

export async function finishGeneration(
  client: SupabaseClient,
  type: GenerationType
): Promise<void> {
  const { error } = await client.rpc("finish_ai_generation", {
    p_generation_type: type,
  });
  if (error) {
    console.error(`Could not release the ${type} generation lock.`, error);
  }
}
