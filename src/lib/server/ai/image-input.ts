import { Buffer } from "node:buffer";

export const ALLOWED_IMAGE_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;
export type AllowedImageMimeType = (typeof ALLOWED_IMAGE_MIME_TYPES)[number];

export type ParsedImageInput = {
  bytes: Buffer;
  mimeType: AllowedImageMimeType;
};

export function parseImageDataUrl(
  value: unknown,
  maximumBytes: number
): ParsedImageInput | null {
  if (typeof value !== "string") return null;
  const match = value.match(
    /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/
  );
  if (!match || !ALLOWED_IMAGE_MIME_TYPES.includes(match[1] as AllowedImageMimeType)) {
    return null;
  }
  const bytes = Buffer.from(match[2], "base64");
  if (
    bytes.length === 0 ||
    bytes.length > maximumBytes ||
    bytes.toString("base64") !== match[2] ||
    !matchesImageSignature(bytes, match[1] as AllowedImageMimeType)
  ) {
    return null;
  }
  return { bytes, mimeType: match[1] as AllowedImageMimeType };
}

export function matchesImageSignature(
  bytes: Uint8Array,
  mimeType: AllowedImageMimeType
): boolean {
  if (mimeType === "image/jpeg") {
    return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  if (mimeType === "image/png") {
    return (
      bytes.length >= 8 &&
      bytes[0] === 0x89 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x4e &&
      bytes[3] === 0x47 &&
      bytes[4] === 0x0d &&
      bytes[5] === 0x0a &&
      bytes[6] === 0x1a &&
      bytes[7] === 0x0a
    );
  }
  return (
    bytes.length >= 12 &&
    Buffer.from(bytes.subarray(0, 4)).toString("ascii") === "RIFF" &&
    Buffer.from(bytes.subarray(8, 12)).toString("ascii") === "WEBP"
  );
}

export function imageExtension(mimeType: string): "jpg" | "png" | "webp" {
  if (mimeType === "image/jpeg") return "jpg";
  if (mimeType === "image/png") return "png";
  return "webp";
}
