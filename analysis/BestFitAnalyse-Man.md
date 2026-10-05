# Best Fit — MAN clothing-fit analyse

> **READ-ONLY dokumentation.** Intet i dette dokument er implementeret.
> Den eksisterende funktionalitet for MAN er låst og urørt.
> Overordnet analyse: `BestFitAnalyse.md`. Modstykke: `BestFitAnalyse-Woman.md`.

---

## 0. Status for male clothing assets

> ### Unknown – insufficient male clothing asset data.
>
> Der findes **nule mandlige clothing assets** i projektet. Alle fire assets i
> `src/assets/system-reference/clothes/` er **female** — verificeret ved
> segmentanalyse (silhuetter på 433 px bredde passer `woman.png`'s krop på
> 433 px, ikke `man.png`'s på 445 px).
>
> **Derfor:** dette dokument kan analysere masterform, pipeline, anchors og
> transform-kæde fuldt ud for MAN. Det **kan ikke** analysere male asset-bounds,
> F_asset, F_eff eller vertikal/horisontal fit for mandlige assets.
>
> **Ingen female-måling er brugt som man-evidens.** Alle steder, hvor data
> mangler, er mærket `Unknown – insufficient male clothing asset data`.

**Komplet billedinventar i projektet:**

| Fil | Type |
|---|---|
| `base-forms/woman.png` | canonical master form (female) |
| `base-forms/man.png` | canonical master form (male) |
| `clothes/04d7f5be-…png` | clothing asset — **female** (joggers) |
| `clothes/5d1e6df1-…png` | clothing asset — **female** (skirt) |
| `clothes/b46171d1-…png` | clothing asset — **female** (jacket) |
| `clothes/tshirt.png` | clothing asset — **female** (t-shirt) |

---

## 1. Scope og metode

| Element | Metode |
|---|---|
| Master form | `pngjs` (colorType 2, RGB). Silhuet = luminance < 178 |
| Clothing assets | Manuel zlib-dekoder (colorType 6, RGBA) |
| Asset-bounds | Solid = alpha >= 128 |
| Analyse-scripts | `%TEMP%`, uden for projektet |

---

## 2. Canonical master form — `man.png`

### 2.1 Filformat

| Egenskab | Værdi |
|---|---|
| Dimensioner | 1024 × 1536 |
| Bit depth | 8 |
| Color type | **2 (RGB — ingen alpha-kanal)** |
| Interlace | 0 (nej) |
| Chunks | `IHDR`, `caBX`, `IDAT`, `IEND` |
| Gennemsigtighed | **Ingen.** Fuldstændig uopaque |

> `caBX` er C2PA-provenance-chunk. Findes i masterformer **og** clothing assets.

### 2.2 Kroppens afgrænsning

| Måling | Værdi | Frac af canvas |
|---|---:|---:|
| bbox x | 282 – 726 | 0.2754 – 0.7090 |
| bbox y | 32 – 1475 | 0.0208 – 0.9609 |
| bredde | 445 px | 0.4346 |
| højde | 1444 px | 0.9401 |
| **centerX** | **504.0** | **0.4922** |

### 2.3 Anatamiske landmarks

| Landmark | frac | bredde (px) | left | right |
|---|---:|---:|---:|---:|
| head top | 0.0208 | 11 | 501 | 511 |
| head | 0.0800 | 151 | 427 | 577 |
| face | 0.1400 | 99 | 454 | 552 |
| neck | 0.1850 | 217 | 396 | 612 |
| **skulderlinje** | **0.1758** | 161 | — | — |
| chest | 0.2700 | 381 | 312 | 692 |
| waist | 0.4200 | 425 | 292 | 716 |
| hip | 0.4600 | 432 | 289 | 720 |
| håndhøjde | 0.5000 | 440 | 285 | 724 |
| knee | 0.7200 | 189 | 413 | 601 |
| ankle | 0.9100 | 105 | 454 | 558 |
| foot | 0.9500 | 127 | 442 | 568 |

**Skulderlinje-metode:** største positive sprang i råbredde mellem 0.14 og 0.32.
Fundet ved y=270 (frac **0.1758**), delta 14 px. Råprofilen bekræfter forløbet:

```
y=240  w= 98     (hals)
y=250  w= 98
y=260  w=114
y=270  w=161     ← SPRING
y=280  w=208
y=290  w=242
y=300  w=307
y=320  w=351
y=450  w=394     (max i skulderzonen)
```

### 2.4 Sammenligning med woman master

| Måling | woman | man | Forskel |
|---|---:|---:|---:|
| bbox top | 32 | 32 | 0 px |
| bbox bund | 1474 | 1475 | 1 px |
| højde | 1443 | 1444 | 1 px |
| heightFrac | 0.9395 | 0.9401 | 0.0006 |
| centerX | 505.0 | 504.0 | 1 px |
| **skulderlinje** | **0.2025** | **0.1758** | **0.0267** |
| neck @0.185 | 209 | 217 | 1.04× |
| chest @0.27 | 307 | 381 | 1.24× |
| waist @0.42 | 378 | 425 | 1.12× |
| hip @0.46 | 396 | 432 | 1.09× |
| hånd @0.50 | 421 | 440 | 1.045× |
| knee @0.72 | 176 | 189 | 1.07× |
| ankle @0.91 | 102 | 105 | 1.03× |
| foot @0.95 | 123 | 127 | 1.03× |

**Konklusion:** de to masterformer er **næsten identisk indramet** (1 px i
højde og center). De afviger **kun i upper-body bredde**, som konvergerer mod
1.03 ved fødderne.

### 2.5 Horizontal reference

| Højde | y | yderste kant |
|---|---:|---|
| håndhøjde 0.50 | 768 | 285 … 724 (bredde 440) |
| centerX | — | 504.0 |

---

## 3. Clothing generation for MAN

```
Originalt clothing-billede
  ↓
POST /api/ai/process-clothing
  ↓  process-clothing.ts:286-291
  ↓  Håndhæver: baseType === primaryCharacter.gender
  ↓  (primaryCharacter.gender = 'man' for man-brugere)
  ↓
runClothingJob()
  ↓
loadSystemBaseFormDataUrl(client, 'man')   →  man.png
  ↓
editImage({
  images: [characterDataUrl, sourceDataUrl],   ← img1 = man.png, img2 = tøj
  size: "1024x1536",
  background: "transparent",
  prompt: clothing-job.ts:77-115                ← IDENTISK prompt for woman og man
})
```

**Bekræftet af kode:**

- Master form vælges via `DRESSED_BASE_FORM_PATHS[baseType]`
- `man.png` bruges **kun** når `baseType === 'man'`
- Der er **ingen fallback** til `woman.png` for man
- Prompten er **byte-identisk** for begge køn (37 strenge, ingen kønsforskel
  ud over `genderStyle` i character-prompten, som ikke er del af clothing-prompten)
- Prompt-linje 78 bruger interpolation: *"Image 1 is the canonical DRESSED
  ${baseType} base form"*

**Gemt i DB:** `wardrobe_item_ai_assets` med `base_type='man'`,
`generation_version=3`. Samme tabel, samme PK-struktur som woman.

---

## 4. Scale for MAN

Identisk for alle køn — ingen kønsopdeling:

```
--clothing-base-scale: var(--dressed-clothing-scale, 0.56)
placement.scale = 1 for alle 21 kategorier
effective scale = 0.56
```

Oprindelse: `d973d1b` "working solution with size", efter 0.60 → 0.55 → 0.56.
Ingen dokumenteret afledning.

**Uden male assets kan jeg ikke bevise, om 0.56 er korrekt for man.**
Se `BestFitAnalyse.md` afsnit 9.3 om hvorfor 0.56 overhovedet ikke kan
 valideres endnu.

---

## 5. Anchor-semantik for MAN

`dressedAnchor(anchor, baseType)` i `clothing-categories.ts`:

```ts
export function dressedAnchor(anchor, baseType) {
  const shared = DRESSED_ANCHORS[anchor];
  if (baseType !== "man") return shared;          // woman: uændret
  const maleY = MAN_ANCHOR_Y[anchor];
  return maleY === undefined ? shared : { x: shared.x, y: maleY };
}
```

`MAN_ANCHOR_Y` (kun for man):

| Anchor | woman y | man y | Forskel | Mandens målte landmark | Vurdering |
|---|---:|---:|---:|---|---|
| neck | 0.185 | **0.170** | −0.015 | 0.185 (217 px) | Mandens nakke smallere/højere |
| dress | 0.20 | **0.175** | −0.025 | skulderlinje 0.1758 | **Præcis** |
| shoulders | 0.22 | **0.200** | −0.020 | skulderlinje 0.1758 | 0.024 under linjen |
| torso | 0.27 | **0.250** | −0.020 | chest 0.27 (381 px) | 0.02 over bryst |
| waist | 0.42 | **0.400** | −0.020 | waist 0.42 (425 px) | 0.02 over talje |
| hips | 0.46 | **0.440** | −0.020 | hip 0.46 (432 px) | 0.02 over hofte |

**Uændrede anchors for man** (kun `MAN_ANCHOR_Y` har mand-specifik værdi):

| Anchor | y | Forventet | Vurdering for man |
|---|---:|---|---|
| head | 0.10 | 0.0800 (151 px) | OK |
| face | 0.14 | 0.1400 (99 px) | OK |
| ears | 0.14 | 0.1400 | OK |
| knees | 0.72 | 0.7200 (189 px) | **Præcis** |
| ankles | 0.91 | 0.9100 (105 px) | **Præcis** |
| feet | 0.95 | 0.9500 (127 px) | **Præcis** |
| left-hand | 0.33 / 0.50 | krop 285…724 | 338 px er 53 px inde fra venstre kant |
| right-hand | 0.67 / 0.50 | krop 285…724 | 686 px er 38 px inde fra højre kant |
| full-body | 0.5 | — | OK |

**Bemærk:** da `woman` returnerer `shared` direkte, er **woman-anchors
bevist uændrede** af `dressedAnchor()`.

---

## 6. Transform-orden for MAN

Identisk implementering — `wardrobe.astro:199-232` og `profile-outfits.ts:17-44`:

```
1. lag i .dressed-canvas (aspect-ratio 2/3)
2. object-fit: contain → 1024×1536 fylder boksen 1:1
3. transform-origin = (anchor.x × 100 %, anchor.y × 100 %)
4. translate(clothing-x, clothing-y) = 0/0   (placement.x/y er NEUTRAL)
5. scale(0.56 × 1) omkring origin
```

For man bruges `dressedAnchor(placement.anchor, 'man')`, så origin har den
mand-specifikke anchor.

`.dressed-canvas` har `width: min(100%, 493.333px)` og `aspect-ratio: 2/3`
→ 493.333 × 740 px. Begge køn renderer i samme boks.

**Ved scale omkring P:** punkt Q → `P + 0.56 × (Q − P)`. For man har P en
**anden y-værdi** end for woman, så samme asset ville placere sig relativt
forskelligt.

---

## 7. Hvad der kan og ikke kan analyseres for MAN

### 7.1 Kan analyseres fuldt ud (bekræftet)

| Element | Status |
|---|---|
| `man.png` format, dimensioner, alpha | CONFIRMED |
| `man.png` bbox, centerX, højde | CONFIRMED |
| `man.png` alle landmarks (11 punkter) | CONFIRMED |
| `man.png` skulderlinje (0.1758) | CONFIRMED |
| Master-valg i pipeline (`man.png` for man) | CONFIRMED i kode |
| Prompt-identitet woman/man | CONFIRMED (byte-identisk) |
| Anchor-tabel for man inkl. `MAN_ANCHOR_Y` | CONFIRMED i kode |
| Transform-kæde | CONFIRMED i kode |
| Scale 0.56 anvendes uændret for man | CONFIRMED i kode |
| DB-struktur (`base_type='man'`) | CONFIRMED i kode |
| woman/master forskelle (kvantitativt) | CONFIRMED |

### 7.2 Kan IKKE analyseres (data mangler)

For hver gælder:
**Unknown – insufficient male clothing asset data.**

| Spørgsmål | Status |
|---|---|
| Male asset canvas-størrelse | Unknown – ingen assets |
| Male asset alpha/solid bbox | Unknown – ingen assets |
| Male asset W/H/centerX/centerY | Unknown – ingen assets |
| Male asset transparente margener | Unknown – ingen assets |
| Male asset fracTop/fracBot | Unknown – ingen assets |
| Male F_asset (mod man-master) | Unknown – ingen assets |
| Male F_eff (F_asset × 0.56) | Unknown – ingen assets |
| Male vertikal fit (renderet top/bot) | Unknown – ingen assets |
| Male horisontal fit (offset) | Unknown – ingen assets |
| Er man-asset centreret på 504 eller 512? | Unknown – ingen assets |
| Er man-assets genereret mod `man.png` korrekt? | Unknown – ingen assets |
| Har man-assets samme F_asset-spread som female? | Unknown – ingen assets |
| Har man-assets samme vertikale afvigelser? | Unknown – ingen assets |

**Ingen af disse er estimeret ud fra female-data.**

---

## 8. Root cause for MAN

### 8.1 Hvad der kan konkluderes

| Problem | Klassificering | Status |
|---|---|---|
| Ingen male assets findes | Data-mangel | CONFIRMED |
| Anchor-pipeline for man korrekt implementeret | — | CONFIRMED i kode |
| Masterform korrekt valgt for man | — | CONFIRMED i kode |
| Prompt identisk for man | — | CONFIRMED i kode |
| `MAN_ANCHOR_Y` baseret på målt skulderlinje-forskel (0.0267) | C (anchor) | CONFIRMED |

### 8.2 Hvad der IKKE kan konkluderes

| Spørgsmål | Status |
|---|---|
| Er `0.56` korrekt for man? | **Unknown – insufficient male clothing asset data** |
| Er male clothing-fit-fejl samme type som female? | **Unknown** |
| Er male assets genereret korrekt i man.png's koordinatsystem? | **Unknown** |
| Findes male-specifikke afvigelser? | **Unknown** |

**Det er ikke bekræftet, at man har samme problem som woman.** Analysen af
woman kan ikke overføres.

---

## 9. WOMAN vs MAN — sammenligning

### 9.1 Identisk arkitektur (CONFIRMED i kode)

| Element | Identisk? | Bevis |
|---|---|---|
| Rendering-arkitektur | **Ja** | Samme `wardrobe.astro` / `profile-outfits.ts` |
| Canvas-størrelse | **Ja** | Begge 1024 × 1536 |
| Coordinate system | **Ja** | Samme `object-fit: contain`, samme boks |
| Asset-generations-pipeline | **Ja** | Samme `runClothingJob` |
| Prompt | **Ja** | Byte-identisk siden `3193b8a` |
| Model / provider | **Ja** | `gpt-image-2.5-sunburst` |
| Scale-værdi | **Ja** | 0.56 for begge |
| `placement.scale` | **Ja** | 1 for alle kategorier |
| `placement.x/y` | **Ja** | 0 for alle kategorier |
| Transform-orden | **Ja** | Identisk CSS |
| DB-struktur | **Ja** | Samme tabel/PK, kun `base_type` |
| Asset-stier | **Ja** | Samme mønster |
| Caching / force-regeneration | **Ja** | Samme kode |

### 9.2 Forskelle i geometry (CONFIRMED ved måling)

| Egenskab | woman | man |
|---|---|---|
| bbox højde | 1443 px | 1444 px (1 px) |
| heightFrac | 0.9395 | 0.9401 |
| centerX | 505.0 | 504.0 (1 px) |
| **skulderlinje** | **0.2025** | **0.1758** (0.0267) |
| chest | 307 px | 381 px (1.24×) |
| waist | 378 px | 425 px (1.12×) |
| hip | 396 px | 432 px (1.09×) |
| knee | 176 px | 189 px (1.07×) |
| foot | 123 px | 127 px (1.03×) |

### 9.3 Forskelle i anchors

Se afsnit 5. Kort fortalt: 6 anchors har mand-specifik y (`neck`, `dress`,
`shoulders`, `torso`, `waist`, `hips`); 8 anchors er delte. x-værdier er
**altid** delte mellem køn.

### 9.4 Fælles problemer

| Problem | Kenderstat |
|---|---|
| `0.56` er udokumenteret magic number | **Fælles** (samme CSS) |
| `left-hand` / `right-hand` x peger ikke på hænder | **Fælles** (samme anchors) |
| Assets centreres på canvas (512) frem for krop (505/504) | **Ukendt for man** |
| 12 af 14 anchors præcise mod landmarks | woman: bekræftet · man: delvist |

### 9.5 Specifikke problemer

| Problem | Kenderstat |
|---|---|
| Joggers vertikal extent (0.107→0.949) | **Woman-only** — ingen man-assets |
| Skirt 0.04 over talje | **Woman-only** |
| T-shirt F_eff 0.87 | **Woman-only** |
| Skulderlinje-forskel 0.0267 | **Begge** (kvantitativ forskel) |

### 9.6 Manglende data

Se afsnit 7.2 — 13 spørgsmål er
`Unknown – insufficient male clothing asset data`.

---

## 10. Unknown

| Spørgsmål | Status |
|---|---|
| Alle male asset-målinger | **Unknown – insufficient male clothing asset data** |
| Om 0.56 er korrekt for man | **Unknown** |
| Om man har samme F_asset-spread som woman | **Unknown** |
| Om man-assets er centreret på canvas eller krop | **Unknown** |
| Om `MAN_ANCHOR_Y` er korrekt i praksis | **Likely** — kun baseret på skulderlinje-forskel |
| Reel man-torso-bredde | **Unknown** — masterformen er linjetegning |

---

## 11. Anbefalinger — ingen implementeret

| # | Anbefaling | Status |
|---|---|---|
| M1 | **Få mandlige clothing assets tilgængelige** | Prærequisit for al videre man-analyse |
| M2 | **Mål man-assets mod `man.png`** | Følger af M1 |
| M3 | **Gentag woman-analysen for man** | Følger af M1 |
| M4 | **Behold `MAN_ANCHOR_Y` uændret** | Baseret på målt skulderlinje-forskel |
| M5 | **Lav fyldt silhouette-reference for begge køn** | Fælles prærequisit |
| M6 | **Rør ikke `0.56` før man-data foreligger** | Som for woman |

---

## 12. Change log

- `BestFitAnalyse-Man.md` oprettet som READ-ONLY analyse.
- **Ingen produktionskode, CSS, prompts, anchors, scale, assets, database
  eller migrations ændret.**
- Ingen female-måling brugt som man-evidens.
