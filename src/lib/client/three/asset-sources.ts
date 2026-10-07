import type { Dressed3dAnchorName } from "../../shared/dressed-3d-contract";

/**
 * POC asset sources — ONE local static test model.
 *
 * Deliberately minimal: no Supabase, no signed URLs, no user assets, no
 * catalog, no database. Everything here ships with the project itself and is
 * served from `public/`. Production asset loading (global `system-reference/`
 * vs private `{userId}/` GLBs) belongs to a later phase.
 */

/**
 * Stylized DRESSED base figure (dressed-base.glb) + the original box
 * mannequin, both in public/model-3d/.
 */
export const MODEL_3D_POC_GLB_URL = "/model-3d/dressed-base.glb";

/**
 * Approximate height of the test model in meters (camera framing hint only).
 * The real DRESSED master model will replace this file later without any
 * contract change.
 */
export const MODEL_3D_POC_HEIGHT_M = 1.75;

/**
 * Anchor rest positions in MODEL SPACE (meters), relative to the model root
 * at the feet. These belong to THIS asset (not to the global contract): a
 * different GLB legitimately ships a different anchor map.
 *
 * Anchors sit ON the body's front surface (like the 2D anchors are points on
 * the figure), so debug markers are visible and the depth offset `w` is
 * measured outward from the surface along local +Z.
 *
 * Mapped onto the stylized DRESSED base figure (dressed-base.glb,
 * 1.75 m): head = forehead, torso = chest/bust, waist = natural waist,
 * shoulders = front of each deltoid.
 *
 * Anatomical note (contract §anchor vocabulary): shoulder_left is the model's
 * own left arm — which sits at +X when the model faces +Z.
 */
export const MODEL_3D_POC_ANCHORS: Record<Dressed3dAnchorName, {
  x: number;
  y: number;
  z: number;
}> = {
  head: { x: 0, y: 1.69, z: 0.069 },
  torso: { x: 0, y: 1.31, z: 0.109 },
  waist: { x: 0, y: 1.11, z: 0.074 },
  shoulder_left: { x: 0.13, y: 1.43, z: 0.043 },
  shoulder_right: { x: -0.13, y: 1.43, z: 0.043 },
};
