import type { APIRoute } from "astro";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  authenticateSupabaseRequest,
  createSupabaseServiceClient,
} from "../../../lib/server/supabase";

export const prerender = false;

/* PERMANENT ACCOUNT DELETION (server-side only).
 *
 * Security contract:
 *  - The caller presents the normal Bearer JWT; the user id is ALWAYS derived
 *    from that token (authenticateSupabaseRequest) and never from the request
 *    body, query string or any client-supplied value. A supplied user id is
 *    ignored.
 *  - The privileged SUPABASE_SERVICE_ROLE_KEY is read inside this route only
 *    and is never returned to the browser.
 *  - Only the authenticated user's own rows are deleted (explicit
 *    `.eq("user_id", …)` per table) and only objects under that user's
 *    `{userId}/` folder in the private buckets.
 *
 * Order: database rows → storage objects → auth user (last). Storage deletion
 * is a separate concern — deleting a row never deletes the object — so both
 * are handled explicitly. Failures are reported honestly: `{deleted:true}` is
 * only returned once the auth user is actually gone. */

const STORAGE_BUCKETS = ["model-images", "profile-images"] as const;
const MAX_FOLDER_DEPTH = 6;
const LIST_PAGE_SIZE = 100;
const REMOVE_BATCH_SIZE = 100;

/* Children first: assets reference items/characters, outfits and results
   reference dressed_characters (composite FK, ON DELETE CASCADE). The order
   keeps every explicit delete valid even if a cascade were missing. */
const USER_TABLES = [
  "wardrobe_item_ai_assets",
  "wardrobe_item_ai_assets_legacy",
  "saved_dressed_outfits",
  "wardrobe_items",
  "wardrobe_results",
  "dressed_characters",
  "ai_generation_usage",
  "ai_generation_limit_overrides",
  "profiles", // no FK to auth.users is guaranteed in version control (F4)
] as const;

function jsonError(message: string, status: number) {
  return Response.json(
    { error: message },
    { status, headers: { "Cache-Control": "no-store" } }
  );
}

/* Recursively lists every object under `{userId}/` in one bucket. Directories
   come back from the storage API with a null `id`. Results are paginated so a
   folder with more entries than one page is fully covered, and depth is
   bounded so a pathological tree can never loop forever. */
async function collectOwnedPaths(
  client: SupabaseClient,
  bucket: string,
  folder: string,
  depth: number
): Promise<string[]> {
  if (depth > MAX_FOLDER_DEPTH) return [];
  const paths: string[] = [];
  let offset = 0;
  for (;;) {
    const { data, error } = await client.storage
      .from(bucket)
      .list(folder, { limit: LIST_PAGE_SIZE, offset });
    if (error) {
      throw new Error(`Could not list ${bucket}/${folder}: ${error.message}`);
    }
    const entries = data ?? [];
    for (const entry of entries) {
      const entryPath = folder ? `${folder}/${entry.name}` : entry.name;
      if (!entry.id) {
        paths.push(
          ...(await collectOwnedPaths(client, bucket, entryPath, depth + 1))
        );
      } else {
        paths.push(entryPath);
      }
    }
    if (entries.length < LIST_PAGE_SIZE) break;
    offset += LIST_PAGE_SIZE;
  }
  return paths;
}

/* Removes every collected path in batches. Returns a warning string when a
   bucket could not be cleaned — never throws, because the caller must still
   be able to finish the auth deletion and report the state honestly. */
async function deleteOwnedStorage(
  client: SupabaseClient,
  userId: string
): Promise<string | null> {
  const failures: string[] = [];
  for (const bucket of STORAGE_BUCKETS) {
    try {
      const paths = await collectOwnedPaths(client, bucket, userId, 0);
      for (let index = 0; index < paths.length; index += REMOVE_BATCH_SIZE) {
        const batch = paths.slice(index, index + REMOVE_BATCH_SIZE);
        const { error } = await client.storage.from(bucket).remove(batch);
        if (error) throw new Error(error.message);
      }
    } catch (error) {
      console.error(`Could not remove private files from ${bucket}.`, error);
      failures.push(bucket);
    }
  }
  return failures.length
    ? `Some stored files could not be removed (${failures.join(", ")}).`
    : null;
}

async function deleteOwnedRows(
  client: SupabaseClient,
  userId: string
): Promise<void> {
  for (const table of USER_TABLES) {
    const { error } = await client.from(table).delete().eq("user_id", userId);
    if (error) {
      throw new Error(`Could not delete rows from ${table}: ${error.message}`);
    }
  }
}

export const POST: APIRoute = async ({ request }) => {
  const authentication = await authenticateSupabaseRequest(request);
  if (!authentication.ok) {
    return jsonError(authentication.message, authentication.status);
  }
  const { user } = authentication; // identity = JWT only, never the body

  // Explicit confirmation so a stray request cannot wipe an account.
  let confirmed = false;
  try {
    const raw = await request.text();
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      confirmed =
        !!parsed &&
        typeof parsed === "object" &&
        (parsed as { confirm?: unknown }).confirm === true;
    }
  } catch {
    confirmed = false;
  }
  if (!confirmed) return jsonError("Account deletion must be confirmed.", 400);

  let serviceClient: SupabaseClient;
  try {
    serviceClient = createSupabaseServiceClient();
  } catch (error) {
    console.error("Trusted server access is not configured.", error);
    return jsonError("Account deletion is not configured.", 503);
  }

  try {
    await deleteOwnedRows(serviceClient, user.id);
  } catch (error) {
    console.error("Could not delete the account's database records.", error);
    return jsonError(
      "Could not delete your account data. Please try again.",
      500
    );
  }

  // Storage is independent of the database: rows are gone either way, so a
  // partial file failure is surfaced as a warning rather than hidden.
  const storageWarning = await deleteOwnedStorage(serviceClient, user.id);

  const { error: authError } = await serviceClient.auth.admin.deleteUser(user.id);
  if (authError) {
    console.error("Could not delete the Supabase Auth user.", authError);
    return jsonError(
      "Your data was removed, but the account itself could not be deleted. Please try again.",
      500
    );
  }

  return Response.json(
    storageWarning
      ? { deleted: true, warning: storageWarning }
      : { deleted: true },
    { headers: { "Cache-Control": "no-store" } }
  );
};

