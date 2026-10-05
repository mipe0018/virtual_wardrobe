import type { APIRoute } from "astro";
import { authenticateSupabaseRequest } from "../../../lib/server/supabase";
import {
  imageDataUrl,
  moderateImage,
  OpenAIImageError,
} from "../../../lib/server/ai/openai-images";
import {
  ALLOWED_IMAGE_MIME_TYPES,
  imageExtension,
  matchesImageSignature,
} from "../../../lib/server/ai/image-input";

export const prerender = false;

const MAX_PHOTO_BYTES = 10 * 1024 * 1024;

function errorResponse(message: string, status: number) {
  return Response.json({ error: message }, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export const POST: APIRoute = async ({ request }) => {
  const authentication = await authenticateSupabaseRequest(request);
  if (!authentication.ok) {
    return errorResponse(authentication.message, authentication.status);
  }
  const { client, user } = authentication;
  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_PHOTO_BYTES + 256_000) {
    return errorResponse("Choose a source photo no larger than 10 MB.", 413);
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return errorResponse("Upload a valid image file.", 400);
  }
  const photo = form.get("photo");
  const mimeType = photo instanceof File
    ? ALLOWED_IMAGE_MIME_TYPES.find((allowedType) => allowedType === photo.type)
    : undefined;
  if (!(photo instanceof File) || !mimeType) {
    return errorResponse("Choose a JPG, PNG, or WEBP source photo.", 400);
  }
  if (photo.size === 0 || photo.size > MAX_PHOTO_BYTES) {
    return errorResponse("Choose a source photo no larger than 10 MB.", 413);
  }

  const photoBytes = new Uint8Array(await photo.arrayBuffer());
  if (!matchesImageSignature(photoBytes, mimeType)) {
    return errorResponse("The uploaded file is not a valid image.", 400);
  }

  try {
    await moderateImage(imageDataUrl(photoBytes, mimeType));
  } catch (error) {
    if (error instanceof OpenAIImageError) {
      return errorResponse(error.message, error.status ?? 502);
    }
    console.error("Source photo moderation failed.", error);
    return errorResponse("Could not check the source photo. Please try again.", 502);
  }

  // Read the currently active source photo before uploading its replacement. The old file is
  // only removed later, once the database update has succeeded.
  const { data: previousProfile, error: previousLookupError } = await client
    .from("profiles")
    .select("source_photo_path")
    .eq("user_id", user.id)
    .maybeSingle<{ source_photo_path: string | null }>();
  if (previousLookupError) {
    console.error("Could not read the source photo this upload replaces.", previousLookupError);
  }
  const previousSourcePhotoPath = previousProfile?.source_photo_path ?? null;

  const path = `${user.id}/source-photo-${crypto.randomUUID()}.${imageExtension(mimeType)}`;
  const { error: uploadError } = await client.storage
    .from("profile-images")
    .upload(path, photoBytes, { contentType: mimeType, upsert: false });
  if (uploadError) {
    console.error("Could not store the moderated profile photo.", uploadError);
    return errorResponse("Could not save your photo. Please try again.", 500);
  }

  const { data: profile, error: profileError } = await client
    .from("profiles")
    .update({ source_photo_path: path })
    .eq("user_id", user.id)
    .select("source_photo_path")
    .maybeSingle();
  if (profileError || !profile) {
    console.error("Could not save the moderated source-photo path.", profileError);
    const { error: cleanupError } = await client.storage.from("profile-images").remove([path]);
    if (cleanupError) console.error("Could not remove unlinked source photo.", cleanupError);
    return errorResponse("Could not save your photo to your profile.", 500);
  }

  // The replacement is persisted, so the previous source photo is now unreferenced. Removal
  // happens only here — never before the update succeeded — and a failure here is non-fatal,
  // because the new source photo is already the active one.
  if (previousSourcePhotoPath && previousSourcePhotoPath !== path) {
    if (!previousSourcePhotoPath.startsWith(`${user.id}/`)) {
      console.error("Skipped removing a replaced source photo outside the user's folder.");
    } else {
      const { error: replacedRemovalError } = await client.storage
        .from("profile-images")
        .remove([previousSourcePhotoPath]);
      if (replacedRemovalError) {
        console.error("Could not remove the replaced source photo.", replacedRemovalError);
      }
    }
  }

  return Response.json(
    { sourcePhotoPath: profile.source_photo_path },
    { headers: { "Cache-Control": "no-store" } }
  );
};
