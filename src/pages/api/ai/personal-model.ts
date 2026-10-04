import type { APIRoute } from "astro";
import { Buffer } from "node:buffer";
import type { SupabaseClient } from "@supabase/supabase-js";
import { authenticateSupabaseRequest } from "../../../lib/server/supabase";
import {
  editImage,
  imageDataUrl,
  moderateImage,
  OpenAIImageError,
} from "../../../lib/server/ai/openai-images";
import { imageExtension, matchesImageSignature } from "../../../lib/server/ai/image-input";
import { PNG } from "pngjs";
import { loadSystemBaseFormDataUrl } from "../../../lib/server/ai/base-forms";
import { DRESSED_GEOMETRY_CONTRACT_VERSION } from "../../../lib/shared/clothing-geometry";
import {
  finishGeneration,
  GenerationLimitError,
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

function characterPrompt(gender: "woman" | "man", hasBaseForm: boolean): string {
  const genderStyle =
    gender === "woman"
      ? "Create a feminine-presenting fashion character with the hair styled neatly away from the face, neck, and ears."
      : "Create a masculine-presenting fashion character with the hair styled neatly away from the face, neck, and ears.";

  const identity = hasBaseForm
    ? [
        "Image 1 is the user's identity reference. Use it only for the person's face, hairstyle, hair color, skin tone, and other visible identity characteristics.",
        `Image 2 is the canonical DRESSED ${gender} base form and the geometric master. Follow image 2 for the fixed 1024x1536 canvas, the centered placement, the straight front-facing pose, and the overall character geometry. Do not copy image 2's face, hair, or identity, and do not copy image 1's crop, camera framing, or pose.`,
      ]
    : ["Image 1 is the user's identity reference."];

  return [
    ...identity,
    "Create a polished, centered, straight, front-facing full-body DRESSED fashion character, with the full head and hair visible and the entire figure within a 2:3 canvas.",
    "Keep the user's recognizable face, hairstyle, hair color, and skin tone, without any eyewear or other worn items.",
    "Use a playful 1990s/Clueless-inspired fashion illustration style.",
    genderStyle,
    "Keep the hair behind the shoulders so the area where clothing layers will be placed stays clear.",
    "Use a relaxed standing pose with the arms slightly away from the sides and both feet visible.",
    "Use a simple, matte, opaque, solid-color sleeveless top and a simple, matte, opaque, solid-color short garment as a neutral character base, in a solid neutral color. The base outfit is only a visual foundation for the DRESSED clothing layers, and clothing from the source photo is not carried over. No shoes and no permanent fashion items.",
    "Create the character without wearable accessories so accessories can be added later as separate DRESSED layers. Draw a clean, bare face with clearly visible eyes and ears, and a plain neck and wrists. Items worn in image 1, such as glasses, sunglasses, hats, earrings, necklaces, bracelets, watches, bags, scarves and hair accessories, are not part of the person's identity and are left out; the hair itself is kept as in image 1.",
    "Use a clean, uniform, pure white background (#FFFFFF) across the whole canvas, replacing the background of image 2 and image 1, with soft, even studio-style lighting and no gradient, shadow on the background, or props.",
    "The final image is a clean digital fashion character illustration, not a photograph.",
  ].join(" ");
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
  let generatedPath: string | null = null;
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

    let baseFormDataUrl: string | null = null;
    try {
      baseFormDataUrl = await loadSystemBaseFormDataUrl(client, profile.gender);
    } catch (error) {
      console.warn(`The canonical ${profile.gender} base form is unavailable; generating without it.`, error);
    }

    const result = await editImage({
      images: baseFormDataUrl ? [sourceDataUrl, baseFormDataUrl] : [sourceDataUrl],
      size: "1024x1536",
      prompt: characterPrompt(profile.gender, Boolean(baseFormDataUrl)),
    });
    if (
      !matchesImageSignature(result.bytes, "image/png") ||
      result.bytes.toString("ascii", 12, 16) !== "IHDR" ||
      result.bytes.readUInt32BE(16) !== 1024 ||
      result.bytes.readUInt32BE(20) !== 1536
    ) {
      throw new Error("The generated character must be a 1024x1536 PNG.");
    }
    try {
      PNG.sync.read(result.bytes);
    } catch {
      throw new Error("The generated character could not be decoded as a PNG.");
    }

    generatedPath =
      `${user.id}/personal-model-${crypto.randomUUID()}.${imageExtension(result.mimeType)}`;
    const { error: uploadError } = await client.storage
      .from("model-images")
      .upload(generatedPath, result.bytes, {
        contentType: result.mimeType,
        upsert: false,
      });
    if (uploadError) {
      console.error("Could not store the generated DRESSED character.", uploadError);
      generatedPath = null;
      throw new Error("Could not save the generated character to your account.");
    }

    const { data: characterId, error: publishError } = await client.rpc(
      "publish_dressed_character",
      {
        p_model_path: generatedPath,
        p_gender: profile.gender,
      }
    );
    if (publishError || !characterId) {
      console.error("Could not publish the generated DRESSED character.", publishError);
      const pathToRemove = generatedPath;
      generatedPath = null;
      const { error: cleanupError } = await client.storage
        .from("model-images")
        .remove([pathToRemove]);
      if (cleanupError) console.error("Could not remove unlinked character image.", cleanupError);
      throw new Error("Could not save the generated character to your profile.");
    }

    return Response.json(
      {
        status: "completed",
        modelPhotoPath: generatedPath,
        characterId,
        gender: profile.gender,
        geometryContractVersion: DRESSED_GEOMETRY_CONTRACT_VERSION,
        usage: reservation,
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    console.error("DRESSED character generation failed.", error);
    if (generatedPath) {
      const { error: cleanupError } = await client.storage
        .from("model-images")
        .remove([generatedPath]);
      if (cleanupError) console.error("Could not remove unlinked character image.", cleanupError);
    }
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
    if (reservation) await finishGeneration(client, "character");
  }
};
