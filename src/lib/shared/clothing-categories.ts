import type { ClothingBaseType } from "./clothing-assets";

export const CLOTHING_CATEGORIES = [
  { value: "tops", label: "Tops", group: "clothing" },
  { value: "shirts", label: "Shirts", group: "clothing" },
  { value: "sweaters", label: "Sweaters", group: "clothing" },
  { value: "jackets", label: "Jackets", group: "clothing" },
  { value: "dresses", label: "Dresses", group: "clothing" },
  { value: "skirts", label: "Skirts", group: "clothing" },
  { value: "pants", label: "Pants", group: "clothing" },
  { value: "shorts", label: "Shorts", group: "clothing" },
  { value: "socks", label: "Socks", group: "clothing" },
  { value: "shoes", label: "Shoes", group: "accessory" },
  { value: "bags", label: "Bags", group: "accessory" },
  { value: "jewelry", label: "Jewelry", group: "accessory" },
  { value: "necklaces", label: "Necklaces", group: "accessory" },
  { value: "earrings", label: "Earrings", group: "accessory" },
  { value: "bracelets", label: "Bracelets", group: "accessory" },
  { value: "watches", label: "Watches", group: "accessory" },
  { value: "glasses", label: "Glasses", group: "accessory" },
  { value: "sunglasses", label: "Sunglasses", group: "accessory" },
  { value: "hats", label: "Hats", group: "accessory" },
  { value: "hair-accessories", label: "Hair Accessories", group: "accessory" },
  { value: "accessories", label: "Accessories", group: "accessory" },
  { value: "other", label: "Other", group: "other" },
] as const;

export type ClothingCategory = (typeof CLOTHING_CATEGORIES)[number]["value"];

export const CLOTHING_FILTER_GROUPS: ReadonlyArray<{
  value: string;
  label: string;
  categories: readonly ClothingCategory[] | null;
}> = [
  { value: "all", label: "ALL", categories: null },
  { value: "tops", label: "TOPS", categories: ["tops", "shirts", "sweaters"] },
  { value: "bottoms", label: "BOTTOMS", categories: ["pants", "shorts", "skirts"] },
  { value: "dresses", label: "DRESSES", categories: ["dresses"] },
  { value: "outerwear", label: "OUTERWEAR", categories: ["jackets"] },
  { value: "socks", label: "SOCKS", categories: ["socks"] },
  { value: "shoes", label: "SHOES", categories: ["shoes"] },
  {
    value: "accessories",
    label: "ACCESSORIES",
    categories: CLOTHING_CATEGORIES
      .filter((entry) => entry.group === "accessory" && entry.value !== "shoes")
      .map((entry) => entry.value),
  },
];

const CLOTHING_LAYER_ORDER: Record<ClothingCategory, number> = {
  socks: 5,
  pants: 20,
  shorts: 20,
  skirts: 20,
  tops: 30,
  shirts: 30,
  sweaters: 30,
  dresses: 35,
  jackets: 40,
  shoes: 45,
  bags: 50,
  jewelry: 60,
  necklaces: 60,
  bracelets: 60,
  watches: 60,
  accessories: 70,
  hats: 80,
  "hair-accessories": 80,
  glasses: 90,
  sunglasses: 90,
  earrings: 90,
  other: 70,
};

/*
 * Normalized placement system for the 2:3 DRESSED canvas.
 * Anchors are body points in canvas fractions (0-1). A layer is scaled uniformly
 * around its category anchor, so the anchor is where the garment attaches to the
 * model and stays fixed while the layer is scaled by --dressed-clothing-scale.
 * Garments hang down from their attachment line, so each anchor marks that line
 * (e.g. skirts/shorts hang from the waist-hip transition, dresses from the
 * shoulder/neck line). Categories add an optional uniform scale multiplier and x/y
 * offsets (percent of canvas); the defaults (scale 1, offset 0) leave placement to the anchor.
 */
export const DRESSED_ANCHORS = {
  head: { x: 0.5, y: 0.1 },
  face: { x: 0.5, y: 0.14 },
  ears: { x: 0.5, y: 0.14 },
  neck: { x: 0.5, y: 0.185 },
  shoulders: { x: 0.5, y: 0.22 },
  torso: { x: 0.5, y: 0.27 },
  waist: { x: 0.5, y: 0.42 },
  hips: { x: 0.5, y: 0.46 },
  "left-hand": { x: 0.33, y: 0.5 },
  "right-hand": { x: 0.67, y: 0.5 },
  knees: { x: 0.5, y: 0.72 },
  ankles: { x: 0.5, y: 0.91 },
  feet: { x: 0.5, y: 0.95 },
  "full-body": { x: 0.5, y: 0.5 },
  // Top-of-garment reference for dresses: the neckline/shoulder line from which the
  // full garment extent hangs. This is a dress attachment point, not the body centre.
  dress: { x: 0.5, y: 0.2 },
} as const;

export type DressedAnchor = keyof typeof DRESSED_ANCHORS;

/*
 * Male upper-body anchors.
 *
 * DRESSED_ANCHORS stays calibrated to the woman canonical base form, whose shoulder
 * line sits at canvas y ~= 0.212. The man canonical base form is broader through the
 * upper body and its shoulder line sits higher, at y ~= 0.176, so reusing the shared
 * anchors lands male garments below the actual shoulder line. These values re-anchor
 * the male upper body onto the man base form only.
 *
 * knees/ankles/feet are deliberately absent: measured at those heights the two figures
 * already agree within ~8%, so shifting them would misplace male footwear and socks.
 * head/face/ears and the hand anchors are also unchanged: both figures begin at the
 * same head top (y ~= 0.021) and share the same horizontal centre (x ~= 0.5).
 */
const MAN_ANCHOR_Y: Partial<Record<DressedAnchor, number>> = {
  neck: 0.17,
  dress: 0.175,
  shoulders: 0.2,
  torso: 0.25,
  waist: 0.4,
  hips: 0.44,
};

/**
 * Resolves the anchor a clothing layer attaches to. For `woman` (and any unknown base
 * type) this returns the shared DRESSED_ANCHORS value unchanged.
 */
export function dressedAnchor(
  anchor: DressedAnchor,
  baseType?: ClothingBaseType | null
): { x: number; y: number } {
  const shared = DRESSED_ANCHORS[anchor];
  if (baseType !== "man") return shared;
  const maleY = MAN_ANCHOR_Y[anchor];
  return maleY === undefined ? shared : { x: shared.x, y: maleY };
}

export type ClothingPlacement = {
  anchor: DressedAnchor;
  scale: number;
  x: number;
  y: number;
};

const NEUTRAL = { scale: 1, x: 0, y: 0 } as const;

const CLOTHING_PLACEMENT: Record<ClothingCategory, ClothingPlacement> = {
  tops: { anchor: "torso", ...NEUTRAL },
  shirts: { anchor: "torso", ...NEUTRAL },
  sweaters: { anchor: "torso", ...NEUTRAL },
  jackets: { anchor: "shoulders", ...NEUTRAL },
  dresses: { anchor: "dress", ...NEUTRAL },
  skirts: { anchor: "hips", ...NEUTRAL },
  pants: { anchor: "waist", ...NEUTRAL },
  shorts: { anchor: "hips", ...NEUTRAL },
  socks: { anchor: "ankles", ...NEUTRAL },
  shoes: { anchor: "feet", ...NEUTRAL },
  bags: { anchor: "right-hand", ...NEUTRAL },
  jewelry: { anchor: "neck", ...NEUTRAL },
  necklaces: { anchor: "neck", ...NEUTRAL },
  earrings: { anchor: "ears", ...NEUTRAL },
  bracelets: { anchor: "left-hand", ...NEUTRAL },
  watches: { anchor: "left-hand", ...NEUTRAL },
  glasses: { anchor: "face", ...NEUTRAL },
  sunglasses: { anchor: "face", ...NEUTRAL },
  hats: { anchor: "head", ...NEUTRAL },
  "hair-accessories": { anchor: "head", ...NEUTRAL },
  accessories: { anchor: "full-body", ...NEUTRAL },
  other: { anchor: "full-body", ...NEUTRAL },
};

export function clothingPlacement(value: unknown): ClothingPlacement {
  const category = normalizeClothingCategory(value);
  return CLOTHING_PLACEMENT[category ?? "other"];
}

export function normalizeClothingCategory(value: unknown): ClothingCategory | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase().replaceAll("_", "-");

  const legacy: Record<string, ClothingCategory> = {
    bottoms: "pants",
    "one-pieces": "dresses",
  };
  const category = legacy[normalized] ?? normalized;
  return CLOTHING_CATEGORIES.some((entry) => entry.value === category)
    ? (category as ClothingCategory)
    : null;
}

export function clothingLayerOrder(value: unknown): number {
  const category = normalizeClothingCategory(value);
  return category ? CLOTHING_LAYER_ORDER[category] : CLOTHING_LAYER_ORDER.other;
}

export function categoryLabel(category: ClothingCategory): string {
  return CLOTHING_CATEGORIES.find((entry) => entry.value === category)?.label ?? "Other";
}
