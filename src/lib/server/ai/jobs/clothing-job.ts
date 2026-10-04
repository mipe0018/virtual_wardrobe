import type { SupabaseClient } from "@supabase/supabase-js";
import { PNG } from "pngjs";
import { loadSystemBaseFormDataUrl } from "../base-forms";
import { editImage, imageDataUrl, setOpenAiApiKey } from "../openai-images";
import { imageExtension, matchesImageSignature } from "../image-input";
import { CLOTHING_CATEGORIES } from "../../../shared/clothing-categories";
import {
  CURRENT_CLOTHING_ASSET_VERSION,
  type ClothingBaseType,
} from "../../../shared/clothing-assets";
import { finishClothingGeneration } from "../generation-usage";
import { createJobClients, jobUserIsValid, type JobEnv } from "../background";

const BACKGROUND_OPENAI_TIMEOUT_MS = 8 * 60 * 1000;
const MAX_SOURCE_BYTES = 4 * 1024 * 1024;

export type ClothingJobPayload = {
  userId: string;
  accessToken: string;
  itemId: string;
  name: string;
  category: string;
  baseType: ClothingBaseType;
  characterId: string;
  originalPath: string;
  existingAssetPath: string | null;
  reservationStartedAt: string;
};

// Runs the heavy part of clothing AI-ready generation. The reservation is always
// finalized: committed only when the asset row was persisted, otherwise rolled back.
export async function runClothingJob(env: JobEnv, payload: ClothingJobPayload): Promise<void> {
  const {
    userId, accessToken, baseType, characterId, originalPath, reservationStartedAt,
  } = payload;
  const item = { id: payload.itemId, name: payload.name, category: payload.category };
  const existingAsset = payload.existingAssetPath
    ? { reference_path: payload.existingAssetPath }
    : null;
  const { userClient: client, serviceClient } = createJobClients(env, accessToken);
  let generatedPath: string | null = null;
  let aiAssetPersisted = false;
  try {
    setOpenAiApiKey(env.openaiKey);
    if (!(await jobUserIsValid(serviceClient, accessToken, userId))) {
      throw new Error("The background job could not verify the user.");
    }
    if (!originalPath.startsWith(`${userId}/`)) {
      throw new Error("The original clothing image path is invalid.");
    }
    const { data: originalBlob, error: originalError } = await client.storage
      .from("model-images")
      .download(originalPath);
    if (originalError || !originalBlob) {
      console.error("Could not retrieve the original clothing image.", originalError);
      throw new Error("Could not retrieve the original clothing image. Please upload it again.");
    }
    const sourceBytes = new Uint8Array(await originalBlob.arrayBuffer());
    const sourceMimeType = originalBlob.type.split(";")[0].toLowerCase();
    if (sourceBytes.length === 0 || sourceBytes.length > MAX_SOURCE_BYTES) {
      throw new Error("The original clothing image is empty or too large.");
    }
    if (!["image/jpeg", "image/png", "image/webp"].includes(sourceMimeType)) {
      throw new Error("The original clothing image format is not supported.");
    }
    const sourceDataUrl = imageDataUrl(sourceBytes, sourceMimeType);
    // The reusable asset is normalized against the canonical base form for this base type.
    const characterDataUrl = await loadSystemBaseFormDataUrl(client, baseType);
    const categoryLabel =
      CLOTHING_CATEGORIES.find((entry) => entry.value === item.category)?.label ?? "clothing item";
    const itemName = JSON.stringify(item.name);
    const generated = await editImage({
      images: [characterDataUrl, sourceDataUrl],
      timeoutMs: BACKGROUND_OPENAI_TIMEOUT_MS,
      size: "1024x1536",
      background: "transparent",
      prompt: [
        `Image 1 is the canonical DRESSED ${baseType} base form: the fixed geometric master reference for this clothing layer, shared by every ${baseType} character in DRESSED.`,
        "The garment must fit this canonical base form's exact body proportions, position, pose, framing, scale, and body placement. Follow image 1's shoulders, neck, chest, waist, hips, arms, and legs precisely, using the same 1024x1536 canvas and pixel coordinate system.",
        "Do not generate, redraw, alter, or replace the person or body. Do not change the character's proportions, pose, or position, and do not move the character to a different position on the canvas. Garment placement must follow image 1 exactly, so the output overlays directly on image 1. Do not zoom in or out, crop, shift, rotate, change the aspect ratio, or change the perspective or camera of the canvas. The garment is drawn exactly where it sits on the character in image 1, so the output and image 1 align pixel for pixel.",
        "CANONICAL ALIGNMENT: image 1 is a fixed template, and the finished clothing layer is composited directly over it with no repositioning. The body in image 1 is never changed: no new body shape, no pose change, no change of proportions, and no moving the figure on the canvas. Every garment follows the matching body area of image 1: tops, shirts, and sweaters from the shoulder line to the correct torso length, centered on the body and following its width; jackets over the shoulders, arms, and upper torso; pants from the waist along the legs; shorts and skirts from the hips; dresses from the shoulders or neckline down to the correct length; socks over the ankles; shoes over the feet; accessories at their matching body area.",
        "Do not copy, reproduce, edit, or include any pixels from image 1. Do not render any part of the person, body, skin, hair, base clothing, mannequin, or background in the output.",
        `Image 2 is the original clothing source and the sole visual source for the design of this ${categoryLabel.toLowerCase()}.`,
        `The user-selected target item is named ${itemName}; use its name and category only to identify which item to isolate if image 2 contains multiple objects.`,
        "Create exactly one separate transparent clothing layer fitted to and positioned over the corresponding area of the character in image 1; show only the garment itself, not the person wearing it.",
        "Preserve the clothing source's color, material, pattern, construction, shape, length, sleeves, collar, pockets, logos, text, and details; make no unnecessary design changes.",
        "Fit the garment's scale and placement to this character's shoulders, chest, waist, hips, arms, and body pose while retaining the source garment's design.",
        "Treat image 2 as a design reference sheet, not a size reference. Image 2 determines only the garment's design, shape, colors, material, details, and length/type. Image 2's own image size, cropping, or garment bounding box must NEVER determine the final physical size of the garment.",
        "Image 1 determines the actual size, placement, proportions, body landmarks, and where the garment sits. First identify the relevant body areas of the character in image 1, then fit the garment to them. Top/blouse: shoulder width follows the character's shoulders, neckline sits at the character's neck, hem sits relative to the character's waist/hip. Trousers/skirt: waist follows the character's waist, hip width follows the hips, legs and length follow the character's legs. Jacket: shoulders and neck follow the character, sleeves follow the character's arms, length sits relative to the character's torso. Dress: upper body, waist, hips, and length follow the character.",
        "If the garment in image 2 fills a very small or very large part of its photo, this must not affect the final size. If its bounding box is larger than the corresponding area of the character, scale the garment down to fit the character's real body measurements; if smaller, scale it up accordingly. If image 2's garment size conflicts with the character's proportions in image 1, image 1 ALWAYS wins; scaling the garment significantly up or down is preferred over a wrong size on the character.",
        "A clearly wrong size must be solved by actually scaling the garment. The character's actual size and body areas in image 1 determine the garment's physical size.",
        "SLEEVES AND ARMS: look at the pose of the character's arms in image 1 and draw every sleeve in exactly that pose. If the arms hang straight down close to the torso, the sleeves must hang straight down close to the torso, from the shoulder seam to the cuff, with the cuff ending where the character's wrist or forearm ends. Do not draw sleeves angled outward, in a T-pose or A-pose, or wider than the character's arms. Each sleeve must lie directly over the character's own arm; the garment's body and sleeves must not be wider than the character's torso and arms plus a small garment allowance.",
        "SHOULDER ALIGNMENT AND WIDTH: place the garment's shoulder points directly at the character's actual shoulders in image 1. The garment's shoulder line must align with the character's actual shoulder line and must never sit below it. The neckline stays aligned with the character's neck while the shoulders extend outward laterally to reach the character's actual shoulder positions. Use image 1's actual shoulder-to-shoulder width as the reference; do not keep a narrower shoulder width from image 2. Adapt the garment's cut to image 1's body without stretching, warping, or distorting it; any scaling is uniform and never non-uniform, and the garment keeps natural fabric proportions.",
        "SLEEVE SIZE: keep the sleeves following the character's arms, but make them large enough to cover the character's actual arms. Sleeve width must follow the visible arm width and never be narrower than the arm. Each sleeve extends from the correctly aligned shoulder and arm attachment point along the character's arm to the appropriate wrist or forearm endpoint. Do not make a sleeve smaller merely to preserve the source garment's original proportions.",
        "OVERALL SIZE AND POSITION: make the garment slightly larger and slightly higher than a plain fit would suggest, as a small controlled adjustment only. Its torso width follows the character's actual torso width, slightly wider where needed to reach the shoulders and arms, and it must not become wider than the corresponding body areas of the character. Do not stretch, warp, or distort any region of the garment to achieve this; keep natural garment proportions and let the cut itself follow each body region.         Do not shift the whole garment markedly upward.",        "Image 1 determines physical size, position, shoulder width, arm width, torso width, and body alignment. Image 2 determines only design, color, material, pattern, construction, and details. Preserve the garment's visual identity while adapting its geometry to image 1.",
        "When unsure about the garment's size because of image 2's cropping or bounding box, prioritize: character geometry, then anatomical landmarks, then garment fit, then reference image scale. Never let the reference image bounding box decide garment size. Keep the garment's design as close to image 2 as possible while adapting its size and placement to the character.",
        "FRONT-FACING DIGITAL DRESS-UP DOLL LAYER: the result is a front-facing 2D clothing layer placed directly on top of the character, behaving like a layer in a digital paper dress-up doll. Generate only the parts of the garment that would be visible when the character is seen straight from the front.",
        "Do not generate a back side of the garment. Do not generate an inner back, lining, inside, or any extra fabric layer that is not visible from the front. Do not generate a complete 3D rendering of the garment. Do not render the garment as a freestanding object or a product photo; convert its design into a clean front-facing layer.",
        "STANDARDIZATION OF ANY SOURCE PHOTO: image 2 may show the garment worn by a person, on a hanger or stand, flat on a floor, photographed from above or at an angle, with a background, or at any size. In every case, reconstruct the garment as a clean, straight-on, front-facing 2D layer and remove the person, mannequin, hanger, stand, hands, and background completely. Show only the front-visible part of the garment; no body parts, no hidden or inner surfaces, no back side.",
        "CATEGORY FIT ON THE FIXED MODEL: tops, shirts, and sweaters cover the character's shoulders and torso; jackets cover the shoulders and upper body; dresses run over the character's relevant body length; pants run from the waist down to the ankles; shorts run from the hips to the shorts' own length; skirts run from the hips down to the skirt's own length; socks sit around the ankles and feet; shoes sit exactly on the character's feet. The result is a standardized layer for this fixed model, reusable for every character of the same base type, so do not personalize it beyond that model geometry.",
        "UNIFORM SCALE ONLY: when adapting the garment to the model, apply proportional scaling; never change the garment's width and height independently, and never stretch or distort it unnaturally. Keep the garment's natural proportions and design.",
        "FLAT 2D DIGITAL DRESS-UP DOLL LAYER, NOT A 3D GARMENT: the output is a flat 2D digital dress-up doll clothing layer, NOT a complete physical 3D garment. Include ONLY the front-facing visible surface of the garment. The output must represent ONLY what a viewer would see from directly in front of the garment when it is worn on our front-facing digital model. Do NOT include any part of the back of the garment. Do NOT include fabric that wraps around the sides of the body and would only be visible from a side or rear view. Do NOT include back panels, back hems, back collars, back straps, rear sleeves, rear folds, or any hidden garment surfaces. Do NOT reconstruct the garment as a complete 3D object. Do NOT show the garment from an angled perspective. If the original photo shows the back of the garment, a side of the garment, or fabric wrapping around the body, those areas must be excluded from the output. The final asset must look like a flat front-facing clothing piece that could be placed directly on top of a paper/digital dress-up doll.",
        "FRONT-VIEW RULE: imagine the final DRESSED model standing perfectly straight and facing directly toward the viewer. The clothing asset must be created specifically for that exact front view. Only the garment surfaces that belong to that front view remain; anything that belongs behind the model or around the back of the model must be removed.",
        "FRONT-VIEW EXAMPLES. Dress: keep the front neckline, front bodice, front sleeves, front skirt, and visible front details such as buttons, patterns, and pockets; remove the back of the dress, back neckline, back straps that would sit behind the model, rear skirt fabric, rear folds, fabric wrapping behind the body, and any hidden surface. Jacket: keep the visible front jacket panels, front collar, front sleeves, and visible front details; do not create a complete jacket wrapped around the model. Pants: keep only the front-facing visible pants surface; no back of the legs, rear pockets, or rear waistband. Shoes: create only the front-facing visible shoe layer positioned for the front-facing model; no complete 3D shoe and no rear or side structure. Socks: keep only the front-visible sock area.",
        "Do NOT interpret removing the back as simply cropping the original image. Reconstruct the garment into a clean front-facing 2D layer. The final result must NOT look like a photograph of clothing; it must look like a clean digital asset intended to be layered over our front-facing fashion doll.",
        "MODEL-SCALED CLOTHING: Every clothing asset must be normalized to the fixed DRESSED model's body geometry before being returned. The physical size of the garment in the source photograph, the camera distance, image crop, amount of whitespace, or number of pixels occupied by the garment must NEVER determine the final clothing size. The garment must be proportionally scaled so that its relevant body dimensions fit the fixed model correctly.",
        "Preserve the garment's natural proportions while scaling it to the model. Scaling must be uniform. Do not independently change width and height. The goal is to make the garment correctly sized for the model, not to reproduce its original pixel dimensions.",
        "For each category, first identify the relevant body geometry of the fixed DRESSED model and normalize the garment to that geometry: tops, shirts and sweaters: fit the model's torso and shoulder width; jackets: fit the model's shoulder and upper-body width; dresses: fit the model's shoulder/torso width and relevant full-body length; pants: fit the model's waist/hip width and leg geometry; shorts: fit the model's hip width and intended leg length; skirts: fit the model's hip width and intended skirt length; socks: fit the model's ankle and foot geometry; shoes: fit the model's feet. The garment should be large enough to naturally cover the relevant model area, while preserving the garment's actual design and proportions.",
        "SKIRT SIZING: A skirt must be normalized to the fixed model's hip width. The waistband should span the appropriate width of the model's hips, and the skirt should provide sufficient horizontal coverage across the visible hip area. Do not make the skirt smaller simply because it appears small in the source photograph. Preserve the skirt's actual length and silhouette relative to its normalized width. A mini skirt must remain a mini skirt, a knee-length skirt must remain knee-length, and a long skirt must remain long; only the relevant body width is normalized to the model.",
        "Where an area of the character is covered by the garment from the front, the clothing layer must cover that area directly. The garment's placement must follow the character's front-facing body and its actual landmarks. Keep the garment's colors, pattern, neckline, sleeves, buttons, belts, ruffles, and other design details.",
        "Priority order: 1) the character's size and position determine the garment's size, 2) the garment has the correct physical size on the character, 3) the garment is front-facing and works as a digital layer, 4) the garment follows the character's body position and landmarks, 5) the garment's design and characteristic details are preserved, 6) the output is a transparent PNG of 1024x1536.",
        "Return a transparent 1024x1536 PNG with exactly the same canvas, framing, and pixel coordinate system as image 1, preserving the transparent background.",
        "Output only the clothing asset itself. Clothing pixels are the only permitted visible pixels; every pixel outside the garment must have alpha 0. Add no background, new person, mannequin, or extra elements.",
        "The output must contain no character/person pixels whatsoever: no face, hair, skin, hands, arms, legs, mannequin, hanger, room, background, shadows outside the garment, or unrelated object.",
      ].join(" "),
    });

    if (
      generated.bytes.length < 24 ||
      !matchesImageSignature(generated.bytes, "image/png") ||
      generated.bytes.toString("ascii", 12, 16) !== "IHDR" ||
      generated.bytes.readUInt32BE(16) !== 1024 ||
      generated.bytes.readUInt32BE(20) !== 1536
    ) {
      throw new Error("The generated clothing layer is not a 1024x1536 PNG.");
    }

    let decoded: PNG;
    try {
      decoded = PNG.sync.read(generated.bytes);
    } catch {
      throw new Error("The generated clothing layer could not be decoded as a PNG.");
    }
    let hasTransparentPixel = false;
    let hasVisiblePixel = false;
    for (let offset = 3; offset < decoded.data.length; offset += 4) {
      const alpha = decoded.data[offset];
      if (alpha < 255) hasTransparentPixel = true;
      if (alpha > 0) hasVisiblePixel = true;
      if (hasTransparentPixel && hasVisiblePixel) break;
    }
    if (!hasTransparentPixel || !hasVisiblePixel) {
      throw new Error("The generated clothing layer must contain both transparent and visible pixels.");
    }
    const cornerAlphas = [
      decoded.data[3],
      decoded.data[(decoded.width - 1) * 4 + 3],
      decoded.data[((decoded.height - 1) * decoded.width) * 4 + 3],
      decoded.data[(decoded.width * decoded.height - 1) * 4 + 3],
    ];
    if (cornerAlphas.some((alpha) => alpha !== 0)) {
      throw new Error("The generated clothing layer must have transparent corners.");
    }

    const { data: stillPrimary, error: primaryCheckError } = await client
      .from("dressed_characters")
      .select("id")
      .eq("user_id", userId)
      .eq("id", characterId)
      .eq("is_primary", true)
      .maybeSingle<{ id: string }>();
    if (primaryCheckError) {
      console.error("Could not verify the primary character after clothing generation.", primaryCheckError);
      throw new Error("Could not verify that your primary character is still active.");
    }
    if (!stillPrimary) {
      throw new Error("Your primary character changed during clothing generation. Please try again.");
    }

    generatedPath =
      `${userId}/clothing/${characterId}/${crypto.randomUUID()}.${imageExtension(generated.mimeType)}`;
    const { error: uploadError } = await client.storage
      .from("model-images")
      .upload(generatedPath, generated.bytes, {
        contentType: generated.mimeType,
        upsert: false,
      });
    if (uploadError) {
      console.error("Could not save the processed clothing reference.", uploadError);
      generatedPath = null;
      throw new Error("Could not save the processed clothing image.");
    }


    const { error: assetWriteError } = await serviceClient
      .from("wardrobe_item_ai_assets")
      .upsert({
        user_id: userId,
        item_id: item.id,
        base_type: baseType,
        reference_path: generatedPath,
        generation_version: CURRENT_CLOTHING_ASSET_VERSION,
        updated_at: new Date().toISOString(),
      }, { onConflict: "user_id,item_id,base_type" });
    if (assetWriteError) {
      console.error("Could not save the base-type AI-ready asset.", assetWriteError);
      throw new Error("Could not save the AI-ready clothing asset.");
    }
    aiAssetPersisted = true;
    if (
      existingAsset?.reference_path &&
      existingAsset.reference_path !== generatedPath &&
      existingAsset.reference_path.startsWith(`${userId}/`)
    ) {
      const { error: oldAssetRemovalError } = await client.storage
        .from("model-images")
        .remove([existingAsset.reference_path]);
      if (oldAssetRemovalError) {
        console.error("Could not remove the replaced legacy clothing layer.", oldAssetRemovalError);
      }
    } else if (existingAsset?.reference_path && !existingAsset.reference_path.startsWith(`${userId}/`)) {
      console.error("Skipped removing a replaced legacy layer with an invalid owner path.", item.id);
    }
  } catch (error) {
    console.error("Clothing image processing failed in the background job.", error);
    if (generatedPath && !aiAssetPersisted) {
      const { error: cleanupError } = await serviceClient.storage
        .from("model-images")
        .remove([generatedPath]);
      if (cleanupError) console.error("Could not remove an unlinked AI-ready clothing image.", cleanupError);
    }
  } finally {
    try {
      await finishClothingGeneration(serviceClient, userId, reservationStartedAt, aiAssetPersisted);
    } catch (error) {
      console.error("Could not finalize the clothing generation reservation.", error);
    }
  }
}