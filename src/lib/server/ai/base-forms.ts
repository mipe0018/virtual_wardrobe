import { Buffer } from "node:buffer";
import type { SupabaseClient } from "@supabase/supabase-js";
import { PNG } from "pngjs";
import type { ClothingBaseType } from "../../shared/clothing-assets";
import { DRESSED_BASE_FORM_PATHS } from "../../shared/dressed-base-forms";
import { imageDataUrl } from "./openai-images";

type BaseFormRecord = {
  storage_path: string;
};

export async function loadSystemBaseFormDataUrl(
  client: SupabaseClient,
  baseType: ClothingBaseType
): Promise<string> {
  const expectedPath = DRESSED_BASE_FORM_PATHS[baseType];
  const { data: record, error: recordError } = await client
    .from("dressed_base_forms")
    .select("storage_path")
    .eq("base_type", baseType)
    .maybeSingle<BaseFormRecord>();
  if (recordError) {
    console.error(`Could not look up the ${baseType} system base form.`, recordError);
    throw new Error("Could not load the system base-form configuration.");
  }
  if (!record || record.storage_path !== expectedPath) {
    throw new Error(`The ${baseType} system base form is not configured.`);
  }

  const { data: blob, error: downloadError } = await client.storage
    .from("model-images")
    .download(expectedPath);
  if (downloadError || !blob) {
    console.error(`Could not download the ${baseType} system base form.`, downloadError);
    throw new Error(`Could not load the ${baseType} system base-form image.`);
  }
  if (
    blob.size === 0 ||
    blob.size > 20 * 1024 * 1024 ||
    blob.type.split(";")[0].toLowerCase() !== "image/png"
  ) {
    throw new Error(`The ${baseType} system base form must be a PNG under 20 MB.`);
  }

  // pngjs requires a Node Buffer; a plain Uint8Array fails to decode.
  const bytes = Buffer.from(await blob.arrayBuffer());
  let image: PNG;
  try {
    image = PNG.sync.read(bytes);
  } catch {
    throw new Error(`The ${baseType} system base form could not be decoded.`);
  }
  if (image.width !== 1024 || image.height !== 1536) {
    throw new Error(`The ${baseType} system base form must be exactly 1024x1536 pixels.`);
  }
  return imageDataUrl(bytes, "image/png");
}
