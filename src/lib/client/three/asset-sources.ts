import type { Dressed3dAnchorName } from "../../shared/dressed-3d-contract";

/**
 * POC asset sources — ONE local static test model.
 *
 * Deliberately minimal: no Supabase, no signed URLs, no user assets, no
 * catalog, no database. Everything here ships with the project itself and is
 * served from `public/`. Production asset loading (global `system-reference/`
 * vs private `{userId}/` GLBs) belongs to a later phase.
 */

/** Static test mannequin, generated for this POC (see public/model-3d/). */
export const MODEL_3D_POC_GLB_URL = "/model-3d/mannequin.glb";

/**
 * Approximate height of the test model in meters (camera framing hint only).
 * The real DRESSED master model will replace this file later without any
 * contract change.
 */
export const MODEL_3D_POC_HEIGHT_M = 1.69;

/**
 * Anchor rest positions in MODEL SPACE (meters), relative to the model root
 * at the feet. These belong to THIS asset (not to the global contract): a
 * different GLB legitimately ships a different anchor map.
 *
 * Anchors sit ON the body's front surface (like the 2D anchors are points on
 * the figure), so debug markers are visible and the depth offset `w` is
 * measured outward from the surface along local +Z.
 *
 * Anatomical note (contract §anchor vocabulary): shoulder_left is the model's
 * own left arm — which sits at +X when the model faces +Z.
 */
export const MODEL_3D_POC_ANCHORS: Record<Dressed3dAnchorName, {
  x: number;
  y: number;
  z: number;
}> = {
  head: { x: 0, y: 1.575, z: 0.1 },
  torso: { x: 0, y: 1.19, z: 0.095 },
  waist: { x: 0, y: 0.975, z: 0.09 },
  shoulder_left: { x: 0.205, y: 1.37, z: 0.06 },
  shoulder_right: { x: -0.205, y: 1.37, z: 0.06 },
};
