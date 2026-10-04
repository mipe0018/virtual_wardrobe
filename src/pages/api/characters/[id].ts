import type { APIRoute } from "astro";
import { authenticateSupabaseRequest } from "../../../lib/server/supabase";
import { DRESSED_GEOMETRY_CONTRACT_VERSION } from "../../../lib/shared/clothing-geometry";

export const prerender = false;

type CharacterRow = {
  id: string;
  model_path: string;
  gender: "woman" | "man";
  is_primary: boolean;
  geometry_contract_version: string | null;
};

type AssetRow = {
  reference_path: string;
};

type ActiveAssetRow = {
  reference_path: string;
};

type OutfitResultRow = {
  result_path: string;
};

function jsonError(message: string, status: number) {
  return Response.json(
    { error: message },
    { status, headers: { "Cache-Control": "no-store" } }
  );
}

export const DELETE: APIRoute = async ({ params, request }) => {
  const authentication = await authenticateSupabaseRequest(request);
  if (!authentication.ok) {
    return jsonError(authentication.message, authentication.status);
  }

  const { client, user } = authentication;
  const characterId = params.id;
  if (
    !characterId ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(characterId)
  ) {
    return jsonError("A valid character ID is required.", 400);
  }

  const { data: character, error: characterError } = await client
    .from("dressed_characters")
    .select("id, model_path, gender, is_primary, geometry_contract_version")
    .eq("user_id", user.id)
    .eq("id", characterId)
    .maybeSingle<CharacterRow>();
  if (characterError) {
    console.error("Could not look up the DRESSED character for deletion.", characterError);
    return jsonError("Could not remove this character.", 500);
  }
  if (!character) return jsonError("This DRESSED character was not found.", 404);

  const { data: characters, error: charactersError } = await client
    .from("dressed_characters")
    .select("id, model_path, gender, is_primary, geometry_contract_version")
    .eq("user_id", user.id)
    .returns<CharacterRow[]>();
  if (charactersError || !characters) {
    console.error("Could not verify the remaining DRESSED characters.", charactersError);
    return jsonError("Could not prepare this character for removal.", 500);
  }
  if (characters.length <= 1) {
    return jsonError("Keep at least one DRESSED character. Generate another before removing this one.", 409);
  }

  const currentPrimary = characters.find((savedCharacter) => savedCharacter.is_primary);
  let replacementPrimaryId: string | null = null;
  if (!currentPrimary || currentPrimary.id === character.id) {
    const replacement = characters.find((savedCharacter) =>
      savedCharacter.id !== character.id &&
      savedCharacter.gender === character.gender &&
      savedCharacter.geometry_contract_version === DRESSED_GEOMETRY_CONTRACT_VERSION &&
      savedCharacter.model_path.startsWith(`${user.id}/`)
    );
    if (!replacement) {
      return jsonError(
        "Generate or select another normalized DRESSED character before removing the primary character.",
        409
      );
    }
    replacementPrimaryId = replacement.id;
  }

  const [
    { data: assets, error: assetsError },
    { data: results, error: resultsError },
    { data: activeAssets, error: activeAssetsError },
  ] = await Promise.all([
    client
      .from("wardrobe_item_ai_assets_legacy")
      .select("reference_path")
      .eq("user_id", user.id)
      .eq("character_id", characterId)
      .returns<AssetRow[]>(),
    client
      .from("wardrobe_results")
      .select("result_path")
      .eq("user_id", user.id)
      .eq("character_id", characterId)
      .returns<OutfitResultRow[]>(),
    client
      .from("wardrobe_item_ai_assets")
      .select("reference_path")
      .eq("user_id", user.id)
      .like("reference_path", `${user.id}/clothing/${characterId}/%`)
      .returns<ActiveAssetRow[]>(),
  ]);
  if (assetsError || resultsError || activeAssetsError) {
    console.error("Could not collect DRESSED character and legacy asset files for deletion.", {
      assetsError,
      resultsError,
      activeAssetsError,
    });
    return jsonError("Could not prepare this character for removal.", 500);
  }

  const paths = Array.from(new Set([
    character.model_path,
    ...(assets ?? []).map((asset) => asset.reference_path),
    ...(results ?? []).map((result) => result.result_path),
    ...(activeAssets ?? []).map((asset) => asset.reference_path),
  ]));
  if (paths.some((path) => !path.startsWith(`${user.id}/`))) {
    console.error("Refused to remove DRESSED character files outside the user's folder.");
    return jsonError("A saved character image path is invalid.", 500);
  }

  let promotedCharacterId: string | null = null;
  if (replacementPrimaryId) {
    const { error: promoteError } = await client.rpc(
      "set_primary_dressed_character",
      { p_character_id: replacementPrimaryId }
    );
    if (promoteError) {
      console.error("Could not select a replacement primary DRESSED character.", promoteError);
      return jsonError("Could not select a replacement primary character.", 409);
    }
    promotedCharacterId = replacementPrimaryId;
  }

  const { data: deleted, error: deleteError } = await client.rpc(
    "delete_dressed_character",
    { p_character_id: characterId }
  );
  if (deleteError) {
    console.error("Could not delete the DRESSED character record.", deleteError);
    if (promotedCharacterId && currentPrimary) {
      const { error: restorePrimaryError } = await client.rpc(
        "set_primary_dressed_character",
        { p_character_id: currentPrimary.id }
      );
      if (restorePrimaryError) {
        console.error("Could not restore the previous primary character after deletion failed.", restorePrimaryError);
      }
    }
    return jsonError("Could not remove this character.", 500);
  }
  if (deleted !== true) {
    if (promotedCharacterId && currentPrimary) {
      const { error: restorePrimaryError } = await client.rpc(
        "set_primary_dressed_character",
        { p_character_id: currentPrimary.id }
      );
      if (restorePrimaryError) {
        console.error("Could not restore the previous primary character after deletion failed.", restorePrimaryError);
      }
    }
    return jsonError("This DRESSED character was not found.", 404);
  }

  let activeAssetsWarning: string | null = null;
  if (activeAssets?.length) {
    const { error: activeAssetsDeleteError } = await client
      .from("wardrobe_item_ai_assets")
      .delete()
      .eq("user_id", user.id)
      .in("reference_path", activeAssets.map((asset) => asset.reference_path));
    if (activeAssetsDeleteError) {
      console.error("Character was deleted, but its active clothing asset rows could not be removed.", activeAssetsDeleteError);
      activeAssetsWarning =
        "Character removed, but some character-specific clothing asset records could not be cleaned up.";
    }
  }

  if (paths.length) {
    const { error: storageError } = await client.storage
      .from("model-images")
      .remove(paths);
    if (storageError) {
      console.error(
        "The DRESSED character was removed, but some private images could not be cleaned up.",
        storageError
      );
      return Response.json(
        {
          warning: activeAssetsWarning ??
            "Character removed, but one or more stored images could not be cleaned up.",
        },
        { headers: { "Cache-Control": "no-store" } }
      );
    }
  }

  if (activeAssetsWarning) {
    return Response.json(
      { warning: activeAssetsWarning },
      { headers: { "Cache-Control": "no-store" } }
    );
  }

  return Response.json(
    { deleted: true },
    { headers: { "Cache-Control": "no-store" } }
  );
};
