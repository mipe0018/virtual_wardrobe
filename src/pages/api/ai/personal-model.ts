import type { APIRoute } from "astro";
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

function characterPrompt(gender: "woman" | "man"): string {
  const genderStyle =
    gender === "woman"
      ? "Create a feminine-presenting character. Keep the hair styled neatly away from the face, neck, and ears so both ears and the neck are clearly visible."
      : "Create a masculine-presenting character. Keep the hair styled neatly away from the face, neck, and ears so both ears and the neck are clearly visible.";

  return [
    "Image 1 is the user's identity reference.",
    "Create a polished, front-facing full-body illustrated DRESSED fashion model, with the full head and hair visible and the entire figure within a centered 2:3 canvas.",
    "Preserve the user's recognizable face, hairstyle, hair color, skin tone and identifying visual details. Adapt the reference into a consistent full-body fashion-character composition rather than copying its crop or camera framing.",
    "Transform the person into a playful 1990s/Clueless-inspired fashion-doll editorial illustration.",
    genderStyle,
    "Always place all hair completely behind both shoulders. No hair may fall in front of either shoulder or overlap the chest, torso, or any area intended to be covered by later clothing layers; keep that clothing-layer area clear of hair.",
    "Use a natural, relaxed, front-facing standing fashion-model pose with arms slightly separated from the torso, feet visible, even margins, and consistent proportions. This figure is a stable reference for later clothing overlays.",
    "Use a simple, matte, opaque, solid-color sleeveless top and separate simple, matte, opaque mid-thigh bottoms. Keep both pieces visually neutral and functional only as a modest covering base layer, with a clear separation between the top and bottoms.",
    "Do not add pants, jeans, skirts, shorts, permanent fashion items, accessories, shoes, or outerwear. Do not emphasize the chest, hips, waist, or other body shapes; avoid suggestive framing or posing.",
    "Use a plain neutral background and even, soft studio lighting, without scenery, props, or dramatic shadows.",
    "Keep the face, hairstyle, general appearance, and overall character design consistent and recognizable.",
    "Do not add large accessories, jewelry, props, or objects. Do not cover the face, neck, or ears.",
    "The result should be a stylized digital fashion illustration, not a photograph.",
    "Keep the overall presentation neutral and non-sexualized, like a 1990s fashion editorial illustration.",
  ].join(" ");
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

    reservation = await reserveGeneration(client, "character");
    if (!(await setGenerationStatus(client, user.id, "pending"))) {
      throw new Error("Could not start character generation.");
    }
    if (!(await setGenerationStatus(client, user.id, "processing"))) {
      throw new Error("Could not update character generation status.");
    }

    const result = await editImage({
      images: [sourceDataUrl],
      size: "1024x1536",
      prompt: characterPrompt(profile.gender),
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
