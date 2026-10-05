# Phase 2 — Woman T-shirt test

> **READ-ONLY empirisk analyse.** Ingen produktionskode, prompts, CSS, anchors,
> assets, database eller migrations blev ændret.
> Relateret: `BestFitAnalyse.md`, `BestFitAnalyse-Woman.md`,
> `ClothingPlacement-Implementation-Analysis.md`.

---

## 0. Test-setup

| Element | Værdi |
|---|---|
| Testasset | `src/assets/system-reference/clothes/tshirtwoman.png` |
| Master (source of truth) | `src/assets/system-reference/base-forms/woman.png` |
| Pipeline | Uændret DRESSED `runClothingJob` → `gpt-image-2.5-sunburst` |
| Prompt | `clothing-job.ts:77-115` — urørt, byte-identisk siden `3193b8a` |
| Fase 1 status | `--clothing-base-scale = 1` (CSS), ingen ændring i denne test |
| Asset lifecycle | Nyt item — eksisterende produktionsassets urørt |

**Målemetode (uændret fra de tidligere analyser):**

| Element | Metode |
|---|---|
| Master | `pngjs` (colorType 2, RGB), silhuet = luminance < 178 |
| Asset | Manuel zlib-dekoder (colorType 6, RGBA) |
| Solid bounds | **alpha ≥ 128** |
| Haze-kontrol | alpha ≥ 1 sammenlignet med alpha ≥ 128 |

---

## 1. Master `woman.png` — anatomiske landmarks

| Landmark | y_px | y_n | bredde_px | x_px center |
|---|---:|---:|---:|---:|
| neck (smalleste før skulder) | 300 | 0.1953 | 169 | 510 |
| **skulderlinje** | **311** | **0.2025** | 217 | 507 |
| chest / torso | 415 | 0.2702 | 307 | 506 |
| waist | 645 | 0.4199 | 378 | 506 |
| hip | 707 | 0.4603 | 396 | 506 |
| håndlinje (arm-span) | 768 | 0.5000 | 421 | 505 |
| body bbox | x 289–721 / y 32–1474 | 0.2822–0.7041 | 433 | centerX 505.0 |

---

## 2. Måling af `tshirtwoman.png`

### 2.1 Filformat

| Egenskab | Værdi |
|---|---|
| Canvas | **1024 × 1536** — identisk med master |
| PNG type | colorType 6 (RGBA), depth 8, ikke-interlaced |
| Chunks | `IHDR`, `caBX`, 14 × `IDAT`, `IEND` |
| Alpha | Aktiv. Solid = alpha ≥ 128 |

### 2.2 Bounds

| Måling | Værdi |
|---|---|
| alpha ≥ 1 (inkl. haze) | x[41,910] y[67,1127] — W 870, H 1061 |
| **alpha ≥ 128 (solid)** | **x[116,907] y[269,1064]** — W 792, H 796 |
| Haze-overvurdering | **+9.8 % bredde, +33.3 % højde** |

> **Alpha-haze er reel her.** En måling på alpha ≥ 1 ville give W 870 / H 1061
> i stedet for 792 / 796. Haze-boksen strækker sig 202 px højere i toppen
> (67 vs 269) og 63 px længere i bunden (1127 vs 1064). Kun alpha ≥ 128 er
> gyldig garment-måling.

### 2.3 Solid-målinger

| Måling | Pixel | Normaliseret |
|---|---:|---:|
| left | 116 | 0.1133 |
| right | 907 | 0.8867 |
| **top** | **269** | **0.1751** |
| **bottom** | **1064** | **0.6934** |
| width | 792 | 0.7734 |
| height | 796 | 0.5182 |
| **centerX** | **511.5** | **0.4995** |
| centerY | 666.5 | 0.4339 |
| Margener T/B/L/R | 269 / 471 / 116 / 116 | |

### 2.4 Silhouetprofil

```
frac     y_px   span   dens   d/s    left  right  centerX
0.20      307    394    394   100%    315    708    512
0.25      384    629    629   100%    198    826    512
0.30      461    713    713   100%    156    868    512
0.35      538    779    779   100%    123    901    512   ← PEAK (ærmer)
0.40      614    423    423   100%    301    723    512   ← skarp fald (ærmer slut)
0.45      691    387    387   100%    319    705    512
0.50      768    348    348   100%    338    685    512   ← smalleste (taljetap)
0.55      845    366    366   100%    331    696    514
0.60      922    438    438   100%    294    731    513
0.65      998    491    491   100%    267    757    512   ← bund (let udvidelse)
0.70     1075    (tom)
```

**Segments:** 1 sammenhængende segment i alle højder (undtagen y=276 med to
34–36 px-bits = kraven). Densitet 100 % i alle rækker.

**Tolkning:** **kortærmet T-shirt, flat-lagd.** Ærmerne er fusioneret med
kroppen (ingen gap), så spidsen på 0.35 (779 px) er skulder + ærme, og
faldet til 0.40 (423 px) er det punkt, hvor ærmerne slutter.

---

## 3. Forventet T-shirt-region — afledt KUN af masteren

T-shirtens anatomi: **skulder → talje/øvre hofte**, plus **korte ærme** der
dækker øverste arm.

| Kant | Anatomisk grundlag | Forventet (px) | Forventet (n) |
|---|---|---:|---:|
| **Top** | Skulder-søm på skulderlinjen | **311** | **0.2025** |
| **Bund** | Talje (645) til øvre hofte (707) | **645–707** | **0.4199–0.4603** |
| **Krop-bredde** | Skal dække chest 307 → waist 378 | ≥ 307–378 | 0.30–0.37 |
| **Ærme-span** | Kortærme når ca. arm-span | ≤ 421 | 0.41 |
| **centerX** | Masterens centerX | **505.0** | **0.4932** |

**Brugt interval: top 0.2025 → bund 0.4603 (396 px).** Dette er masterens
fulde skulder→hofte-region — det mest generøse rimelige T-shirt-interval.
**Ikke** baseret på assetets egen bbox.

Anchor `torso = 0.27` (y = 415 px) er masterens **chest** (bredde 307) — et
anatomisk referencepunkt, **ikke** definitionen af T-shirtens placering.

---

## 4. Sammenligning: forventet (master) vs. faktisk (asset)

### 4.1 Delta-tabel

| Kant | Forventet | Faktisk | Δ | Δ px |
|---|---:|---:|---:|---:|
| **Top** | 0.2025 | **0.1751** | **−0.0274** | **−42 px (for høj)** |
| **Bund** | 0.4603 | **0.6934** | **+0.2331** | **+358 px (for lav)** |
| Left | 0.2822 (body bbox) | 0.1133 | −0.1689 | −173 px |
| Right | 0.7041 (body bbox) | 0.8867 | +0.1826 | +187 px |
| **centerX** | 0.4932 (505.0) | 0.4995 (511.5) | **+0.0063** | **+6.5 px** |
| **Højde** | 396 px | **796 px** | +400 px | **2.01×** |
| **Bredde** | 433 px (body) | **792 px** | +359 px | **1.83×** |
| **Ærme-span @0.35** | ≤ 421 (arm) | **779 px** | +358 px | **1.85×** |

### 4.2 Vurdering adskilt

| Dimension | Vurdering | Bevis |
|---|---|---|
| **1. Form** | ✅ **Korrekt** | 1 sammenhængende segment, 100 % densitet, genkendelig kortærmet T-shirt med krave, taljetap og let bundudvidelse |
| **2. Størrelse** | ❌ **ca. 2× for stor** | H 796 mod forventet 396 px. Bredde 792 mod 433 (body) / 421 (arm-span) |
| **3. Placering (vertikal)** | ❌ **Forkert** | Top 42 px for høj, bund 358 px for lav |
| **4. Placering (horizontal)** | ✅ **Korrekt** | centerX 511.5 mod master 505.0 = **+6.5 px (0.6 %)** |
| **5. Canvas/coordinate system** | ✅ **Korrekt** | 1024 × 1536, colorType 6, samme chunk-struktur |

### 4.3 Sammenligning med det ældere asset

| Asset | fracTop | fracBot | H | W | H / 396 |
|---|---:|---:|---:|---:|---:|
| `tshirt.png` (gammel, før Fase 1) | 0.1816 | 0.6549 | 727 | 760 | 1.84× |
| **`tshirtwoman.png` (ny, efter Fase 1)** | **0.1751** | **0.6934** | **796** | **792** | **2.01×** |

> **Regenerering har ikke ændret mønstret.** Begge assets ligger i samme
> fejlregion: top 0.175–0.182 (for højt) og bund 0.655–0.693 (for lavt).
> AI'en producerer stabilt det samme fejlende resultat.

---

## 5. Fase 1 rendering — matematisk test

```
A + 1 × (L − A) = L        for ethvert A og ethvert L
```

**Verifikation:** `transform-origin` er `(anchor.x, anchor.y) = (0.5, 0.27)`.
Ved `scale(1)` er identiteten trivielt sand for alle L. `translate(0, 0)` er
identitet. Laget har **null** geometrisk effekt.

| | Før (S = 0.56) | Efter (S = 1) |
|---|---|---|
| Asset top 0.1751 | 0.27 + 0.56(0.1751 − 0.27) = **0.2205** | **0.1751** (rå) |
| Asset bund 0.6934 | 0.27 + 0.56(0.6934 − 0.27) = **0.5113** | **0.6934** (rå) |

### 5.1 Det centrale spørgsmål

> *Hvis `tshirtwoman.png` allerede er genereret korrekt på samme 1024×1536
> coordinate system som `woman.png`, vil det nu blive placeret korrekt?*

> ## **YES**
>
> Bevis: `A + 1(L − A) = L`. Ved S = 1 udøver hverken `transform-origin` nor
> `translate` nogen geometrisk effekt. Laget placeres **præcis 1:1** i
> masterens coordinate system.

**Men:** forudsætningen er **ikke opfyldt**. Assetet er *ikke* genereret
korrekt. Fase 1 har gjort compositing troværdig; den kan ikke reparere et
asset, der selv er fejlplaceret.

---

## 6. Anchor-analyse

| Egenskab | Værdi |
|---|---|
| T-shirt anchor | `torso` |
| Normaliseret | `0.5 × 0.27` |
| Pixel på master | (512, 415) |
| Anatomi på master | **chest** — bredde 307 px |
| Vurdering som referencepunkt | ✅ Anatomisk gyldigt |
| Vurdering som facit | ❌ Definerer **ikke** T-shirtens top/bund/bredde |

**Ved S = 1 har anchoren nul geometrisk virkning.** Den er bevaret som
dokumenteret anat reference. **Masterens geometri bestemmer forventningen
(§3) — ikke anchoren.**

---

## 7. Konklusioner A–E

### A. Producerer AI'en et T-shirt asset, der følger Woman-masterens coordinate system?

> ## **NO**
>
> Canvas og centerX er korrekte, men vertical placering og størrelse er ikke:
> top 42 px for højt, bund 358 px for lavt, højde 2.01× forventet.

### B. Hvor opstår den første konkrete afvigelse?

> **I assetet selv, i AI-generationen** — ikke i compositing, anchor, scale
> eller rendering.
>
> Kæden: MASTER ✅ → ANCHOR ✅ → **ASSET CANVAS-POSITION ❌** → SCALE ✅ (nu 1)
> → TRANSFORM-ORIGIN ✅ (uden virkning) → TRANSLATION ✅ → RENDERING ✅

### C. Hvilken afvigelse er primær?

> **Kombination af to:**
> 1. **Størrelse** — 2.01× for høj (H 796 mod 396), 1.83× for bred
> 2. **Vertical placering** — top −42 px, bund +358 px
>
> **Horizontal placering er korrekt** (+6.5 px = 0.6 %).
> **Formen er korrekt** (100 % sammenhængende, genkendelig T-shirt).

### D. Kan det løses med prompten alene?

> ## **UNKNOWN**
>
> **Pro:** prompten burde kunne specificere det. Den siger allerede
> *"exactly the same canvas, framing, and pixel coordinate system as image 1"*
> (linje 112) og angiver per-kategori kropsregioner (linje 79, 108).
> **Imod:** prompten har været uændret siden `3193b8a`, og to uafhængige
> generationer (`tshirt.png`, `tshirtwoman.png`) gav **samme fejlregion**.
> Det peger på, at modellen ikke efterkommer kravet.
>
> Kan **kun** afgøres empirisk.
> **Bemærk:** uanset udfald er assetet ~2× for stort, så selv korrekt
> promptformulering løser højst skaleringen.

### E. Ændrer compositing stadig et korrekt asset?

> ## **NO**
>
> Beviset er matematisk: `A + 1(L − A) = L` for alle A og L.
> `transform-origin` og `translate` er begge identiteter ved S = 1.
> **Fase 1 har fuldstændig fjernet compositingens geometriske bidrag.**
> Ethvert afvigende asset i DRESSED skyldes 100 % assetet.

---

## 8. CONFIRMED

| # | Udsagn | Bevis |
|---|---|---|
| P1 | Asset er 1024 × 1536, colorType 6, samme chunk-struktur som master | header-måling |
| P2 | Solid bbox (alpha ≥ 128): x[116,907] y[269,1064], W 792, H 796 | målt |
| P3 | Alpha-haze er reel: +9.8 % bredde, +33.3 % højde | alpha≥1 vs alpha≥128 |
| P4 | Formen er korrekt: 1 segment, 100 % densitet, kortærmet T-shirt | silhouette + segmenter |
| P5 | Asset-centerX 511.5 mod master 505.0 = +6.5 px (0.6 %) | målt |
| P6 | fracTop 0.1751 mod forventet 0.2025 = **−42 px for høj** | målt |
| P7 | fracBot 0.6934 mod forventet 0.4603 = **+358 px for lav** | målt |
| P8 | Højde 796 mod 396 = **2.01×** | målt |
| P9 | Bredde 792 mod 433 (body) = 1.83×; mod 421 (arm) ærme-span 779 = 1.85× | målt |
| P10 | Ved S = 1 har `transform-origin` og `translate` nul geometrisk effekt | `A + 1(L−A) = L` |
| P11 | Anchor `torso = 0.27` peger på masterens chest (415 px, 307 px bred) | målt |
| P12 | To uafhængige generationer gav samme fejlregion | `tshirt.png` vs `tshirtwoman.png` |

---

## 9. OBSERVED

| # | Observation | Bemærk |
|---|---|---|
| O1 | AI'en holder canvas- og centerX-korrekthed stabilt | 512 mod forventet 505 |
| O2 | AI'en overskrider konsekvent den krævede 1:1-alignment | H 1.84× og 2.01× |
| O3 | AI'en lægger toppen ~0.02 for højt stabilt | 0.1816 / 0.1751 |
| O4 | AI'en lægger bunden ~0.20–0.23 for lavt stabilt | 0.6549 / 0.6934 |
| O5 | Regenerering gav ikke bedre resultat | §4.3 |
| O6 | AI'en bruger kanalfristen korrekt (100 % dækket) | silhouette-profil |

---

## 10. UNKNOWN

| # | Spørgsmål | Hvorfor ukendt |
|---|---|---|
| X1 | Om en skarpere prompt kan få AI'en til at overholde 1:1 | Kræver promptforsøg |
| X2 | Om fejlen er modellens (gpt-image-2.5-sunburst) begrænsning | Kræver A/B-test af prompt |
| X3 | Om andre kategorier (jacket, skirt, joggers) opfører sig identisk | Kræver flere tests |
| X4 | Om Man-generation har samme fejl | Ingen mandlige assets |
| X5 | Om det er kilderelateret (dvs. afhænger af input-fotoet) | Ét testasset med ukendt kilde |
| X6 | Om det visuelle resultat i DRESSED matcher målingen | Ikke observeret i browser |
| X7 | Stabilitet over flere regenerationer | To samples kun |

---

## 11. NEXT STEP

| # | Anbefaling | Formål |
|---|---|---|
| T1 | **Ingen kodeændring før videre målinger** | Undgå at "fikse" det forkerte |
| T2 | Gentag testen med 2–3 yderligere T-shirts | X7 — er 2.0× stabil? |
| T3 | Test de øvrige kategorier (jacket, skirt, joggers) | X3 — er fejlen generel? |
| T4 | Skaf **ét mandligt asset** | X4 |
| T5 | Overvej om AI-output bør valideres/normaliseres efter generering | Nuværende kode validerer kun format (1024×1530, alpha), **ikke** placering |
| T6 | Hvis X1 er afklaret negativt: overvej deterministisk asset-normalisering | Alternativ til prompt |

---

## 12. Ændringsliste for denne test

| Type | Fil | Handling |
|---|---|---|
| Asset | `src/assets/system-reference/clothes/tshirtwoman.png` | Leveret af bruger (testinput) |
| Dokument | `analysis/Phase2-Woman-Tshirt-Test.md` | Oprettet (denne fil) |
| Analyse-script | `%TEMP%\p2test.js` | Midlertidigt, uden for projektet |

**Ingen produktionskode, prompts, CSS, anchors, placement, masterformer,
database, migrations eller eksisterende assets blev ændret.**
