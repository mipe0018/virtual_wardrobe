import type { APIRoute } from "astro";
import { Buffer } from "node:buffer";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  authenticateSupabaseRequest,
  createSupabaseServiceClient,
} from "../../../lib/server/supabase";
import { launchBackgroundJob } from "../../../lib/server/ai/job-launcher";
import {
  characterPrompt,
  runCharacterJob,
  type CharacterJobPayload,
} from "../../../lib/server/ai/jobs/character-job";
import {
  editImage,
  imageDataUrl,
  moderateImage,
  OpenAIImageError,
} from "../../../lib/server/ai/openai-images";
import { matchesImageSignature } from "../../../lib/server/ai/image-input";
import { PNG } from "pngjs";
import { loadSystemBaseFormDataUrl } from "../../../lib/server/ai/base-forms";
import {
  finishGeneration,
  finishGenerationServer,
  GenerationLimitError,
  readReservationToken,
  reserveGeneration,
} from "../../../lib/server/ai/generation-usage";

export const prerender = false;

const MAX_SOURCE_IMAGE_BYTES = 10 * 1024 * 1024;

type ProfilePhoto = {
  gender: "woman" | "man" | null;
  source_photo_path: string | null;
};

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function describeDataUrl(dataUrl: string) {
  const match = /^data:([^;]+);base64,(.*)$/s.exec(dataUrl);
  if (!match) return { valid: false as const };
  const bytes = Buffer.from(match[2], "base64");
  const isPng = matchesImageSignature(bytes, "image/png");
  let width: number | null = null;
  let height: number | null = null;
  let decodes = false;
  if (isPng) {
    try {
      const decoded = PNG.sync.read(bytes);
      width = decoded.width;
      height = decoded.height;
      decodes = true;
    } catch {
      decodes = false;
    }
  }
  return { valid: true as const, mimeType: match[1], bytes: bytes.length, isPng, width, height, decodes };
}

// DEV ONLY. TEST A = source photo only, B = canonical base form only,
// C = source photo + canonical base form (the production input), INFO = no OpenAI call.
async function runDiagnostic(
  test: string,
  gender: "woman" | "man",
  sourceDataUrl: string,
  client: SupabaseClient
) {
  const noStore = { "Cache-Control": "no-store" };
  if (!["A", "B", "C", "INFO"].includes(test)) {
    return Response.json({ error: "Use diagnostic=A, B, C or INFO." }, { status: 400, headers: noStore });
  }

  let baseFormDataUrl: string;
  try {
    baseFormDataUrl = await loadSystemBaseFormDataUrl(client, gender);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const category = /configuration|not configured|look up/i.test(message)
      ? "database_lookup_failed"
      : /download|base-form image/i.test(message)
        ? "storage_download_failed"
        : /decoded/i.test(message)
          ? "png_validation_failed"
          : /1024x1536/.test(message)
            ? "dimension_validation_failed"
            : /PNG under/.test(message)
              ? "png_validation_failed"
              : "unknown";
    console.error(`[diagnostic] Could not load the ${gender} base form (${category}).`, error);
    return Response.json(
      { test, category, error: `The canonical ${gender} base form could not be loaded or failed validation.` },
      { status: 503, headers: noStore }
    );
  }

  const inputs = {
    source: describeDataUrl(sourceDataUrl),
    baseForm: describeDataUrl(baseFormDataUrl),
  };
  if (test === "INFO") {
    return Response.json(
      { test, gender, model: "gpt-image-2.5-sunburst", size: "1024x1536", quality: "high", inputs },
      { headers: noStore }
    );
  }

  const images =
    test === "A" ? [sourceDataUrl] : test === "B" ? [baseFormDataUrl] : [sourceDataUrl, baseFormDataUrl];
  console.info(`[diagnostic] TEST ${test}: sending ${images.length} image(s) to OpenAI.`);
  try {
    const result = await editImage({
      images,
      size: "1024x1536",
      prompt: characterPrompt(gender, test === "C"),
    });
    console.info(`[diagnostic] TEST ${test}: accepted (${result.bytes.length} bytes). Result discarded.`);
    return Response.json(
      { test, gender, accepted: true, imagesSent: images.length, inputs },
      { headers: noStore }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    const safety = /safety_violations=\[([^\]]*)\]/.exec(message)?.[1] ?? null;
    console.warn(
      `[diagnostic] TEST ${test}: rejected. status=${error instanceof OpenAIImageError ? error.status : "n/a"} safety=${safety ?? "none"}`
    );
    return Response.json(
      {
        test,
        gender,
        accepted: false,
        imagesSent: images.length,
        safetyViolations: safety,
        error: `TEST ${test} (${
          test === "A" ? "source only" : test === "B" ? "base form only" : "source + base form"
        }) failed: ${message}`,
        inputs,
      },
      { status: 200, headers: noStore }
    );
  }
}

async function setGenerationStatus(
  client: SupabaseClient,
  userId: string,
  status: "pending" | "processing" | "completed" | "failed",
  modelPhotoPath?: string
): Promise<boolean> {
  const update = modelPhotoPath
    ? { model_generation_status: status, model_photo_path: modelPhotoPath }
    : { model_generation_status: status };
  const { data, error } = await client
    .from("profiles")
    .update(update)
    .eq("user_id", userId)
    .select("user_id")
    .maybeSingle();
  if (error || !data) {
    console.error(`Could not set personal model status to ${status}.`, error);
    return false;
  }
  return true;
}

export const POST: APIRoute = async ({ request }) => {
  const authentication = await authenticateSupabaseRequest(request);
  if (!authentication.ok) {
    return jsonError(authentication.message, authentication.status);
  }

  const { client, user } = authentication;
  let reservation: Awaited<ReturnType<typeof reserveGeneration>> | null = null;
  let jobStarted = false;
  try {
    const { data: profile, error: profileError } = await client
      .from("profiles")
      .select("gender, source_photo_path")
      .eq("user_id", user.id)
      .maybeSingle<ProfilePhoto>();

    if (profileError) {
      console.error("Could not load the source photo and model type.", profileError);
      return jsonError("Could not load your profile. Please try again.", 500);
    }
    if (!profile) return jsonError("Your profile could not be found.", 404);
    if (profile.gender !== "woman" && profile.gender !== "man") {
      return jsonError("Choose and save Woman or Man on your profile before generating a character.", 409);
    }
    if (!profile.source_photo_path) {
      return jsonError("Upload a source photo before generating your character.", 400);
    }
    if (!profile.source_photo_path.startsWith(`${user.id}/`)) {
      return jsonError("The saved source photo path is invalid.", 400);
    }
    const { data: sourcePhoto, error: sourceError } = await client.storage
      .from("profile-images")
      .download(profile.source_photo_path);
    if (sourceError || !sourcePhoto) {
      console.error("Could not retrieve the private source photo.", sourceError);
      throw new Error("Could not retrieve your saved photo. Please upload it again.");
    }
    if (sourcePhoto.size === 0 || sourcePhoto.size > MAX_SOURCE_IMAGE_BYTES) {
      throw new Error("The saved source photo is empty or too large.");
    }

    const sourceMimeType = sourcePhoto.type.split(";")[0].toLowerCase();
    if (!["image/jpeg", "image/png", "image/webp"].includes(sourceMimeType)) {
      throw new Error("The saved source photo format is not supported.");
    }
    const sourceDataUrl = imageDataUrl(await sourcePhoto.arrayBuffer(), sourceMimeType);

    try {
      await moderateImage(sourceDataUrl);
    } catch (error) {
      if (error instanceof OpenAIImageError && error.status === 422) {
        throw new Error(error.message);
      }
      throw error;
    }

    // Development-only image-input diagnostics. Runs after authentication and source
    // moderation but BEFORE the quota reservation; it never touches quota, status,
    // storage, or the database, and is compiled out of production builds.
    if (import.meta.env.DEV) {
      const diagnostic = new URL(request.url).searchParams.get("diagnostic");
      if (diagnostic) {
        return runDiagnostic(diagnostic.toUpperCase(), profile.gender, sourceDataUrl, client);
      }
    }

    reservation = await reserveGeneration(client, "character");
    if (!(await setGenerationStatus(client, user.id, "pending"))) {
      throw new Error("Could not start character generation.");
    }
    if (!(await setGenerationStatus(client, user.id, "processing"))) {
      throw new Error("Could not update character generation status.");
    }

    const serviceClient = createSupabaseServiceClient();
    const reservationStartedAt = await readReservationToken(serviceClient, user.id, "character");
    if (!reservationStartedAt) {
      throw new Error("Could not start character generation.");
    }
    const accessToken = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1] ?? "";
    const started = await launchBackgroundJob<CharacterJobPayload>(
      request,
      "personal-model-background",
      {
        userId: user.id,
        accessToken,
        gender: profile.gender,
        sourcePhotoPath: profile.source_photo_path,
        reservationStartedAt,
      },
      runCharacterJob
    );
    if (!started) {
      await finishGenerationServer(serviceClient, user.id, "character", reservationStartedAt, false);
      reservation = null;
      throw new Error("Could not start the background generation. Please try again.");
    }
    jobStarted = true;

    return Response.json(
      { status: "processing", usage: reservation },
      { status: 202, headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    console.error("DRESSED character generation failed.", error);
    if (!(error instanceof GenerationLimitError)) {
      await setGenerationStatus(client, user.id, "failed");
    }
    if (error instanceof GenerationLimitError) return jsonError(error.message, error.status);
    if (error instanceof OpenAIImageError) return jsonError(error.message, error.status ?? 502);
    return jsonError(
      error instanceof Error ? error.message : "Character generation failed. Please try again.",
      502
    );
  } finally {
    if (reservation && !jobStarted) await finishGeneration(client, "character");
  }
};
