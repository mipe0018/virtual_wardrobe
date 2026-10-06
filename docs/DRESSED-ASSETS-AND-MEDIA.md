# DRESSED — ASSETS & MEDIA INVENTORY

> Komplet oversigt over projektets billeder/assets pr. dokumentationsrunden.
> Dimensioner er aflæst direkte fra PNG-IHDR bytes (fakta, ikke gæt).
> Mange billeder lever KUN runtime i Supabase Storage — de er ikke i repoet
> (se afsnit om runtime-assets).

## 4.1 IMAGE INVENTORY (filer i repoet)

```text
FILE: src/assets/system-reference/base-forms/woman.png
TYPE: PNG          DIMENSIONS: 1024×1536 (1.613.922 bytes — aflæst)
PURPOSE: CANONISK master form (kvinde) — geometry source of truth for både
         AI-karakter- og clothing-generation (samme koordinatsystem).
USED BY: server/ai/base-forms.ts (hentes fra storage/tabel dressed_base_forms;
         gate "must be exactly1024×1536"), alle AI-jobs som image1.
SOURCE: projektsystem-reference (indreholdt i Supabase via
        dressed_base_forms.storage_path).
CRITICAL: YES.   DO NOT MODIFY: YES.

FILE: src/assets/system-reference/base-forms/man.png
TYPE: PNG          DIMENSIONS: 1024×1536 (1.588.596 bytes — aflæst)
PURPOSE: CANONISK master form (mand). Samme rolle som woman.png.
USED BY: samme sti; base-type afledes af gender (baseTypeDerivations).
CRITICAL: YES.   DO NOT MODIFY: YES.

FILE: src/assets/system-reference/clothes/*.png  (8 filer — aflæst: ALLE 1024×1536)
  04d7f5be-ce4f-4d54-bdf6-abf049951750.png (1.610.797 B)
  5d1e6df1-6d33-4f66-be81-fb49be013b7a.png (1.412.664 B)
  b46171d1-81cc-495f-ba0c-5a4593171a51.png (2.104.117 B)
  codesshirt.png (1.179.240 B), codestop.png (1.101.031 B),
  longshirt.png (1.100.032 B), tshirt.png (870.289 B), tshirtwoman.png (1.000.823 B)
PURPOSE: Reference-tøj på det kanoniske canvas (brugbare som AI-kilde/referencer;
         samme1024×1536-koordinatsystem som master forms).
USED BY: AI-processering/referencer (system-reference). Bruges ikke direkte af
         siderne som UI-grafik.
CRITICAL: NO (men må IKKE ændres uden godkendelse — kanon-mål).
DO NOT MODIFY: YES (ude for scope).

FILE: public/favicon.ico, public/favicon.svg
TYPE: ICO + SVG     DIMENSIONS: n/a (ikon-formater)
PURPOSE: Site-icon (eneste SVG i projektet).
USED BY: Layout/browser.
CRITICAL: NO.   DO NOT MODIFY: uden godkendelse (Rule3).
```

**Total i repoet:10 PNG +1 SVG +1 ICO.** Ingen øvrige billeder findes i `src/`
eller `public/`.

## 4.2 MASTER FORMS

| | |
|---|---|
| **Location** | `src/assets/system-reference/base-forms/{woman,man}.png` |
| **Dimensions** | **1024×1536** begge (2:3) — aflæst fra PNG-header |
| **Role** | CANONICAL geometry: alle AI-jobs kører `size:"1024x1536"` med PNG-dim-tjek; AI må ikke ændre canvas (Rule12) |
| **Geometry purpose** | "Image1 = canonical base form (geometry)" for clothing-job; model-basis for character-job; browseren bruger det samme boks-forhold (`aspect-ratio:2/3`) i `.dressed-canvas` |
| **Supabase copy** | Tabel `dressed_base_forms` (migration `202610040010`, rækker indsat m. `base_type` + `storage_path`; RLS: select-only authenticated, revoke anon/public). `server/ai/base-forms.ts` henter fra tabellen + storage og GATEr `must be exactly1024×1536` |
| **Coordinate system** | Eet kanonisk1024×1536-koordinatsystem; browser-kompositionen arbejder i `%` af samme `absolute inset:0`-boks (placement `x/y` i %, `transform-origin` i anchor-%) |

## 4.3 CLOTHING ASSETS

**I repoet (system-referencer, alle1024×1536):** de8 filer i
`src/assets/system-reference/clothes/` (se §4.1). Kategorier kan ikke fastslås
sikkert fra filnavnene alene — UUID-navnene er AI-generede/emne-uafhængige.
Ingen af dem indgår direkte i UI.

**Runtime (egentlige clothing assets — IKKE i repoet):**

```text
KILDE: brugerens tøjfoto → POST /api/ai/process-clothing → clothing-job
       (image1 = canonical form, image2 = foto)
LAGER: Supabase Storage (bruger-mappe) + metadata i wardrobe_item_ai_assets
       pr. (user_id, item_id, base_type) med generationVersion =3 (CURRENT)
FORMAT: transparent PNG på1024×1536-canvas (AI-ready layer)
ADGANG: signerede URLs via clothing-assets-hjælperen (udløber → fornyes)
PLACEMENT-RELEVANS: fordi hvert lag er skabt på det kanoniske canvas, kan
       category-defaults + placement {anchor,x,y,scale} anvendes systemfrit på
       tværs af items — det er derfor placement tilhører item'et (ikke filen).
```

## 4.4 ICONS / SVG

- **Ingen ikon-mappe findes.** Projektets eneste SVG er `public/favicon.svg`.
- UI-ikoner er tekst/emoji/CSS (piller, badges, pixel-shadow) frem for SVG-sæt.
- **Navigationsikoner:** `Header.astro`/`Footer.astro` (tekst-links), ikke assets.
- Import-måde: statiske filer i `public/` servet direkte (`/favicon.svg`);
  PNG'er i `src/assets` bruges kun server-side i AI-pipen (ingen `import`-grafik
  i siderne).

## 4.5 STATIC ASSETS

| Type | Status |
|---|---|
| Fonts | **Ingen lokale fontfiler** — Google Fonts via `global.css` @import (DM Mono, DM Sans, Playfair Display) |
| Logoer | Ingen logofiler (tekst-baseret branding) |
| Baggrunde | CSS-gradients i `global.css` (ingen billeder) |
| Decorative | Pixel-shadow-tokens + gradients |
| System reference | `base-forms/` (2) + `clothes/` (8) — kanoniske, ikke-ui |
| Runtime-only | Profilbilleder, tøjuploads, AI-resultater, modelbilleder og master-form-kopien i Supabase Storage (ikke en del af repoet — dokumenteret her fordi de er "assets" for brugeren) |

**DO NOT MODIFY-princippet:** kanoniske PNG'er (§4.1–4.2) ændres aldrig uden
eksplicit godkendelse (Rule9/12) — dimensionerne er en del af AI-kontrakten.

