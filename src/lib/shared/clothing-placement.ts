import {
  clothingPlacement,
  DRESSED_ANCHORS,
  type DressedAnchor,
} from "./clothing-categories";

/*
 * Shared placement resolver + validator for the per-item placement override
 * {anchor, x, y, scale} produced by the wardrobe placement editor.
 *
 * Resolution priority, identical in DRESSED (wardrobe) and Profile:
 *   session override -> persisted item placement -> existing category default.
 *
 * A missing/NULL/invalid persisted placement always falls back to the existing
 * clothingPlacement() defaults, so items that were never adjusted render
 * exactly as they did before placement persistence existed.
 */

export type Placement = {
  anchor: DressedAnchor;
  x: number;
  y: number;
  scale: number;
};

export const PLACEMENT_SCALE_MIN = 0.4;
export const PLACEMENT_SCALE_MAX = 2;
export const PLACEMENT_OFFSET_LIMIT = 60; // percent of canvas, per axis

const PLACEMENT_PRECISION = 4; // decimals persisted to the database
const PLACEMENT_KEYS = "anchor,scale,x,y";

function isAnchorKey(value: unknown): value is DressedAnchor {
  return (
    typeof value === "string" &&
    Object.prototype.hasOwnProperty.call(DRESSED_ANCHORS, value)
  );
}

function hasExactShape(record: Record<string, unknown>): boolean {
  return Object.keys(record).sort().join(",") === PLACEMENT_KEYS;
}

function round(value: number): number {
  const factor = 10 ** PLACEMENT_PRECISION;
  return Math.round(value * factor) / factor;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Strict validation for WRITES (editor DONE and the PATCH endpoint). Returns
 * null unless the value is exactly {anchor,x,y,scale} with a known anchor and
 * finite numbers inside the editor limits. Numbers are rounded before being
 * returned so repeated saves stay byte-stable.
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
  return { anchor, x: round(x), y: round(y), scale: round(scale) };
}

/**
 * Tolerant sanitization for READS: never throws. Unknown shape or unknown
 * anchor returns null (=> defaults); numbers are clamped to the editor limits
 * but NOT rounded, so rendering keeps the exact values drawn in the session.
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
  return {
    anchor,
    x: clamp(x, -PLACEMENT_OFFSET_LIMIT, PLACEMENT_OFFSET_LIMIT),
    y: clamp(y, -PLACEMENT_OFFSET_LIMIT, PLACEMENT_OFFSET_LIMIT),
    scale: clamp(scale, PLACEMENT_SCALE_MIN, PLACEMENT_SCALE_MAX),
  };
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

/** True when a stored/known value already equals the given placement. */
export function isSamePlacement(value: unknown, other: Placement): boolean {
  const left = sanitizePlacement(value);
  if (!left) return false;
  return (
    left.anchor === other.anchor &&
    left.x === other.x &&
    left.y === other.y &&
    left.scale === other.scale
  );
}
