import {
  CURRENT_CLOTHING_ASSET_VERSION,
  type ClothingBaseType,
} from "../shared/clothing-assets";
import { clothingPlacement, DRESSED_ANCHORS } from "../shared/clothing-categories";
import {
  loadPersistentWardrobe,
  loadSavedDressedOutfits,
  type SavedDressedOutfit,
} from "./wardrobe-ai";

type WardrobeItem = Awaited<ReturnType<typeof loadPersistentWardrobe>>["items"][number];

// Only the chosen outfit id is stored in the browser; no tokens or secrets.
const storageKey = (userId: string) => `dressed-profile-outfit:${userId}`;

function renderLayers(
  canvas: HTMLElement,
  items: WardrobeItem[],
  baseType: ClothingBaseType
) {
  canvas.querySelector(".profile-clothing-layers")?.remove();
  const layers = document.createElement("div");
  layers.className = "profile-clothing-layers";
  layers.setAttribute("aria-hidden", "true");
  items.forEach((item, index) => {
    const asset = item.aiReadyAssets?.[baseType];
    if (asset?.generationVersion !== CURRENT_CLOTHING_ASSET_VERSION || !asset.previewUrl) return;
    const layer = document.createElement("img");
    layer.className = "profile-clothing-layer";
    layer.src = asset.previewUrl;
    layer.alt = "";
    layer.style.zIndex = String(index + 1);
    const placement = clothingPlacement(item.category);
    const anchor = DRESSED_ANCHORS[placement.anchor];
    layer.style.setProperty("--anchor-x", String(anchor.x));
    layer.style.setProperty("--anchor-y", String(anchor.y));
    layer.style.setProperty("--clothing-scale", String(placement.scale));
    layer.style.setProperty("--clothing-x", `${placement.x}%`);
    layer.style.setProperty("--clothing-y", `${placement.y}%`);
    layers.appendChild(layer);
  });
  canvas.appendChild(layers);
}

export async function initProfileOutfits(
  accessToken: string,
  userId: string,
  modelPreview: HTMLElement
) {
  const panel = document.querySelector<HTMLElement>("#profile-outfits");
  const image = modelPreview.querySelector<HTMLImageElement>("img");
  if (!panel || !image) return;

  const [wardrobe, outfits] = await Promise.all([
    loadPersistentWardrobe(accessToken),
    loadSavedDressedOutfits(accessToken),
  ]);
  const baseType = wardrobe.primaryCharacterBaseType;
  const available = outfits.filter((outfit) =>
    outfit.characterId === wardrobe.primaryCharacterId && outfit.baseType === baseType
  );
  panel.replaceChildren();
  if (!baseType) return;

  let canvas = modelPreview.querySelector<HTMLElement>(".profile-dressed-canvas");
  if (!canvas) {
    canvas = document.createElement("div");
    canvas.className = "profile-dressed-canvas";
    image.replaceWith(canvas);
    canvas.appendChild(image);
  }
  const target = canvas;

  const itemsOf = (outfit: SavedDressedOutfit | undefined) =>
    (outfit?.itemIds ?? [])
      .map((id) => wardrobe.items.find((item) => item.id === id))
      .filter((item): item is WardrobeItem => Boolean(item));

  let savedId: string | null = localStorage.getItem(storageKey(userId));
  if (savedId && !available.some((outfit) => outfit.id === savedId)) savedId = null;
  let pendingId = savedId;
  renderLayers(target, itemsOf(available.find((o) => o.id === savedId)), baseType);

  const heading = document.createElement("strong");
  heading.textContent = "MY OUTFIT";
  const list = document.createElement("div");
  list.className = "profile-outfit-list";
  const saveButton = document.createElement("button");
  saveButton.type = "button";
  saveButton.className = "profile-outfit-save";
  saveButton.textContent = "SAVE OUTFIT CHOICE";
  const status = document.createElement("small");
  status.setAttribute("role", "status");

  const choices: Array<{ id: string | null; label: string }> = [
    { id: null, label: "NO OUTFIT" },
    ...available.map((outfit) => ({ id: outfit.id as string | null, label: outfit.name })),
  ];

  function refresh() {
    list.querySelectorAll<HTMLButtonElement>("button").forEach((button) => {
      const selected = (button.dataset.outfitId || null) === pendingId;
      button.classList.toggle("is-selected", selected);
      button.setAttribute("aria-pressed", String(selected));
    });
    saveButton.disabled = pendingId === savedId;
  }

  for (const choice of choices) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "profile-outfit-choice";
    button.dataset.outfitId = choice.id ?? "";
    button.textContent = choice.label;
    button.addEventListener("click", () => {
      pendingId = choice.id;
      status.textContent = pendingId === savedId ? "" : "CHOICE NOT SAVED YET.";
      refresh();
    });
    list.appendChild(button);
  }

  saveButton.addEventListener("click", () => {
    savedId = pendingId;
    if (savedId) localStorage.setItem(storageKey(userId), savedId);
    else localStorage.removeItem(storageKey(userId));
    renderLayers(target, itemsOf(available.find((o) => o.id === savedId)), baseType);
    status.textContent = savedId ? "OUTFIT SAVED AND SHOWN ON YOUR MODEL." : "OUTFIT REMOVED FROM YOUR MODEL.";
    refresh();
  });

  panel.append(heading, list, saveButton, status);
  if (available.length === 0) status.textContent = "NO SAVED OUTFITS YET. CREATE ONE IN CLOSET.";
  refresh();
}
