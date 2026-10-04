import type { APIRoute } from "astro";
import type { SupabaseClient } from "@supabase/supabase-js";
import { PNG } from "pngjs";
import { loadSystemBaseFormDataUrl } from "../../../lib/server/ai/base-forms";
import { launchBackgroundJob } from "../../../lib/server/ai/job-launcher";
import { runClothingJob, type ClothingJobPayload } from "../../../lib/server/ai/jobs/clothing-job";
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
  // The reusable asset is normalized against the canonical base form for this base type,
  // never against an individual user's personal model.
  let characterDataUrl: string;
  try {
    characterDataUrl = await loadSystemBaseFormDataUrl(client, baseType);
  } catch (error) {
    console.error(`Could not load the canonical ${baseType} base form.`, error);
    return jsonError(
      `The canonical ${baseType} reference model is not available. Please try again later.`,
      503
    );
  }

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
  let jobStarted = false;
  try {
    reservation = await reserveClothingGeneration(client);
    if (!originalPath) throw new Error("The original clothing image is missing.");
    const accessToken = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1] ?? "";
    const started = await launchBackgroundJob<ClothingJobPayload>(
      request,
      "process-clothing-background",
      {
        userId: user.id,
        accessToken,
        itemId: item.id,
        name: item.name,
        category: item.category,
        baseType,
        characterId: primaryCharacter.id,
        originalPath,
        existingAssetPath: existingAsset?.reference_path ?? null,
        reservationStartedAt: reservation.reservationStartedAt,
      },
      runClothingJob
    );
    if (!started) throw new Error("Could not start the background generation. Please try again.");
    jobStarted = true;

    return Response.json(
      { status: "processing", usage: reservation },
      { status: 202, headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    if (error instanceof GenerationLimitError) return jsonError(error.message, error.status);
    console.error("Clothing image processing could not be started.", error);
    return jsonError(
      error instanceof Error ? error.message : "Could not process this clothing image.",
      502
    );
  } finally {
    if (reservation && !jobStarted) {
      try {
        await finishClothingGeneration(serviceClient, user.id, reservation.reservationStartedAt, false);
      } catch (error) {
        console.error("Could not release the clothing reservation.", error);
      }
    }
  }
};