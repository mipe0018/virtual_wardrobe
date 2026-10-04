import type { APIRoute } from "astro";
import type { SupabaseClient } from "@supabase/supabase-js";
import { PNG } from "pngjs";
import {
  authenticateSupabaseRequest,
  createSupabaseServiceClient,
} from "../../../lib/server/supabase";
import {
  editImage,
  imageDataUrl,
  moderateImage,
  OpenAIImageError,
} from "../../../lib/server/ai/openai-images";
import {
  ALLOWED_IMAGE_MIME_TYPES,
  imageExtension,
  matchesImageSignature,
  parseImageDataUrl,
} from "../../../lib/server/ai/image-input";
import {
  CLOTHING_CATEGORIES,
  normalizeClothingCategory,
} from "../../../lib/shared/clothing-categories";
import {
  CLOTHING_BASE_TYPES,
  CURRENT_CLOTHING_ASSET_VERSION,
  clothingAssetCharacterId,
  type ClothingBaseType,
} from "../../../lib/shared/clothing-assets";
import {
  finishClothingGeneration,
  GenerationLimitError,
  reserveClothingGeneration,
} from "../../../lib/server/ai/generation-usage";

export const prerender = false;

const MAX_REQUEST_BYTES = 5_800_000;
const MAX_SOURCE_BYTES = 4 * 1024 * 1024;
const MAX_ITEM_NAME_LENGTH = 100;

type ProcessClothingRequest = {
  id?: unknown;
  name?: unknown;
  category?: unknown;
  baseType?: unknown;
  imageDataUrl?: unknown;
};

type WardrobeItem = {
  name: string;
  category: string;
  reference_path: string | null;
  original_path: string | null;
  preview_path?: string | null;
};

type ClothingAsset = {
  reference_path: string;
  generation_version: number | null;
};

type PrimaryCharacter = {
  id: string;
  gender: ClothingBaseType;
  model_path: string;
  geometry_contract_version: string;
};

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function isMissingColumn(error: { code?: string; message?: string }, column: string): boolean {
  return (
    error.message?.includes(column) === true &&
    (error.code === "42703" || error.code === "PGRST204")
  );
}

function readJpegDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;

  let offset = 2;
  while (offset < bytes.length) {
    if (bytes[offset] !== 0xff) return null;
    while (bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset];
    offset += 1;

    if (marker === 0xd9 || marker === 0xda) break;
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      continue;
    }
    if (offset + 2 > bytes.length) return null;
    const segmentLength = (bytes[offset] << 8) | bytes[offset + 1];
    if (segmentLength < 2 || offset + segmentLength > bytes.length) return null;

    const isStartOfFrame =
      [0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]
        .includes(marker);
    if (isStartOfFrame) {
      if (segmentLength < 8) return null;
      return {
        height: (bytes[offset + 3] << 8) | bytes[offset + 4],
        width: (bytes[offset + 5] << 8) | bytes[offset + 6],
      };
    }
    offset += segmentLength;
  }
  return null;
}

function readWebpDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  if (
    bytes.length < 30 ||
    Buffer.from(bytes.subarray(0, 4)).toString("ascii") !== "RIFF" ||
    Buffer.from(bytes.subarray(8, 12)).toString("ascii") !== "WEBP"
  ) {
    return null;
  }

  const chunkLength = Buffer.from(bytes).readUInt32LE(16);
  if (chunkLength + 20 > bytes.length) return null;
  const chunkType = Buffer.from(bytes.subarray(12, 16)).toString("ascii");
  if (chunkType === "VP8X" && chunkLength >= 10) {
    return {
      width: 1 + bytes[24] + (bytes[25] << 8) + (bytes[26] << 16),
      height: 1 + bytes[27] + (bytes[28] << 8) + (bytes[29] << 16),
    };
  }
  if (chunkType === "VP8L" && chunkLength >= 5 && bytes[20] === 0x2f) {
    return {
      width: 1 + bytes[21] + ((bytes[22] & 0x3f) << 8),
      height:
        1 +
        ((bytes[22] & 0xc0) >> 6) +
        (bytes[23] << 2) +
        ((bytes[24] & 0x0f) << 10),
    };
  }
  if (
    chunkType === "VP8 " &&
    chunkLength >= 10 &&
    (bytes[20] & 0x01) === 0 &&
    bytes[23] === 0x9d &&
    bytes[24] === 0x01 &&
    bytes[25] === 0x2a
  ) {
    return {
      width: ((bytes[26] | (bytes[27] << 8)) & 0x3fff),
      height: ((bytes[28] | (bytes[29] << 8)) & 0x3fff),
    };
  }
  return null;
}

async function assetResponse(
  client: SupabaseClient,
  userId: string,
  item: { id: string; name: string; category: string },
  originalPath: string | null,
  cleanPreviewPath: string | null,
  referencePath: string,
  baseType: ClothingBaseType,
  characterId: string,
  cacheHit: boolean
) {
  if (!referencePath.startsWith(`${userId}/`)) {
    return jsonError("The saved AI-ready clothing path is invalid.", 500);
  }
  if (originalPath && !originalPath.startsWith(`${userId}/`)) {
    return jsonError("The saved original clothing path is invalid.", 500);
  }
  if (cleanPreviewPath && !cleanPreviewPath.startsWith(`${userId}/`)) {
    return jsonError("The saved clean clothing preview path is invalid.", 500);
  }
  const [{ data: preview, error: previewError }, original, cleanPreview] = await Promise.all([
    client.storage.from("model-images").createSignedUrl(referencePath, 60 * 5),
    originalPath
      ? client.storage.from("model-images").createSignedUrl(originalPath, 60 * 5)
      : Promise.resolve({ data: null, error: null }),
    cleanPreviewPath
      ? client.storage.from("model-images").createSignedUrl(cleanPreviewPath, 60 * 5)
      : Promise.resolve({ data: null, error: null }),
  ]);
  if (previewError || !preview) {
    console.error("Could not sign the saved AI-ready clothing preview.", previewError);
    return jsonError("Could not load the saved AI-ready clothing image.", 500);
  }
  if (original.error) {
    console.error("Could not sign the original clothing preview.", original.error);
  }
  if (cleanPreview.error) {
    console.error("Could not sign the clean clothing preview.", cleanPreview.error);
  }
  return Response.json(
    {
      status: "completed",
      item: {
        ...item,
        referencePath,
        previewUrl: preview.signedUrl,
        originalPath,
        originalPreviewUrl: original.data?.signedUrl ?? null,
        cleanPreviewPath,
        cleanPreviewUrl: cleanPreview.data?.signedUrl ?? null,
        baseType,
        characterId,
        generationVersion: CURRENT_CLOTHING_ASSET_VERSION,
        cacheHit,
      },
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}

export const POST: APIRoute = async ({ request }) => {
  const authentication = await authenticateSupabaseRequest(request);
  if (!authentication.ok) return jsonError(authentication.message, authentication.status);
  const { client, user } = authentication;

  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) {
    return jsonError("Choose a smaller clothing image (4 MB maximum).", 413);
  }

  let body: ProcessClothingRequest;
  try {
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > MAX_REQUEST_BYTES) {
      return jsonError("Choose a smaller clothing image (4 MB maximum).", 413);
    }
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return jsonError("The request body must be a valid JSON object.", 400);
    }
    body = parsed as ProcessClothingRequest;
  } catch {
    return jsonError("The request body must be valid JSON.", 400);
  }

  if (typeof body.id !== "string" || !body.id.trim() || body.id.length > 100) {
    return jsonError("A valid clothing item ID is required.", 400);
  }
  if (
    typeof body.name !== "string" ||
    !body.name.trim() ||
    body.name.trim().length > MAX_ITEM_NAME_LENGTH
  ) {
    return jsonError("Enter an item name between 1 and 100 characters.", 400);
  }
  const requestedCategory = normalizeClothingCategory(body.category);
  if (!requestedCategory) return jsonError("Choose a supported clothing category.", 400);
  if (!(CLOTHING_BASE_TYPES as readonly unknown[]).includes(body.baseType)) {
    return jsonError("Choose Woman or Man for this clothing generation.", 400);
  }
  const baseType = body.baseType as ClothingBaseType;

  const { data: primaryCharacter, error: characterError } = await client
    .from("dressed_characters")
    .select("id, gender, model_path, geometry_contract_version")
    .eq("user_id", user.id)
    .eq("is_primary", true)
    .maybeSingle<PrimaryCharacter>();
  if (characterError) {
    console.error("Could not load the primary character for clothing generation.", characterError);
    return jsonError("Could not load your primary DRESSED character.", 500);
  }
  if (!primaryCharacter) {
    return jsonError("Generate a DRESSED character before making clothing AI ready.", 409);
  }
  if (primaryCharacter.gender !== "woman" && primaryCharacter.gender !== "man") {
    console.error("The primary character has an unsupported gender/base type.", primaryCharacter.id);
    return jsonError("The primary DRESSED character type is invalid.", 409);
  }
  if (primaryCharacter.geometry_contract_version !== "normalized-v1") {
    return jsonError("Generate a new DRESSED character before making clothing AI ready.", 409);
  }
  if (primaryCharacter.gender !== baseType) {
    return jsonError(
      `This clothing layer must be generated for your primary ${primaryCharacter.gender} character.`,
      409
    );
  }
  if (!primaryCharacter.model_path.startsWith(`${user.id}/`)) {
    console.error("The primary character has an invalid private storage path.", primaryCharacter.id);
    return jsonError("The primary DRESSED character image path is invalid.", 500);
  }

  let { data: existingItem, error: itemLookupError } = await client
    .from("wardrobe_items")
    .select("name, category, reference_path, original_path, preview_path")
    .eq("user_id", user.id)
    .eq("id", body.id.trim())
    .maybeSingle<WardrobeItem>();
  if (itemLookupError && isMissingColumn(itemLookupError, "preview_path")) {
    const legacyItem = await client
      .from("wardrobe_items")
      .select("name, category, reference_path, original_path")
      .eq("user_id", user.id)
      .eq("id", body.id.trim())
      .maybeSingle<WardrobeItem>();
    existingItem = legacyItem.data;
    itemLookupError = legacyItem.error;
  }
  if (itemLookupError) {
    console.error("Could not look up the clothing item before processing.", itemLookupError);
    return jsonError("Could not load this wardrobe item. Please try again.", 500);
  }

  const item = {
    id: body.id.trim(),
    name: existingItem?.name ?? body.name.trim(),
    category: existingItem?.category ?? requestedCategory,
  };

  const { data: existingAsset, error: assetLookupError } = await client
    .from("wardrobe_item_ai_assets")
    .select("reference_path, generation_version")
    .eq("user_id", user.id)
    .eq("item_id", item.id)
    .eq("base_type", baseType)
    .maybeSingle<ClothingAsset>();
  if (assetLookupError) {
    console.error("Could not check for an existing base-type clothing asset.", assetLookupError);
    if (isMissingColumn(assetLookupError, "generation_version")) {
      return jsonError(
        "Apply the base-type clothing assets migration before making clothing AI-ready.",
        503
      );
    }
    return jsonError("Could not verify whether this item is already AI-ready. Apply the base-type clothing assets migration first.", 503);
  }
  if (
    existingAsset?.reference_path &&
    clothingAssetCharacterId(user.id, existingAsset.reference_path) === primaryCharacter.id &&
    existingAsset.generation_version === CURRENT_CLOTHING_ASSET_VERSION
  ) {
    return assetResponse(
      client,
      user.id,
      item,
      existingItem?.original_path ?? null,
      existingItem?.preview_path ?? null,
      existingAsset.reference_path,
      baseType,
      primaryCharacter.id,
      true
    );
  }

  let sourceBytes: Uint8Array;
  let sourceMimeType: string;
  let originalPath = existingItem?.original_path ?? null;
  let newlyStoredOriginalPath: string | null = null;
  if (originalPath) {
    if (!originalPath.startsWith(`${user.id}/`)) {
      return jsonError("The original clothing image path is invalid.", 400);
    }
    const { data: originalBlob, error: originalError } = await client.storage
      .from("model-images")
      .download(originalPath);
    if (originalError || !originalBlob) {
      console.error("Could not retrieve the original clothing image.", originalError);
      return jsonError("Could not retrieve the original clothing image. Please upload it again.", 500);
    }
    sourceBytes = new Uint8Array(await originalBlob.arrayBuffer());
    sourceMimeType = originalBlob.type.split(";")[0].toLowerCase();
    if (sourceBytes.length === 0 || sourceBytes.length > MAX_SOURCE_BYTES) {
      return jsonError("The original clothing image is empty or too large.", 400);
    }
    if (!["image/jpeg", "image/png", "image/webp"].includes(sourceMimeType)) {
      return jsonError("The original clothing image format is not supported.", 400);
    }
  } else {
    const parsed = parseImageDataUrl(body.imageDataUrl, MAX_SOURCE_BYTES);
    if (!parsed) {
      return jsonError("Provide a valid JPG, PNG, or WEBP image no larger than 4 MB.", 400);
    }
    sourceBytes = parsed.bytes;
    sourceMimeType = parsed.mimeType;
    newlyStoredOriginalPath =
      `${user.id}/clothing-originals/${crypto.randomUUID()}.${imageExtension(sourceMimeType)}`;
  }

  const sourceDataUrl = imageDataUrl(sourceBytes, sourceMimeType);
  const { data: characterBlob, error: characterImageError } = await client.storage
    .from("model-images")
    .download(primaryCharacter.model_path);
  if (characterImageError || !characterBlob) {
    console.error("Could not download the primary character reference image.", characterImageError);
    return jsonError("Could not load your primary DRESSED character image.", 503);
  }
  if (characterBlob.size === 0 || characterBlob.size > 20 * 1024 * 1024) {
    return jsonError("Your primary DRESSED character image is empty or too large.", 409);
  }
  const characterBytes = new Uint8Array(await characterBlob.arrayBuffer());
  const characterMimeType = ALLOWED_IMAGE_MIME_TYPES.find((mimeType) =>
    matchesImageSignature(characterBytes, mimeType)
  );
  if (!characterMimeType) {
    return jsonError("Your primary DRESSED character must be a valid PNG, JPEG, or WEBP image.", 409);
  }

  let characterDimensions: { width: number; height: number } | null = null;
  try {
    if (characterMimeType === "image/png") {
      if (Buffer.from(characterBytes).toString("ascii", 12, 16) !== "IHDR") {
        throw new Error("Invalid PNG header.");
      }
      const decodedCharacter: PNG = PNG.sync.read(Buffer.from(characterBytes));
      characterDimensions = {
        width: decodedCharacter.width,
        height: decodedCharacter.height,
      };
    } else if (characterMimeType === "image/jpeg") {
      characterDimensions = readJpegDimensions(characterBytes);
    } else {
      characterDimensions = readWebpDimensions(characterBytes);
    }
  } catch {
    return jsonError("Your primary DRESSED character image is invalid or unreadable.", 409);
  }
  if (!characterDimensions) {
    return jsonError("Your primary DRESSED character image is invalid or unreadable.", 409);
  }
  if (characterDimensions.width !== 1024 || characterDimensions.height !== 1536) {
    return jsonError("Your primary DRESSED character must be exactly 1024x1536 pixels.", 409);
  }
  const characterDataUrl = imageDataUrl(characterBytes, characterMimeType);

  try {
    await moderateImage(sourceDataUrl);
  } catch (error) {
    if (error instanceof OpenAIImageError) {
      return jsonError(error.message, error.status ?? 502);
    }
    console.error("Clothing image moderation failed.", error);
    return jsonError("Could not check the clothing image. Please try again.", 502);
  }

  if (newlyStoredOriginalPath) {
    const { error: originalUploadError } = await client.storage
      .from("model-images")
      .upload(newlyStoredOriginalPath, sourceBytes, {
        contentType: sourceMimeType,
        upsert: false,
      });
    if (originalUploadError) {
      console.error("Could not persist the original clothing image.", originalUploadError);
      return jsonError("Could not save the original clothing image.", 500);
    }
    originalPath = newlyStoredOriginalPath;

    const write = existingItem
      ? await client.from("wardrobe_items")
          .update({ original_path: originalPath, updated_at: new Date().toISOString() })
          .eq("user_id", user.id)
          .eq("id", item.id)
          .is("original_path", null)
      : await client.from("wardrobe_items").upsert(
          {
            user_id: user.id,
            id: item.id,
            name: item.name,
            category: item.category,
            reference_path: null,
            original_path: originalPath,
          },
          { onConflict: "user_id,id", ignoreDuplicates: true }
        );
    if (write.error) {
      console.error("Could not save the original wardrobe item metadata.", write.error);
      const { error: cleanupError } = await client.storage
        .from("model-images")
        .remove([originalPath]);
      if (cleanupError) console.error("Could not remove an unlinked original clothing image.", cleanupError);
      return jsonError("Could not save the original clothing item.", 500);
    }
    const { data: canonicalItem, error: canonicalItemError } = await client
      .from("wardrobe_items")
      .select("original_path")
      .eq("user_id", user.id)
      .eq("id", item.id)
      .maybeSingle<{ original_path: string | null }>();
    if (canonicalItemError || !canonicalItem?.original_path) {
      console.error("Could not confirm the original clothing path.", canonicalItemError);
      const { error: cleanupError } = await client.storage
        .from("model-images")
        .remove([originalPath]);
      if (cleanupError) console.error("Could not remove an unlinked original clothing image.", cleanupError);
      return jsonError("Could not save the original clothing item.", 500);
    }
    if (canonicalItem.original_path !== originalPath) {
      const orphanedPath = originalPath;
      originalPath = canonicalItem.original_path;
      const { error: cleanupError } = await client.storage
        .from("model-images")
        .remove([orphanedPath]);
      if (cleanupError) console.error("Could not remove a duplicate original clothing upload.", cleanupError);
    }
  }

  let serviceClient: SupabaseClient;
  try {
    serviceClient = createSupabaseServiceClient();
  } catch (error) {
    console.error("Trusted asset persistence is not configured.", error);
    return jsonError("AI-ready clothing storage is not configured on the server.", 503);
  }

  let reservation: Awaited<ReturnType<typeof reserveClothingGeneration>> | null = null;
  let generatedPath: string | null = null;
  let aiAssetPersisted = false;
  try {
    reservation = await reserveClothingGeneration(client);
    const categoryLabel =
      CLOTHING_CATEGORIES.find((entry) => entry.value === item.category)?.label ?? "clothing item";
    const itemName = JSON.stringify(item.name);
    const generated = await editImage({
      images: [characterDataUrl, sourceDataUrl],
      size: "1024x1536",
      background: "transparent",
      prompt: [
        `Image 1 is the user's current primary DRESSED ${baseType} character and the ABSOLUTE geometric reference for this clothing layer.`,
        "The garment must fit this existing character's exact body proportions, position, pose, framing, scale, and body placement. Follow image 1's shoulders, neck, chest, waist, hips, arms, and legs precisely, using the same 1024x1536 canvas and pixel coordinate system.",
        "Do not generate, redraw, alter, or replace the person or body. Do not change the character's proportions, pose, or position, and do not move the character to a different position on the canvas. Garment placement must follow image 1 exactly, so the output overlays directly on image 1. The garment may be scaled as needed to match the character's actual size.",
        "Do not copy, reproduce, edit, or include any pixels from image 1. Do not render any part of the person, body, skin, hair, base clothing, mannequin, or background in the output.",
        `Image 2 is the original clothing source and the sole visual source for the design of this ${categoryLabel.toLowerCase()}.`,
        `The user-selected target item is named ${itemName}; use its name and category only to identify which item to isolate if image 2 contains multiple objects.`,
        "Create exactly one separate transparent clothing layer fitted to and positioned over the corresponding area of the character in image 1; show only the garment itself, not the person wearing it.",
        "Preserve the clothing source's color, material, pattern, construction, shape, length, sleeves, collar, pockets, logos, text, and details; make no unnecessary design changes.",
        "Fit the garment's scale and placement to this character's shoulders, chest, waist, hips, arms, and body pose while retaining the source garment's design.",
        "Treat image 2 as a design reference sheet, not a size reference. Image 2 determines only the garment's design, shape, colors, material, details, and length/type. Image 2's own image size, cropping, or garment bounding box must NEVER determine the final physical size of the garment.",
        "Image 1 determines the actual size, placement, proportions, body landmarks, and where the garment sits. First identify the relevant body areas of the character in image 1, then fit the garment to them. Top/blouse: shoulder width follows the character's shoulders, neckline sits at the character's neck, hem sits relative to the character's waist/hip. Trousers/skirt: waist follows the character's waist, hip width follows the hips, legs and length follow the character's legs. Jacket: shoulders and neck follow the character, sleeves follow the character's arms, length sits relative to the character's torso. Dress: upper body, waist, hips, and length follow the character.",
        "If the garment in image 2 fills a very small or very large part of its photo, this must not affect the final size. If its bounding box is larger than the corresponding area of the character, scale the garment down to fit the character's real body measurements; if smaller, scale it up accordingly. If image 2's garment size conflicts with the character's proportions in image 1, image 1 ALWAYS wins; scaling the garment significantly up or down is preferred over a wrong size on the character.",
        "A clearly wrong size must be solved by actually scaling the garment. The character's actual size and body areas in image 1 determine the garment's physical size.",
        "SLEEVES AND ARMS: look at the pose of the character's arms in image 1 and draw every sleeve in exactly that pose. If the arms hang straight down close to the torso, the sleeves must hang straight down close to the torso, from the shoulder seam to the cuff, with the cuff ending where the character's wrist or forearm ends. Do not draw sleeves angled outward, in a T-pose or A-pose, or wider than the character's arms. Each sleeve must lie directly over the character's own arm; the garment's body and sleeves must not be wider than the character's torso and arms plus a small garment allowance.",
        "SHOULDER ALIGNMENT AND WIDTH: place the garment's shoulder points directly at the character's actual shoulders in image 1. The garment's shoulder line must align with the character's actual shoulder line and must never sit below it. The neckline stays aligned with the character's neck while the shoulders extend outward laterally to reach the character's actual shoulder positions. Use image 1's actual shoulder-to-shoulder width as the reference; do not keep a narrower shoulder width from image 2. The garment may be warped outward at the shoulders while preserving its original design.",
        "SLEEVE SIZE: keep the sleeves following the character's arms, but make them large enough to cover the character's actual arms. Sleeve width must follow the visible arm width and never be narrower than the arm. Each sleeve extends from the correctly aligned shoulder and arm attachment point along the character's arm to the appropriate wrist or forearm endpoint. Do not make a sleeve smaller merely to preserve the source garment's original proportions.",
        "OVERALL SIZE AND POSITION: make the garment slightly larger and slightly higher than a plain fit would suggest, as a small controlled adjustment only. Its torso width follows the character's actual torso width, slightly wider where needed to reach the shoulders and arms, and it must not become wider than the corresponding body areas of the character. Do not achieve this by enlarging the whole garment uniformly; expand and warp the shoulder, torso, and sleeve regions independently so each follows its body region.         Do not shift the whole garment markedly upward.",        "Image 1 determines physical size, position, shoulder width, arm width, torso width, and body alignment. Image 2 determines only design, color, material, pattern, construction, and details. Preserve the garment's visual identity while adapting its geometry to image 1.",
        "When unsure about the garment's size because of image 2's cropping or bounding box, prioritize: character geometry, then anatomical landmarks, then garment fit, then reference image scale. Never let the reference image bounding box decide garment size. Keep the garment's design as close to image 2 as possible while adapting its size and placement to the character.",
        "FRONT-FACING DIGITAL DRESS-UP DOLL LAYER: the result is a front-facing 2D clothing layer placed directly on top of the character, behaving like a layer in a digital paper dress-up doll. Generate only the parts of the garment that would be visible when the character is seen straight from the front.",
        "Do not generate a back side of the garment. Do not generate an inner back, lining, inside, or any extra fabric layer that is not visible from the front. Do not generate a complete 3D rendering of the garment. Do not render the garment as a freestanding object or a product photo; convert its design into a clean front-facing layer.",
        "Where an area of the character is covered by the garment from the front, the clothing layer must cover that area directly. The garment's placement must follow the character's front-facing body and its actual landmarks. Keep the garment's colors, pattern, neckline, sleeves, buttons, belts, ruffles, and other design details.",
        "Priority order: 1) the character's size and position determine the garment's size, 2) the garment has the correct physical size on the character, 3) the garment is front-facing and works as a digital layer, 4) the garment follows the character's body position and landmarks, 5) the garment's design and characteristic details are preserved, 6) the output is a transparent PNG of 1024x1536.",
        "Return a transparent 1024x1536 PNG with exactly the same canvas, framing, and pixel coordinate system as image 1, preserving the transparent background.",
        "Output only the clothing asset itself. Clothing pixels are the only permitted visible pixels; every pixel outside the garment must have alpha 0. Add no background, new person, mannequin, or extra elements.",
        "The output must contain no character/person pixels whatsoever: no face, hair, skin, hands, arms, legs, mannequin, hanger, room, background, shadows outside the garment, or unrelated object.",
      ].join(" "),
    });

    if (
      generated.bytes.length < 24 ||
      !matchesImageSignature(generated.bytes, "image/png") ||
      generated.bytes.toString("ascii", 12, 16) !== "IHDR" ||
      generated.bytes.readUInt32BE(16) !== 1024 ||
      generated.bytes.readUInt32BE(20) !== 1536
    ) {
      throw new Error("The generated clothing layer is not a 1024x1536 PNG.");
    }

    let decoded: PNG;
    try {
      decoded = PNG.sync.read(generated.bytes);
    } catch {
      throw new Error("The generated clothing layer could not be decoded as a PNG.");
    }
    let hasTransparentPixel = false;
    let hasVisiblePixel = false;
    for (let offset = 3; offset < decoded.data.length; offset += 4) {
      const alpha = decoded.data[offset];
      if (alpha < 255) hasTransparentPixel = true;
      if (alpha > 0) hasVisiblePixel = true;
      if (hasTransparentPixel && hasVisiblePixel) break;
    }
    if (!hasTransparentPixel || !hasVisiblePixel) {
      throw new Error("The generated clothing layer must contain both transparent and visible pixels.");
    }
    const cornerAlphas = [
      decoded.data[3],
      decoded.data[(decoded.width - 1) * 4 + 3],
      decoded.data[((decoded.height - 1) * decoded.width) * 4 + 3],
      decoded.data[(decoded.width * decoded.height - 1) * 4 + 3],
    ];
    if (cornerAlphas.some((alpha) => alpha !== 0)) {
      throw new Error("The generated clothing layer must have transparent corners.");
    }

    const { data: stillPrimary, error: primaryCheckError } = await client
      .from("dressed_characters")
      .select("id")
      .eq("user_id", user.id)
      .eq("id", primaryCharacter.id)
      .eq("is_primary", true)
      .maybeSingle<{ id: string }>();
    if (primaryCheckError) {
      console.error("Could not verify the primary character after clothing generation.", primaryCheckError);
      throw new Error("Could not verify that your primary character is still active.");
    }
    if (!stillPrimary) {
      throw new Error("Your primary character changed during clothing generation. Please try again.");
    }

    generatedPath =
      `${user.id}/clothing/${primaryCharacter.id}/${crypto.randomUUID()}.${imageExtension(generated.mimeType)}`;
    const { error: uploadError } = await client.storage
      .from("model-images")
      .upload(generatedPath, generated.bytes, {
        contentType: generated.mimeType,
        upsert: false,
      });
    if (uploadError) {
      console.error("Could not save the processed clothing reference.", uploadError);
      generatedPath = null;
      throw new Error("Could not save the processed clothing image.");
    }

    const { data: signed, error: signedError } = await client.storage
      .from("model-images")
      .createSignedUrl(generatedPath, 60 * 5);
    if (signedError || !signed) {
      console.error("Could not create a private clothing preview URL.", signedError);
      throw new Error("Could not create a preview of the processed clothing.");
    }

    const { error: assetWriteError } = await serviceClient
      .from("wardrobe_item_ai_assets")
      .upsert({
        user_id: user.id,
        item_id: item.id,
        base_type: baseType,
        reference_path: generatedPath,
        generation_version: CURRENT_CLOTHING_ASSET_VERSION,
        updated_at: new Date().toISOString(),
      }, { onConflict: "user_id,item_id,base_type" });
    if (assetWriteError) {
      console.error("Could not save the base-type AI-ready asset.", assetWriteError);
      throw new Error("Could not save the AI-ready clothing asset.");
    }
    aiAssetPersisted = true;
    if (
      existingAsset?.reference_path &&
      existingAsset.reference_path !== generatedPath &&
      existingAsset.reference_path.startsWith(`${user.id}/`)
    ) {
      const { error: oldAssetRemovalError } = await client.storage
        .from("model-images")
        .remove([existingAsset.reference_path]);
      if (oldAssetRemovalError) {
        console.error("Could not remove the replaced legacy clothing layer.", oldAssetRemovalError);
      }
    } else if (existingAsset?.reference_path && !existingAsset.reference_path.startsWith(`${user.id}/`)) {
      console.error("Skipped removing a replaced legacy layer with an invalid owner path.", item.id);
    }

    let originalPreviewUrl: string | null = null;
    if (originalPath) {
      const { data: originalSigned, error: originalSignError } = await client.storage
        .from("model-images")
        .createSignedUrl(originalPath, 60 * 5);
      if (originalSignError) {
        console.error("Could not sign the persisted original clothing image.", originalSignError);
      }
      originalPreviewUrl = originalSigned?.signedUrl ?? null;
    }
    let cleanPreviewUrl: string | null = null;
    const cleanPreviewPath = existingItem?.preview_path ?? null;
    if (cleanPreviewPath) {
      const { data: cleanPreviewSigned, error: cleanPreviewSignError } = await client.storage
        .from("model-images")
        .createSignedUrl(cleanPreviewPath, 60 * 5);
      if (cleanPreviewSignError) {
        console.error("Could not sign the clean clothing preview.", cleanPreviewSignError);
      }
      cleanPreviewUrl = cleanPreviewSigned?.signedUrl ?? null;
    }

    return Response.json(
      {
        status: "completed",
        item: {
          ...item,
          referencePath: generatedPath,
          previewUrl: signed.signedUrl,
          originalPath,
          originalPreviewUrl,
          cleanPreviewPath,
          cleanPreviewUrl,
          baseType,
          characterId: primaryCharacter.id,
          generationVersion: CURRENT_CLOTHING_ASSET_VERSION,
          cacheHit: false,
        },
        usage: reservation,
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    if (generatedPath && !aiAssetPersisted) {
      const { error: cleanupError } = await client.storage
        .from("model-images")
        .remove([generatedPath]);
      if (cleanupError) console.error("Could not remove an unlinked AI-ready clothing image.", cleanupError);
    }
    if (error instanceof GenerationLimitError) return jsonError(error.message, error.status);
    if (error instanceof OpenAIImageError) return jsonError(error.message, error.status ?? 502);
    console.error("Clothing image processing failed.", error);
    return jsonError(
      error instanceof Error ? error.message : "Could not process this clothing image.",
      502
    );
  } finally {
    if (reservation) {
      await finishClothingGeneration(
        serviceClient,
        user.id,
        reservation.reservationStartedAt,
        aiAssetPersisted
      );
    }
  }
};
