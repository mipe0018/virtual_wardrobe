export type DressedCharacterCache = {
  version: 1;
  modelPhotoPath: string;
  imageDataUrl?: string;
  gender: "woman" | "man";
  generatedAt: string;
};

export const DRESSED_CHARACTER_KEY = "dressed-character";
const MAX_LOCAL_IMAGE_CHARS = 3_800_000;

export function readDressedCharacterCache(): DressedCharacterCache | null {
  try {
    const stored = localStorage.getItem(DRESSED_CHARACTER_KEY);
    if (!stored) return null;
    const value: unknown = JSON.parse(stored);
    if (
      !value ||
      typeof value !== "object" ||
      (value as DressedCharacterCache).version !== 1 ||
      typeof (value as DressedCharacterCache).modelPhotoPath !== "string" ||
      !["woman", "man"].includes((value as DressedCharacterCache).gender)
    ) {
      return null;
    }
    return value as DressedCharacterCache;
  } catch (error) {
    console.warn("Could not read the saved DRESSED character cache.", error);
    return null;
  }
}

export async function cacheDressedCharacter(input: {
  signedUrl: string;
  modelPhotoPath: string;
  gender: "woman" | "man";
  generatedAt?: string;
}): Promise<boolean> {
  const existing = readDressedCharacterCache();
  const cache: DressedCharacterCache = {
    version: 1,
    modelPhotoPath: input.modelPhotoPath,
    gender: input.gender,
    generatedAt:
      input.generatedAt ??
      (existing?.modelPhotoPath === input.modelPhotoPath && existing.gender === input.gender
        ? existing.generatedAt
        : new Date().toISOString()),
  };

  try {
    const response = await fetch(input.signedUrl);
    if (!response.ok) throw new Error(`Character download returned HTTP ${response.status}.`);
    const blob = await response.blob();
    if (blob.size <= MAX_LOCAL_IMAGE_CHARS * 0.72) {
      const imageDataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () =>
          typeof reader.result === "string"
            ? resolve(reader.result)
            : reject(new Error("Character cache was not encoded as an image."));
        reader.onerror = () => reject(reader.error ?? new Error("Could not read character image."));
        reader.readAsDataURL(blob);
      });
      if (imageDataUrl.length <= MAX_LOCAL_IMAGE_CHARS) cache.imageDataUrl = imageDataUrl;
    }
    localStorage.setItem(DRESSED_CHARACTER_KEY, JSON.stringify(cache));
    return Boolean(cache.imageDataUrl);
  } catch (error) {
    console.warn("Could not cache the DRESSED character locally.", error);
    delete cache.imageDataUrl;
    try {
      localStorage.setItem(DRESSED_CHARACTER_KEY, JSON.stringify(cache));
    } catch (storageError) {
      console.warn("Could not save DRESSED character metadata locally.", storageError);
    }
    return false;
  }
}
