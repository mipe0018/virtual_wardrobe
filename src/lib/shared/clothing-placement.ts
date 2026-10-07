import {
  clothingPlacement,
  DRESSED_ANCHORS,
  type DressedAnchor,
} from "./clothing-categories";

/*
 * Shared placement resolver + validator for the per-item placement override
 * {anchor, x, y, scale[, scaleX, scaleY]} produced by the wardrobe placement editor.
 *
 * Resolution priority, identical in DRESSED (wardrobe) and Profile:
 *   session override -> persisted item placement -> existing category default.
 *
 * A missing/NULL/invalid persisted placement always falls back to the existing
 * clothingPlacement() defaults, so items that were never adjusted render
 * exactly as they did before placement persistence existed.
 *
 * `scale` keeps its historical meaning: the canonical PROPORTIONAL scale.
 * `scaleX`/`scaleY` are optional FREE-scaling axes; they are only ever stored
 * together (both or neither) and are never required — legacy 4-key rows stay
 * valid and render exactly as before via effectiveScaleX/effectiveScaleY.
 */

export type Placement = {
  anchor: DressedAnchor;
  x: number;
  y: number;
  scale: number;
  /** Optional free horizontal scale (0.4–2). Only stored together with `scaleY`. */
  scaleX?: number;
  /** Optional free vertical scale (0.4–2). Only stored together with `scaleX`. */
  scaleY?: number;
};

export const PLACEMENT_SCALE_MIN = 0.4;
export const PLACEMENT_SCALE_MAX = 2;
export const PLACEMENT_OFFSET_LIMIT = 60; // percent of canvas, per axis

const PLACEMENT_PRECISION = 4; // decimals persisted to the database
const PLACEMENT_KEYS = "anchor,scale,x,y";
// Free-scaling shape: the legacy four keys PLUS both axis keys together.
// {…,scaleX} or {…,scaleY} alone is intentionally NOT a valid shape.
const PLACEMENT_KEYS_FREE = "anchor,scale,scaleX,scaleY,x,y";

function isAnchorKey(value: unknown): value is DressedAnchor {
  return (
    typeof value === "string" &&
    Object.prototype.hasOwnProperty.call(DRESSED_ANCHORS, value)
  );
}

function hasExactShape(record: Record<string, unknown>): boolean {
  const keys = Object.keys(record).sort().join(",");
  // Exactly the legacy four keys, OR exactly the six free-scaling keys.
  return keys === PLACEMENT_KEYS || keys === PLACEMENT_KEYS_FREE;
}

function round(value: number): number {
  const factor = 10 ** PLACEMENT_PRECISION;
  return Math.round(value * factor) / factor;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Strict validation for WRITES (editor DONE, FREE scaling and the PATCH
 * endpoint). Returns null unless the value is exactly {anchor,x,y,scale} — or
 * exactly {anchor,x,y,scale,scaleX,scaleY} — with a known anchor and finite
 * numbers inside the editor limits. `scaleX`/`scaleY` are both required when
 * either is present (never stored alone) and use the same 0.4–2 range as
 * `scale`. Numbers are rounded before being returned so repeated saves stay
 * byte-stable.
 */
export function parsePlacement(value: unknown): Placement | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (!hasExactShape(record)) return null;
  const anchor = record.anchor;
  if (!isAnchorKey(anchor)) return null;
  const { x, y, scale } = record;
  if (typeof x !== "number" || !Number.isFinite(x)) return null;
  if (typeof y !== "number" || !Number.isFinite(y)) return null;
  if (typeof scale !== "number" || !Number.isFinite(scale)) return null;
  if (x < -PLACEMENT_OFFSET_LIMIT || x > PLACEMENT_OFFSET_LIMIT) return null;
  if (y < -PLACEMENT_OFFSET_LIMIT || y > PLACEMENT_OFFSET_LIMIT) return null;
  if (scale < PLACEMENT_SCALE_MIN || scale > PLACEMENT_SCALE_MAX) return null;
  const placement: Placement = { anchor, x: round(x), y: round(y), scale: round(scale) };
  if ("scaleX" in record) {
    // hasExactShape guarantees scaleX AND scaleY are both present here.
    const { scaleX, scaleY } = record;
    if (typeof scaleX !== "number" || !Number.isFinite(scaleX)) return null;
    if (typeof scaleY !== "number" || !Number.isFinite(scaleY)) return null;
    if (scaleX < PLACEMENT_SCALE_MIN || scaleX > PLACEMENT_SCALE_MAX) return null;
    if (scaleY < PLACEMENT_SCALE_MIN || scaleY > PLACEMENT_SCALE_MAX) return null;
    placement.scaleX = round(scaleX);
    placement.scaleY = round(scaleY);
  }
  return placement;
}

/**
 * Tolerant sanitization for READS: never throws. Unknown shape or unknown
 * anchor returns null (=> defaults); numbers are clamped to the editor limits
 * but NOT rounded, so rendering keeps the exact values drawn in the session.
 * Optional `scaleX`/`scaleY` are only kept when both are present and valid
 * numbers — otherwise the placement degrades to its legacy proportional form.
 */
export function sanitizePlacement(value: unknown): Placement | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (!hasExactShape(record)) return null;
  const anchor = record.anchor;
  if (!isAnchorKey(anchor)) return null;
  const { x, y, scale } = record;
  if (typeof x !== "number" || !Number.isFinite(x)) return null;
  if (typeof y !== "number" || !Number.isFinite(y)) return null;
  if (typeof scale !== "number" || !Number.isFinite(scale)) return null;
  const placement: Placement = {
    anchor,
    x: clamp(x, -PLACEMENT_OFFSET_LIMIT, PLACEMENT_OFFSET_LIMIT),
    y: clamp(y, -PLACEMENT_OFFSET_LIMIT, PLACEMENT_OFFSET_LIMIT),
    scale: clamp(scale, PLACEMENT_SCALE_MIN, PLACEMENT_SCALE_MAX),
  };
  if ("scaleX" in record) {
    const { scaleX, scaleY } = record;
    if (typeof scaleX === "number" && Number.isFinite(scaleX)
      && typeof scaleY === "number" && Number.isFinite(scaleY)) {
      placement.scaleX = clamp(scaleX, PLACEMENT_SCALE_MIN, PLACEMENT_SCALE_MAX);
      placement.scaleY = clamp(scaleY, PLACEMENT_SCALE_MIN, PLACEMENT_SCALE_MAX);
    }
    // Invalid pair => keep the legacy proportional form (drop both axes).
  }
  return placement;
}

/**
 * Effective horizontal/vertical scale: `scaleX ?? scale` and `scaleY ?? scale`.
 * Legacy 4-key placements render exactly as before (both equal `scale`).
 */
export function effectiveScaleX(placement: Placement): number {
  return placement.scaleX ?? placement.scale;
}

export function effectiveScaleY(placement: Placement): number {
  return placement.scaleY ?? placement.scale;
}

/** session override -> persisted item placement -> category default. */
export function resolveItemPlacement(input: {
  category: unknown;
  persistedPlacement?: unknown;
  sessionOverride?: unknown;
}): Placement {
  const override = sanitizePlacement(input.sessionOverride);
  if (override) return override;
  const persisted = sanitizePlacement(input.persistedPlacement);
  if (persisted) return persisted;
  const base = clothingPlacement(input.category);
  return { anchor: base.anchor, x: base.x, y: base.y, scale: base.scale };
}

/** True when a stored/known value already equals the given placement.
 * Optional `scaleX`/`scaleY` must match too (undefined === undefined keeps
 * legacy-vs-legacy comparison unchanged, so unchanged placements still skip
 * the PATCH as before). */
export function isSamePlacement(value: unknown, other: Placement): boolean {
  const left = sanitizePlacement(value);
  if (!left) return false;
  return (
    left.anchor === other.anchor &&
    left.x === other.x &&
    left.y === other.y &&
    left.scale === other.scale &&
    left.scaleX === other.scaleX &&
    left.scaleY === other.scaleY
  );
}
