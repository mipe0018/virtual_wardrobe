export const CURRENT_CLOTHING_ASSET_VERSION = 3;

export const CLOTHING_BASE_TYPES = ["woman", "man"] as const;

export type ClothingBaseType = (typeof CLOTHING_BASE_TYPES)[number];

export type ClothingBaseAsset = {
  referencePath: string;
  previewUrl: string;
  generationVersion: number;
  characterId?: string;
};

export function clothingAssetCharacterId(
  userId: string,
  referencePath: string
): string | null {
  const prefix = `${userId}/clothing/`;
  if (!referencePath.startsWith(prefix)) return null;
  const [characterId, fileName, ...extraSegments] = referencePath
    .slice(prefix.length)
    .split("/");
  if (
    !characterId ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(characterId) ||
    !fileName?.toLowerCase().endsWith(".png") ||
    extraSegments.length > 0
  ) {
    return null;
  }
  return characterId;
}
