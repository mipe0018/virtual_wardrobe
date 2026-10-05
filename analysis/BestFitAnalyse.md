# Best Fit — analyse af DRESSED clothing-systemet

> **Status:** READ-ONLY analyse-dokument.
> **Advarsel:** Dette dokument beskriver et igangværende problem. Ingen af de
> nævnte tal eller kodeændringer skal behandles som godkendt løsning.
> **Baseline:** al eksisterende funktionalitet er låst og må ikke ændres af dette
> dokument. Alt herunder er måling, sammenligning, dokumentation og
> anbefaling — intet er implementeret.
>
> **Dybdeanalyser:** `BestFitAnalyse-Woman.md` (female, fuld asset-analyse) og
> `BestFitAnalyse-Man.md` (male, dokumenterer datamangel).

---

## 1. Formål

DRESSED skal kunne tage et originalt clothing-billede og generere et
standardiseret clothing asset, som passer korrekt på den relevante canonical
master form.

**Master form bestemmer:** body geometry, canvas, position, proportions,
placement coordinate system.

**Original clothing reference bestemmer:** design, color, material, pattern,
construction, shape, length, sleeves, collar, pockets, logos/tekst og øvrige
visuelle detaljer.

---

## 2. Canonical master forms

| Fil | Canvas |
|---|---|
| `src/assets/system-reference/base-forms/woman.png` | 1024 x 1536 |
| `src/assets/system-reference/base-forms/man.png` | 1024 x 1536 |

Begge er PNG `colorType=2` (RGB) — ingen alpha-kanal, ingen gennemsigtighed.
Begge har chunks `IHDR, caBX, IDAT, IEND`, hvor `caBX` er en C2PA-provenance-chunk
(findes også i alle clothing assets — den er ikke en billedkanal).

### Verificerede målinger

| | Woman | Man |
|---|---:|---:|
| bbox x | 289 – 721 | 282 – 726 |
| bbox y | 32 – 1474 | 32 – 1475 |
| width | 433 px | 445 px |
| height | 1443 px | 1444 px |
| centerX | 505.0 | 504.0 |
| heightFrac | 0.9395 | 0.9401 |
| **skulderlinje** | **0.2025** | **0.1758** |

### Kropsbredder ved relevante højder (silhuet-span inkl. arme)

| Punkt | frac | woman | man | forhold |
|---|---:|---:|---:|---:|
| neck | 0.185 | 209 | 217 | 1.038 |
| skulderlinje | 0.2025 | 217 | 337 | 1.553 |
| dress | 0.20 | 188 | 329 | 1.750 |
| shoulders | 0.22 | 291 | 366 | 1.258 |
| torso | 0.27 | 307 | 381 | 1.241 |
| waist | 0.42 | 378 | 425 | 1.124 |
| hips | 0.46 | 396 | 432 | 1.091 |
| mid | 0.50 | 421 | 440 | 1.045 |
| knees | 0.72 | 176 | 189 | 1.074 |
| ankles | 0.91 | 102 | 105 | 1.029 |
| feet | 0.95 | 123 | 127 | 1.033 |

### Konklusion for masterformerne

- Den **vertikale koordinatakse er næsten identisk**: kun ca. 1 px forskel i
  height, centerX og y-extent.
- **Upper-body widths varierer betydeligt** (op til 1.75x ved dress-linjen),
  mens forskellen konvergerer mod 1.03 ved fødderne.
- Derfor **skal anchors være base-type-specifikke**, mens den vertikale
  skalingsakse kan være fælles.

> **Male clothing assets er endnu ikke tilgængelige. Male clothing fit er
> derfor IKKE verificeret.** Se `BestFitAnalyse-Man.md`.

---

## 3. Eksisterende female clothing assets

Fire assets ligger i `src/assets/system-reference/clothes/`. Alle er **female**;
de er verificeret female via segmentanalyse (silhuetter på 433 px krop passer
woman-formen, ikke man-formens 445 px).

Alle målinger bruger **solid alpha >= 128** (ignorerer anti-aliasing/haze).
Målemetode: manuel PNG-dekoder via zlib. `pngjs` kan ikke læse filerne, fordi de
indeholder en C2PA-provenance-chunk `caBX`.

### Oversigt

| Asset | Fil | Solid bbox | W | H | centerX | centerY |
|---|---|---|---:|---:|---:|---:|
| Jacket | `b46171d1-…png` | x[44,979] y[208,1247] | 936 | 1040 | 511.5 | 727.5 |
| T-shirt | `tshirt.png` | x[132,891] y[279,1005] | 760 | 727 | 511.5 | 642.0 |
| Skirt | `5d1e6df1-…png` | x[209,814] y[487,1012] | 606 | 526 | 511.5 | 749.5 |
| Joggers | `04d7f5be-…png` | x[292,736] y[165,1456] | 445 | 1292 | 514.0 | 810.5 |

### Normaliseret placering og F-værdier

| Asset | fracTop → fracBot | Margener T/B/L/R | Anchor | x0.56 W x H | Renderet top→bot |
|---|---|---|---|---|---|
| Jacket | 0.1354 → 0.8125 | 208/288/44/44 | shoulders 0.22 | 524x582 | 0.1726 → 0.5518 |
| T-shirt | 0.1816 → 0.6549 | 279/530/132/132 | torso 0.27 | 426x407 | 0.2205 → 0.4856 |
| Skirt | 0.3171 → 0.6595 | 487/523/209/209 | hips 0.46 | 339x295 | 0.3800 → 0.5717 |
| Joggers | 0.1074 → 0.9486 | 165/79/292/287 | waist 0.42 | 249x724 | 0.2450 → 0.7160 |

### F_asset og F_eff

`F_asset = garment-span / krops-silhuet-span i samme højde` · `F_eff = F_asset x 0.56`

| Asset | Målt @ | span | krop | F_asset | F_eff |
|---|---:|---:|---:|---:|---:|
| Jacket | 0.50 | 776 | 421 | 1.84 | **1.03** |
| Jacket | 0.42 | 749 | 378 | 1.98 | **1.11** |
| T-shirt (krop) | 0.42 | 398 | 378 | 1.05 | **0.59** |
| T-shirt (ærme) | 0.35 | 748 | 328 | 2.28 | 1.28 |
| Skirt | 0.50 | 526 | 421 | 1.25 | **0.70** |
| Joggers | 0.42 | 432 | 378 | 1.14 | **0.64** |
| Joggers | 0.50 | 422 | 421 | 1.00 | **0.56** |

### Vigtigste observationer pr. asset

**Jacket** — F_eff 1.03-1.11, tæt på korrekt. Renderes 0.1726 → 0.5518, hvilket
er skulder → hoft. Har 2 løsrevne ærmer der fortsætter ned til 0.81.

**T-shirt** — F_eff 0.59 (krop). Kortærmet: 1 segment gennem det meste, ærmerne
slutter mellem 0.35 og 0.42. Renderes 0.2205 → 0.4856 (skulder → hoft).

**Skirt** — F_eff 0.70. A-linje, 1 segment hele vejen, monotont udvidende
346 → 606. Renderes 0.3800 → 0.5717.

**Joggers** — F_eff 0.56-0.64. **Udenfor som resten**: assetet spanner
0.1074 → 0.9486 = fra halsen til fødderne, i stedet for talje → ankler. Renderes
0.2450 → 0.7160 = bryst → knæ. 2 ben-segmenter fra 0.35.

### Metodisk begrænsning

F-værdier under `frac ~ 0.50` er **ikke sammenlignelige**: under hoften falder
woman-silhuetten, fordi benene deler sig (421 px @0.50 → 204 @0.58 → 128 @0.80).
Alpha-bbox alene fortæller ikke, om et garment sidder korrekt.

---

## 4. Current rendering scale

`src/styles/wardrobe.css:648`

```css
--clothing-base-scale: var(--dressed-clothing-scale, 0.56);
```

Samme værdi findes **hardkodet** i `src/styles/profile.css:616`:

```css
--clothing-base-scale: 0.56;
```

`placement.scale` er aktuelt `1` for alle 21 kategorier (`NEUTRAL` i
`clothing-categories.ts`). Derfor:

```
effective scale = placement.scale x 0.56 = 0.56
```

Placering afhænger alene af anchor + transform-origin; `placement.x/y` er `0`.

### 0.56 er et empirisk / magic number

| Commit | Besked | Værdi |
|---|---|---|
| `1e70ee4` | Agent turn 12 | 0.60 |
| `8c1df35` | Agent turn 13 | 0.55 |
| `d973d1b` | **"working solution with size"** | **0.56** |
| `d0dc64d` … `c8051fb` | 8 commits | 0.56 (uændret) |

Der findes **ingen dokumenteret matematisk afledning** nogensteds i repoet.
Værdien er stabil siden `d973d1b` og har to uafhængige copies i CSS.

> ### 0.56 SKAL IKKE ÆNDRES ENDNU
> Dette dokument beskriver `0.56` som observeret systemadfærd, ikke som en
> godkendt værdi. Se afsnit 9 for målingen, der viser at en korrekt værdi
> endnu ikke kan afledes.

---

## 5. Current clothing generation pipeline

```
Originalt clothing-billede
  → clothing generation job
  → canonical master form + clothing reference
  → OpenAI image generation
  → transparent 1024x1536 clothing asset
  → storage
  → database
  → CLOSET / DRESSED
```

### Nøgleg fakta

| | |
|---|---|
| Master form | `loadSystemBaseFormDataUrl()` — **geometry/canvas authority** |
| Clothing reference | Brugerens upload — **design authority** |
| Billedrækkefølge | `images: [characterDataUrl, sourceDataUrl]` (img1 = master, img2 = tøj) |
| Model | `gpt-image-2.5-sunburst` |
| Endpoint | `POST https://api.openai.com/v1/images/edits` |
| `size` | `1024x1536` |
| `background` | `transparent` |
| Prompt | `clothing-job.ts:77-115` — 37 strenge |
| Prompt-status | **Byte-identisk** siden `3193b8a` |

Prompten kræver eksplicit: *"Return a transparent 1024x1536 PNG with exactly the
same canvas, framing, and pixel coordinate system as image 1"*.

---

## 6. Current regeneration limitation

Et allerede AI-ready clothing item **kan ikke regenereres** via UI'en.

**UI-blokering** (`profile.astro:1478-1483`): knappen "MAKE … AI READY" renders
kun når `!isAiReady`. Er item'et allerede AI-ready, findes ingen knap.

**Server-cache-hit** (`process-clothing.ts:341-356`):

```ts
if (
  existingAsset?.reference_path &&
  existingAsset.generation_version === CURRENT_CLOTHING_ASSET_VERSION
) {
  return assetResponse(..., cacheHit: true);   // HTTP 200, intet OpenAI-kald
}
```

Cache-hit sker **før** kvotereservation. Der foretages ingen AI-generation.

> **Hvis vi ændrer prompt/geometry/scale uden at ændre versionen eller tvinge
> regeneration, bliver der ikke genereret et nyt asset.**

`CURRENT_CLOTHING_ASSET_VERSION = 3` (`clothing-assets.ts:1`).

---

## 7. Current asset replacement behavior

**Asset-tabel:** `wardrobe_item_ai_assets` (ikke `clothing_assets`)

**Primær nøgle:** `(user_id, item_id, base_type)` — én række pr. kombination.
Der oprettes altså ikke automatisk en ny aktiv række pr. generation.

**Ved en faktisk forced regeneration:**

| Aspekt | Resultat |
|---|---|
| DB-række | Samme række **upsertes** (`onConflict: user_id,item_id,base_type`) |
| `reference_path` | **Erstattes** |
| Gammelt storage asset | **SLETTES** (`clothing-job.ts:200-213`) |
| Revisionshistorik | **Ingen** |
| `is_active` / revision | **Findes ikke** i nogen migration |
| `generation_version` | Contract-flag, **ikke** revisionshistorik |

**CLOSET** og **DRESSED** vil derefter bruge det nye asset — de læser
`aiReadyAssets[base_type]` med den aktuelle `reference_path`.

> **Fejl-sikkerheden ved forced regeneration skal analyseres, før vi
> implementerer den.**

---

## 8. Storage & Asset Lifecycle

Alle bruger- og AI-billeder ligger i ét Supabase-bucket: `model-images`.
Der findes ingen staging- eller temp-præfiks.

### 8.1 Original user upload

Brugerens uploadede clothing-billede er en **permanent reference** og må gemmes.

| Krav | Status |
|---|---|
| Gemmes permanent som brugerens originale reference | OK |
| Upload → DB-write → **rollback ved DB-fejl** | OK |

Implementeret to steder, samme mønster: `process-clothing.ts:416-450` og
`items/index.ts:427-483`.

### 8.2 AI-generated clothing asset

> **A finished AI-generated clothing asset is considered persistent only when
> the database successfully points to it.**

| Krav | Status |
|---|---|
| Må først blive permanent efter generationen er færdig og **valideret** | OK |
| Validering før upload (1024x1536 PNG, transparente hjørner) | OK `clothing-job.ts:118-153` |
| Ny storage path ved regeneration | OK `crypto.randomUUID()` |
| DB peger på nyt **før** gammel slettes | OK linje 185 → 200 |
| Ved fejl før DB-success overlever det gamle asset | OK |
| Nyt midlertidigt asset fjernes ved kendte fejl | OK `catch`, kun hvis `!aiAssetPersisted` |

Den nuværende `clothing-job.ts` **allerede følger denne rækkefølge**:

```
170  generér ny path
172  upload ny fil          ← først efter alle valideringer
185  DB-upsert → ny fil    ← DB peger på nyt
199  aiAssetPersisted = true
200  remove(gammel fil)    ← gammel slettes FØRST HER
214  catch: remove(ny) kun hvis !aiAssetPersisted
```

### 8.3 Identificerede problemer

| # | Problem | Status |
|---|---|---|
| **P1** | Character regeneration efterlod altid gamle storage-filer | Rettet |
| **P2** | Process-død mellem upload og DB-write kan efterlade orphaned files | Ikke løst nu |
| **P3** | Quota-fejl-cleanup er ikke fuldt koblet til fil-cleanup | Ikke løst nu |
| **P4** | Clean previews er AI-generated; status uafklaret | Ikke løst nu |
| **P5** | Der findes ingen generel orphan-cleanup/sweep | Ikke løst nu |

**P1 var:** `publish_dressed_character` sat blot den gamle række til
`is_primary = false` og slettede ingen storage-fil.

**P1 er rettet** i `src/lib/server/ai/jobs/character-job.ts` med samme mønster
som clothing-job: den aktive `model_path` læses *før* publish, og filen slettes
*efter* at publish er bekræftet lykket. Sletningen ligger efter
try/catch/finally, så en fejl der aldrig kan slette det nye, publicerede image.

**P2–P5 skal ikke løses nu.** De kræver arkitekturændringer, kobling af
kvotalogik og en produktbeslutning.

### 8.4 Original uploads overlever generering (verificeret)

Undersøgelsen af accept/reject-flowet viste, at **der ikke findes noget
accept-trin** i systemet: AI-resultater behandles som accepteret i samme øjeblik
de genereres.

Det betyder, at den ønskede acceptance-baserede sletning af originaler **ikke
kan implementeres uden et schema-skridt** (fx en `status` / `accepted_at`
-kolonne), og det er ikke gjort.

Det betyder også, at følgende invariant **allerede holder**:

> Originale brugeruploads slettes **aldrig** under generering.

| Original | Slettes kun ved |
|---|---|
| `wardrobe_items.original_path` | `items/[id].ts:123` — brugerens eksplicitte "DELETE ITEM" |
| `profiles.source_photo_path` | `source-photo.ts` — kun hvis DB-update fejler ved upload |

#### Rettet fejl: re-upload orphannede det forrige source-foto

`source-photo.ts` genererede altid en ny sti og overskrev
`profiles.source_photo_path` **uden at slette den forrige fil**. Hver ny upload
af et source-foto efterlod derfor én permanent fil i `profile-images`.

Rettet med samme mønster som P1-fixen for character:

```
68   LÆS profiles.source_photo_path (før upload)
80   upload ny fil → ny sti
90   DB-update → source_photo_path = ny sti
102  EFTER succesfuld DB-opdatering: slet forrige fil
```

| Fejlpunkt | Resultat |
|---|---|
| Upload fejler | Nyt slettes; **det eksisterende source-foto overlever** |
| DB-update fejler | Nyt slettes; **det eksisterende source-foto overlever** |
| Sletning af gammel fil fejler | Nyt foto er **allerede aktivt**; kun log, ingen rollback |

**Bemærk:** `profile-images`-policer findes ikke i `supabase/migrations` kun
dashboard-konfigurerede. Delete-fejl håndteres non-fatalt, så løsningen er
sikker uanset om rettigheden er tilstede.

### 8.5 Force regeneration (udvikling)

Til iterative Best Fit-arbejde (ændring → force regeneration → måling → ny
ændring) er der en udvikling-only mekanisme, der gør det muligt at regenerere
et eksisterende AI-ready item **uden** at bumpe
`CURRENT_CLOTHING_ASSET_VERSION`.

#### Sådan trigges den

Via en opt-in request-header på den eksisterende endpoint:

```
POST /api/ai/process-clothing
x-dressed-force-regenerate: 1
```

Kun tilgængelig på den lokale dev-server. **Ingen synlig knap i UI'et.**

#### Sikkerhed

| Krav | Status |
|---|---|
| Kun brugerens eget item | OK — `authenticateSupabaseRequest` + `.eq("user_id", user.id)` uændret |
| Authentication fortsat valideret | OK — sker før flaget læses |
| Ingen adgang til andres assets | OK — intet nyt scope; alle queries har `user_id`-filter |
| Ikke en generel quota-bypass | OK — `import.meta.env.DEV` er statisk `false` i produktion |
| Ikke eksponeret for almindelige brugere | OK — ingen UI, ingen knap, ingen brugerflade |

Guarden er `import.meta.env.DEV` — det samme mønster, der allerede bruges i
`personal-model.ts:233`. Vite erstatter det med `false` ved build, så **hele
stien er dødvendigvis kompileret væk i produktion.** Verificeret: header-strengen
findes ikke i `dist/` efter `npm run build`.

#### Cache-hit bypass

`process-clothing.ts` — ét udtryk ændret:

```
const forceRegenerate =
  import.meta.env.DEV &&
  request.headers.get(FORCE_REGENERATE_HEADER) === "1";

if (
  !forceRegenerate &&
  existingAsset?.reference_path &&
  existingAsset.generation_version === CURRENT_CLOTHING_ASSET_VERSION
) { /* cache-hit: returnér eksisterende asset */ }
```

**Alt efter cache-hit'en er uændret.** Ingen parallel pipeline:

- Kvotereservation (`reserveClothingGeneration`) kører normalt
- `launchBackgroundJob("process-clothing-background")` kører normalt
- `runClothingJob` kører normalt med samme validering

#### Storage replacement

Helt uændret — ingen særskilt kode. Den eksisterende rækkefølge i
`clothing-job.ts` anvendes:

```
1. Find eksisterende aktivt asset     (existingAsset)
2. Generér nyt AI-resultat            (editImage)
3. Validér resultatet                 (118-153: 1024x1536 PNG, alpha)
4. Upload til NY storage path        (crypto.randomUUID())
5. DB-upsert → ny reference_path     (onConflict user_id,item_id,base_type)
6. aiAssetPersisted = true
7. Slet gammel storage asset         ← FØRST HER
```

| Fejlpunkt | Resultat |
|---|---|
| OpenAI / validation / upload fejler før DB | Gammelt asset **overlever**; nyt fjernes i `catch` |
| DB-upsert fejler | Gammelt asset **overlever**; nyt fjernes i `catch` |
| Gammel storage deletion fejler | Nyt asset er **allerede aktivt**; kun log |

#### Ét aktivt asset

Der er fortsat **kun ét** aktivt clothing asset pr. `user_id + item_id +
base_type`. Force regeneration erstatter dette — den opretter ingen ny række og
ingen revisionshistorik.

---

## 9. Fitting-analyse (read-only, 2026-10-05)

**Baseline: al eksisterende funktionalitet er låst og urørt.** Denne sektion er
udelukkende måling og anbefaling — intet er implementeret.

### 9.1 Den fulde transform-kæde

```
contain:  model 1024x1536 → box 2:3,  ingen transform        (scale 1.0)
          lag   1024x1536 → box 2:3,  scale(S) om anchor
S         = 0.56 x placement.scale(altid 1) = 0.56
translate = placement.x/y = 0  →  ingen effekt
```

Forskydning efter skalering om anchor `A`:

```
y_renderet = A + 0.56 x (y_asset - A)
```

### 9.2 Vertikal placering — kun ét objektivt fejlagende asset

| Asset | Asset-span | Renderet (0.56) | Forventet region | Bedømmelse |
|---|---|---|---|---|
| T-shirt | 0.1816→0.6549 | 0.2205→0.4856 | skulder 0.2025 → hoft 0.46 | OK |
| Jacket | 0.1354→0.8125 | 0.1726→0.5518 | skulder → hoft | OK |
| Skirt | 0.3171→0.6595 | 0.3800→0.5717 | talje 0.42 → knæ 0.72 | OK |
| **Joggers** | **0.1074→0.9486** | **0.2450→0.7160** | **talje 0.42 → ankel 0.91** | **FEJL** |

**Joggers havner på bryst → knæ i stedet for talje → ankel.** Dvs. ca. 175 px
for højt i toppen og ca. 194 px for kort i bunden.

### 9.3 Bevis: ingen uniform scale kan rette joggers

Løsning kræver samme `s` i to betingelser:

```
top:  0.42 + s x (0.1074 - 0.42) = 0.42   ->  s = 0
bund: 0.42 + s x (0.9486 - 0.42) = 0.91   ->  s = 0.926
```

Modstridende. **Joggers kan ikke repareres i compositing-laget** — assetet skal
regenereres, så det males i rigtig kropsregion. (Prompten er urørt; dette er kun
en dokumenteret anbefaling.)

### 9.4 Fund: masterformerne er linjetegninger

Segmentanalyse af `woman.png` / `man.png` (luminance < 178) viser, at kroppen er
**streger og konturer, ikke fyldte silhuetter**. Rækkerne fragmenterer i 4-8 små
strokes, og en "kernebredde" kan ikke udledes stabilt:

```
0.30  segmenter=[119,107]   <- to halve konturer, ikke et sammenhængende torso
0.42  segmenter=[85,17,19,86]
0.50  segmenter=[39,20,58,22,37]
```

**Konsekvens for fitting-arbejdet:** det findes ingen maskinelt læselig
"kroppens bredde" i de nuværende assets. En pålidelig kalibrering kræver et nyt
reference-artifact — en *fyldt* kropssilhuet pr. base type.

Det må **ikke** være en ændring af `woman.png` / `man.png` (de er låste canonical
forms), men et separat analyse-asset. **Anbefaling, ikke implementeret.**

### 9.5 Hvad der kan og ikke kan beregnes

| Kan beregnes | Kan ikke beregnes |
|---|---|
| Asset-bounds, center, margener | "Ideel" skalering pr. kategori |
| Renderet top/bund/center efter 0.56 | Torso-bredde isoleret fra arme |
| Body **silhuet-span** pr. højde (øvre grænse) | F_asset mod en troværdig torso-reference |
| Vertikal korrekthed pr. asset | Vandret korrekthed pr. asset |

F_asset-tallene i afsnit 3 bruger **silhuet-span inkl. arme** og er derfor kun
brugbare som **øvre grænse**. De kan ikke bruges til at aflede en korrekt
skalering.

### 9.6 Anbefalinger — ingen implementeret

| # | Anbefaling | Begrundelse |
|---|---|---|
| R1 | **Regenerer joggers** | Eneste asset med objektivt forkert vertikal extent. Assetet males fra hals til fødder. |
| R2 | **Antag `0.56` er uafledet** | Magic number (0.60→0.55→0.56). Bevises først gyldig/ugyldig, når torso-reference findes. **Må ikke ændres nu.** |
| R3 | **Lav fyldt silhouette-reference** | Forudsætningen for al kvantitativ fitting-kalibrering. Nyt asset, ikke ændring af canonical forms. |
| R4 | **Behold nuværende anchors** | 3 af 4 assets er vertikalt korrekte med dem. |
| R5 | **Hent mandlige assets** | Uden dem er male fitting uundersøgt. |

### 9.7 Regression-status

Denne runde har **ikke** ændret: `0.56`, anchors, `MAN_ANCHOR_Y`, prompts,
masterformer, CSS, `base_type`-logik, AI-ready-logik, generation-status, quota,
background jobs, force-regeneration, Header, migrations, API-kontrakter.

Kun `BestFitAnalyse.md` er opdateret.

---

---

## 10. Master → Anchor → Clothing sammenhæng (KERNEN)

> **MASTEREN ER FACIT.** Alle clothing-mål er relativt til masterformen.
> Assets bruges aldrig til at bestemme masterens geometry.

### 10.1 Masterens landmarks — pixel + normaliseret

**WOMAN** (`woman.png`, 1024 × 1536)

| Landmark | x_px | y_px | x_n | y_n | bredde_px |
|---|---:|---:|---:|---:|---:|
| head top | 505 | 32 | 0.4927 | 0.0208 | 20 |
| neck (smalleste før skulder) | 510 | 300 | 0.4976 | 0.1953 | 169 |
| **skulderlinje** | 507 | **311** | 0.4951 | **0.2025** | 217 |
| chest | 506 | 415 | 0.4941 | 0.2702 | 307 |
| waist | 506 | 645 | 0.4937 | 0.4199 | 378 |
| hip | 506 | 707 | 0.4937 | 0.4603 | 396 |
| håndlinje | 505 | 768 | 0.4932 | 0.5000 | 421 |
| knee | 506 | 1106 | 0.4937 | 0.7201 | 176 |
| ankle | 506 | 1398 | 0.4937 | 0.9102 | 102 |
| foot bottom | 507 | 1474 | 0.4946 | 0.9596 | 36 |
| bbox | 289–721 | 32–1474 | 0.2822–0.7041 | 0.0208–0.9596 | 433 |

**MAN** (`man.png`, 1024 × 1536)

| Landmark | x_px | y_px | x_n | y_n | bredde_px |
|---|---:|---:|---:|---:|---:|
| head top | 506 | 32 | 0.4941 | 0.0208 | 11 |
| neck (smalleste før skulder) | 504 | 231 | 0.4917 | 0.1504 | 98 |
| **skulderlinje** | 504 | **270** | 0.4922 | **0.1758** | 161 |
| chest | 502 | 415 | 0.4902 | 0.2702 | 381 |
| waist | 504 | 645 | 0.4922 | 0.4199 | 425 |
| hip | 505 | 707 | 0.4927 | 0.4603 | 432 |
| håndlinje | 505 | 768 | 0.4927 | 0.5000 | 440 |
| knee | 507 | 1106 | 0.4951 | 0.7201 | 189 |
| ankle | 506 | 1398 | 0.4941 | 0.9102 | 105 |
| foot bottom | 507 | 1475 | 0.4951 | 0.9603 | 35 |
| bbox | 282–726 | 32–1475 | 0.2754–0.7090 | 0.0208–0.9603 | 445 |

Ingen koordinater er opfundet. Body center er **505.0 / 753.0** (woman) og
**504.0 / 753.5** (man).

### 10.2 Hvad hvert anchor faktisk er

| Anchor | y_px | Nærmeste master-landmark | Afstand |
|---|---:|---|---:|
| neck | 284 | woman neck 300 (0.1953) | 16 px over |
| shoulders | 338 | woman skulderlinje 311 (0.2025) | 27 px under |
| torso | 415 | woman chest 415 (0.2702) | **0 px — præcis** |
| waist | 645 | woman waist 645 (0.4199) | **0 px — præcis** |
| hips | 707 | woman hip 707 (0.4603) | **0 px — præcis** |
| knees | 1106 | woman knee 1106 (0.7201) | **0 px — præcis** |
| ankles | 1398 | woman ankle 1398 (0.9102) | **0 px — præcis** |
| feet | 1459 | woman foot 1474 (0.9596) | 15 px over |
| dress | 307 | woman skulderlinje 311 (0.2025) | **4 px — præcis** |
| head | 154 | woman head 32–217 (0.0208–0.141) | i hovedet |
| face / ears | 215 | woman face 216 px @ y215 | **præcis** |
| full-body | 768 | midt i figuren | OK |
| left-hand | 338 | arm yderkant 295 | 43 px inde |
| right-hand | 686 | arm yderkant 715 | 29 px inde |

`torso`, `waist`, `hips`, `knees`, `ankles`, `face` og `dress` er
**pixel-præcise**. `neck`, `shoulders` og `feet` er inden for 30 px. Kun
`left-hand`/`right-hand` peger ikke på det punkt, de er navngenet efter.

### 10.3 Expected clothing region — afledt KUN af masteren

| Category | Region (woman, px) | Top frac | Bund frac |
|---|---|---:|---:|
| T-shirt | skulder 311 → hofte 707 | 0.2025 | 0.4603 |
| Jacket | skulder 311 → hofte 707 | 0.2025 | 0.4603 |
| Skirt | talje 645 → knæ 1106 | 0.4199 | 0.7201 |
| Pants / joggers | talje 645 → ankel 1398 | 0.4199 | 0.9102 |
| Dress | nakke 300 → under hofte | 0.1953 | 0.4603 |
| Shoes | ankel 1398 → fødder 1474 | 0.9102 | 0.9596 |

**Ingen af disse afledes fra, hvor et eksisterende asset tilfældigvis ligger.**

### 10.4 Den afgørende matematik

Ved `scale(S)` omkring anchor `A` flyttes et punkt `L` til `A + S(L − A)`.

```
A + S(L − A) = L   ⇒   (S − 1)(L − A) = 0   ⇒   L = A
```

> **Et punkt bevarer kun sin placering, hvis det ligger PRÆCIS I ANCHOR.**
> Alt andet flyttes (1 − S) = **44 % af sin afstand mod anchor**.

Med S = 0.56 vil et **perfekt pixel-alignet** asset derfor rendere sådan:

| Category | Forventet top | Renderet | Δ top | Forventet bund | Renderet | Δ bund | Længde |
|---|---|---|---:|---|---|---:|---|
| T-shirt | 311 px | 357 px | **+46 px for lav** | 707 px | 578 px | **−129 px** | 221/396 = **56 %** |
| Jacket | 311 px | 323 px | +12 px | 707 px | 545 px | **−162 px** | 222/396 = **56 %** |
| Skirt | 645 px | 672 px | +27 px | 1106 px | 930 px | **−176 px** | 258/461 = **56 %** |
| **Joggers** | 645 px | 645 px | **0 px** | 1398 px | 1067 px | **−331 px** | 422/753 = **56 %** |

> ### Svar på afsnit 16: **NEJ.**
> Hvis vi gav systemet et **perfekt genereret og korrekt placeret** asset på
> samme 1024 × 1536 coordinate system, ville compositing-systemet **ikke**
> placere det korrekt. Hvert stykke tøj ville rendere ved **56 % af masterens
> region**, og toppen ville forskydes mod anchor.

### 10.5 Bevis: joggers er matematisk umulige

For at et asset skal ramme korrekt, skal det ligge:

```
nødvendig_top = A + (L_top − A)/0.56
nødvendig_bot = A + (L_bot − A)/0.56
```

| Category | Nødvendig top | Nødvendig bund | Faktisk top | Faktisk bund |
|---|---|---|---|---|
| T-shirt | 0.1495 (230 px) | 0.6098 (937 px) | 0.1816 | 0.6549 |
| Jacket | 0.1888 (290 px) | 0.6491 (997 px) | 0.1354 | 0.8125 |
| Skirt | 0.3884 (597 px) | 0.9245 (1420 px) | 0.3171 | 0.6595 |
| **Joggers** | 0.4198 (645 px) | **1.2954 (1990 px)** | 0.1074 | 0.9486 |

**Joggers kræver en bund på 1990 px — 454 px uden for den 1536 px store canvas.**

Generel regel: et asset kan kun ramme rigtigt, hvis

```
(L_bot − A) ≤ 0.56 × (1 − A)
```

| Category | (L_bot − A) | Kapacitet 0.56×(1−A) | Udslag |
|---|---:|---:|---|
| T-shirt | 0.1903 | 0.409 | ✅ 47 % af kapacitet |
| Jacket | 0.2403 | 0.437 | ✅ 55 % |
| Skirt | 0.2601 | 0.302 | ⚠️ **86 % — tæt på grænsen** |
| **Joggers** | **0.4902** | **0.325** | ❌ **151 % — umuligt** |

> **CONFIRMED: joggers kan ikke placeres korrekt af dette system, uanset hvor
> AI'en placerer dem.** Det er ikke en AI-fejl — det er en grænse i compositing.

### 10.6 Asset vs. master — afvigelse

| Asset | | Master forventet | Asset faktisk | Δ (asset − forventet) |
|---|---|---|---|---|
| T-shirt | top | 0.2025 | 0.1816 | −0.021 (−32 px) |
| | bund | 0.4603 | 0.6549 | +0.195 (+299 px) |
| Jacket | top | 0.2025 | 0.1354 | −0.067 (−103 px) |
| | bund | 0.4603 | 0.8125 | +0.352 (+541 px) |
| Skirt | top | 0.4199 | 0.3171 | −0.103 (−158 px) |
| | bund | 0.7201 | 0.6595 | −0.061 (−93 px) |
| **Joggers** | top | 0.4199 | **0.1074** | **−0.313 (−480 px)** |
| | bund | 0.9102 | 0.9486 | +0.038 (+59 px) |

**Alle fire assets er genereret større end masterens region** (undtagen
skirtens bund). Det er konsistent med, at AI'en ubevidst kompenserer for
0.56-kompressionen — men inkonsistent.

### 10.7 Hvor fejlen opstår — kæden

| Trin | T-shirt | Jacket | Skirt | Joggers |
|---|---|---|---|---|
| MASTER | ✅ korrekt | ✅ korrekt | ✅ korrekt | ✅ korrekt |
| ANCHOR | ✅ korrekt (0 px) | ✅ (27 px) | ✅ (0 px) | ✅ (0 px) |
| **ASSET CANVAS-POSITION** | ⚠️ top 32 px for høj | ⚠️ top 103 px for høj | ❌ top 158 px for høj | ❌ **top 480 px for høj** |
| ASSET GEOMETRY | ⚠️ inkonsistent | ⚠️ | ⚠️ | ⚠️ |
| SCALE | ❌ komprimerer 44 % | ❌ | ❌ | ❌ |
| TRANSFORM-ORIGIN | ❌ placerer på anchor | ❌ | ❌ | ❌ |
| TRANSLATION | ✅ 0/0 no-op | ✅ | ✅ | ✅ |
| FINAL COMPOSITION | ⚠️ | ⚠️ | ⚠️ | ❌ |

> **Det første afvigende punkt i kæden er `ASSET CANVAS-POSITION` — ikke
> anchor, ikke scale, ikke rendering.** Men `SCALE` er en permanent strukturel
> fejl: den ville ødelægge selv et korrekt placeret asset.

### 10.8 Den strukturelle modsætning

| Kilde | Krav til assetet |
|---|---|
| `clothing-job.ts:112` (prompt) | *"Return a transparent 1024x1536 PNG with **exactly the same canvas, framing, and pixel coordinate system as image 1**"* → **1:1-alignment** |
| `wardrobe.css:648` | `scale(0.56)` → forventer **1.79× (1/0.56) livsstørrelse** |

**De to krav er gensidigt udelelige.** Et 1:1-alignet asset ødelægges af 0.56.

Hvis prompten overholdes → `0.56` ødelægger det.
Hvis AI'en returnerer 1.79× → prompten er brudt, men renderingen kan virke.

**Dette forklarer den observerede spredning i F_asset (1.18 – 1.84):** AI'en
overholder prompten inkonsistent, og `0.56` er kalibreret til kun én af disse
stilarter (jacket'ens 1.84).

### 10.9 Bevis på at de to assetsystemer er designet til samme rum

| Egenskab | Master | Clothing assets | Fælles? |
|---|---|---|---|
| Canvas | 1024 × 1536 | 1024 × 1536 | ✅ Ja |
| Aspect | 2 : 3 | 2 : 3 | ✅ Ja |
| Prompt-krav | — | *"same canvas… as image 1"* | ✅ Ja |
| Validation | — | 1024 × 1530 PNG (linje 118-121) | ✅ Ja |
| Compositing | `object-fit: contain` i 2:3-boks | samme boks | ✅ Ja |

**De to billeder ER designet til samme pixelkoordinatsystem.** Det er
forudsætningen for hele systemet — og den er korrekt.

### 10.10 Det gennemgående eksempel (T-shirt, woman)

```
Master skulderlinje      0.2025 (311 px)
Master hofte             0.4603 (707 px)
↓  forventet T-shirt-region:  0.2025 → 0.4603
Anchor torso             0.27    (415 px)  ← præcis masterens chest
↓  transform-origin       (512 px, 415 px) i display-boksen
Asset fracTop/fracBot    0.1816 → 0.6549
↓  scale(0.56) omkring 0.27
Renderet top             0.27 + 0.56(0.1816 − 0.27) = 0.2205  (339 px)
Renderet bund             0.27 + 0.56(0.6549 − 0.27) = 0.4855  (746 px)
↓  sammenlign med master
Skulderlinje forventet   0.2025 (311 px)   → tøjet er 28 px for lavt
Hofte forventet          0.4603 (707 px)   → tøjet er 39 px for lavt
Renderet længde          407 px  vs. master-region 396 px  (103 %)
```

T-shirtets længde (103 % af masterens skulder→hofte-region) er **heldvis
korrekt** — fordi AI'en genererede den 1.53× for stor. Det er ikke designet;
det er en heldig kompensation.

### 10.11 Delkonklusioner

| # | Konklusion | Status |
|---|---|---|
| C1 | Master og assets deler korrekt 1024 × 1536 pixelkoordinatsystem | **CONFIRMED** |
| C2 | 12 af 14 anchors er pixel-præcise mod masteren | **CONFIRMED** |
| C3 | `scale(0.56)` ødelægger alignment for alt undtagen anchor-punktet | **CONFIRMED** |
| C4 | Prompt (1:1) og CSS (1.79×) er gensidigt udelelige | **CONFIRMED** |
| C5 | Joggers er umulige i dette system — 151 % af kapacitet | **CONFIRMED** |
| C6 | Skirt er på 86 % af kapacitet — tæt på grænsen | **CONFIRMED** |
| C7 | Første fejl i kæden er asset-canvas-position | **CONFIRMED** |
| C8 | Transformation (x) er ubetydelig (7 px) | **CONFIRMED** |
| C9 | Om 0.56 er korrekt for *nogen* kategori | **UNKNOWN** — kun 4 samples, én base type |
| C10 | Male-side af kæden | **UNKNOWN – insufficient male clothing asset data** |

---

## 11. Known problems

1. **Male clothing assets mangler** — kun 4 female assets findes i projektet.
2. **Male clothing fit er derfor ikke verificeret.**
3. **0.56 er et udokumenteret magic number** — visuelt tunet 0.60 → 0.55 → 0.56.
4. **0.56 passer ikke ens på de målte female assets.**
5. **T-shirt (0.59), skirt (0.70) og joggers (0.64) har lavere F_eff** end
   jacket (1.03).
6. **Jacket (1.03) passer relativt godt** med 0.56.
7. **Joggers har desuden en forkert vertical extent** — assetet spanner fra hals
   til fødder i stedet for talje til ankler.
8. **Clothing assets har ikke nødvendigvis ens output-scale fra AI** — F_asset
   varierer fra 1.00 til 2.28 på de fire målte assets.
9. **Regeneration er blokeret** af cache/version-logikken (jf. 8.5).
10. **Forced replacement skal være failure-safe**, før den kan bruges bredt.
11. **Der findes ingen maskinelt læselig kropsbredde** i masterformerne
    (linjetegninger, jf. 9.4).

---

## 12. Confirmed facts vs hypotheses

### 12.1 Confirmed facts

*Målt eller fundet i kode/Git.*

- Begge masterforme er 1024 x 1536 med ca. 1 px forskel i height, centerX og
  y-extent (afsnit 2).
- Upper-body bredder afviger op til 1.75x mellem woman og man (afsnit 2).
- Alle fire assets er female og måler F_asset 1.00-2.28 (afsnit 3).
- F_eff efter 0.56: jacket 1.03, t-shirt 0.59, skirt 0.70, joggers 0.56-0.64.
- `placement.scale` er 1 for alle kategorier; effective scale = 0.56.
- `0.56` blev introduceret i `d973d1b` "working solution with size" efter 0.60
  og 0.55; ingen afledning findes i repoet.
- `0.56` findes i to separate CSS-filer.
- Clothing-prompten er byte-identisk siden `3193b8a`.
- Asset-tabellen er `wardrobe_item_ai_assets` med PK
  `(user_id, item_id, base_type)`.
- Regeneration er blokeret af UI-krav og serverens cache-hit.
- Ved forced regeneration overskrives DB-rækken, og gammel storage-fil slettes.
- Der findes ingen `is_active`, revision- eller historikkolonne.
- 3 af 4 assets er vertikalt korrekte efter compositing; kun joggers er ikke
  (afsnit 9.2).
- Ingen uniform scale kan rette joggers (afsnit 9.3).
- Masterformerne er linjetegninger, så torso-bredde kan ikke isoleres maskinelt
  (afsnit 9.4).
- Der findes intet accept/reject-trin i systemet (afsnit 8.4).

### 12.2 Hypotheses

*Ikke bevist endnu.*

- Om AI'en konsekvent genererer clothing i korrekt størrelse.
- Om `0.56` bør fjernes eller erstattes af en målt værdi.
- Om scale bør være category-specific.
- Om male/female kan bruge samme scale.
- Om clothing-prompten skal ændres.
- Om joggers' forkerte vertical extent er et isoleret tilfælde eller et
  systemisk AI-mønster.
- Om male assets genereres korrekt i `man.png`'s koordinatsystem.
- Om closet-gitterets `cleanPreviewUrl` er årsagen til visuelle
  "NOT AI READY"-misforståelser.

---

## 13. Best Fit strategy

Det ønskede fremtidige princip, **endnu ikke implementeret**:

> **Original clothing reference = design authority**
> **Canonical master form = geometry authority**
> **Browser/CSS = final placement authority**

Målet er et ensartet system for både woman og man **uden tilfældige
gender-specific scale hacks**.

---

## 14. Next investigation steps

1. Få mandlige clothing assets tilgængelige.
2. Lav en fyldt silhouette-reference pr. base type (R3), så torso-bredde kan
   måles maskinelt.
3. Mål male assets mod `man.png`.
4. Sammenlign male/female category-by-category.
5. Undersøg safest forced regeneration flow.
6. Test regeneration med ét asset.
7. Først derefter beslutte `0.56`.
8. Derefter kalibrere generation/placement-systemet.

---

## Change log

- Dokument oprettet som READ-ONLY analyse.
- **Ingen produktionskode ændret.**
- **Ingen database/migrations ændret.**
- **Ingen eksisterende assets ændret.**
- Tilføjet: 8.4 (original-lifecycle), 8.5 (force regeneration), 9 (fitting).
