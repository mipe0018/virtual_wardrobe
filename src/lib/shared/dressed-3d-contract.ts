/**
 * DRESSED 3D CONTRACT — canonical conventions for every future 3D module.
 *
 * READ-ONLY constants + documentation. This module is in `lib/shared` and is
 * therefore imported by BOTH client and (potentially) server code — it must
 * NEVER import Three.js or any browser/WebGL API.
 *
 * Source of truth: analysis/dressed-3d-implementation-readiness.md §5 and
 * analysis/dressed-3d-model-z-axis-analysis.md. Nothing here is persisted;
 * no database/storage state exists for the POC.
 */

/** Bumped whenever a convention below changes in a way that invalidates GLBs. */
export const DRESSED_3D_CONTRACT_VERSION = "poc-v1";

/* ---------------------------------------------------------------------------
 * COORDINATE SYSTEM (glTF defaults — no custom axes)
 *
 *   units         : meters (1 world unit = 1 m)
 *   up            : +Y  (glTF Y-up)
 *   forward       : +Z  (the model's chest/face points toward +Z at yaw 0)
 *   origin        : model root at the FEET, centered on the body axis;
 *                   ground plane is y = 0
 *   +X in front view : appears to the RIGHT on screen (camera sits at +Z,
 *                   looking down −Z, up = +Y)
 *
 * ANATOMICAL SIDE CONVENTION (never ambiguous):
 *   "left"/"right" always mean the MODEL's own anatomical sides. With the
 *   model facing the camera at yaw 0, the model's LEFT side appears on the
 *   screen-RIGHT (a real person facing you mirrors the same way).
 * ------------------------------------------------------------------------- */
export const DRESSED_3D_UNITS = "meters";
export const DRESSED_3D_UP_AXIS = "+Y";
export const DRESSED_3D_FORWARD_AXIS = "+Z";
export const DRESSED_3D_ORIGIN = "feet-center (ground plane y=0)";

/* ---------------------------------------------------------------------------
 * ROTATION — model yaw is THE rotation state of the whole system.
 *
 *   axis      : world +Y through the model origin (turntable)
 *   rule      : right-hand rule about +Y
 *   positive  : the model's front (+Z) rotates toward world +X
 *               (the face swings toward screen-right in the front view)
 *   unit      : RADIANS inside code/UI-boundary helpers; DEGREES only in
 *               labels and slider readouts. Convert at the boundary.
 *   camera    : framing is a deterministic function of the model bounds and
 *               is NEVER persisted — camera position/rotation is presentation
 *               only and must never become wardrobe placement data.
 *
 * Named views (explicit, no ambiguity):
 *   yaw =   0° : FRONT  — camera sees the model's front
 *   yaw = +90° : the model faces world +X — camera sees the model's RIGHT side
 *   yaw = 180° : BACK   — camera sees the model's back
 *   yaw = −90° : the model faces world −X — camera sees the model's LEFT side
 * ------------------------------------------------------------------------- */
export const DRESSED_YAW_ZERO_IS_FRONT = true;
export const DRESSED_CAMERA_IS_PERSISTED = false;

export const DRESSED_VIEWS = {
  FRONT: 0,
  /** Camera sees the model's anatomical RIGHT side (model faces +X). */
  RIGHT_SIDE: Math.PI / 2,
  BACK: Math.PI,
  /** Camera sees the model's anatomical LEFT side (model faces −X). */
  LEFT_SIDE: -Math.PI / 2,
} as const;

export function degreesToYawRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

export function yawRadiansToDegrees(radians: number): number {
  return (radians * 180) / Math.PI;
}

/* ---------------------------------------------------------------------------
 * CLOTHING DEPTH / "Z" — future semantic chain (documented now, NOT stored):
 *
 *   bone → anchor → local position (u, v, w) → local rotation → local scale
 *        → shell
 *
 *   u : anchor-local horizontal (body width direction)
 *   v : anchor-local vertical   (body height direction)
 *   w : anchor-local DEPTH / shell offset in meters along the anchor's local
 *       +Z — how far a garment sits proud of the skin. "Clothing Z" in DRESSED
 *       is ALWAYS this local w, NEVER a world coordinate.
 *
 * There is deliberately NO `placement3d` storage at the POC stage.
 * ------------------------------------------------------------------------- */
export const DRESSED_3D_DEPTH_CHAIN =
  "bone → anchor → (u,v,w) → rotation → scale → shell" as const;

/* ---------------------------------------------------------------------------
 * ANCHOR VOCABULARY — POC subset.
 *
 * Reuses the existing 2D anchor names where they exist (`head`, `torso`,
 * `waist` — CONFIRMED in src/lib/shared/clothing-categories.ts) and adds the
 * sided shoulder names required by the future accessory system (analysis/
 * dressed-freeform-ai-to-3d-feasibility-analysis.md §18: extend, don't
 * replace). Only enough anchors exist to prove the architecture.
 *
 * Legacy mapping note: 2D `shoulders` (single, centered) →
 * `shoulder_left` + `shoulder_right` in 3D.
 * ------------------------------------------------------------------------- */
export type Dressed3dAnchorName =
  | "head"
  | "torso"
  | "waist"
  | "shoulder_left"
  | "shoulder_right";

export const DRESSED_3D_POC_ANCHOR_NAMES: readonly Dressed3dAnchorName[] = [
  "head",
  "torso",
  "waist",
  "shoulder_left",
  "shoulder_right",
];
