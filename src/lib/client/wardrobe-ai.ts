import { waitForGenerationToFinish } from "./generation-usage";
import { CURRENT_CLOTHING_ASSET_VERSION } from "../shared/clothing-assets";
import type {
  ClothingBaseAsset,
  ClothingBaseType,
} from "../shared/clothing-assets";
import type { Placement } from "../shared/clothing-placement";

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

/* Persists the placement override of ONE wardrobe item (null = use the
   existing defaults). Placement belongs to the clothing item, never to an
   outfit, so the saved value follows the item into every outfit and render. */
export async function saveItemPlacement(
  accessToken: string,
  itemId: string,
  placement: Placement | null
): Promise<void> {
  const response = await fetch(`/api/wardrobe/items/${encodeURIComponent(itemId)}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ placement }),
    cache: "no-store",
  });
  if (!response.ok) {
    throw await responseError(response, "Could not save this placement.");
  }
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
  if (response.status === 202) {
    // Generation runs in a background function; wait for the server to finish, then read
    // the persisted asset instead of trusting a response that was never produced.
    await waitForGenerationToFinish(accessToken, "clothing");
    const wardrobe = await loadPersistentWardrobe(accessToken);
    const saved = wardrobe.items.find((entry) => entry.id === item.id);
    const asset = saved?.aiReadyAssets[item.baseType];
    if (!saved || !asset || asset.generationVersion !== CURRENT_CLOTHING_ASSET_VERSION) {
      throw new Error("The clothing generation did not finish. Please try again.");
    }
    return {
      id: saved.id,
      name: saved.name,
      category: saved.category,
      referencePath: asset.referencePath,
      previewUrl: asset.previewUrl,
      originalPath: saved.originalPath,
      originalPreviewUrl: saved.originalPreviewUrl,
      cleanPreviewPath: saved.cleanPreviewPath,
      cleanPreviewUrl: saved.cleanPreviewUrl,
      baseType: item.baseType,
      characterId: asset.characterId ?? "",
      generationVersion: asset.generationVersion,
      cacheHit: false,
    };
  }
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
    placement?: Placement | null;
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
      placement?: Placement | null;
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
