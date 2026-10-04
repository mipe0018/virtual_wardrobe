import type { APIRoute } from "astro";
import { Buffer } from "node:buffer";
import {
  FashnSpaceError,
  generateFashnTryOn,
  type FashnCategory,
  type FashnPhotoType,
} from "../../../lib/server/ai/fashn-space";
import { authenticateSupabaseRequest } from "../../../lib/server/supabase";
import {
  finishGeneration,
  GenerationLimitError,
  reserveGeneration,
} from "../../../lib/server/ai/generation-usage";
import {
  imageDataUrl,
  moderateImage,
  OpenAIImageError,
} from "../../../lib/server/ai/openai-images";

export const prerender = false;

const MAX_REQUEST_BODY_BYTES = 5.5 * 1024 * 1024;
const MAX_SOURCE_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_GARMENT_IMAGE_BYTES = 4 * 1024 * 1024;
const MAX_RESULT_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_REQUEST_DURATION_MS = 54_000;

const IMAGE_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

type TryOnRequest = {
  wardrobeItemId?: unknown;
  garmentImageDataUrl?: unknown;
  category?: unknown;
  photoType?: unknown;
};

type ParsedImage = {
  mimeType: (typeof IMAGE_MIME_TYPES)[number];
  bytes: Buffer;
};

function jsonError(message: string, status: number) {
  return Response.json(
    { error: message },
    { status, headers: { "Cache-Control": "no-store" } }
  );
}

function parseImageDataUrl(value: unknown, maxBytes: number): ParsedImage | null {
  if (typeof value !== "string") return null;

  const match = value.match(
    /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/
  );
  if (!match || !IMAGE_MIME_TYPES.includes(match[1] as ParsedImage["mimeType"])) {
    return null;
  }

  const bytes = Buffer.from(match[2], "base64");
  if (
    bytes.length === 0 ||
    bytes.length > maxBytes ||
    bytes.toString("base64") !== match[2]
  ) {
    return null;
  }

  return { mimeType: match[1] as ParsedImage["mimeType"], bytes };
}

function normalizeCategory(value: unknown): FashnCategory | null {
  if (typeof value !== "string") return null;

  switch (value.toLowerCase()) {
    case "tops":
      return "tops";
    case "bottoms":
      return "bottoms";
    case "dresses":
    case "one-pieces":
      return "one-pieces";
    default:
      return null;
  }
}

function isPhotoType(value: unknown): value is FashnPhotoType {
  return value === "model" || value === "flat-lay";
}

function imageExtension(mimeType: string): string {
  switch (mimeType) {
    case "image/jpeg":
      return "jpg";
    case "image/png":
      return "png";
    default:
      return "webp";
  }
}

export const POST: APIRoute = async ({ request }) => {
  const authentication = await authenticateSupabaseRequest(request);
  if (!authentication.ok) {
    return jsonError(authentication.message, authentication.status);
  }

  const { client, user } = authentication;
  const deadline = Date.now() + MAX_REQUEST_DURATION_MS;
  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BODY_BYTES) {
    return jsonError("The request is too large. Use a smaller garment image.", 413);
  }

  let body: TryOnRequest;
  try {
    const rawBody = await request.text();
    if (Buffer.byteLength(rawBody, "utf8") > MAX_REQUEST_BODY_BYTES) {
      return jsonError("The request is too large. Use a smaller garment image.", 413);
    }
    const parsed: unknown = JSON.parse(rawBody);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return jsonError("The request body must be a JSON object.", 400);
    }
    body = parsed as TryOnRequest;
  } catch {
    return jsonError("The request body must be valid JSON.", 400);
  }

  if (
    typeof body.wardrobeItemId !== "string" ||
    body.wardrobeItemId.trim().length === 0 ||
    body.wardrobeItemId.length > 100
  ) {
    return jsonError("A valid wardrobe item ID is required.", 400);
  }

  const garment = parseImageDataUrl(body.garmentImageDataUrl, MAX_GARMENT_IMAGE_BYTES);
  if (!garment) {
    return jsonError(
      "Provide a JPG, PNG, or WEBP garment image no larger than 4 MB.",
      400
    );
  }

  const category = normalizeCategory(body.category);
  if (!category) {
    return jsonError(
      "Choose a supported category: tops, bottoms, or dresses.",
      400
    );
  }

  if (!isPhotoType(body.photoType)) {
    return jsonError("Choose a photo type: model or flat-lay.", 400);
  }

  const { data: profile, error: profileError } = await client
    .from("profiles")
    .select("source_photo_path")
    .eq("user_id", user.id)
    .maybeSingle();

  if (profileError) {
    console.error("Could not load the source photo path for try-on.", profileError);
    return jsonError("Could not load your profile. Please try again.", 500);
  }
  if (!profile?.source_photo_path) {
    return jsonError("Upload a source photo before trying on clothing.", 400);
  }
  if (!profile.source_photo_path.startsWith(`${user.id}/`)) {
    return jsonError("The saved source photo path is invalid.", 400);
  }

  const { data: sourcePhoto, error: sourcePhotoError } = await client.storage
    .from("profile-images")
    .download(profile.source_photo_path);

  if (sourcePhotoError || !sourcePhoto) {
    console.error("Could not retrieve the private source photo for try-on.", sourcePhotoError);
    return jsonError("Could not retrieve your saved photo. Please upload it again.", 500);
  }
  if (sourcePhoto.size === 0 || sourcePhoto.size > MAX_SOURCE_IMAGE_BYTES) {
    return jsonError("The saved source photo is too large or empty.", 400);
  }

  const sourceMimeType = sourcePhoto.type.split(";")[0].toLowerCase();
  if (!IMAGE_MIME_TYPES.includes(sourceMimeType as ParsedImage["mimeType"])) {
    return jsonError("The saved source photo format is not supported.", 400);
  }

  const personImageDataUrl = imageDataUrl(
    await sourcePhoto.arrayBuffer(),
    sourceMimeType
  );
  const garmentImageDataUrl = imageDataUrl(garment.bytes, garment.mimeType);
  try {
    await Promise.all([
      moderateImage(personImageDataUrl),
      moderateImage(garmentImageDataUrl),
    ]);
  } catch (error) {
    if (error instanceof OpenAIImageError) {
      return jsonError(error.message, error.status ?? 502);
    }
    console.error("FASHN input-image moderation failed.", error);
    return jsonError("Could not check the try-on images. Please try again.", 502);
  }

  let generatedPath: string | null = null;
  let generationReserved = false;

  try {
    await reserveGeneration(client, "tryon");
    generationReserved = true;
    const result = await generateFashnTryOn({
      personImageDataUrl,
      personMimeType: sourceMimeType,
      garmentImageDataUrl,
      garmentMimeType: garment.mimeType,
      category,
      photoType: body.photoType,
      deadline,
    });

    if (Date.now() >= deadline) {
      throw new FashnSpaceError("FASHN took too long to respond. Please try again.");
    }

    if (result.bytes.byteLength > MAX_RESULT_IMAGE_BYTES) {
      throw new FashnSpaceError("The FASHN result image is too large.");
    }

    const extension = imageExtension(result.mimeType);
    generatedPath = `${user.id}/try-on-${crypto.randomUUID()}.${extension}`;
    const { error: uploadError } = await client.storage
      .from("model-images")
      .upload(generatedPath, result.bytes, {
        contentType: result.mimeType,
        upsert: false,
      });

    if (uploadError) {
      console.error("Could not store the FASHN try-on result.", uploadError);
      generatedPath = null;
      return jsonError("Could not save the try-on result to your account.", 500);
    }

    return Response.json(
      {
        status: "completed",
        wardrobeItemId: body.wardrobeItemId,
        resultPath: generatedPath,
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    console.error("FASHN try-on request failed.", error);

    if (generatedPath) {
      const { error: cleanupError } = await client.storage
        .from("model-images")
        .remove([generatedPath]);
      if (cleanupError) {
        console.error("Could not remove the unlinked FASHN result image.", cleanupError);
      }
    }

    if (error instanceof GenerationLimitError) {
      return jsonError(error.message, error.status);
    }

    if (error instanceof FashnSpaceError) {
      const status =
        error.status === 429
          ? 429
          : error.status === 503
            ? 503
            : error.message.includes("too long")
              ? 504
              : 502;
      return Response.json(
        {
            error: error.message,
            status,
            providerStatus: error.providerStatus,
            providerEvent: error.providerEvent,
            providerError: error.providerError,
        },
        { status, headers: { "Cache-Control": "no-store" } }
      );
    }

    return jsonError("Could not complete the try-on request. Please try again.", 500);
  } finally {
    if (generationReserved) await finishGeneration(client, "tryon");
  }
};
