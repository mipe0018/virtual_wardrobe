import type { APIRoute } from "astro";
import { authenticateSupabaseRequest } from "../../../../lib/server/supabase";
import {
  editImage,
  imageDataUrl,
  moderateImage,
  OpenAIImageError,
} from "../../../../lib/server/ai/openai-images";
import {
  imageExtension,
  matchesImageSignature,
  parseImageDataUrl,
} from "../../../../lib/server/ai/image-input";
import { PNG } from "pngjs";
import { CLOTHING_CATEGORIES, normalizeClothingCategory } from "../../../../lib/shared/clothing-categories";
import {
  CLOTHING_BASE_TYPES,
  CURRENT_CLOTHING_ASSET_VERSION,
  clothingAssetCharacterId,
  type ClothingBaseType,
} from "../../../../lib/shared/clothing-assets";
import {
  type SupabaseClient,
} from "@supabase/supabase-js";

export const prerender = false;

type WardrobeRow = {
  id: string;
  name: string;
  category: string;
  reference_path: string | null;
  original_path: string | null;
  preview_path: string | null;
  created_at: string;
};

type BaseAssetRow = {
  item_id: string;
  base_type: ClothingBaseType;
  reference_path: string;
  generation_version: number;
};

type CleanPreviewResult = {
  previewPath: string | null;
  previewUrl: string | null;
  error: string | null;
};

function isMissingPreviewPathColumn(error: { code?: string; message?: string }): boolean {
  return (
    error.message?.includes("preview_path") === true &&
    (error.code === "42703" || error.code === "PGRST204")
  );
}

async function createCleanPreview(
  client: SupabaseClient,
  userId: string,
  itemId: string,
  name: string,
  category: string,
  sourceBytes: Uint8Array,
  sourceMimeType: string,
): Promise<CleanPreviewResult> {
  let previewPath: string | null = null;
  try {
    const categoryLabel =
      CLOTHING_CATEGORIES.find((entry) => entry.value === category)?.label ?? "clothing item";
    const generated = await editImage({
      images: [imageDataUrl(sourceBytes, sourceMimeType)],
      size: "1024x1024",
      background: "opaque",
      prompt: [
        `Produce a strict product cutout of only the exact ${categoryLabel.toLowerCase()} named "${name}" from the uploaded reference.`,
        "Use the uploaded image as the sole image input and as a reference only for identifying the target and preserving its visible design. Never copy, extend, or recreate its scene.",
        "Show the target as a single garment arranged flat for a clean catalog photograph, fully visible, centered, and surrounded by generous pure-white space on a flat, evenly lit pure-white background. Do not use a person, support, or body-shaped form to display it.",
        "The exclusion of all non-garment content is absolute and takes priority over matching the source scene. Include no person or human feature whatsoever: no face, head, hair, skin, neck, hands, fingers, arms, legs, feet, body, body-shaped silhouette, reflection, or human shadow.",
        "Also include no mannequin, model, dress form, hanger, stand, other garment or layer, separate accessory, furniture, room, wall, floor, prop, background object, text overlay, watermark, environmental shadow, or cast shadow.",
        `If the target is worn or layered, isolate only the named ${categoryLabel.toLowerCase()}; exclude the wearer and every other clothing item, even when they overlap or touch the target.`,
        "Preserve the target garment's evidenced design and appearance: original colors, material texture, pattern, print, cut, proportions, construction, seams, pockets, buttons, zippers, and other visible details. Retain a logo or text only if it is physically part of this garment.",
        "Do not redesign, stylize, embellish, simplify, recolor, add details, substitute another garment, or infer details hidden or obscured in the source. If details are occluded, leave them unspecified rather than reconstructing a person or inventing garment detail.",
        "Keep the visible garment shape and design faithful to the reference, and do not crop any visible part of it. Replace all surrounding scene content with pure white.",
        "The final output is one square, opaque, garment-only catalog thumbnail. It is not a portrait, outfit-on-person image, scene, or character-aligned AI-ready layer.",
      ].join(" "),
    });
    if (!matchesImageSignature(generated.bytes, "image/png")) {
      throw new Error("The clean clothing preview was not returned as a PNG.");
    }
    try {
      PNG.sync.read(generated.bytes);
    } catch {
      throw new Error("The clean clothing preview could not be decoded as a PNG.");
    }

    previewPath = `${userId}/clothing-previews/${crypto.randomUUID()}.png`;
    const { error: uploadError } = await client.storage
      .from("model-images")
      .upload(previewPath, generated.bytes, { contentType: "image/png", upsert: false });
    if (uploadError) throw new Error("Could not save the clean clothing preview.");

    const { error: updateError } = await client
      .from("wardrobe_items")
      .update({ preview_path: previewPath, updated_at: new Date().toISOString() })
      .eq("user_id", userId)
      .eq("id", itemId);
    if (updateError) {
      console.error("Could not save the clean clothing preview path.", updateError);
      const { error: cleanupError } = await client.storage.from("model-images").remove([previewPath]);
      if (cleanupError) console.error("Could not remove an unlinked clean clothing preview.", cleanupError);
      previewPath = null;
      throw new Error("Could not save the clean clothing preview.");
    }

    const { data: signed, error: signError } = await client.storage
      .from("model-images")
      .createSignedUrl(previewPath, 60 * 5);
    if (signError || !signed) {
      console.error("Could not sign the clean clothing preview.", signError);
      return { previewPath, previewUrl: null, error: "Clean preview saved, but its thumbnail could not be loaded." };
    }
    return { previewPath, previewUrl: signed.signedUrl, error: null };
  } catch (error) {
    if (previewPath) {
      const { error: cleanupError } = await client.storage.from("model-images").remove([previewPath]);
      if (cleanupError) console.error("Could not remove a failed clean clothing preview.", cleanupError);
    }
    const message = error instanceof OpenAIImageError
      ? error.message
      : error instanceof Error ? error.message : "Could not create a clean clothing preview.";
    console.error("Clean clothing preview generation failed.", error);
    return { previewPath: null, previewUrl: null, error: message };
  }
}

type ResultRow = {
  id: string;
  item_ids: string[];
  result_path: string;
  created_at: string;
};

export const GET: APIRoute = async ({ request }) => {
  const authentication = await authenticateSupabaseRequest(request);
  if (!authentication.ok) {
    return Response.json(
      { error: authentication.message },
      { status: authentication.status, headers: { "Cache-Control": "no-store" } }
    );
  }

  const { client, user } = authentication;
  const [
    { data: resultRows, error: resultsError },
    { data: primaryCharacter, error: characterError },
  ] =
    await Promise.all([
      client
        .from("wardrobe_results")
        .select("id, item_ids, result_path, created_at")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(12)
        .returns<ResultRow[]>(),
      client
        .from("dressed_characters")
        .select("id, gender, geometry_contract_version")
        .eq("user_id", user.id)
        .eq("is_primary", true)
        .maybeSingle<{
          id: string;
          gender: "woman" | "man";
          geometry_contract_version: string;
        }>(),
    ]);

  if (resultsError || characterError) {
    console.error("Could not load saved wardrobe data.", { resultsError, characterError });
    return Response.json(
      { error: "Could not load your saved wardrobe. Apply the DRESSED AI migration first." },
      { status: 503, headers: { "Cache-Control": "no-store" } }
    );
  }

  let { data: itemRows, error: itemsError } = await client
    .from("wardrobe_items")
    .select("id, name, category, reference_path, original_path, preview_path, created_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: true })
    .returns<WardrobeRow[]>();
  let previewColumnAvailable = true;
  if (itemsError && isMissingPreviewPathColumn(itemsError)) {
    previewColumnAvailable = false;
    const legacyItems = await client
      .from("wardrobe_items")
      .select("id, name, category, reference_path, original_path, created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: true })
      .returns<Array<Omit<WardrobeRow, "preview_path">>>();
    itemRows = legacyItems.data?.map((item) => ({ ...item, preview_path: null })) ?? null;
    itemsError = legacyItems.error;
  }
  if (itemsError) {
    console.error("Could not load wardrobe items.", itemsError);
    return Response.json(
      { error: "Could not load your clothing items. Please try again." },
      { status: 503, headers: { "Cache-Control": "no-store" } }
    );
  }

  const rows = itemRows ?? [];
  const { data: assetRows, error: assetsError } =
    rows.length
      ? await client
          .from("wardrobe_item_ai_assets")
          .select("item_id, base_type, reference_path, generation_version")
          .eq("user_id", user.id)
          .in("item_id", rows.map((item) => item.id))
          .returns<BaseAssetRow[]>()
      : { data: [] as BaseAssetRow[], error: null };
  if (assetsError) {
    console.error("Could not load base-type clothing assets.", assetsError);
    return Response.json(
      { error: "Could not load AI-ready wardrobe items. Apply the base-type clothing assets migration." },
      { status: 503, headers: { "Cache-Control": "no-store" } }
    );
  }
  const assetsByItem = new Map<string, BaseAssetRow[]>();
  for (const asset of assetRows ?? []) {
    const entries = assetsByItem.get(asset.item_id) ?? [];
    entries.push(asset);
    assetsByItem.set(asset.item_id, entries);
  }

  const items = await Promise.all(rows.map(async (item) => {
    const itemAssets = assetsByItem.get(item.id) ?? [];
    const aiReadyAssets: Partial<Record<ClothingBaseType, {
      referencePath: string;
      previewUrl: string;
      generationVersion: number;
      characterId: string | null;
    }>> = {};
    await Promise.all(itemAssets.map(async (asset) => {
      if (!(CLOTHING_BASE_TYPES as readonly string[]).includes(asset.base_type)) return;
      if (!asset.reference_path.startsWith(`${user.id}/`)) {
        console.error("Skipped a wardrobe reference with an invalid owner path.", item.id);
        return;
      }
      const { data, error } = await client.storage
        .from("model-images")
        .createSignedUrl(asset.reference_path, 60 * 60);
      if (error || !data) {
        console.error(`Could not sign the ${asset.base_type} AI-ready preview for ${item.id}.`, error);
        return;
      }
      aiReadyAssets[asset.base_type] = {
        referencePath: asset.reference_path,
        previewUrl: data.signedUrl,
        generationVersion: asset.generation_version,
        characterId: clothingAssetCharacterId(user.id, asset.reference_path),
      };
    }));
    const baseType = primaryCharacter?.gender ?? null;
    const currentAsset = baseType ? aiReadyAssets[baseType] : undefined;
    const activeAsset = currentAsset?.generationVersion === CURRENT_CLOTHING_ASSET_VERSION
      ? currentAsset
      : undefined;
    let originalPreviewUrl: string | null = null;
    if (item.original_path) {
      if (!item.original_path.startsWith(`${user.id}/`)) {
        console.error("Skipped an original wardrobe image with an invalid owner path.", item.id);
      } else {
        const { data, error } = await client.storage
          .from("model-images")
          .createSignedUrl(item.original_path, 60 * 5);
        if (error || !data) {
          console.error(`Could not sign the original clothing preview for ${item.id}.`, error);
        } else {
          originalPreviewUrl = data.signedUrl;
        }
      }
    }
    let cleanPreviewUrl: string | null = null;
    if (previewColumnAvailable && item.preview_path) {
      if (!item.preview_path.startsWith(`${user.id}/`)) {
        console.error("Skipped a clean wardrobe preview with an invalid owner path.", item.id);
      } else {
        const { data, error } = await client.storage
          .from("model-images")
          .createSignedUrl(item.preview_path, 60 * 5);
        if (error || !data) {
          console.error(`Could not sign the clean clothing preview for ${item.id}.`, error);
        } else {
          cleanPreviewUrl = data.signedUrl;
        }
      }
    }
    return {
      id: item.id,
      name: item.name,
      category: item.category,
      referencePath: activeAsset?.referencePath ?? null,
      previewUrl: activeAsset?.previewUrl ?? null,
      originalPath: item.original_path,
      originalPreviewUrl,
      cleanPreviewPath: item.preview_path,
      cleanPreviewUrl,
      baseType: activeAsset ? baseType : null,
      aiReadyAssets,
      generationVersion: activeAsset?.generationVersion ?? null,
      createdAt: item.created_at,
    };
  }));

  const results = await Promise.all((resultRows ?? []).map(async (result) => {
    if (!result.result_path.startsWith(`${user.id}/`)) {
      console.error("Skipped a wardrobe result with an invalid owner path.", result.id);
      return null;
    }
    const { data, error } = await client.storage
      .from("model-images")
      .createSignedUrl(result.result_path, 60 * 60);
    if (error || !data) {
      console.error(`Could not sign wardrobe result ${result.id}.`, error);
      return null;
    }
    return {
      id: result.id,
      itemIds: result.item_ids,
      resultPath: result.result_path,
      previewUrl: data.signedUrl,
      createdAt: result.created_at,
    };
  }));

  return Response.json(
    {
      items: items.filter((item) => item !== null),
      results: results.filter((result) => result !== null),
      primaryCharacterId: primaryCharacter?.id ?? null,
      primaryCharacterBaseType:
        primaryCharacter?.geometry_contract_version === "normalized-v1"
          ? primaryCharacter.gender
          : null,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
};

export const POST: APIRoute = async ({ request }) => {
  const authentication = await authenticateSupabaseRequest(request);
  if (!authentication.ok) {
    return Response.json(
      { error: authentication.message },
      { status: authentication.status, headers: { "Cache-Control": "no-store" } }
    );
  }
  const { client, user } = authentication;
  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > 5_800_000) {
    return Response.json({ error: "Choose a smaller clothing image (4 MB maximum)." }, { status: 413 });
  }

  let body: { id?: unknown; name?: unknown; category?: unknown; imageDataUrl?: unknown };
  try {
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > 5_800_000) {
      return Response.json({ error: "Choose a smaller clothing image (4 MB maximum)." }, { status: 413 });
    }
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    body = parsed as typeof body;
  } catch {
    return Response.json({ error: "The request body must be a valid JSON object." }, { status: 400 });
  }
  if (typeof body.id !== "string" || !body.id.trim() || body.id.length > 100) {
    return Response.json({ error: "A valid clothing item ID is required." }, { status: 400 });
  }
  if (typeof body.name !== "string" || !body.name.trim() || body.name.trim().length > 100) {
    return Response.json({ error: "Enter an item name between 1 and 100 characters." }, { status: 400 });
  }
  const category = normalizeClothingCategory(body.category);
  if (!category) return Response.json({ error: "Choose a supported clothing category." }, { status: 400 });

  const { data: existing, error: lookupError } = await client
    .from("wardrobe_items")
    .select("original_path")
    .eq("user_id", user.id)
    .eq("id", body.id.trim())
    .maybeSingle<{ original_path: string | null }>();
  if (lookupError) {
    console.error("Could not check the original wardrobe item.", lookupError);
    return Response.json({ error: "Could not save this clothing item." }, { status: 500 });
  }

  let originalPath = existing?.original_path ?? null;
  let storedOriginalPath: string | null = null;
  let sourceBytes: Uint8Array | null = null;
  let sourceMimeType: string | null = null;
  if (originalPath && !originalPath.startsWith(`${user.id}/`)) {
    return Response.json({ error: "The saved original clothing image path is invalid." }, { status: 500 });
  }
  if (!originalPath) {
    const image = parseImageDataUrl(body.imageDataUrl, 4 * 1024 * 1024);
    if (!image) {
      return Response.json(
        { error: "Provide a valid JPG, PNG, or WEBP image no larger than 4 MB." },
        { status: 400 }
      );
    }
    const originalDataUrl = imageDataUrl(image.bytes, image.mimeType);
    sourceBytes = image.bytes;
    sourceMimeType = image.mimeType;
    try {
      await moderateImage(originalDataUrl);
    } catch (error) {
      if (error instanceof OpenAIImageError) {
        return Response.json({ error: error.message }, { status: error.status ?? 502 });
      }
      console.error("Original clothing moderation failed.", error);
      return Response.json({ error: "Could not check this clothing image. Please try again." }, { status: 502 });
    }

    storedOriginalPath =
      `${user.id}/clothing-originals/${crypto.randomUUID()}.${imageExtension(image.mimeType)}`;
    const { error: uploadError } = await client.storage
      .from("model-images")
      .upload(storedOriginalPath, image.bytes, {
        contentType: image.mimeType,
        upsert: false,
      });
    if (uploadError) {
      console.error("Could not store the original clothing image.", uploadError);
      return Response.json({ error: "Could not save the original clothing image." }, { status: 500 });
    }
    originalPath = storedOriginalPath;
  }

  const write = existing
    ? await client.from("wardrobe_items").update({
        name: body.name.trim(),
        category,
        original_path: originalPath,
        updated_at: new Date().toISOString(),
      }).eq("user_id", user.id).eq("id", body.id.trim()).is("original_path", null)
    : await client.from("wardrobe_items").upsert(
        {
          user_id: user.id,
          id: body.id.trim(),
          name: body.name.trim(),
          category,
          reference_path: null,
          original_path: originalPath,
        },
        { onConflict: "user_id,id", ignoreDuplicates: true }
      );
  if (write.error) {
    console.error("Could not save original clothing metadata.", write.error);
    if (storedOriginalPath) {
      const { error: cleanupError } = await client.storage.from("model-images").remove([storedOriginalPath]);
      if (cleanupError) console.error("Could not remove an unlinked original clothing image.", cleanupError);
    }
    return Response.json({ error: "Could not save the clothing item to your wardrobe." }, { status: 500 });
  }

  const { data: canonicalItem, error: canonicalItemError } = await client
    .from("wardrobe_items")
    .select("original_path")
    .eq("user_id", user.id)
    .eq("id", body.id.trim())
    .maybeSingle<{ original_path: string | null }>();
  if (canonicalItemError || !canonicalItem?.original_path) {
    console.error("Could not confirm the original wardrobe item path.", canonicalItemError);
    if (storedOriginalPath) {
      const { error: cleanupError } = await client.storage.from("model-images").remove([storedOriginalPath]);
      if (cleanupError) console.error("Could not remove an unlinked original clothing image.", cleanupError);
    }
    return Response.json({ error: "Could not save the original clothing item." }, { status: 500 });
  }
  if (canonicalItem.original_path !== originalPath) {
    if (storedOriginalPath) {
      const { error: cleanupError } = await client.storage.from("model-images").remove([storedOriginalPath]);
      if (cleanupError) console.error("Could not remove a duplicate original clothing upload.", cleanupError);
    }
    originalPath = canonicalItem.original_path;
  }

  let previewPath: string | null = null;
  let cleanPreviewUrl: string | null = null;
  let previewError: string | null = null;
  const { data: previewColumn, error: previewColumnError } = await client
    .from("wardrobe_items")
    .select("preview_path")
    .eq("user_id", user.id)
    .eq("id", body.id.trim())
    .maybeSingle<{ preview_path: string | null }>();
  if (previewColumnError) {
    if (isMissingPreviewPathColumn(previewColumnError)) {
      previewError = "Clothing was saved. Apply the clothing preview migration to enable clean previews.";
    } else {
      console.error("Could not check for a saved clean clothing preview.", previewColumnError);
      previewError = "Clothing was saved, but its clean preview could not be checked.";
    }
  } else {
    previewPath = previewColumn?.preview_path ?? null;
  }
  if (!previewError && !previewPath) {
    if (!sourceBytes || !sourceMimeType) {
      const { data: originalBlob, error: downloadError } = await client.storage
        .from("model-images")
        .download(originalPath);
      if (downloadError || !originalBlob) {
        console.error("Could not retrieve the original to create a clean clothing preview.", downloadError);
        previewError = "Original clothing was saved, but a clean preview could not be created.";
      } else {
        sourceBytes = new Uint8Array(await originalBlob.arrayBuffer());
        sourceMimeType = originalBlob.type.split(";")[0].toLowerCase();
      }
    }
    if (!previewError && sourceBytes && sourceMimeType) {
      const cleanPreview = await createCleanPreview(
        client,
        user.id,
        body.id.trim(),
        body.name.trim(),
        category,
        sourceBytes,
        sourceMimeType,
      );
      previewPath = cleanPreview.previewPath;
      cleanPreviewUrl = cleanPreview.previewUrl;
      previewError = cleanPreview.error;
    }
  }

  const { data: signed, error: signedError } = await client.storage
    .from("model-images")
    .createSignedUrl(originalPath, 60 * 5);
  if (signedError || !signed) {
    console.error("Could not sign the original clothing image preview.", signedError);
    return Response.json({ error: "Clothing was saved, but its preview could not be loaded." }, { status: 500 });
  }
  if (previewPath && !cleanPreviewUrl) {
    const { data: cleanPreviewSigned, error: cleanPreviewSignError } = await client.storage
      .from("model-images")
      .createSignedUrl(previewPath, 60 * 5);
    if (cleanPreviewSignError || !cleanPreviewSigned) {
      console.error("Could not sign the saved clean clothing preview.", cleanPreviewSignError);
      previewError ??= "Clean preview saved, but its thumbnail could not be loaded.";
    } else {
      cleanPreviewUrl = cleanPreviewSigned.signedUrl;
    }
  }
  return Response.json(
    {
      item: {
        id: body.id.trim(),
        name: body.name.trim(),
        category,
        originalPath,
        originalPreviewUrl: signed.signedUrl,
        previewPath,
        cleanPreviewUrl,
        previewError,
      },
    },
    { headers: { "Cache-Control": "no-store" } }
  );
};
