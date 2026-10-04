export const CLOTHING_CATEGORIES = [
  { value: "tops", label: "Tops", group: "clothing" },
  { value: "shirts", label: "Shirts", group: "clothing" },
  { value: "sweaters", label: "Sweaters", group: "clothing" },
  { value: "jackets", label: "Jackets", group: "clothing" },
  { value: "dresses", label: "Dresses", group: "clothing" },
  { value: "skirts", label: "Skirts", group: "clothing" },
  { value: "pants", label: "Pants", group: "clothing" },
  { value: "shorts", label: "Shorts", group: "clothing" },
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

const CLOTHING_LAYER_ORDER: Record<ClothingCategory, number> = {
  shoes: 10,
  pants: 20,
  shorts: 20,
  skirts: 20,
  tops: 30,
  shirts: 30,
  sweaters: 30,
  dresses: 35,
  jackets: 40,
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
