# Clothing Placement — FASE 1 Implementation Analysis

> **READ-ONLY dokumentation af en konkret implementering.**
> Analyse af den faktiske kodeændring — ikke et nyt design.
> Relateret: `BestFitAnalyse.md` (root-cause), `BestFitAnalyse-Woman.md`,
> `BestFitAnalyse-Man.md`.

---

## 1. Hvad blev ændret

### 1.1 Produktionskode — præcis to linjer

| Fil | Linje | Før | Efter |
|---|---:|---|---|
| `src/styles/wardrobe.css` | 648 | `--clothing-base-scale: var(--dressed-clothing-scale, 0.56);` | `--clothing-base-scale: var(--dressed-clothing-scale, 1);` |
| `src/styles/profile.css` | 616 | `--clothing-base-scale: 0.56;` | `--clothing-base-scale: 1;` |

**Ingen andre produktionsfiler blev ændret.**

### 1.2 Bevarede kodelinjer (urørt)

| Bevaret | Placering |
|---|---|
| Alle 14 anchors | `clothing-categories.ts` `DRESSED_ANCHORS` |
| `dressedAnchor()` | `clothing-categories.ts:135-141` |
| `MAN_ANCHOR_Y` | `clothing-categories.ts:122-129` |
| `placement.scale` (NEUTRAL = 1) | `clothing-categories.ts:152` |
| `placement.x/y` (NEUTRAL = 0) | `clothing-categories.ts:152` |
| `transform-origin`-reglen | `wardrobe.css:649`, `profile.css:617` |
| `translate()`-laget | `wardrobe.css:651`, `profile.css:619` |
| `scale(calc(base × category))` | `wardrobe.css:652`, `profile.css:620` |
| z-index / lag-rækkefølge | `wardrobe.astro:221`, `profile-outfits.ts:33` |
| Container + `object-fit` | `wardrobe.css:608-626`, `profile.css:611-620` |
| Hele AI-pipeline | `clothing-job.ts`, `process-clothing.ts` |
| Prompt (37 strenge) | `clothing-job.ts:77-115` — byte-identisk, urørt |
| Masterformer | `woman.png`, `man.png` — urørt |
| Storage, quota, versionering, background jobs | urørt |
| `CURRENT_CLOTHING_ASSET_VERSION = 3` | urørt |

---

## 2. Før/efter for scale

| Værdi | Før | Efter |
|---|---:|---:|
| `--dressed-clothing-scale` | aldrig sat → fallback | aldrig sat → fallback |
| `--clothing-base-scale` (`wardrobe.css`) | `var(--dressed-clothing-scale, 0.56)` | `var(--dressed-clothing-scale, 1)` |
| `--clothing-base-scale` (`profile.css`) | `0.56` (hardkodet) | `1` (hardkodet) |
| `--clothing-scale` (category) | 1 | 1 |
| **Effektiv scale** | **0.56** | **1.0** |

**Bekræftet:** `--dressed-clothing-scale` forekommer i hele `src/` kun ét sted —
`wardrobe.css:648` som `var()`-fallback-reference. Det sættes aldrig nogen steder.
Fallback-værdien `1` er derfor altid aktiv.

**Bekræftet:** `placement.scale` er `1` for alle 21 kategorier
(`clothing-categories.ts:152`, `NEUTRAL = { scale: 1, x: 0, y: 0 }`).

**Bekræftet:** `placement.x` og `placement.y` er `0` for alle 21 kategorier.
De sættes stadig som `--clothing-x: 0%` / `--clothing-y: 0%`
(`wardrobe.astro:228-229`, `profile-outfits.ts:39-40`).

---

## 3. Den faktiske transform-kæde efter ændringen

```css
transform-origin: calc(var(--anchor-x, 0.5) * 100%) calc(var(--anchor-y, 0.2) * 100%);
transform:
  translate(var(--clothing-x, 0%), var(--clothing-y, 0%))
  scale(calc(var(--clothing-base-scale) * var(--clothing-scale, 1)));
```

Opløst:

```
translate(0%, 0%)                    → identitet
scale(calc(1 × 1))                   → scale(1)
transform-origin                     → (anchor.x, anchor.y)
```

Ved `scale(1)` omkring punkt `A` flyttes `L` til:

```
A + 1 × (L − A) = L        for ethvert A og ethvert L
```

### 3.1 Følger for transform-origin

> **CONFIRMED (matematisk):** `transform-origin` har **ingen geometrisk
> virkning** ved scale 1. Identiteten `A + 1(L−A) = L` holder for alle værdier af
> A. Der opstår ingen utilsigtet forskydning.

Anchors er derfor nu **informativ reference** (dokumenterer hvor tøjet hænger
anatomisk) og ikke længere en funktionel forudsætning for placering.

### 3.2 Følger for translate-laget

> **CONFIRMED:** `translate(0%, 0%)` er en identitetstransformation.
> Laget er funktionelt et no-op, men er bevaret som et eksisterende
> placement-lag (`wardrobe.css:645`: *"Category x/y offsets are applied on top"*).
> `placement.x/y` er bevaret uændret, så et fremtidigt per-category-justeringslag
> findes stadig uden ny arkitektur.

---

## 4. Masterformen er fortsat source of truth

| Egenskab | Status |
|---|---|
| Masterformer urørt | ✅ `woman.png` / `man.png` ikke ændret |
| Master 1024 × 1536 | ✅ bekræftet (colorType 2, RGB) |
| Master body bbox woman | ✅ x 289–721, y 32–1474, centerX 505.0 |
| Master body bbox man | ✅ x 282–726, y 32–1475, centerX 504.0 |
| Master skulderlinje | ✅ woman 0.2025 (311 px), man 0.1758 (270 px) |
| Assets må ikke definere mastergeometri | ✅ overholdt — ingen ændring |
| Anchors afledt af masteren | ✅ urørt, dokumenteret i `BestFitAnalyse.md` §10.2 |

Ingen clothing-måling har ændret eller foreslået ændringer ved masteren.

---

## 5. Clothing assets bruger fortsat 1024 × 1536

| Egenskab | Status |
|---|---|
| Asset-canvas | ✅ 1024 × 1536 (alle fire female assets, målt) |
| Aspect ratio | ✅ 2 : 3 — identisk med master |
| Prompt-krav | ✅ *"exactly the same canvas, framing, and pixel coordinate system as image 1"* (urørt) |
| Validering | ✅ 1024 × 1530 PNG (clothing-job.ts:118-121, urørt) |
| Compositing | ✅ `object-fit: contain` i 2:3-boks (urørt) |

**Konklusion:** Master og assets deler fortsat det samme
pixelkoordinatsystem. Det er den forudsætning, som FASE 1 gør troværdig.

---

## 6. Hvad ændringen betyder matematisk for et korrekt placeret asset

For et asset der allerede ligger korrekt i masterens coordinate system
(garmentets attachment = masterens landmark, uden skalering):

| | Før (S = 0.56) | Efter (S = 1) |
|---|---|---|
| Placement af attachment | `A + 0.56(L − A)` — **flyttet** | `A + 1(L − A) = L` — **præcis** |
| Længde | 56 % af masterens region | **100 %** |
| Horisontal center | 511.5–514.0 mod master 505.0 | uændret (7.0 px forskydning) |
| Aspect | bevaret (uniform scale) | bevaret (scale 1) |

> **CONFIRMED:** Før ændringen kunne et korrekt placeret asset **ikke** placeres
> korrekt. Efter ændringen kan det.

Dette var den strukturelle modsætning dokumenteret i `BestFitAnalyse.md` §10.8:
prompten kræver 1:1, CSS'en krævede 1.79×. **FASE 1 ophæver denne modsætning.**

---

## 7. Hvad ændringen betyder for de eksisterende Woman-assets

Følgende er **beregnet** ud fra de målte asset-bounds og transform-ligningen
(`y_renderet = A + S(y_asset − A)`) — det er **ikke** observeret i en browser.

| Asset | Anchor A | Asset rå top→bund | S=0.56 (før) | S=1 (efter) | Master-region | Efter vs. master |
|---|---:|---|---|---|---|---|
| T-shirt | 0.27 | 0.1816→0.6549 | 0.2205→0.4855 | **0.1816→0.6549** | 0.2025→0.4603 | top 32 px for høj, bund 299 px for lav |
| Jacket | 0.22 | 0.1354→0.8125 | 0.1726→0.5518 | **0.1354→0.8125** | 0.2025→0.4603 | top 103 px for høj, bund 541 px for lav |
| Skirt | 0.46 | 0.3171→0.6595 | 0.3800→0.5717 | **0.3171→0.6595** | 0.4199→0.7201 | top 158 px for høj, bund 93 px for kort |
| Joggers | 0.42 | 0.1074→0.9486 | 0.2449→0.7160 | **0.1074→0.9486** | 0.4199→0.9102 | top 480 px for høj, bund 59 px for lav |

> **OBSERVED (forudsagt):** Eksisterende assets vil flytte sig tydeligt, fordi de
> var genereret til at kompensere for 0.56. Alle fire vil stå i deres **rå**
> canvas-position, som for T-shirt, Jacket og Joggers er markant højere end
> masterens region.

Dette er forventet og ønsket: **det er den rene compositing-ændrings isolerede
virkning.**

---

## 8. CONFIRMED

| # | Udsagn | Bevis |
|---|---|---|
| F1 | Præcis to CSS-linjer ændret (0.56 → 1) | `wardrobe.css:648`, `profile.css:616` |
| F2 | Effektiv scale er nu 1 × 1 = 1 | `NEUTRAL.scale = 1` + fallback `1` |
| F3 | `transform-origin` har ingen geometrisk virkning | `A + 1(L−A) = L` |
| F4 | `placement.x/y` bevaret som separate lag | `NEUTRAL.x/y = 0`, urørt kode |
| F5 | Masterformer urørt og fortsat source of truth | ingen ændring + §4 |
| F6 | Assets bruger fortsat 1024 × 1536 | målt, urørt |
| F7 | Prompt uændret | `clothing-job.ts` urørt |
| F8 | Prompt/CSS-modsætningen (1:1 vs 1.79×) er ophævet | `BestFitAnalyse.md` §10.8 |
| F9 | Ét korrekt placeret asset kan nu placeres korrekt | matematisk |
| F10 | Ingen database/migration/storage/quota/job ændret | git status |
| F11 | 7.0 px horizontal forskydning er uændret | `object-fit: contain` urørt |

---

## 9. UNKNOWN

| # | Spørgsmål | Hvorfor ukendt |
|---|---|---|
| U1 | Om AI-genereringen producerer **korrekt placerede** assets | Kræver regeneration + måling af nyt asset |
| U2 | Om Woman-genereringen fungerer korrekt efter regeneration | Samme |
| U3 | Om Man-genereringen fungerer korrekt | `Unknown – insufficient male clothing asset data` |
| U4 | Om **alle** clothing categories fungerer | Kun 4 kategorier målt |
| U5 | Om `dress`, `shoes`, `socks`, `bags`, `necklaces` m.fl. placerer korrekt | Ingen assets for disse |
| U6 | Om eksisterende assets' **faktiske** visuelle resultat | Ikke observeret i browser i denne runde |
| U7 | Om 0.56 ville være korrekt for nogen kategori | Uændret spørgsmål, ikke testet |
| U8 | Stabilitet på tværs af regenereringer | Ét sample pr. kategori |
| U9 | Om man/master + man/asset passerer 1:1 | Mangler male assets |

**Ingen af disse er antaget, gættet eller erstattet med female-evidens.**

---

## 10. NEXT STEP

| # | Anbefaling | Formål |
|---|---|---|
| N1 | **Regenerer ét asset** (fx t-shirt) mod `woman.png` | Første empiriske test af U1/U2 |
| N2 | Mål det nye asset: fracTop/fracBot mod master 0.2025→0.4603 | Kvantitativ verifikation af 1:1 |
| N3 | Sammenlign `fracTop` med masterens skulderlinje 0.2025 | Afgør om AI'en overholder prompten |
| N4 | Gentag for `joggers` (den mest afvigende) | Test af vertikal extent |
| N5 | Skaf mindst ét **mandligt** asset | U3, U9 |
| N6 | Test de øvrige kategorier | U4, U5 |

**Fase 1 skal observeres alene før nogen Fase 2.** Ændringen er strukturel og
forventes at forbedre compositing; den løser ikke genereringsfejlen.
