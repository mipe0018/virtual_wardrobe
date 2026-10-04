import { Buffer } from "node:buffer";
import type { SupabaseClient } from "@supabase/supabase-js";
import { PNG } from "pngjs";
import { loadSystemBaseFormDataUrl } from "../base-forms";
import { editImage, imageDataUrl, setOpenAiApiKey } from "../openai-images";
import { imageExtension, matchesImageSignature } from "../image-input";
import { finishGenerationServer } from "../generation-usage";
import { createJobClients, jobUserIsValid, type JobEnv } from "../background";

const BACKGROUND_OPENAI_TIMEOUT_MS = 8 * 60 * 1000;

export type CharacterJobPayload = {
  userId: string;
  accessToken: string;
  gender: "woman" | "man";
  sourcePhotoPath: string;
  reservationStartedAt: string;
};

export function characterPrompt(gender: "woman" | "man", hasBaseForm: boolean): string {
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

async function setStatus(client: SupabaseClient, userId: string, status: "failed"): Promise<void> {
  const { error } = await client
    .from("profiles")
    .update({ model_generation_status: status })
    .eq("user_id", userId);
  if (error) console.error(`Could not set personal model status to ${status}.`, error);
}

// Runs the heavy part of character generation. Every path ends by releasing the
// reservation (crediting it back on failure) and, on failure, marking the profile failed.
export async function runCharacterJob(env: JobEnv, payload: CharacterJobPayload): Promise<void> {
  const { userId, accessToken, gender, sourcePhotoPath, reservationStartedAt } = payload;
  const { userClient, serviceClient } = createJobClients(env, accessToken);
  let succeeded = false;
  let generatedPath: string | null = null;
  try {
    setOpenAiApiKey(env.openaiKey);
    if (!(await jobUserIsValid(serviceClient, accessToken, userId))) {
      throw new Error("The background job could not verify the user.");
    }
    if (!sourcePhotoPath.startsWith(`${userId}/`)) {
      throw new Error("The saved source photo path is invalid.");
    }

    const { data: sourcePhoto, error: sourceError } = await userClient.storage
      .from("profile-images")
      .download(sourcePhotoPath);
    if (sourceError || !sourcePhoto) {
      throw new Error("Could not retrieve your saved photo. Please upload it again.");
    }
    const sourceMimeType = sourcePhoto.type.split(";")[0].toLowerCase();
    if (!["image/jpeg", "image/png", "image/webp"].includes(sourceMimeType)) {
      throw new Error("The saved source photo format is not supported.");
    }
    const sourceDataUrl = imageDataUrl(await sourcePhoto.arrayBuffer(), sourceMimeType);

    let baseFormDataUrl: string | null = null;
    try {
      baseFormDataUrl = await loadSystemBaseFormDataUrl(userClient, gender);
    } catch (error) {
      console.warn(`The canonical ${gender} base form is unavailable; generating without it.`, error);
    }

    const result = await editImage({
      images: baseFormDataUrl ? [sourceDataUrl, baseFormDataUrl] : [sourceDataUrl],
      size: "1024x1536",
      prompt: characterPrompt(gender, Boolean(baseFormDataUrl)),
      timeoutMs: BACKGROUND_OPENAI_TIMEOUT_MS,
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

    generatedPath = `${userId}/personal-model-${crypto.randomUUID()}.${imageExtension(result.mimeType)}`;
    const { error: uploadError } = await userClient.storage
      .from("model-images")
      .upload(generatedPath, result.bytes, { contentType: result.mimeType, upsert: false });
    if (uploadError) {
      console.error("Could not store the generated DRESSED character.", uploadError);
      generatedPath = null;
      throw new Error("Could not save the generated character to your account.");
    }

    const { data: characterId, error: publishError } = await userClient.rpc(
      "publish_dressed_character",
      { p_model_path: generatedPath, p_gender: gender }
    );
    if (publishError || !characterId) {
      console.error("Could not publish the generated DRESSED character.", publishError);
      throw new Error("Could not save the generated character to your profile.");
    }
    succeeded = true;
  } catch (error) {
    console.error("DRESSED character generation failed in the background job.", error);
    if (generatedPath) {
      const { error: cleanupError } = await serviceClient.storage
        .from("model-images")
        .remove([generatedPath]);
      if (cleanupError) console.error("Could not remove unlinked character image.", cleanupError);
    }
    await setStatus(serviceClient, userId, "failed");
  } finally {
    const released = await finishGenerationServer(
      serviceClient, userId, "character", reservationStartedAt, succeeded
    );
    if (!released) console.error("The character reservation was already released or expired.");
  }
}