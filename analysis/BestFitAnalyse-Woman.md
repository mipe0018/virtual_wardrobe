# Best Fit — WOMAN clothing-fit analyse

> **READ-ONLY dokumentation.** Intet i dette dokument er implementeret.
> Den eksisterende funktionalitet for WOMAN er låst og urørt.
> Overordnet analyse: `BestFitAnalyse.md`. Modstykke: `BestFitAnalyse-Man.md`.

---

## 1. Scope og metode

Analysen dækker hele WOMAN clothing-fit-kæden fra canonical master form til
endelig browser-compositing.

| Element | Metode |
|---|---|
| Master form | `pngjs` (colorType 2, RGB). Silhuet = luminance < 178 |
| Clothing assets | Manuel zlib-dekoder (colorType 6, RGBA). `pngjs` kan ikke læse dem |
| Asset-bounds | Solid = alpha >= 128. Alpha >= 1 bruges kun til at vise haze |
| Analyse-scripts | `%TEMP%`, uden for projektet |

**Vigtig skelnen:**

- `alpha >= 1` = inkluderer **alpha haze** (næsten usynlig dæmpning fra
  encoderen). Må ALDRIG fortolkes som garment.
- `alpha >= 128` = det faktiske **garment**.

Forskellen er stor: t-shirtens `alpha>=1`-bbox er 879×852, mens dens
`alpha>=128`-bbox er 760×727. Haze ville overdrive bredden med 16 %.

---

## 2. Canonical master form — `woman.png`

### 2.1 Filformat

| Egenskab | Værdi |
|---|---|
| Dimensioner | 1024 × 1536 |
| Bit depth | 8 |
| Color type | **2 (RGB — ingen alpha-kanal)** |
| Interlace | 0 (nej) |
| Chunks | `IHDR`, `caBX`, `IDAT`, `IEND` |
| Gennemsigtighed | **Ingen.** Fuldstændig uopaque |

> `caBX` er en C2PA-provenance-chunk (OpenAI Content Authenticity). Den findes
> i **alle** assets, også masterformerne. Den er ikke en billedkanal.

### 2.2 Kroppens afgrænsning

| Måling | Værdi | Frac af canvas |
|---|---:|---:|
| bbox x | 289 – 721 | 0.2822 – 0.7041 |
| bbox y | 32 – 1474 | 0.0208 – 0.9596 |
| bredde | 433 px | 0.4229 |
| højde | 1443 px | 0.9395 |
| **centerX** | **505.0** | **0.4932** |

**centerX = 505.0, ikke 512.** Kroppen ligger 7 px venstre for canvascentrum.
Det har konsekvenser for horizontal alignment (se afsnit 8).

### 2.3 Anatamiske landmarks

| Landmark | frac | bredde (px) | left | right |
|---|---:|---:|---:|---:|
| head top | 0.0208 | 20 | 495 | 514 |
| head | 0.0800 | 182 | 416 | 597 |
| face | 0.1400 | 216 | 397 | 612 |
| neck | 0.1850 | 209 | 402 | 610 |
| **skulderlinje** | **0.2025** | 217 | 399 | 615 |
| chest | 0.2700 | 307 | 353 | 659 |
| waist | 0.4200 | 378 | 317 | 694 |
| hip | 0.4600 | 396 | 308 | 703 |
| håndhøjde | 0.5000 | 421 | 295 | 715 |
| knee | 0.7200 | 176 | 418 | 593 |
| ankle | 0.9100 | 102 | 455 | 556 |
| foot | 0.9500 | 123 | 444 | 566 |

**Skulderlinje-metode:** største positive sprang i råbredde mellem 0.14 og 0.32.
Fundet ved y=311 (frac 0.2025), delta 12 px. Råprofilen bekræfter:
169 (y=300) → 205 (y=310) → 264 (y=320) → 292 (y=340).

**Bemærk:** skulderbredden ved selve skulderlinjen (217 px) er **ikke**
skulderbredden. Det er overgangen fra hals til skulder. Den faktiske
skulder-/brystbredde er **315 px @ frac 0.2956**.

### 2.4 Horizontal reference

| Højde | y | yderste kant |
|---|---:|---|
| håndhøjde 0.50 | 768 | 295 … 715 (bredde 421) |
| centerX | — | 505.0 |

Anchor-værdierne `left-hand x=0.33 → 338` og `right-hand x=0.67 → 686` ligger
**inde i kroppen** (295…715), ikke på håndenderne.

---

## 3. Clothing generation

```
Originalt clothing-billede
  ↓
POST /api/ai/process-clothing        (cache-hit hvis allerede AI-ready)
  ↓
process-clothing-background          (Netlify background function)
  ↓
runClothingJob()                     (clothing-job.ts)
  ↓
editImage({
  images: [characterDataUrl, sourceDataUrl],   ← img1 master, img2 tøj
  size: "1024x1536",
  background: "transparent",
  prompt: clothing-job.ts:77-115                ← 37 strenge, byte-identisk siden 3193b8a
})
  ↓
Model: gpt-image-2.5-sunburst
```

**Bemærk:** `characterDataUrl` er ALTID `woman.png` for base_type `woman`. Der
er ingen fallback til en anden master form.

**Promptens rollefordeling (bekræftet i prompt-teksten):**

- Master form (img 1) = geometri, canvas, placering
- Original (img 2) = **"the sole visual source for the design"**
- Linje 507: *"Treat image 2 as a design reference sheet, not a size reference"*

---

## 4. Asset-pipeline efter generering

```
170  generér ny path  ${userId}/clothing/${characterId}/${uuid}.png
172  upload ny fil            ← efter alle valideringer
118-153 validering: 1024×1536 PNG, alpha 0 i hjørner, transparent+visibel
185  DB-upsert → ny reference_path
199  aiAssetPersisted = true
200  remove(gammel fil)      ← FØRST HER
```

Gemt i `wardrobe_item_ai_assets` med PK `(user_id, item_id, base_type)`,
`base_type='woman'`, `generation_version=3`.

---

## 5. Factiske clothing assets (female)

Alle fire er `1024×1536`, `colorType=6` (RGBA), chunks `IHDR,caBX,IDAT,IEND`.

### 5.1 Alpha-haze vs. solid

| Asset | alpha>=1 bbox | alpha>=128 bbox | Haze-overvurdering |
|---|---|---|---:|
| T-shirt | 879 × 852 | 760 × 727 | +15.7 % / +17.2 % |
| Jacket | 943 × 1411 | 936 × 1040 | +0.7 % / +35.7 % |
| Skirt | 968 × 1427 | 606 × 526 | +59.7 % / +171 % |
| Joggers | 821 × 1298 | 445 × 1292 | +84.5 % / +0.5 % |

**Skirtens alpha>=1-bbox er 968 px bred mod 606 px solid.** Et mål baseret på
alpha>=1 ville konkludere, at skirten er næsten dobbelt så bred som den er.

### 5.2 Solid-målinger (alpha >= 128)

| Asset | solid bbox | W | H | centerX | centerY | Margener T/B/L/R |
|---|---|---:|---:|---:|---:|---|
| T-shirt | x[132,891] y[279,1005] | 760 (74.2 %) | 727 (47.3 %) | 511.5 | 642.0 | 279/530/132/132 |
| Jacket | x[44,979] y[208,1247] | 936 (91.4 %) | 1040 (67.7 %) | 511.5 | 727.5 | 208/288/44/44 |
| Skirt | x[209,814] y[487,1012] | 606 (59.2 %) | 526 (34.2 %) | 511.5 | 749.5 | 487/523/209/209 |
| Joggers | x[292,736] y[165,1456] | 445 (43.5 %) | 1292 (84.1 %) | 514.0 | 810.5 | 165/79/292/287 |

### 5.3 Normaliseret placering

| Asset | fracTop | fracBot | W frac | H frac |
|---|---:|---:|---:|---:|
| T-shirt | 0.1816 | 0.6549 | 0.7422 | 0.4733 |
| Jacket | 0.1354 | 0.8125 | 0.9141 | 0.6771 |
| Skirt | 0.3171 | 0.6595 | 0.5918 | 0.3424 |
| Joggers | 0.1074 | 0.9486 | 0.4346 | 0.8411 |

### 5.4 Silhuetprofil (span ved alpha>=128)

```
        f0.1  f0.2  f0.3  f0.4  f0.5  f0.6  f0.7  f0.8  f0.9
T-shirt    0   314   658   549   375   423     0     0     0
Jacket     0   528   712   746   776   844   882   935     0
Skirt      0     0     0   419   526   592     0     0     0
Joggers    0   413   445   434   422   424   419   406   347
```

**Identifikation:**

- **T-shirt:** ét sammenhængende segment, top 0.18, bund 0.65. Kortærmet
  (bredden falder fra 658 @ 0.3 til 375 @ 0.5).
- **Jacket:** krave @ 0.14, **to løsrevne ærmer** @ 0.2–0.3, krop + ærme @ 0.4,
  kun ærmer @ 0.7–0.8 (de spreder sig yderligere: 882 → 935).
- **Skirt:** ét segment hele vejen, **monotont udvidende** 419 → 592. A-linje.
- **Joggers:** ét segment @ 0.2–0.3, **to ben-segmenter fra 0.35**.

### 5.5 Densitet vs. span (hvor meget er fuldt dækket)

```
        f0.2  f0.3  f0.4  f0.5  f0.6
T-shirt   314  658   507   375   423     (100 %, 100 %, 92 %, 100 %, 100 %)
Jacket    323  650   746   690   598     (61 %, 91 %, 100 %, 89 %, 71 %)
Skirt       -    -   419   526   592     (100 % hele vejen)
Joggers   413  445   413   391   390     (100 %, 100 %, 95 %, 93 %, 92 %)
```

T-shirt og Skirt er **fuldt dækkede**. Jacket har lavere densitet, fordi ærmerne
er adskilte fra kroppen. Joggers er næsten dækket (lille ben-gap).

---

## 6. Scale — `0.56`

### 6.1 Oprindelse

| Commit | Besked | Værdi |
|---|---|---|
| `1e70ee4` | Agent turn 12 | 0.60 |
| `8c1df35` | Agent turn 13 | 0.55 |
| `d973d1b` | **"working solution with size"** | **0.56** |
| `d0dc64d` … `c8051fb` | 8 commits | 0.56 (uændret) |

**Ingen dokumenteret matematisk afledning** findes nogensteds i repoet.

### 6.2 Anvendelse

`src/styles/wardrobe.css:648-652`:

```css
--clothing-base-scale: var(--dressed-clothing-scale, 0.56);
transform-origin: calc(var(--anchor-x, 0.5) * 100%) calc(var(--anchor-y, 0.2) * 100%);
transform:
  translate(var(--clothing-x, 0%), var(--clothing-y, 0%))
  scale(calc(var(--clothing-base-scale) * var(--clothing-scale, 1)));
```

`src/styles/profile.css:616` har samme værdi **hardkodet**.

**Værdiopløsning:**

| Variabel | Værdi | Kilde |
|---|---|---|
| `--dressed-clothing-scale` | **aldrig sat** | → fallback 0.56 |
| `--clothing-base-scale` | 0.56 | beregnet |
| `--clothing-scale` | 1 | `placement.scale` (NEUTRAL for alle 21 kategorier) |
| `--clothing-x` / `--clothing-y` | 0 % | `placement.x/y` (NEUTRAL) |

**`effective scale = 0.56 × 1 = 0.56`** for alle kategorier.

---

## 7. Anchor-semantik

`dressedAnchor(anchor, baseType)` i `clothing-categories.ts` returnerer
`DRESSED_ANCHORS[anchor]` for `woman`. `MAN_ANCHOR_Y` påvirker **ikke** woman.

### 7.1 Alle eksisterende anchors

| Anchor | x | y | Forventet anatomisk reference | Vurdering |
|---|---:|---:|---|---|
| head | 0.5 | 0.10 | Isse midt (head top 0.0208, 182 px @ 0.08) | OK |
| face | 0.5 | 0.14 | Øjne/ansigt (216 px @ 0.14) | OK |
| ears | 0.5 | 0.14 | Ører samme højde som face | OK |
| neck | 0.5 | 0.185 | Nakke (209 px @ 0.185) | **Præcis** |
| shoulders | 0.5 | 0.22 | Skulderlinje (0.2025) | 0.018 under linjen — OK |
| torso | 0.5 | 0.27 | Bryst (307 px @ 0.27) | **Præcis** |
| waist | 0.5 | 0.42 | Talje (378 px @ 0.42) | **Præcis** |
| hips | 0.5 | 0.46 | Hofte (396 px @ 0.46) | **Præcis** |
| dress | 0.5 | 0.20 | Nakline/skulder | 0.0025 over skulderlinjen — OK |
| left-hand | 0.33 | 0.50 | Venstre hånd | 338 px; kroppen er 295…715 → **inde i kroppen** |
| right-hand | 0.67 | 0.50 | Højre hånd | 686 px; samme forhold |
| knees | 0.5 | 0.72 | Knæ (176 px @ 0.72) | **Præcis** |
| ankles | 0.5 | 0.91 | Ankler (102 px @ 0.91) | **Præcis** |
| feet | 0.5 | 0.95 | Fødder (123 px @ 0.95) | **Præcis** |
| full-body | 0.5 | 0.50 | Hele figuren | OK |

**Konklusion:** 12 af 14 anchors er præcise mod målte landmarks.
`left-hand` og `right-hand` er de eneste, der ikke peger på det anatomiske punkt.

### 7.2 Kategori → anchor

| Kategori | Anchor | y | Bemærk |
|---|---|---:|---|
| tops, shirts, sweaters | torso | 0.27 | Præcis til bryst |
| jackets | shoulders | 0.22 | Præcis til skulder |
| dresses | dress | 0.20 | Præcis til nakline |
| skirts, shorts | hips | 0.46 | Præcis til hofte |
| pants | waist | 0.42 | Præcis til talje |
| socks | ankles | 0.91 | Præcis |
| shoes | feet | 0.95 | Præcis |
| bags | right-hand | 0.50 | Anchor x peger ikke på hånden |
| jewelry, necklaces | neck | 0.185 | Præcis |
| earrings | ears | 0.14 | Præcis |
| bracelets, watches | left-hand | 0.50 | Anchor x peger ikke på hånden |
| glasses, sunglasses | face | 0.14 | Præcis |
| hats, hair-accessories | head | 0.10 | Præcis |
| accessories, other | full-body | 0.50 | OK |

---

## 8. Transform-orden og horizontal fit

### 8.1 Hvad browseren gør

1. Lag-elementet placeres i `.dressed-canvas` (aspect-ratio 2/3)
2. `object-fit: contain` → 1024×1536 billede fylder boksen 1:1
3. `transform-origin` sættes til `(anchor.x × 100 %, anchor.y × 100 %)`
4. `translate(clothing-x, clothing-y)` → **0/0, no-op**
5. `scale(0.56 × 1)` omkring transform-origin

**Rækkefølge:** CSS `transform`-funktioner anvendes højre-til-venstre, men da
`translate` er identisk 0, er rækkefølgen uden betydning.

**Ved scale omkring punkt P:** et punkt Q flyttes til `P + 0.56 × (Q − P)`.
Alle afstande fra P krympes til 56 %. Elementets **relative** placering ændres
ikke, men dets **placering i boksen** gør, fordi P er det punkt, der holdes fast.

### 8.2 Horizontal

| Måling | Værdi |
|---|---|
| Asset centerX (alle fire) | 511.5 – 514.0 |
| Master centerX (woman) | **505.0** |
| **Forskel** | **+6.5 til +9.0 px (højre)** |
| Anchor x | 0.5 → 512.0 |
| Renderet centerX | 511.5 – 514.0 (uændret af scale om x=512) |

**Alle assets er centreret på canvas (512), mens kroppen er centreret på 505.**
Resultatet er et permanent **~7 px højre-forskyldt** lag i forhold til kroppen.
På en 493 px bred display svarer det til ca. 3.4 CSS-pixel.

| Spørgsmål | Svar |
|---|---|
| Konsistent offset? | **Ja** — alle fire: +6.5 til +9.0 px |
| Category-specifik? | Nej |
| Asset-specifik? | Nej (kun centerX 514.0 for joggers) |
| Reelt problem? | **Nej, ubetydeligt** |

**Klassificering: B (asset normalization).** AI'en centrerer garmentet på
canvas, ikke på kroppens centerX.

---

## 9. Vertikal fit pr. asset

Formel: `y_renderet = A + 0.56 × (y_asset − A)`

| Asset | Anchor (A) | Asset top→bot | Renderet top→bot | Forventet start | Forventet slut | Δ top | Δ bot |
|---|---|---|---|---|---|---:|---:|
| T-shirt | torso 0.27 | 0.1816→0.6549 | 0.2205→0.4856 | 0.2025 | 0.46 | +0.018 | +0.026 |
| Jacket | shoulders 0.22 | 0.1354→0.8125 | 0.1726→0.5518 | 0.2025 | 0.46 | −0.030 | +0.092 |
| Skirt | hips 0.46 | 0.3171→0.6595 | 0.3800→0.5717 | 0.42 | 0.72 | −0.040 | −0.148 |
| **Joggers** | waist 0.42 | 0.1074→0.9486 | **0.2450→0.7160** | **0.42** | **0.91** | **−0.175** | **−0.194** |

T-shirt og Jacket er inden for rimelig tolerance. Skirtet sidder 0.04 over
taljen (~60 px) — tydelig men lille afvigelse.

**Joggers er klart fejlplaceret:** bryst → knæ i stedet for talje → ankel.

### 9.1 Bevis: ingen uniform scale kan rette joggers

```
top:  0.42 + s × (0.1074 − 0.42) = 0.42  →  s = 0
bund: 0.42 + s × (0.9486 − 0.42) = 0.91  →  s = 0.926
```

Modstridende. Assetet **kan ikke** repareres i compositing-laget.

---

## 10. Horisontal sizing pr. category

Sammenligningen bruger **den mest relevante kropsregion pr. kategori**.

### 10.1 T-shirt (kortærmet, anchor torso 0.27)

| Måling | Værdi |
|---|---|
| Asset brystbredde (span @ f0.3) | **658 px** (100 % dækket) |
| Master bryst (0.27) | 307 px |
| Master skulder max (0.2956) | 315 px |
| Master arm-span (0.50) | 421 px |
| F_asset mod bryst | 658/307 = **2.14** |
| F_asset mod skulderzone | 658/315 = **2.09** |
| F_asset mod arm-span | 658/421 = **1.56** |
| **F_eff mod arm-span** | 1.56 × 0.56 = **0.87** |
| Renderet bredde | 760 × 0.56 = **426 px** |

658 px inkluderer de korte ærme. Mod arm-span er F_eff **0.87**.

### 10.2 Jacket (langt, anchor shoulders 0.22)

| Måling | Værdi |
|---|---|
| Asset bryst+ærme (span @ f0.4) | 746 px |
| Asset max bredde (span @ f0.8) | 935 px (kun de spredte ærme) |
| Master arm-span (0.50) | 421 px |
| F_asset @ f0.5 | 776/421 = **1.84** |
| **F_eff @ f0.5** | 1.84 × 0.56 = **1.03** |
| Renderet bredde @ f0.5 | 776 × 0.56 = **434 px** |

### 10.3 Skirt (A-linje, anchor hips 0.46)

| Måling | Værdi |
|---|---|
| Asset hoftebredde (span @ f0.5) | **526 px** |
| Master hofte (0.46) | 396 px |
| Master arm-span (0.50) | 421 px |
| F_asset mod hofte | 526/396 = **1.33** |
| F_asset mod arm-span | 526/421 = **1.25** |
| **F_eff mod arm-span** | 1.25 × 0.56 = **0.70** |
| Renderet bredde @ f0.5 | 526 × 0.56 = **295 px** |

Skirt har ingen arme, så arm-span (421) er den relevante øvre reference.

### 10.4 Joggers (anchor waist 0.42)

| Måling | Værdi |
|---|---|
| Asset hoftebredde (span @ f0.3) | **445 px** |
| Master talje (0.42) | 378 px |
| F_asset mod talje | 445/378 = **1.18** |
| **F_eff mod talje** | 1.18 × 0.56 = **0.66** |
| Renderet bredde @ f0.3 | 445 × 0.56 = **249 px** |
| Master knæ (0.72) | 176 px — asset @ f0.7 = 419 px |
| F_asset mod knæ | 419/176 = 2.38 |
| F_eff mod knæ | 2.38 × 0.56 = 1.33 |

---

## 11. Root cause pr. problem

### 11.1 Problem A — Joggers vertikal extent

| | Vurdering |
|---|---|
| Klassificering | **A (AI generation)** |
| Status | **CONFIRMED** |
| Bevis | Asset spanner 0.107→0.949 (hals→fødder) i stedet for 0.42→0.91. Ingen uniform scale kan løse det (s=0 vs s=0.926). |
| Fejldiagnostic | Ja |

### 11.2 Problem B — Skirt/T-shirt for små mod 0.56

| | Vurdering |
|---|---|
| Klassificering | **A (AI generation), sekundært H** |
| Status | **LIKELY** |
| Bevis | F_asset varierer fra **1.18 (joggers) til 1.84 (jacket)**. `0.56` er tunet til jacket'ens 1.84. T-shirt (1.56) og skirt (1.25) bliver 0.87 og 0.70. |
| Forbehold | Delvist ubekræftet, fordi torso-bredde ikke kan isoleres fra arme (se 12.1) |

### 11.3 Problem C — 7 px horizontal offset

| | Vurdering |
|---|---|
| Klassificering | **B (asset normalization)** |
| Status | **CONFIRMED** (målt) |
| Vurdering | Ubetydeligt — ca. 3.4 CSS-pixel |

### 11.4 Problem D — hand-anchors peger ikke på hænder

| | Vurdering |
|---|---|
| Klassificering | **C (anchor)** |
| Status | **CONFIRMED** |
| Bevis | `left-hand x=0.33 → 338 px`; kroppen er 295…715. 338 px er 43 px inde fra venstre kant. |
| Vurdering | Kun relevant for bags, bracelets, watches — ingen sådanne assets er målt |

### 11.5 Ikke et problem

| Observation | Status |
|---|---|
| 12 af 14 anchors præcise mod landmarks | CONFIRMED — ingen ændring anbefalet |
| Vertikal placering for T-shirt/Jacket | CONFIRMED OK |
| Canvas 1024×1536 for alle assets | CONFIRMED — ingen forvrøng |
| Uniform scale (intet stretching) | CONFIRMED — kun én `scale()` |

---

## 12. Metodiske forbehold

### 12.1 Masterformerne er linjetegninger

Segmentanalyse (`luminance < 178`) viser, at kroppen består af **streger og
konturer, ikke en fyldt silhuet**. Rækkerne fragmenterer i 4–8 små strokes:

```
woman  y≈645: segmenter = [85, 17, 19, 86]
woman  y≈768: segmenter = [39, 20, 58, 22, 37]
```

**Konsekvens:** torso-bredde kan ikke isoleres maskinelt fra arme. Alle
silhuet-bredder i dette dokument er derfor **øvre grænser** (inkl. arme).

Det betyder, at F_eff-tallene for T-shirt, Skirt og Joggers er
**sandsynligvis for lave** — den reelle torso er smallere end arm-span.

### 12.2 Hvad der skal måles for at løse det

Der kræves et **fyldt kropssilhuet-reference-artifact pr. base type** (ikke en
ændring af de låste `woman.png` / `man.png`). Dette er en anbefaling, ikke en
implementeret ændring.

---

## 13. Unknown

| Spørgsmål | Status |
|---|---|
| Reel torso-bredde uden arme | **Unknown** — kræver fyldt reference |
| Om `0.56` er korrekt for jacket'en | **Unknown** — kun 4 assets, kun én reference-point |
| Om 0.87 (t-shirt) er acceptabelt | **Unknown** — kræver visuel bedømmelse |
| Adfærd for bags, necklaces, hats, glasses | **Unknown** — ingen assets |
| Stabilitet på tværs af regenereringer | **Unknown** — kun ét sample pr. kategori |
| Skirtens 0.04 forhøjede top | **Likely** mindre fejl; ikke verificeret visuelt |

---

## 14. Anbefalinger — ingen implementeret

| # | Anbefaling | Status |
|---|---|---|
| W1 | **Regenerer joggers** | CONFIRMED nødvendigt — vertikal extent kan ikke repareres i CSS |
| W2 | **Undgå at ændre `0.56` nu** | Mangler reference til at validere |
| W3 | **Lav fyldt silhouette-reference** | Forudsætning for at aflede korrekt scale |
| W4 | **Behold alle eksisterende anchors** | 12 af 14 er præcise |
| W5 | **Overvej hand-anchor x** | Kun hvis bags/watches skal testes |
| W6 | **Mål flere samples pr. kategori** | En enkelt observation kan være tilfældig |

---

## 15. Change log

- `BestFitAnalyse-Woman.md` oprettet som READ-ONLY analyse.
- **Ingen produktionskode, CSS, prompts, anchors, scale, assets, database
  eller migrations ændret.**
