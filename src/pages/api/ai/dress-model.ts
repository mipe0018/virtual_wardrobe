import type { APIRoute } from "astro";
import { authenticateSupabaseRequest } from "../../../lib/server/supabase";
import {
  editImage,
  imageDataUrl,
  OpenAIImageError,
} from "../../../lib/server/ai/openai-images";
import {
  finishGeneration,
  GenerationLimitError,
  reserveGeneration,
} from "../../../lib/server/ai/generation-usage";
import { CLOTHING_CATEGORIES } from "../../../lib/shared/clothing-categories";
import { CURRENT_CLOTHING_ASSET_VERSION } from "../../../lib/shared/clothing-assets";

export const prerender = false;

type WardrobeImageRow = {
  id: string;
  name: string;
  category: string;
};

type ProfileModel = {
  gender: "woman" | "man" | null;
  model_photo_path: string | null;
};

type PrimaryCharacter = {
  id: string;
  gender: "woman" | "man";
  model_path: string;
};

type CharacterClothingAsset = {
  item_id: string;
  base_type: "woman" | "man";
  reference_path: string;
  generation_version: number;
};

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function placement(category: string): string {
  switch (category) {
    case "shoes": return "place them naturally on the feet";
    case "bags": return "place it naturally on a shoulder or held at the side";
    case "jewelry": return "place it on the anatomically appropriate visible body area";
    case "necklaces": return "place it naturally around the visible neck";
    case "earrings": return "place them on the visible earlobes";
    case "bracelets": return "place them on the visible wrist";
    case "watches": return "place it on the visible wrist";
    case "glasses":
    case "sunglasses": return "place them naturally on the face over the eyes";
    case "hats": return "place it naturally on the head";
    case "hair-accessories": return "place it naturally in the hair without covering the face";
    case "accessories": return "place the accessory naturally in its appropriate location";
    default: return "replace only the corresponding clothing area";
  }
}

export const POST: APIRoute = async ({ request }) => {
  const authentication = await authenticateSupabaseRequest(request);
  if (!authentication.ok) return jsonError(authentication.message, authentication.status);
  const { client, user } = authentication;

  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > 16_000) {
    return jsonError("The request body is too large.", 413);
  }
  let requestedIds: unknown;
  try {
    const rawBody = await request.text();
    if (new TextEncoder().encode(rawBody).byteLength > 16_000) {
      return jsonError("The request body is too large.", 413);
    }
    const body: unknown = JSON.parse(rawBody);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return jsonError("The request body must be a JSON object.", 400);
    }
    requestedIds = (body as { itemIds?: unknown }).itemIds;
  } catch {
    return jsonError("The request body must be valid JSON.", 400);
  }
  if (
    !Array.isArray(requestedIds) ||
    requestedIds.length < 1 ||
    requestedIds.length > 5 ||
    requestedIds.some((id) => typeof id !== "string" || !id.trim() || id.length > 100) ||
    new Set(requestedIds).size !== requestedIds.length
  ) {
    return jsonError("Select between one and five valid, distinct clothing items.", 400);
  }
  const itemIds = requestedIds as string[];

  const { data: profile, error: profileError } = await client
    .from("profiles")
    .select("gender, model_photo_path")
    .eq("user_id", user.id)
    .maybeSingle<ProfileModel>();
  if (profileError) {
    console.error("Could not load the primary character for outfit generation.", profileError);
    return jsonError("Could not load your profile. Please try again.", 500);
  }
  const { data: primaryCharacter, error: characterError } = await client
    .from("dressed_characters")
    .select("id, gender, model_path")
    .eq("user_id", user.id)
    .eq("is_primary", true)
    .maybeSingle<PrimaryCharacter>();
  if (characterError) {
    console.error("Could not load the saved primary DRESSED character.", characterError);
    return jsonError("Could not load your saved character. Please try again.", 500);
  }

  const profileGender =
    profile?.gender === "woman" || profile?.gender === "man" ? profile.gender : null;
  if (
    profileGender &&
    primaryCharacter &&
    primaryCharacter.gender !== profileGender
  ) {
    return jsonError("Your saved primary character does not match your locked model type.", 409);
  }
  const characterGender = profileGender ?? primaryCharacter?.gender ?? null;
  const primaryCharacterPath =
    primaryCharacter?.model_path.startsWith(`${user.id}/`)
      ? primaryCharacter.model_path
      : null;
  const profileCharacterPath =
    profile?.model_photo_path?.startsWith(`${user.id}/`)
      ? profile.model_photo_path
      : null;
  const modelPhotoPath = primaryCharacterPath ?? profileCharacterPath;

  if (!characterGender || !modelPhotoPath || !primaryCharacter) {
    return jsonError("Generate your DRESSED character before styling an outfit.", 400);
  }

  // ============================================================
  // REUSABLE TRY-ON RESULT
  // ============================================================
  const outfitKey = JSON.stringify([...itemIds].sort());
  const { data: cachedResult, error: cachedResultError } = await client
    .from("wardrobe_results")
    .select("id, result_path")
    .eq("user_id", user.id)
    .eq("character_id", primaryCharacter.id)
    .eq("outfit_key", outfitKey)
    .not("character_id", "is", null)
    .not("outfit_key", "is", null)
    .maybeSingle<{ id: string; result_path: string }>();
  if (cachedResultError) {
    console.error("Could not look up a saved outfit result.", cachedResultError);
    return jsonError("Could not check for a saved outfit. Please try again.", 500);
  }
  if (cachedResult) {
    if (!cachedResult.result_path.startsWith(`${user.id}/`)) {
      console.error("The saved outfit result has an invalid owner path.", cachedResult.id);
      return jsonError("The saved outfit result path is invalid.", 500);
    }
    const { data: cachedPreview, error: cachedPreviewError } = await client.storage
      .from("model-images")
      .createSignedUrl(cachedResult.result_path, 60 * 60);
    if (cachedPreviewError || !cachedPreview) {
      console.error("Could not sign the saved outfit result preview.", cachedPreviewError);
      return jsonError("Could not load the saved outfit result.", 500);
    }

    const { data: usageRows, error: usageError } = await client.rpc(
      "get_ai_generation_usage"
    );
    if (usageError) {
      console.error("Could not load try-on usage for the saved outfit result.", usageError);
      return jsonError("Could not load generation limits. Please try again.", 503);
    }
    const tryOnUsage = Array.isArray(usageRows)
      ? usageRows.find((entry) => entry.generation_type === "tryon")
      : null;
    if (
      !tryOnUsage ||
      typeof tryOnUsage.used_count !== "number" ||
      typeof tryOnUsage.free_limit !== "number"
    ) {
      console.error("The generation usage service returned no valid try-on usage row.");
      return jsonError("Could not load try-on generation limits. Please try again.", 503);
    }

    return Response.json(
      {
        status: "completed",
        resultId: cachedResult.id,
        resultPath: cachedResult.result_path,
        previewUrl: cachedPreview.signedUrl,
        usage: {
          usedCount: tryOnUsage.used_count,
          freeLimit: tryOnUsage.free_limit,
        },
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  }

  const { data: items, error: itemError } = await client
    .from("wardrobe_items")
    .select("id, name, category")
    .eq("user_id", user.id)
    .in("id", itemIds)
    .returns<WardrobeImageRow[]>();
  if (itemError) {
    console.error("Could not load selected private wardrobe items.", itemError);
    return jsonError("Could not load the selected clothing. Please try again.", 500);
  }
  if (!items || items.length !== itemIds.length) {
    return jsonError(
      "One or more selected items are not prepared for AI styling yet. Use PREPARE FOR AI first.",
      409
    );
  }
  const { data: characterAssets, error: assetsError } = await client
    .from("wardrobe_item_ai_assets")
    .select("item_id, base_type, reference_path, generation_version")
    .eq("user_id", user.id)
    .in("item_id", itemIds)
    .returns<CharacterClothingAsset[]>();
  if (assetsError) {
    console.error("Could not load character-ready clothing assets.", assetsError);
    return jsonError("Could not load AI-ready clothing. Apply the character clothing assets migration first.", 503);
  }
  const assetsByItem = new Map((characterAssets ?? [])
    .filter((asset) =>
      asset.base_type === characterGender &&
      asset.generation_version === CURRENT_CLOTHING_ASSET_VERSION
    )
    .map((asset) => [asset.item_id, asset.reference_path]));
  const itemPaths = new Map<string, string>();
  for (const item of items) {
    const referencePath = assetsByItem.get(item.id);
    if (!referencePath || !referencePath.startsWith(`${user.id}/`)) {
      return jsonError(
        `“${item.name}” is not AI-ready for ${characterGender}. Make that version AI-ready first.`,
        409
      );
    }
    itemPaths.set(item.id, referencePath);
  }

  const { data: characterBlob, error: characterStorageError } = await client.storage
    .from("model-images")
    .download(modelPhotoPath);
  if (characterStorageError || !characterBlob) {
    console.error("Could not retrieve the private DRESSED character.", characterStorageError);
    return jsonError("Could not retrieve your saved character. Please try again.", 500);
  }
  const characterMime = characterBlob.type.split(";")[0].toLowerCase();
  if (characterBlob.size === 0 || characterBlob.size > 20 * 1024 * 1024) {
    return jsonError("The saved character image is empty or too large.", 400);
  }
  const imageInputs = [
    imageDataUrl(await characterBlob.arrayBuffer(), characterMime),
  ];

  for (const item of items) {
    const { data: itemBlob, error: itemBlobError } = await client.storage
      .from("model-images")
      .download(itemPaths.get(item.id)!);
    if (itemBlobError || !itemBlob) {
      console.error(`Could not retrieve the private clothing image for ${item.id}.`, itemBlobError);
      return jsonError("Could not retrieve a selected clothing image. Please try again.", 500);
    }
    if (itemBlob.size === 0 || itemBlob.size > 20 * 1024 * 1024) {
      return jsonError("A selected clothing image is empty or too large.", 400);
    }
    imageInputs.push(imageDataUrl(await itemBlob.arrayBuffer(), itemBlob.type || "image/png"));
  }

  let reservation: Awaited<ReturnType<typeof reserveGeneration>> | null = null;
  let resultPath: string | null = null;
  try {
    reservation = await reserveGeneration(client, "tryon");
    const clothingDescriptions = items.map((item, index) => {
      const label =
        CLOTHING_CATEGORIES.find((category) => category.value === item.category)?.label ??
        item.category;
      return `${index + 1}. ${label}: ${placement(item.category)}.`;
    });
    const result = await editImage({
      images: imageInputs,
      size: "1024x1536",
      prompt: [
        "Use the first image as the one fixed DRESSED character and all following images as exact clothing or accessory references.",
        "Keep the character's recognizable face, hair, skin tone, gender presentation, expression, pose, background, and body proportions unchanged.",
        "Add the referenced items to this same character. Change only the clothing regions or body areas necessary to wear/place those exact items.",
        "Preserve the exact colors, patterns, logos, material appearance, and distinctive details of each reference item. Do not invent replacement items or unrelated parts of a new outfit.",
        "Place each selected item as follows:",
        ...clothingDescriptions,
        "Keep the full character visible against the existing simple background. The result is a polished illustrated fashion character, not a photograph.",
      ].join(" "),
    });

    resultPath = `${user.id}/wardrobe-results/${crypto.randomUUID()}.png`;
    const { error: uploadError } = await client.storage
      .from("model-images")
      .upload(resultPath, result.bytes, {
        contentType: result.mimeType,
        upsert: false,
      });
    if (uploadError) {
      console.error("Could not save the generated outfit image.", uploadError);
      resultPath = null;
      throw new Error("Could not save the generated outfit.");
    }

    const { data: signed, error: signedError } = await client.storage
      .from("model-images")
      .createSignedUrl(resultPath, 60 * 60);
    if (signedError || !signed) {
      console.error("Could not sign the generated outfit preview.", signedError);
      throw new Error("Could not create a preview of the generated outfit.");
    }

    // ============================================================
    // SAVE TRY-ON RESULT
    // ============================================================
    const { data: resultRecord, error: recordError } = await client
      .from("wardrobe_results")
      .insert({
        user_id: user.id,
        item_ids: itemIds,
        result_path: resultPath,
        character_id: primaryCharacter.id,
        outfit_key: outfitKey,
      })
      .select("id")
      .maybeSingle();
    if (recordError || !resultRecord) {
      console.error("Could not save the generated outfit record.", recordError);
      const pathToRemove = resultPath;
      resultPath = null;
      const { error: cleanupError } = await client.storage
        .from("model-images")
        .remove([pathToRemove]);
      if (cleanupError) console.error("Could not remove unlinked outfit image.", cleanupError);
      throw new Error("The image was created, but could not be saved to your closet.");
    }

    return Response.json(
      {
        status: "completed",
        resultId: resultRecord.id,
        resultPath,
        previewUrl: signed.signedUrl,
        usage: reservation,
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    if (resultPath) {
      const { error: cleanupError } = await client.storage
        .from("model-images")
        .remove([resultPath]);
      if (cleanupError) console.error("Could not remove unlinked outfit image.", cleanupError);
    }
    if (error instanceof GenerationLimitError) return jsonError(error.message, error.status);
    if (error instanceof OpenAIImageError) return jsonError(error.message, error.status ?? 502);
    console.error("DRESSED character styling failed.", error);
    return jsonError(
      error instanceof Error ? error.message : "Could not style the DRESSED character.",
      502
    );
  } finally {
    if (reservation) await finishGeneration(client, "tryon");
  }
};
