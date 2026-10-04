import type { APIRoute } from "astro";
import { authenticateSupabaseRequest } from "../../../../lib/server/supabase";
import {
  clothingAssetCharacterId,
  CURRENT_CLOTHING_ASSET_VERSION,
  type ClothingBaseType,
} from "../../../../lib/shared/clothing-assets";

export const prerender = false;

type OutfitRow = {
  id: string;
  character_id: string;
  base_type: "woman" | "man";
  name: string;
  item_ids: string[];
  created_at: string;
  updated_at: string;
};

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export const GET: APIRoute = async ({ request }) => {
  const authentication = await authenticateSupabaseRequest(request);
  if (!authentication.ok) return jsonError(authentication.message, authentication.status);
  const { client, user } = authentication;

  const { data, error } = await client
    .from("saved_dressed_outfits")
    .select("id, character_id, base_type, name, item_ids, created_at, updated_at")
    .eq("user_id", user.id)
    .order("updated_at", { ascending: false })
    .returns<OutfitRow[]>();
  if (error) {
    console.error("Could not load saved DRESSED outfits.", error);
    return jsonError("Could not load your saved outfits. Apply the saved outfits migration first.", 503);
  }

  return Response.json(
    {
      outfits: (data ?? []).map((outfit) => ({
        id: outfit.id,
        characterId: outfit.character_id,
        baseType: outfit.base_type,
        name: outfit.name,
        itemIds: outfit.item_ids,
        createdAt: outfit.created_at,
        updatedAt: outfit.updated_at,
      })),
    },
    { headers: { "Cache-Control": "no-store" } }
  );
};

export const POST: APIRoute = async ({ request }) => {
  const authentication = await authenticateSupabaseRequest(request);
  if (!authentication.ok) return jsonError(authentication.message, authentication.status);
  const { client } = authentication;

  let body: { name?: unknown; itemIds?: unknown };
  try {
    const rawBody = await request.text();
    if (new TextEncoder().encode(rawBody).byteLength > 12_000) {
      return jsonError("The saved outfit request is too large.", 413);
    }
    const parsed: unknown = JSON.parse(rawBody);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return jsonError("The request body must be a JSON object.", 400);
    }
    body = parsed as typeof body;
  } catch {
    return jsonError("The request body must be valid JSON.", 400);
  }

  if (typeof body.name !== "string" || !body.name.trim() || body.name.trim().length > 80) {
    return jsonError("Enter an outfit name between 1 and 80 characters.", 400);
  }
  if (
    !Array.isArray(body.itemIds) ||
    body.itemIds.length < 1 ||
    body.itemIds.length > 5 ||
    body.itemIds.some((itemId) => typeof itemId !== "string" || !itemId.trim() || itemId.length > 100) ||
    new Set(body.itemIds).size !== body.itemIds.length
  ) {
    return jsonError("Choose between one and five distinct clothing items.", 400);
  }
  const itemIds = body.itemIds as string[];

  const { data: primaryCharacter, error: characterError } = await client
    .from("dressed_characters")
    .select("id, gender, geometry_contract_version")
    .eq("user_id", user.id)
    .eq("is_primary", true)
    .maybeSingle<{
      id: string;
      gender: ClothingBaseType;
      geometry_contract_version: string;
    }>();
  if (characterError) {
    console.error("Could not verify the primary character before saving an outfit.", characterError);
    return jsonError("Could not verify your primary character.", 500);
  }
  if (
    !primaryCharacter ||
    primaryCharacter.geometry_contract_version !== "normalized-v1" ||
    (primaryCharacter.gender !== "woman" && primaryCharacter.gender !== "man")
  ) {
    return jsonError("A current geometry-compatible primary character is required to save an outfit.", 409);
  }

  const { data: assets, error: assetsError } = await client
    .from("wardrobe_item_ai_assets")
    .select("item_id, reference_path, generation_version")
    .eq("user_id", user.id)
    .eq("base_type", primaryCharacter.gender)
    .in("item_id", itemIds)
    .returns<Array<{ item_id: string; reference_path: string; generation_version: number }>>();
  if (assetsError) {
    console.error("Could not verify the clothing layers before saving an outfit.", assetsError);
    return jsonError("Could not verify the selected clothing layers.", 503);
  }
  const compatibleItemIds = new Set(
    (assets ?? [])
      .filter((asset) =>
        asset.generation_version === CURRENT_CLOTHING_ASSET_VERSION &&
        clothingAssetCharacterId(user.id, asset.reference_path) === primaryCharacter.id
      )
      .map((asset) => asset.item_id)
  );
  if (itemIds.some((itemId) => !compatibleItemIds.has(itemId))) {
    return jsonError("Make every selected item AI ready for this primary character before saving.", 409);
  }

  const { data, error } = await client.rpc("save_dressed_outfit", {
    p_name: body.name.trim(),
    p_item_ids: itemIds,
  });
  if (error) {
    console.error("Could not save the DRESSED outfit.", error);
    const status = error.code === "P0001" ? 409 : 500;
    return jsonError(
      error.message?.includes("normalized geometry")
        ? "Generate a new geometry-compatible character before saving outfits."
        : error.message?.includes("AI-ready")
          ? "Make every selected item AI ready for this character type first."
          : "Could not save this outfit. Please try again.",
      status
    );
  }

  const saved = Array.isArray(data) ? data[0] : data;
  if (!saved || typeof saved.outfit_id !== "string") {
    console.error("The saved outfit function returned an invalid result.");
    return jsonError("The saved outfit could not be confirmed.", 500);
  }
  if (saved.character_id !== primaryCharacter.id) {
    const { error: cleanupError } = await client
      .from("saved_dressed_outfits")
      .delete()
      .eq("user_id", user.id)
      .eq("id", saved.outfit_id);
    if (cleanupError) {
      console.error("Could not remove an outfit saved during a primary-character change.", cleanupError);
      return jsonError("The primary character changed and the saved outfit could not be verified.", 500);
    }
    return jsonError("Your primary character changed while saving. Please try again.", 409);
  }
  return Response.json(
    {
      outfit: {
        id: saved.outfit_id,
        characterId: saved.character_id,
        baseType: saved.base_type,
        name: saved.outfit_name,
        itemIds: saved.item_ids,
        updatedAt: saved.updated_at,
      },
    },
    { headers: { "Cache-Control": "no-store" } }
  );
};
