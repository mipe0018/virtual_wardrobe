import type { APIRoute } from "astro";
import {
  authenticateSupabaseRequest,
  createSupabaseServiceClient,
} from "../../../../lib/server/supabase";
import { parsePlacement, type Placement } from "../../../../lib/shared/clothing-placement";

export const prerender = false;

function isMissingPreviewPathColumn(error: { code?: string; message?: string }): boolean {
  return (
    error.message?.includes("preview_path") === true &&
    (error.code === "42703" || error.code === "PGRST204")
  );
}

export const DELETE: APIRoute = async ({ params, request }) => {
  const authentication = await authenticateSupabaseRequest(request);
  if (!authentication.ok) {
    return Response.json(
      { error: authentication.message },
      { status: authentication.status, headers: { "Cache-Control": "no-store" } }
    );
  }
  const { client, user } = authentication;
  const itemId = params.id;
  if (!itemId || itemId.length > 100) {
    return Response.json({ error: "A valid item ID is required." }, { status: 400 });
  }

  let { data: item, error: lookupError } = await client
    .from("wardrobe_items")
    .select("reference_path, original_path, preview_path")
    .eq("user_id", user.id)
    .eq("id", itemId)
    .maybeSingle<{
      reference_path: string | null;
      original_path: string | null;
      preview_path: string | null;
    }>();
  if (lookupError && isMissingPreviewPathColumn(lookupError)) {
    const legacyItem = await client
      .from("wardrobe_items")
      .select("reference_path, original_path")
      .eq("user_id", user.id)
      .eq("id", itemId)
      .maybeSingle<{ reference_path: string | null; original_path: string | null }>();
    item = legacyItem.data ? { ...legacyItem.data, preview_path: null } : null;
    lookupError = legacyItem.error;
  }
  if (lookupError) {
    console.error("Could not look up the wardrobe item for deletion.", lookupError);
    return Response.json({ error: "Could not remove this item." }, { status: 500 });
  }
  if (!item) {
    return Response.json({ error: "This clothing item was not found." }, { status: 404 });
  }

  const [
    { data: assets, error: assetsError },
    { data: legacyAssets, error: legacyAssetsError },
  ] = await Promise.all([
    client
      .from("wardrobe_item_ai_assets")
      .select("reference_path")
      .eq("user_id", user.id)
      .eq("item_id", itemId),
    client
      .from("wardrobe_item_ai_assets_legacy")
      .select("reference_path")
      .eq("user_id", user.id)
      .eq("item_id", itemId),
  ]);
  if (assetsError || legacyAssetsError) {
    console.error("Could not look up clothing images for deletion.", { assetsError, legacyAssetsError });
    return Response.json({ error: "Could not remove this item." }, { status: 500 });
  }

  const { data: relatedResults, error: resultsError } = await client
    .from("wardrobe_results")
    .select("id, result_path")
    .eq("user_id", user.id)
    .contains("item_ids", [itemId]);
  if (resultsError) {
    console.error("Could not look up saved outfits that reference this item.", resultsError);
    return Response.json({ error: "Could not remove this item." }, { status: 500 });
  }

  const paths = Array.from(new Set([
    item?.reference_path,
    item?.original_path,
    item?.preview_path,
    ...(assets ?? []).map((asset) => asset.reference_path),
    ...(legacyAssets ?? []).map((asset) => asset.reference_path),
    ...(relatedResults ?? []).map((result) => result.result_path),
  ].filter((path): path is string => Boolean(path))));
  if (paths.some((path) => !path.startsWith(`${user.id}/`))) {
    console.error("Refused to remove a wardrobe image outside the user's folder.");
    return Response.json({ error: "A saved item image path is invalid." }, { status: 500 });
  }

  if (relatedResults?.length) {
    const { error: resultsDeleteError } = await client
      .from("wardrobe_results")
      .delete()
      .eq("user_id", user.id)
      .in("id", relatedResults.map((result) => result.id));
    if (resultsDeleteError) {
      console.error("Could not delete saved outfits that reference this item.", resultsDeleteError);
      return Response.json({ error: "Could not remove saved outfits for this item." }, { status: 500 });
    }
  }

  const { error: deleteError } = await client
    .from("wardrobe_items")
    .delete()
    .eq("user_id", user.id)
    .eq("id", itemId);
  if (deleteError) {
    console.error("Could not delete the wardrobe item record.", deleteError);
    return Response.json({ error: "Could not remove this item." }, { status: 500 });
  }

  if (paths.length) {
    const { error: storageError } = await client.storage
      .from("model-images")
      .remove(paths);
    if (storageError) {
      console.error("Item was removed but its private image could not be cleaned up.", storageError);
      return Response.json(
        { error: "Item removed, but its stored image could not be cleaned up." },
        { status: 500 }
      );
    }
  }

  return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
};

/* Saves the per-item placement override for ONE clothing item. Authentication
   still runs through authenticateSupabaseRequest (the caller must present the
   owner's JWT), and only the placement column plus updated_at are ever
   touched — the item itself, its assets and any saved outfits are never
   modified. The UPDATE itself runs on the trusted server client because the
   owner-RLS UPDATE policy carries a WITH CHECK on reference_path, which is
   NULL for every item created by the current flows; ownership stays enforced
   by the authenticated user plus the explicit user_id + item id filters.
   `placement` may be null (=> existing defaults) or exactly {anchor,x,y,scale}. */
export const PATCH: APIRoute = async ({ params, request }) => {
  const authentication = await authenticateSupabaseRequest(request);
  if (!authentication.ok) {
    return Response.json(
      { error: authentication.message },
      { status: authentication.status, headers: { "Cache-Control": "no-store" } }
    );
  }
  const { user } = authentication;
  const itemId = params.id;
  if (!itemId || itemId.length > 100) {
    return Response.json({ error: "A valid item ID is required." }, { status: 400 });
  }

  let body: { placement?: unknown };
  try {
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > 16_000) throw new Error("too large");
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    body = parsed as { placement?: unknown };
  } catch {
    return Response.json(
      { error: "The request body must be a valid JSON object." },
      { status: 400 }
    );
  }
  if (!("placement" in body)) {
    return Response.json({ error: "A placement value is required." }, { status: 400 });
  }
  let placement: Placement | null = null;
  if (body.placement !== null) {
    placement = parsePlacement(body.placement);
    if (!placement) {
      return Response.json(
        {
          error:
            "Placement must be {anchor,x,y,scale} (optionally with scaleX+scaleY together) with a known anchor and values inside the editor limits.",
        },
        { status: 400 }
      );
    }
  }

  let serviceClient;
  try {
    serviceClient = createSupabaseServiceClient();
  } catch (error) {
    console.error("Could not open a trusted connection to save this placement.", error);
    return Response.json({ error: "Could not save this placement." }, { status: 503 });
  }
  const { data: updated, error: updateError } = await serviceClient
    .from("wardrobe_items")
    .update({ placement, updated_at: new Date().toISOString() })
    .eq("user_id", user.id)
    .eq("id", itemId)
    .select("placement");
  if (updateError) {
    // The placement migration has not been applied yet, or the database is
    // unreachable — report it without breaking the editor session.
    console.error("Could not save the placement for this item.", updateError);
    return Response.json({ error: "Could not save this placement." }, { status: 503 });
  }
  if (!updated || updated.length === 0) {
    return Response.json({ error: "This clothing item was not found." }, { status: 404 });
  }
  const saved = updated[0] as { placement?: unknown };
  return Response.json(
    { placement: saved.placement ?? null },
    { headers: { "Cache-Control": "no-store" } }
  );
};
