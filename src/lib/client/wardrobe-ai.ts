import type {
  ClothingBaseAsset,
  ClothingBaseType,
} from "../shared/clothing-assets";

export type ProcessableWardrobeItem = {
  id: string;
  name: string;
  category: string;
  image: string;
  originalPath?: string;
  baseType?: ClothingBaseType;
};

export type ProcessedWardrobeItem = {
  id: string;
  name: string;
  category: string;
  referencePath: string;
  previewUrl: string;
  originalPath: string | null;
  originalPreviewUrl: string | null;
  cleanPreviewPath: string | null;
  cleanPreviewUrl: string | null;
  baseType: ClothingBaseType;
  characterId: string;
  generationVersion: number;
  cacheHit: boolean;
};

export type SavedWardrobeResult = {
  id: string;
  itemIds: string[];
  resultPath: string;
  previewUrl: string;
  createdAt: string;
};

export type SavedDressedOutfit = {
  id: string;
  characterId: string;
  baseType: ClothingBaseType;
  name: string;
  itemIds: string[];
  updatedAt: string;
};

async function responseError(response: Response, fallback: string): Promise<Error> {
  const contentType = response.headers.get("content-type") ?? "";
  const result = contentType.includes("application/json")
    ? await response.json() as { error?: string }
    : null;
  return new Error(result?.error ?? fallback);
}

export async function loadSavedDressedOutfits(
  accessToken: string
): Promise<SavedDressedOutfit[]> {
  const response = await fetch("/api/wardrobe/outfits", {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });
  const result = await response.json() as {
    error?: string;
    outfits?: SavedDressedOutfit[];
  };
  if (!response.ok) throw new Error(result.error ?? "Could not load your saved outfits.");
  return result.outfits ?? [];
}

export async function saveDressedOutfit(
  accessToken: string,
  name: string,
  itemIds: string[]
): Promise<SavedDressedOutfit> {
  const response = await fetch("/api/wardrobe/outfits", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ name, itemIds }),
  });
  const result = await response.json() as {
    error?: string;
    outfit?: SavedDressedOutfit;
  };
  if (!response.ok || !result.outfit) {
    throw new Error(result.error ?? "Could not save this outfit.");
  }
  return result.outfit;
}

export async function deleteSavedDressedOutfit(
  accessToken: string,
  outfit: Pick<SavedDressedOutfit, "id" | "name">
): Promise<boolean> {
  if (!window.confirm(`Remove the saved outfit "${outfit.name}"?`)) return false;
  const response = await fetch(`/api/wardrobe/outfits/${encodeURIComponent(outfit.id)}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) throw await responseError(response, "Could not remove this saved outfit.");
  return true;
}

export async function processClothingItem(
  accessToken: string,
  item: ProcessableWardrobeItem & { baseType: ClothingBaseType }
): Promise<ProcessedWardrobeItem> {
  const response = await fetch("/api/ai/process-clothing", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      id: item.id,
      name: item.name,
      category: item.category,
      baseType: item.baseType,
      imageDataUrl: item.image || undefined,
    }),
  });
  const result = (await response.json()) as {
    error?: string;
    item?: ProcessedWardrobeItem;
  };
  if (!response.ok || !result.item) {
    throw new Error(result.error ?? "Could not prepare this clothing item.");
  }
  return result.item;
}

export async function saveOriginalClothingItem(
  accessToken: string,
  item: ProcessableWardrobeItem
): Promise<{
  id: string;
  name: string;
  category: string;
  originalPath: string;
  originalPreviewUrl: string;
  previewPath: string | null;
  cleanPreviewUrl: string | null;
  previewError: string | null;
}> {
  const response = await fetch("/api/wardrobe/items", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      id: item.id,
      name: item.name,
      category: item.category,
      imageDataUrl: item.image,
    }),
  });
  const result = (await response.json()) as {
    error?: string;
    item?: {
      id: string;
      name: string;
      category: string;
      originalPath: string;
      originalPreviewUrl: string;
      previewPath: string | null;
      cleanPreviewUrl: string | null;
      previewError: string | null;
    };
  };
  if (!response.ok || !result.item) {
    throw new Error(result.error ?? "Could not save the original clothing item.");
  }
  return result.item;
}

export async function confirmAndDeleteWardrobeItem(
  accessToken: string,
  item: Pick<ProcessableWardrobeItem, "id" | "name">
): Promise<boolean> {
  if (!window.confirm(`Are you sure you want to remove "${item.name}"?`)) return false;

  const response = await fetch(`/api/wardrobe/items/${encodeURIComponent(item.id)}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) {
    const contentType = response.headers.get("content-type") ?? "";
    const result = contentType.includes("application/json")
      ? (await response.json()) as { error?: string }
      : null;
    throw new Error(result?.error ?? "Could not remove this clothing item. Please try again.");
  }
  return true;
}

export async function readImageDataUrl(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not cache image (HTTP ${response.status}).`);
  const blob = await response.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      typeof reader.result === "string"
        ? resolve(reader.result)
        : reject(new Error("Image could not be converted to a local cache."));
    reader.onerror = () => reject(reader.error ?? new Error("Image could not be read."));
    reader.readAsDataURL(blob);
  });
}

export async function loadPersistentWardrobe(accessToken: string): Promise<{
  items: Array<{
    id: string;
    name: string;
    category: string;
    referencePath: string | null;
    previewUrl: string | null;
    cleanPreviewPath: string | null;
    cleanPreviewUrl: string | null;
    originalPath: string | null;
    originalPreviewUrl: string | null;
    baseType: ClothingBaseType | null;
    aiReadyAssets: Partial<Record<ClothingBaseType, ClothingBaseAsset>>;
    generationVersion: number | null;
    createdAt: string;
  }>;
  results: SavedWardrobeResult[];
  primaryCharacterId: string | null;
  primaryCharacterBaseType: ClothingBaseType | null;
}> {
  const response = await fetch("/api/wardrobe/items", {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });
  const result = (await response.json()) as {
    error?: string;
    items?: Array<{
      id: string;
      name: string;
      category: string;
      referencePath: string | null;
      previewUrl: string | null;
      cleanPreviewPath: string | null;
      cleanPreviewUrl: string | null;
      originalPath: string | null;
      originalPreviewUrl: string | null;
      baseType: ClothingBaseType | null;
      aiReadyAssets: Partial<Record<ClothingBaseType, ClothingBaseAsset>>;
      generationVersion: number | null;
      createdAt: string;
    }>;
    results?: SavedWardrobeResult[];
    primaryCharacterId?: string | null;
    primaryCharacterBaseType?: ClothingBaseType | null;
  };
  if (!response.ok) throw new Error(result.error ?? "Could not load saved wardrobe items.");
  return {
    items: result.items ?? [],
    results: result.results ?? [],
    primaryCharacterId: result.primaryCharacterId ?? null,
    primaryCharacterBaseType: result.primaryCharacterBaseType ?? null,
  };
}
