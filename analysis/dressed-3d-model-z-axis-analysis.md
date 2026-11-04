# DRESSED 3D Model + Z-Axis Analysis

> **Type: READ-ONLY ANALYSE.** Ingen produktionskode, ingen migrations, ingen
> database, ingen dependencies, ingen UI og intet wardrobe er ændret. **Denne fil
> er det eneste nye artefakt.** Ingen commit/push/merge er udført.
>
> **Branch:** `safety-branch` (HEAD `e77b86b`, working tree ren på analyse-tidspunktet).
> **X/Y-scaling-grundlag:** `b5b6610` ("implementing scale x + y") + `e77b86b`
> ("implemented x & y scale"), inkl. migration
> `supabase/migrations/202610060002_placement_free_scale.sql`.
>
> **Evidensmarkering bruges konsekvent:**
> **CONFIRMED** = læst direkte i kode/migration/analyse i dette repo ·
> **INFERRED** = logisk slutning fra bekræftet materiale ·
> **UNVERIFIED** = kræver ekstern research, live-måling eller et eksperiment,
> der ikke er kørt her. Alle eksterne forhold (priser, tredjeparts-licenser,
> model-kvalitet) er UNVERIFIED, medmindre andet er angivet.

---

## Executive Summary

DRESSED er i dag et **2D-system**: ét kanonisk 1024×1536-canvas, ét personligt
AI-genereret karakterbillede, og ét lag transparent PNG pr. clothing item,
placeret med en CSS-transform
(`translate(x%, y%) scale(scaleX, scaleY)` omkring `transform-origin = anchor`).
Placement gemmes per item som JSONB `{anchor,x,y,scale[,scaleX,scaleY]}` og
resolveres ens i DRESSED og Profile.

Konklusionerne i denne analyse:

1. **Der findes INGEN tidligere 3D/WebGL/GLTF/z-axis/rotations-analyse i
   projektet** (grep over `analysis/`, `docs/` og `*.txt` = 0 relevante
   træffere). Denne fil er derfor første 3D-analyse og bygger oven på de
   *eksisterende* placement-, AI- og database-analyser — den overskriver dem ikke.

2. **Den eksisterende placement-model skal ikke kasseres — den skal
   *oversættes*.** Det teknisk korrekte 3D-modstykke til `anchor + x + y +
   scale` er **ikke** `x + y + z`, men et **forældre-bundet lokalt transform**:
   `node (arvet anchor) + lokal position (u,v) + lokal rotation + lokal scale +
   shell-offset (w)`. `z` er i DRESSED-praksis **ikke en fri verdensakse** men et
   **offset langs legemets normal** (dybde/lag-tykkelse), fordi tøjet skal følge
   kroppen ved rotation og korrekt sorteres mod huden.

3. **Front/side/back-konsistens løses ved konstruktion, ikke ved prompt.**
   Anbefalingen er **én** 3D-garment-asset pr. item (mulighed A), hvorfra
   front/side/back *afledes* ved rendering. Aldrig tre uafhængige
   AI-genereringer.

4. **Anbefalet teknologi:** `three.js` (vanilla, MIT) + `glTF/GLB` (Draco +
   KTX2) i den eksisterende Astro/`vanilla TS`-arkitektur — **ingen**
   React/framework-islands (det ville bryde den dokumenterede beslutning i
   `analysis/DRESSED-ASTRO-ARCHITECTURE-ANALYSIS.md` §2, som bevidst afviste
   UI-frameworks). Babylon.js er et gyldigt alternativ, `<model-viewer>` er for
   begrænset, og Ready Player Me er **ikke** en mulighed (offentlig platform
   lukket jan. 2026 — UNVERIFIED i denne sammenhæng, bekræftet af flere
   uafhængige kilder under researchen; skal genverificeres før eventuel brug).

5. **Den største arkitektoniske gevinst er, at DRESSED allerede har ÉN fast
   geometri pr. base type.** `character-job.ts` tvinger alle brugere til master
   formens geometri ("IMAGE 2 ALWAYS WIN"; kun ansigt/hår/hudfarve er brugerens).
   Det betyder **én krops-mesh pr. base type, ét anchorsæt, tøj der passer alle
   brugere af samme type** — og gør voksen/teen/barn og hårsystem til
   *sammensatte* problemer med samme skelet/anchor-sprog, ikke tre separate
   systemer.

6. **AI-brug minimeres til tre punkter:** (a) identitet/hoved, (b) garment-asset,
   (c) evt. final try-on-billede. Rotation, scaling, placering, genbrug og
   multi-view-afledning er **aldrig** AI. Cross-user-genbrug indføres via
   **content-hash-identitet**, så "User B genererer samme skjorte igen" kan
   undgås.

7. **Backward compatibility er mulig uden data-konvertering:** legacy
   `{anchor,x,y,scale[,scaleX,scaleY]}` forbliver gyldigt og læses af en
   **2D-kompatibilitetslayer**; 3D-placement tilføjes **additivt** som ny,
   versionsnøglet struktur. Ingen eksisterende wardrobe-items, outfits eller
   X/Y-scaling røres.

8. **Risikoen er højest tre steder:** mobile 3D-performance, AI-konsistens ved
   garment-generation, og kompleksiteten i `wardrobe.astro` (1.486 linjer
   monolit, allerede kritiseret i `DRESSED-ASTRO-ARCHITECTURE-ANALYSIS.md` §1).

**Hovedanbefaling:** byg 3D som et **additivt, feature-flagget parallelt
renderer-spor** oven på den nuværende 2D-arkitektur, startende med et isoleret
PoC, og med datamodellen (node-baseret `placement3d` + asset-hash) besluttet
**før** første 3D-clothing-asset.

## Existing Project State

### Stack og afhængigheder (CONFIRMED — `package.json`)

```text
astro ^7.3.5 · @astrojs/netlify ^8.2.6 · @supabase/supabase-js ^2.117.2 · pngjs ^7.0.0
Scripts: dev / build / preview / astro   → INGEN test-script
Ingen frontend-framework. Ingen three.js/babylon/model-viewer. Ingen openai-pakke
(OpenAI kaldes via fetch i src/lib/server/ai/openai-images.ts).
```

> **DOKUMENTATIONS-AFVIGELSE (noteret, IKKE rettet):**
> `docs/DRESSED-CODEBASE-OVERVIEW.md` beskriver `package.json` med `openai` og
> `zod`, og dokument-inventaret nævner "7 .md" og "14 migrations". Faktisk:
> **15 .md-filer** i `analysis/` før denne, **16 migrations**, og
> `openai`/`zod` findes ikke i `package.json`. Alderstegn på docs — ikke en fejl
> i denne analyse, men en opgave til næste dokumentationsrunde (Rule 19).

### AI-pipeline (CONFIRMED)

| Led | Fakta |
|---|---|
| Image-model | `gpt-image-2.5-sunburst` via `POST /v1/images/edits` (`openai-images.ts:14`), `quality:"high"`, `output_format:"png"` |
| Moderation | `omni-moderation-latest` først (`openai-images.ts:13`) |
| Canvas | **altid** `1024x1536` + PNG-dim-tjek (character, clothing, dress-model, base forms) |
| Master forms | `src/assets/system-reference/base-forms/{woman,man}.png` 1024×1536; Supabase-kopi i `dressed_base_forms` (gate "must be exactly 1024×1536") |
| Character | `character-job.ts:20-53` — image1 = brugerens foto (**IDENTITY ONLY**), image2 = canonical base form (**GEOMETRY MASTER**, "IMAGE 2 ALWAYS WIN"), hvid baggrund, "playful 1990s/Clueless-inspired fashion illustration style", "clean digital fashion character illustration, not a photograph", neutral base-bebeklædning, håret holdt væk fra tøj-områder |
| Clothing | `clothing-job.ts:72-116` — image1 = canonical base form (geometry), image2 = brugerens tøjfoto (design), output = transparent 1024×1536 lag med α-/hjørne-validering |
| Try-on | `dress-model.ts` (OpenAI, 1–5 items, cache på `outfit_key`) og `try-on.ts` (FASHN VTON 1.5 på HF Space, `fashn-space.ts`) |
| Job-model | Netlify background functions (`netlify/functions/{personal-model,process-clothing}-background.mts`), kvote-reservation → job → `finish_*_server` |

**Vigtigt for denne analyse:** begge try-on-endpoints (`/api/ai/dress-model`,
`/api/ai/try-on`) findes server-side, men **ingen klient kalder dem i dag**
(grep over `src/` = 0 referencer). De er skjult kapacitet, ikke produceret
funktionalitet.

### Kvote / omkostningskontrol (CONFIRMED — repo + `DRESSED-LIVE-DATABASE-INSPECTION.md` §D)

```text
LIVE: character=3, clothing=5, tryon=1   (repo-migration 0015 siger 1/3/1 → LIVE ≠ REPO = F6)
Override: 1 række clothing_free_limit=100 (testbruger)
Mekanisme: reserve_ai_generation / finish_*_server (service-role), in_progress-lås,
           5-minutters stale-vindue, refund ved fejl
```

### Storage (CONFIRMED — live + kode)

```text
Buckets: model-images (private), profile-images (private, findes KUN live — F4)
Adgang: kun signerede URLs (5 min preview, 60 min AI-resultater) eller service-rolle
Stier: {userId}/clothing/{characterId}/*.png, {userId}/personal-model-*.png,
       {userId}/wardrobe-results/*.png, {userId}/try-on-*.png
```

### Data (CONFIRMED)

- `wardrobe_items.placement` = **nullable JSONB**, enten `{anchor,x,y,scale}`
  eller `{anchor,x,y,scale,scaleX,scaleY}` (migration `202610060002`), 15 anchors,
  x/y ∈ [−60,60], scale/scaleX/scaleY ∈ [0.4,2.0], **præcis nøglesæt** (ukendte
  nøgler afvises), `scaleX`/`scaleY` **begge eller ingen** (aldrig én alene).
- Live-indhold: **3 af 9** items har non-null placement, 6 er `null` (default-adfærd).
  Eks.: `{"x":0,"y":-4.2106,"scale":0.63,"anchor":"torso"}`.
- `saved_dressed_outfits.item_ids` = **`text[]`** — kun id'er, **aldrig placement**.
- `wardrobe_item_ai_assets` PK `(user_id, item_id, base_type)`,
  `generation_version = 3` (`CURRENT_CLOTHING_ASSET_VERSION`), geometri-kontrakt
  `"normalized-v1"` (`clothing-geometry.ts`).
- `wardrobe_results`-cache: `(user_id, character_id, outfit_key)` → samme outfit
  genereres kun én gang pr. bruger pr. character (mønster allerede i drift).
- Live mængder: 3 profiles · 9 wardrobe_items · 3 outfits · 4 characters ·
  **0 wardrobe_results** · 7 usage-rækker.

### UI / interaktion (CONFIRMED)

```text
Modellen er ét <img> (dressed-character-base) + N <img>-lag (dressed-clothing-layer)
i samme absolute inset:0-boks (aspect-ratio 2/3, maks 493 → 413 → 333 px).
Layer order = z-index fra selectedItems via clothingLayerOrder (stable sort).
Events: ÉN delegeret pointer-model på #wardrobe-model
        · TAP  = select   (TAP_SLOP_PX = 8 px, commit på pointerup)
        · DRAG = x/y      (kun på --editing-lag, lokal touch-action:none)
        · PINCH = placement.scale (2 pointers der startede på laget)
        · WHEEL = placement.scale ved venstre-klik-hold (WHEEL_SCALE_RATE 0.0005)
Ingen canvas-zoom, ingen pan, ingen transform på selve canvaset (BEKRÆFTET i
Wheel-Pinch-analysen §9 og gældende stadig).
```

---

## Previous Analysis Review

15 analyser + 3 docs + 3 historiske `.txt`-filer blev gennemlæst før denne.
`analysis/` behandles som **historik og grundlag** — ingen tidligere fil er
ændret eller overskrevet.

### 1. Hvad de eksisterende analyser konkluderede

| Dokument | Kernekonklusion | Anbefaling | Status nu |
|---|---|---|---|
| `BestFitAnalyse.md` (+ `-Woman`, `-Man`) | Masterformer = geometry authority; effektiv scale var `0.56` (indført i `d973d1b` uden afledning); anchors **skal** være base-type-specifikke; mandlige assets mangler | Fase 1: fjern `0.56`; mål assets; skaf male-assets | **Delvist implementeret:** `0.56` er væk (`wardrobe.css:651` = `var(--dressed-clothing-scale, 1)`, `profile.css:619` = `1`) og `transform-origin` er dermed igen meningsfuld. Male-fit stadig **UNVERIFIED** |
| `ClothingPlacement-Implementation-Analysis.md` | Præcis 2 CSS-linjer ændret; transform-kæde dokumenteret; ingen DB/storage/prompt ændret | Observer Fase 1 alene før Fase 2 | **Implementeret** (se ovenfor); efterfølgende udvidet med overrides + persistence |
| `Wheel-Pinch-Placement-Scale-Analysis.md` | Slider + wheel + pinch = **ét** scale-system (`placement.scale`, clamp 0.4–2.0); ingen canvas-zoom | Fysisk test; evt. hint i UI; kør touch-suitten ved ændringer | **Implementeret + automatiseret testet**; persistence live-verificeret; wheel/pinch **ikke live-accepteret** |
| `DRESSED-CURRENT-STATUS.md` | Officiel statusliste + doc-inventory | Commit/backup, flyt tests ind i repoet, live-accept af wheel/pinch | Milepælen er siden overhalet: X/Y-scaling er nu commit't (`b5b6610`, `e77b86b`) og mergent |
| `DRESSED-ASTRO-ARCHITECTURE-ANALYSIS.md` | Behold Astro + vanilla TS; **afvis UI-framework**; bryd `wardrobe.astro`-monolitten op i `lib/client`-moduler | Tynde sider, small client-moduler, én renderkanal | **Ikke implementeret** — `wardrobe.astro` er stadig1.486 linjer. **Direkte relevant for 3D:** beslutningen "intet framework" gælder også for React Three Fiber |
| `DRESSED-SQL-MIGRATIONS-ANALYSIS.md` | F1–F9 (placement-CHECK `'text'` vs `'string'`, 42702, RLS-vs-NULL, F4 objekter uden for VC, ikke-idempotente migrations, limits-drift, duplikater, ingen indexes, manglende FK) | Corrective migrations, bring `profiles` ind i VC, read-only pg_constraint-tjek | **Delvist løst:** F1 rettet i `0003`; F6 dokumenteret live. **F2–F5, F7–F9 står stadig** og vil påvirke enhver ny 3D-migration |
| `DRESSED-AUTH-SQL-ARCHITECTURE-ANALYSIS.md` | Alt brugerindhold privat (RLS ejer); delt = kun `ai_generation_limits` + base forms; **§16: nye features skal tilføje nye policies, aldrig erstatte** | — | **Gældende.** Direkte relevant for delte 3D-assets (se §Database/§Storage) |
| `DRESSED-LIVE-DATABASE-INSPECTION.md` | 11 tabeller live = repo; limits (3,5,1) ≠ repo (1,3,1); 2 private buckets; placement live-bevist; `profiles` rigere end VC (F4) | Bring live-schema i VC | **Gældende og autoritativ for live-tilstanden** |
| `DRESSED-MODEL-GENERATION-{DEBUG-01,DEBUG-02,REGRESSION-ANALYSIS,FIX}.md` | Root cause: `finish_ai_generation_server` returnerede `void` → `data === true` altid false → hængende `in_progress` → 16-min timeout | Ny migration + rettet returtype | **Implementeret og live-verificeret** (`DRESSED-MODEL-GENERATION-FIX.md` §6–10) |
| `Phase2-Woman-Tshirt-Test.md` | Målt fit af ét asset mod masterens landmarks | Regenerer og mål | **Historisk engangstest** — metoden er genbrugelig til 3D-fit-verifikation |

### 2. Hvad der siden er implementeret (og dermed *ikke* længere kun er en anbefaling)

1. **Fase 1 compositing:** `0.56` → `1` i begge CSS-filer (transform er ikke
   længere en identitet ved ægte skalaer).
2. **Placement persistence:** `wardrobe_items.placement` + `resolveItemPlacement`
   (session → persisted → default) brugt af **både** DRESSED og Profile.
3. **Wheel + pinch + slider** som ét scale-system.
4. **Tap-to-select** (8 px slop) oven på drag.
5. **X/Y free scaling:** `scaleX`/`scaleY` i `clothing-placement.ts`
   (`effectiveScaleX/Y`, `PLACEMENT_KEYS_FREE`), UI-toggle "FREE" med
   WIDTH/HEIGHT-sliders i `wardrobe.astro`, CSS `scale(var(--clothing-scale-x),
   var(--clothing-scale-y))`, og migration **`202610060002_placement_free_scale.sql`**
   (additiv: ændrer KUN CHECK'en; legacy 4-nøgle-rækker forbliver gyldige uden
   backfill). Commits `b5b6610` (kode+SQL) og `e77b86b` (HEAD).
6. **Model-generation-fix** (background job + RPC-returtype).
7. **AI-ready-versionering:** `generationVersion = 3` som hardt UI-krav.

### 3. Hvad der er forældet / ikke længere aktuelt

- Alle påstande om `openai`/`zod` i `package.json`, "7 analyse-filer",
  "14 migrations" — **talene er forkerte i dag**.
- `ClothingPlacement-Implementation-Analysis.md`'s "identity-transform-era"
  (markeret delvist forældet i statusfilen — korrekt: overrides/persistence kom efter).
- Enhver antagelse om, at placement kun har 4 nøgler — **`scaleX/scaleY` er nu
  en del af kontrakten** og skal tages med i alt fremtidigt placementsdesign.
- `BestFitAnalyse`'s "regeneration er blokeret" (stadig gældende for v3) — men
  enhver ny asset-version (3D) arver samme cache-/version-logik og skal
  derfor designes bevidst omkring `force regeneration`.

### 4. Hvad INGEN tidligere analyse dækker

Søgning efter `three.js|webgl|glb|gltf|vrm|3d model|z-axis|rotat|babylon|avatar`
i `analysis/`, `docs/` og `*.txt` gav **én** træffere (en uvæsentlig
"avatar"-note i codebase-overview). **Der findes altså ingen historisk
3D-beslutning, der kan forpligte eller modsige denne analyse** — men der findes
en stærk **ikke-3D**-beslutning: Rule 12 (koordinatsystem), Rule 13 (browseren er
final authority), Rule 14 (ingen skjulte faktorer) og Rule 2 (bevar eksisterende
arkitektur) i `docs/DRESSED-PROJECT-SPECIFICATION.md`.

---

## Current Architecture

Dette afsnit er den faktiske nuværende state **efter** X/Y-scaling — ikke
arkitekturen fra før `b5b6610`.

### 1. Renderingskæden (CONFIRMED)

```text
wardrobe_items (item = identitet; outfit = kun item_ids)
   ↓  GET /api/wardrobe/items  (signerede URLs, placement-kolonne med fallback)
WardrobeItem { id, category, aiReadyAssets[baseType], placement }
   ↓  resolveItemPlacement({category, persistedPlacement, sessionOverride})
      session override → persisted → clothingPlacement(category) default
   ↓  dressedAnchor(anchor, baseType)   ← 15 anchors; MAN_ANCHOR_Y-undtagelser
CSS-variabler pr. lag (applyLayerPlacement / profile-outfits.renderLayers):
   --anchor-x/y · --clothing-scale · --clothing-scale-x/y · --clothing-x/y
   ↓
transform: translate(--clothing-x, --clothing-y)
           scale(base × scaleX, base × scaleY)     base = --dressed-clothing-scale (1)
transform-origin: (anchor-x × 100%) (anchor-y × 100%)
   ↓
DOM: .dressed-canvas (aspect 2/3) > img.dressed-character-base (z 0)
                              > .dressed-clothing-layers > N img.dressed-clothing-layer
                                 z-index = lagnummer fra selectedItems
```

**Samme matematik i Profile** (`profile-outfits.ts:42-55`,
`profile.css:611-627`) — én delt resolver, to renderere, identisk kontrakten.
Dette er et bevidst arkitektur-træk og **skal bevares** (spec §2.6, punkt 3).

### 2. Koordinatsystemet (CONFIRMED)

| Egenskab | Værdi |
|---|---|
| Canvas | 2:3, `absolute inset:0` for både base-billede og lag ⇒ **ét fælles boks-koordinatsystem** |
| Placering | `%` af containeren (aldrig px) — `placement.x/y` er **procent af canvas**, ikke af billedet |
| Skala | dimensionløs faktor; `scaleX`/`scaleY` uafhængige (0.4–2.0) |
| Origin | anchor i canvas-**brøker** (0–1), base-type-specifik (`dressedAnchor`) |
| Dybde | **findes ikke** — udtrykkes kun som `z-index` (lag-rækkefølge) |
| Rotation | **findes ikke** — lagene er front-plane billboards |

### 3. Placement-kontrakten efter `202610060002` (CONFIRMED)

```text
LEGACY : {anchor, x, y, scale}                    → stadig valid, ingen backfill
FREE   : {anchor, x, y, scale, scaleX, scaleY}    → begge akser sammen, aldrig én
REJECT : ukendte nøgler, én akse alene, kendte anchors uden for de 15,
         x/y uden for ±60, scale* uden for 0.4–2.0
VALIDERING3 steder: parsePlacement (client + PATCH) · sanitizePlacement (read)
         · SQL CHECK (do-delt, samme validering i alle tre led)
```

`effectiveScaleX = scaleX ?? scale` ⇒ **legacy-rækker renderer identisk med før**
(uden break). Dette mønster — "ny nøgle er altid valgfri med fallback til legacy" —
er præcis det, 3D skal gentage.

### 4. Event- og selectionsarkitektur (CONFIRMED, `wardrobe.astro`)

- Én `pointerdown`-håndterer på `#wardrobe-model` laver **altid** et
  tap-kandidat (`TAP_SLOP_PX = 8`) og begynder derefter pinch eller drag.
- `pointermove`: pinch-gren skriver **kun** `scale`; drag-gren skriver **kun**
  `x/y` (beregnet som % af lag-containerens rect).
- `wheel` (passive:false): kun når venstre-klik holdes OG cursoren er over det
  aktive lag; sætter `wheelScaleActive` så musejitter ikke flytter `x/y`.
- `endPlacementPointer` rydder drag/pinch/wheel og committer tap-valg —
  bevidst rækkefølge for at undgå re-entrancy.
- **Ét gestus ad gangen**, `touch-action: none` **kun** på redigeret lag og
  sliders (Rule 16).

### 5. Persistens (CONFIRMED)

`DONE` / ADJUST-lukning / `RESET` → `commitPlacementOverride` →
`parsePlacement` (runder til 4 decimaler) → `isSamePlacement`-skip →
`PATCH /api/wardrobe/items/[id]` (JWT + service-klient-UPDATE, kun
`placement` + `updated_at`) → session-værdi gen-sættes til den skrevne værdi.
Fejl = session beholdes + fejlmelding (editoren lukker ikke stille).

### 6. AI-genereringskæderne (CONFIRMED)

```text
MODEL : source photo → moderate → character-job (bg) → gpt-image-2.5-sunburst
        (foto=identity, base form=geometry) → storage model-images
        → publish_dressed_character → profiles.model_generation_status='completed'
CLOTH : item upload → (clean preview) → process-clothing → clothing-job (bg)
        (base form=geometry, foto=design) → transparent 1024×1536
        → wardrobe_item_ai_assets (user, item, base_type, v3)
OUTFIT: dress-model (OpenAI, op til 5 assets) → wardrobe_results (outfit_key-cache)
        try-on (FASHN) → {user}/try-on-*.png
```

### 7. Hvad 2D-arkitekturen **ikke** kan (målet for 3D)

1. Ingen rotation — tøj kan kun ses forfra (`BestFitAnalyse-Woman` måler netop
   front-fit).
2. Ingen ægte dybde — `z-index` er statisk lag-rækkefølge, ikke geometri;
   occlusion mellem arme og tøj kan ikke eksistere.
3. Side/back-udseende findes **overhovedet ikke** i data — kun front-PNG.
4. Krop og tøj er **flade billboards**: ved (hypotetisk) rotation ville lagene
   flade ud.
5. Hår, ansigt og krop er ét billede — kan ikke styles uafhængigt.

---

## 3D Technology Comparison

Alle eksterne forhold nedenfor er **UNVERIFIED** (kun research; ingen spike er
kørt). Licenser og priser skal genverificeres **før** eventuel implementering.

### A. Renderere / frameworks

| | **Three.js** | **Babylon.js** | **Native WebGL/WebGPU** | **`<model-viewer>`** | **React Three Fiber** |
|---|---|---|---|---|---|
| Browser support | WebGL2 bred + WebGPU-fallback | WebGL2 bred | Alt, men du skriver alt selv | WebGL2 | Samme som three |
| Astro-kompatibilitet | Direkte i `<script>`-modul (ingen framework-islands) | Direkte | Direkte | Direkte (custom element) | **Kræver React** — bryder Rule 2 og ASTRO-analysen §2 |
| TS | Fuld | Fuld | Fuld | Begrænset API | Fuld |
| Desktop perf | Meget god | Meget god | Bedst mulig, højest arbejde | God til enkel viewing | God |
| Mobile perf | God m. discipline (DPR-clamp, draco/ktx2, LOD) | God | God | God | God |
| Modelkvalitet | Hele glTF-spec'en inkl. skins/morphs | Samme | Samme | glTF uden avanceret kontrol | Samme som three |
| Rotation/animation | `OrbitControls`, skeletons, morph targets | Samme | Manuel | Begrænset | Samme |
| Clothing attachment | Skinning + scene-graph parenting | Samme | Manuel | Nej | Samme |
| Kompleksitet | Mellem (stort økosystem: drei-lignende hjælp findes, men vi bruger kerne) | Mellem-til-høj (stort API) | Meget høj | Lav | Høj (ny tech-stack) |
| Learning curve | Moderat (dokumentation fremragende) | Moderat | Høj | Lav | Høj + React |
| Licens | **MIT** | **Apache-2.0** | n/a | Apache-2.0 | MIT |
| Passer til DRESSED | **JA** | Ja (tungere vægt, samme muligheder) | Nej — for meget genopfundet hjul | Kun til statiske previews | **NEJ** — bryder bevidst arkitekturvalg |

**Værdi-måling:** DRESSED er `vanilla TS` + DOM. Det afgørende er, at place
det 3D-scene-graph **bag samme API-flade** som i dag:
`applyLayerPlacement()` skriver i dag CSS-variabler; i 3D skal samme funktion
skrive `mesh.position/rotation/scale`. Det er en **ren udskiftning af ét
renderingslag**, ikke af app-arkitekturen.

### B. Formater og modeller

| | Egenskaber | Vurdering for DRESSED |
|---|---|---|
| **glTF 2.0 / GLB** | Industri-standard; binaries; Draco/meshopt-kompression; KTX2 teksturer; skins + morph targets; three/babylon native | **Valgt format.** Én fil pr. asset, forudsigelig loading, standardværktøjer (Blender eksport) |
| **VRM (1.0)** | Humanoid-bone-konvention + hår-springbones; bygget oven på glTF; stærk i anime/stylized-verdenen | **Overvejes som skelet-standard** (især hårsystem), men er ikke nødvendigt: vi har brug for 15 faste anchors, ikke en fuld humanoid-spec. Licenstilknytning skal verificeres |
| **Ready Player Me** | Selfie→avatar, GLB-eksport | **Udelukket:** offentlig platform/API lukket 31.01.2026 efter Netflix-opkøb (flere kilder; UNVERIFIED, men konsistent). Genverificér aldrig ved at bygge på hosted RPM |
| **Avatar SDK (MetaPerson)** mm. | Komerciel selfie→avatar API, GLB/FBX | Muligt, men **lukket økosystem, løbende omkostning, ingen kontrol med stil** — passer ikke til "Clueless-illustration"-æstetikken |
| **Blender-genererede assets** | Manuel/automatiseret modelling + eksport | **Nødvendigt led** til den *kanoniske* krops-mesh og de første hårmeshes. Én gangs arbejde, ingen løbende AI-omkostning |
| **Parametriske mennesker (SMPL/STAR/GHUM-lignende)** | Videnskabelige kroppe med blend shapes; **SMPL kræver særskilt kommerciel licens** (gebyr — UNVERIFIED, licens-side findes) | Overkill + licens-risk for DRESSED. Vores geometri er i forvejen **fast** pr. base type |
| **AI image-to-3D** (Tripo, Meshy, Rodin, åbne som TRELLIS/Hunyuan3D-klasse) | Foto → mesh+tekstur på sekunder/minutter; kvalitet varierer; mennesker/hænder er svage; licenser varierer pr. udbyder | **Kandidat til garments og hoveder**, ikke til kroppen. Skal testes i spike m. licenstjek |
| **AI-genereret 3D-menneske (photo→full body)** | Som ovenfor: front-bias, dårlig ryg, ingen riggaranti | **Frarådes** til kroppen — se §Model Architecture |

### C. Klart svar

**Three.js (MIT) + glTF/GLB + Draco + KTX2, importeret som et almindeligt
Astro-script-modul, placeret bag den eksisterende placement-flade.**
Babylon.js er et acceptabelt alternativ, hvis spiket viser bedre out-of-box
tooling; valget mellem de to er **lav-risiko og reversible**, fordi begge taler
glTF. `<model-viewer>` bruges evt. kun til thumbnails, ikke til interaktion.
R3F afvises (framework). RPM/ lukkede avatar-tjenester afvises (leverandørrisiko).

---

## Z-Axis Architecture

> Dette er analysens kerne. Konklusionen er, at **"tilføj et z" er den forkerte
> model**, og at den rigtige model er en *arvet* (parented) transform med et
> normal-offset.

### 1. Hvorfor `x, y, z` er teknisk forkert i DRESSED

| # | Problem med "bare tilføj z" | Forklaring |
|---|---|---|
| Z1 | **x/y i dag er ikke kropskoordinater** | `placement.x/y` er `%` af **canvas-containeren** (viewport-lignende), anvendt *oven i* et anchor. Ved rotation af modellen vil et frit world-z **ikke** følge kroppen — tøjet ville svinge af |
| Z2 | **x/y er anvendt efter origin, ikke som ægte translation i rummet** | CSS `transform: translate(...) scale(...)` med `transform-origin` er en 2D-affin komposition. Den har ingen mening i 3D uden at definere, *i hvilket plan* offsetet ligger (tangentialt til legemet? i kamera-plan?) |
| Z3 | **Dybde er allerede brugt til noget andet** | I dag = `z-index` (lag-rækkefølge). I 3D skal rækkefølgen styres af *afstand til huden*, ikke af en tredje positionskoordinat |
| Z4 | **Kamera-rotation ≠ objekt-rotation** | Brugerens "rotation" bør være et kamera-orbit (eller en samlet model-rotation), aldrig en ændring af garderobens data. Data må være **kamera-uafhængige** |
| Z5 | **Occlusion kræver geometri, ikke tal** | En tal-baseret z kan ikke få en arm til at skjule en ærme. Det kræver, at både krop og tøj er meshes med z-buffer |

### 2. Den korrekte model: node-baseret placement (INFERRED fra ovenstående, testbar)

DRESSED har allerede det rigtige begreb — **anchoret**. En anchor er i praksis
et *attachment point*. I 3D bliver den til en **node** (scene-graph bone/pivot):

```text
placement3d = {
  version : 1,
  node    : "torso" | "shoulders" | ... (samme 15 navne som i dag),
  position: [u, v, w],      // LOKAL i nodens frame; u/v = tangent, w = normal-offset
  rotation: [rx, ry, rz],   // grader, lokalt (typisk 0 for de fleste items)
  scale   : [sx, sy, sz],   // fri skala pr. akse (arver scaleX/scaleY-ideen)
  shell   : 0.000…0.050     // eksplicit lag-tykkelse fra huden (den "ægte z")
}
```

**Fire koordinatsystemer, bevidst adskilt (Rule 12/13 bevares):**

```text
ASSET LOCAL   →  garmentets eget centrum (uv, geometri)
NODE LOCAL    →  pladsen på kroppen (anchor) — HER gemmes placement3d
MODEL WORLD   →  nodens forældre-transform (rotation af hele figuren) arves automatisk
CAMERA        →  orbit/front-side-back presets — gemmes ALDRIG i data
```

**Det afgørende punkt:** fordi placement gemmes i **nodens lokale frame**, vil
modellens rotation automatisk bære tøjet med sig. Det er præcis det, `z-index`
aldrig kunne: **forældreskab er erstatningen for en tredje akse.**

### 3. Hvad "z" så reelt betyder i DRESSED

`w` (normal-offset / `shell`) bruges til:

1. **Lag-orden:** `shell(underben) < shell(buks) < shell(top) < shell(jakke)
   < shell(accessory)` — en direkte 3D-oversættelse af `clothingLayerOrder`
   (`clothing-categories.ts:51-74`), så den nuværende z-index-semantik **bevares**
   som et tal, der også kan clamps.
2. **Z-fighting/occlusion:** nok offset til, at tøjet altid ligger uden på huden,
   men ikke så meget, at lagene "svæver".
3. **Fit-variationer:** en stram vs. løs skjorte = forskellig shell, ikke
   forskellig skala.

Det er **ikke** en fri, brugerjusterbar verdens-z. Brugerens eksisterende
følelse af "bevægelse" (drag) oversættes til **u/v i nodens tangentplan** —
som er den samme følelse som i dag.

### 4. Eksisterende data → 3D (migrations-matematikken)

Lad `(ax, ay)` være den anchor-brøk, som `dressedAnchor(anchor, baseType)` giver,
og lad modellen i verdensrummet fylde `H` enheder i højden og `H×(1024/1536)` i
bredden på canvaset (2:3). Så er det **en deterministisk, ikke-AI konvertering**:

```text
node   = placement.anchor                          (1:1 — alle 15 anchors findes i begge verdener)
u      = (placement.x / 100) × canvasWidthWorld    (x er % af canvas)
v      = −(placement.y / 100) × canvasHeightWorld  (CSS-y peger nedad; verdens-y opad)
w      = shell default for kategorien              (ny værdi — ingen legacy-information tabes)
scale  = [effectiveScaleX, effectiveScaleY, effectiveScaleX]   (bevarer X/Y-scaling)
rotation = [0,0,0]                                 (legacy er front-only)
```

**Vigtigt:** legacy-items er *defineret* som front-only. At give dem
`rotation = 0` er **korrekt**, ikke en kompromis — og de skal derfor renderes
som et front-plane lag (2D-kompatibilitetslayer) indtil brugeren åbner dem i
3D-editoren. Konverteringen er **lazy/demand-drevet**, aldrig et batch-backfill.

### 5. Depth sorting, occlusion og front/back-synlighed

| Emne | 2D i dag | 3D-løsning |
|---|---|---|
| Lag-rækkefølge | `z-index` fra `selectedItems` | z-buffer + `shell`-sortering; samme `clothingLayerOrder`-tal som sort-nøgle ved uklarhed |
| Gennemsigtighed | naturlig (PNG α) | glTF `alphaMode: BLEND` ⇒ **sorter transparente pass** efter kamera-afstand (three.js gør dette; bevidst rydde-dybde foran) |
| Occlusion | umulig | z-buffer; arm foran ærme virker automatisk |
| Ryg/side | umulig | geometri findes; derfor **ingen manuel side/back-logik** |
| Tværgående fejl | — | `depthWrite:false` på meget tynde/transparente lag (hår, net) for at undgå artefakter — skal fastsættes pr. asset-type i spike |

### 6. Hvad der bevarer uændret (Rule 1/2/10–14)

- Hele `placement`-JSONB forbliver uændret og gyldigt (CHECK'en i
  `202610060002` røres **ikke**).
- `resolveItemPlacement`-prioriteten (session → persisted → default) genbruges
  uændret; der udvides bare med et `resolveItemPlacement3d`-led **efter** persisted.
- Profile og DRESSED bruger fortsat **én delt resolver**.
- Browseren forbliver final authority: 3D-renderen sker lokalt i klienten, serveren
  gemmer kun tal (Rule 13).
- Ingen skjulte faktorer: én `scale`-kæde, én `shell`-kæde (Rule 14).

---

## Model Architecture

### 1. Den afgørende observation (CONFIRMED fra `character-job.ts`)

DRESSED genererer i dag **ikke** brugerens krop. Karakteren tvinges til master
formens geometri ("MASTER GEOMETRY IS A HARD CONSTRAINT … IMAGE 2 ALWAYS WIN"),
og kun **ansigt, frisure, hårfarve og hudfarve** transplanteres fra brugerens
foto. Hertil kommer, at prompten allerede tvinger:

- hvid baggrund, ingen skygger, ingen rekvisitter,
- neutral base-beklædning (sleeveless top + kort underdel, ingen sko),
- håret holdt bag skuldrene, **så tøj-området er frit**,
- "illustration, not a photograph".

**Konsekvens:** geometri-identitet er allerede opnået på 2D. I 3D betyder det:

```text
ÉN kanonisk body-mesh pr. base type   (woman / man)  ← som master forms i dag
+ per-user identitet: ansigtstekstur / hoved-mesh    ← brugerens egen generation
+ per-user frisure (se Hair-afsnittet)                ← separat asset
= perfekt clothing-fit for alle brugere af samme type, uden per-user fitting
```

Det er den egentlige gevinst ved 3D for DRESSED: **tøjet passes til modellen én
gang — ikke én gang pr. bruger** (i modsætning til klassiske try-on-systemer).

### 2. Optioner (identity, kvalitet, kontrol, fit, rotation, konsistens, omkostning)

| | A: AI genererer den færdige 3D-model | B: AI reference-billeder → 3D bygges | C: Standard 3D-krop + AI-ansigt | D: Hybrid (anbefales) |
|---|---|---|---|---|
| Identity preservation | Svagt (photo→3D taber typisk ansigt/ryg; UNVERIFIED, generel erfaring) | God — mennesker bevarer den | God for ansigt; krop er "gal" (men gal er *lige præcis* det vi vil have: master formens krop) | **Bedst:** identitet, hvor den betyder noget (hoved); geometri, hvor den betyder noget (krop = master) |
| Visuel kvalitet | Variabel, svær at rette | Høj, men manuelt dyrt | Høj og kontrollerbar | Høj og kontrollerbar |
| Kontrollabilitet | Lav (black box) | Høj | Høj | Høj |
| Clothing compatibility | Ukendt fit, intet skeleton | God hvis rigges manuelt | **God** — ét skeleton, tøj bundet til det | God |
| Rotation | Svag på ryg/side | God | God | God |
| Konsistens bruger↔bruger | Svag | God | God | **Perfekt** (fælles krop) |
| Omkostning | Høj AI + rettelser | Høj (manuelt) + lav AI | Lav AI, engangs-arbejde | **Lav løbende, ét engangs-arbejde** |
| Anbefaling | Nej | Kun som reference til hoved | Basis | **JA** |

### 3. Anbefalet modelarkitektur (D — hybrid)

```text
BODY     : én stylized, low-poly body-mesh pr. base type (Blender, ét engangsarbejde),
           skinned til et skelet med de EKSISTERENDE 15 anchors som knudepunkter
HEAD     : separat head-mesh (samme skeleton); ansigtstekstur fra brugerens
           eksisterende 2D-character (projicering) ELLER AI image→3D-head (senere fase)
FACE     : tekstur (albedo) — bevarer identitet; 1990s/Clueless-illustration-shading
HAIR     : separat asset bundet til head-node (se Bald Master + Hair)
SKINNING : tøj = skinned meshes med samme skeleton ⇒ følger kroppen ved rotation
SHADING  : toon/gradient-matcap + ink-outline — skal matche den nuværende
           illustration-stil ellers brydes visual identity (se Visual Identity)
```

**Hvorfor ikke photoreal?** DRESSEDs produkt-løfte er en *illustreret*
Clueless-model. En fotorealistisk 3D-krop ville gøre de AI-genererede 2D-ansigter
inkompatible (en ansigtstekstur tegnet til en flad illustration passer dårligt på
PBR-hud) og få appen til at ligne en generisk avatar-app.

---

## Clothing Multi-View Architecture

### 1. De seks muligheder (A–F) vurderet

| | **A:** Én 3D-mesh + tekstur | **B:** Front/side/back-teksturer | **C:** AI multi-view billeder | **D:** AI-genereret 3D-tøj | **E:** Ren 2.5D (billboards) | **F:** Hybrid (A + fallback) |
|---|---|---|---|---|---|---|
| Kvalitet | God–meget god | Mellem (holder ikke i profil) | God forfra, uklar ved skift | Variabel (folder, tykkelse, self-intersection) | Som i dag | Som A, med E som fallback |
| Realisme | Høj | Lav | Medium | Medium–høj | Lav | Høj hvor A findes |
| AI-omkostning | 1 pr. item | 2–3 pr. item | 1–3 pr. item | 1 pr. item | 0 (i dag) | 1 pr. item |
| Genereringstid | Sekunder–minutter | Hurtigt | Hurtigt | Sekunder–minutter | 0 | Som A |
| Storage | ~0,3–3 MB/GLB + tekstur | ~3 PNG'er | 3 PNG'er | ~0,5–5 MB | 1 PNG | Som A |
| Implementerings-kompleksitet | Mellem (fit, skinning) | Lav | Lav | Mellem (import-kvalitet) | **Lavest** | Mellem |
| Browser-perf | God (ét draw-call pr. item) | God | God | God | Bedst | God |
| **Konsistens mellem views** | **Perfekt ved konstruktion** | God (én fil) | **Dårlig — hovedrisiko** | Perfekt ved konstruktion | Perfekt (1 billede) | Perfekt ved konstruktion |
| Rotation | Fuld | Falsk (flade) | Falsk (skift af stilling) | Fuld | Falsk | Fuld |
| Fit på forskellige kroppe | God (skinning + skala) | Som i dag | Som i dag | God | Som i dag | God |
| Passer DRESSED | **Målet** | Kun 2.5D | Nej som primær | Ja som pipeline-led | Kun transitional | **JA — anbefaling** |

### 2. Konsistens: hvordan front, side og back viser DET SAMME tøj

> **Konsistens opnås aldrig ved at bede en model om tre billeder. Den opnås ved
> at have én kilde og aflede alle vinkler fra den.**

Konkrete mekanismer (i anbefalet rækkefølge):

1. **Én kilde = ét asset.** Generér **én** 3D-garment (mulighed A/D). Front,
   side og back er *renders* af samme mesh — **konsistens ved konstruktion, 100 %**.
2. **Hvis 2D-billeder alligevel kræves** (overgangsperiode/2.5D): brug **én**
   multi-view-generering, hvor alle vinkler frembringes i **ét** kald med samme
   konditionering (referencefoto + dedikeret multi-view-metode) — aldrig tre
   separate kald med samme prompt. Uafhængige kald giver tre forskellige
   skjorter (INFERRED, men robust kendt fænomen).
3. **Automatisk accept/reject FØR lagring.** `BestFitAnalyse` §8.4 dokumenterede,
   at systemet i dag **slet intet accept/reject-trin har** — det skal 3D-versionen
   have:
   - **Farve/palette-lighed** mellem kilde og hver afledt vinkel (ΔE på
     dominerende farver) — fanger "forkert skjorte".
   - **Logo/mønster-kontrol** via feature-match på forudsigelige regioner
     (zscore-tærskel) — fanger redesign.
   - **Silhuet/pasform-boks pr. kategori** — videreførelse af metoden fra
     `Phase2-Woman-Tshirt-Test` (landmarks frem for pixelmål).
   - **Fail-closed:** ved tvivl → afvis, brug 2D-fallback, vis "NOT 3D-READY".
4. **Asset-identitet/versionering:** alle afledte artefakter (vinkler,
   thumbnails, LOD) peger på **samme `asset_id` + `asset_hash`**, så ældre og
   nyere sæt aldrig kan blandes (se §AI Cost and Asset Reuse).
5. **Prompt-disciplin, hvor AI stadig bruges:** beskriv **kun** designet
   (farve, materiale, mønster, snit, længde), aldrig vinklen; brug det samme
   referencefoto som *design authority* for alle vinkler — i tråd med
   `BestFitAnalyse` §13: *original reference = design authority, canonical form =
   geometry authority, browser = final placement authority*.

**Konklusion:** **A med F som fallback.** Når genereringen fejler, eller
kategorien ikke kan 3D-modelleres (net, pels, meget komplekse detaljer), falder
item'et tilbage til den **nuværende v3-front-PNG som billboard**, som kun kan ses
forfra — tydeligt markeret i UI.

---

## AI Clothing Pipeline

> **Princip:** AI bruges kun, hvor den er uundværlig. Alt, hvad en CPU kan gøre
> (rotere, skalere, aflede vinkler, cache, genbruge), er **ikke** AI.

```text
USER UPLOADS CLOTHING                 [ingen AI — storage + mimetype-tjek]
        ↓
NORMALISERING + CLEAN PREVIEW          [AI, én gang — allerede i drift: items/index.ts]
        ↓
CONTENT-HASH (sha256 + perceptual hash)[INGEN AI — nye data, gratis]
        ↓
HIT I SHARED ASSET LIBRARY?           [INGEN AI]
   JA → genbrug eksisterende asset    (ingen omkostning, 0 sekunder)
   NEJ ↓
CLOTHING UNDERSTANDING                [AI, billigt/detektivt: kategori, erme-længde,
                                        halsudskæring, materiale-tagger — KAN udelades
                                        hvis kategori+navn er nok (som i dag)]
        ↓
3D GARMENT GENERATION                 [AI — det eneste store kald: foto → mesh+tekstur
                                        på canonical body geometry]
        ↓
VALIDERING / ACCEPT-REJECT            [INGEN AI — farve/logo/silhuet-måling]
   FAIL → 2D-fallback (v3 billboard), item markeres "NOT 3D-READY"
   OK ↓
FRONT / SIDE / BACK                   [INGEN AI — renders fra samme mesh]
        ↓
STORE ASSET (GLB + tekstur + renders) [ingen AI — Supabase Storage, hash-nøglet]
        ↓
DRESSED WARDROBE (item → asset-link)  [ingen AI — DB]
        ↓
ATTACH TO MODEL (node + placement3d)  [ingen AI — deterministisk matematik]
        ↓
ROTATE MODEL / EDIT PLACEMENT         [ingen AI — ren client rendering]
        ↓
(optional) FINAL LOOK IMAGE           [AI, én gang pr. outfit — allerede findes:
                                        dress-model + outfit_key-cache]
```

### Hvor AI **skal** bruges

1. **Identitet** (ansigt/hoved) — én gang pr. bruger pr. generation.
2. **Garment-asset** (foto → 3D) — én gang pr. *unikt* item (hash-gated).
3. **Evt. final look-billede** — én gang pr. (bruger, outfit, character) via den
   eksisterende `outfit_key`-cache.

### Hvor AI **ikke** må bruges

- Rotation, kamera, front/side/back-afledning, thumbnails, LOD.
- Placering/placement-matematik (deterministisk; Rule 13/14).
- Regenerering af identiske items (hash-cache).
- Regenerering ved skift af bruger, kropstørrelse eller UI — geometrien er
  uafhængig af brugeren (se Model Architecture).
- Runtime i browseren overhovedet.

### Pipeline-ændringer i forhold til i dag

| I dag (CONFIRMED) | Forslag |
|---|---|
| `wardrobe_item_ai_assets` pr. `(user, item, base_type)`, v3 | Udvides med **3D-asset-version** (f.eks. `asset_kind = layer2d` eller `mesh3d`) så 2D og 3D kan leve side om side |
| Generation pr. bruger, ingen deling | **Hash-gate først**: `asset_fingerprints` → fælles bibliotek |
| Cache blokeres af `generationVersion` (`BestFitAnalyse` §8.5) | Behold version-logik, men tilføj **eksplícit force-generation**-sti til test/3D-migration |
| Ingen accept/reject | Indsæt valideringstrin (ovenfor) |
| Kø via Netlify background functions + kvote-RPC | **Genbrug samme mønster** — ny `generation_type` ('cloth3d') eller udvidelse af 'clothing' (afhænger af godkendelse) |

---

## AI Cost and Asset Reuse

### 1. Status i dag (CONFIRMED)

- **Alt er pr. bruger.** Sti-mønsteret `{userId}/clothing/{characterId}/*.png` og
  PK'en `(user_id, item_id, base_type)` betyder, at **tre brugere med samme
  skjorte genererer tre kopier** — præcis det mønster, analysen vil undgå.
- **Omkostningskontrol = kvoter, ikke priser.** Live: character 3, clothing 5,
  tryon 1 (+ 1 override på 100). Der findes **ingen økonomisk analyse af
  priser pr. generation** i repoet (kun kvote-logik) — priser skal indhentes
  separat (UNVERIFIED).
- **Eksisterende genbrugsmønster, allerede i drift:**
  1. `wardrobe_results.outfit_key` = sorteret item-id-liste ⇒ samme outfit
     genereres **én** gang pr. bruger pr. character.
  2. `wardrobe_item_ai_assets` cache-hit ⇒ samme item genereres ikke igen inden
     for samme version.
  3. Base forms deles af alle (læses fra `dressed_base_forms`, aldrig regenereres).

### 2. Hvad der skal genereres hvor mange gange

| Artefakt | Pr. | Begrundelse |
|---|---|---|
| Canonical body-mesh (kvinde, mand) | **Én gang totalt** | Geometri er kanonisk (master forms) |
| Skeleton/anchor-map, hårmeshes, UI-assets | **Én gang totalt** | Fælles |
| Base-form-billeder | **Én gang totalt** | Allerede sandt i dag |
| 3D garment-asset | **Én gang pr. unikt design** (hash) | Genbruges på tværs af brugere |
| Personligt hoved/ansigt | Pr. bruger | Identitet |
| Frisure | **Én gang pr. frisure-model** (fælles bibliotek) + valg pr. bruger | Ikke personligt indhold |
| Final look-billede | Pr. (bruger, outfit, character) | Allerede cached via `outfit_key` |
| Front/side/back-renders, thumbnails, LOD | **0 AI** | Afledt fra mesh |

### 3. Asset identity / hash-strategi (forslag — ingen SQL skrevet)

```text
STEP 1  sha256(normaliseret kilde-PNG)            → præcis-duplikat-nøgle
STEP 2  perceptuel hash (pHash/dHash, 64-bit)      → "lignende nok"-nøgle (Hamming ≤ t)
STEP 3  (valgfrit) design-descriptor: dominant colors + kategori + erme/hals-tags
        → AI-genereret ÉN GANG, gemt som metadata, genbruges som match-signatur

asset_fingerprints (KANDIDAT-TABEL):
  hash_sha256 (PK) · phash · category · descriptor jsonb ·
  canonical_asset_id · created_at

wardrobe_items (udvidelse, IKKE ændring):
  + fingerprint_sha256 (nullable)   ← linker brugerens item til det delte asset
```

**Match-regel:** præcis sha256 ⇒ altid genbrug. pHash-lighed ⇒ *foreslå*
genbrug ("This item already exists in DRESSED — reuse the generated asset?")
i stedet for tvungen deling.

**Privatliv/juridisk afgrænsning (vigtigt):** del kun **det genererede
garment-asset** (ingen persondata), aldrig brugerens kilde-foto. Fotografiet
bliver i brugerens private bucket. Det delte bibliotek indeholder kun
tøj-geometri/tekstur, som i forvejen er AI-normaliseret.

### 4. Hvad der gemmes hvor (cache-hierarki)

```text
Browser-cache   : signerede URLs (i dag 5/60 min) → overvej længere TTL for
                  fælles assets + localStorage-karakter-cache (findes: dressed-character.ts)
Supabase Storage: kanoniske assets (GLB/tekstur/render) — private, adgang via
                  signerede URLs eller ny shared-read policy (se Storage)
CDN             : Supabase Storage er CDN-foran; fælles assets cache-forgrener sig
                  naturligt pr. URL. Overvej versionerede filnavne (hash i navnet)
                  så ugyldigering sker ved navneskift, ikke ved purge
DB              : metadata, hash, version, placement — aldrig binære data
```

### 5. Omkostningsrisici

1. **Multi-view-metodevalg:** hvis en løsning kræver 3 AI-kald pr. item, tredobles
   udgiften — derfor er "én mesh, renders afledt" ikke kun en kvalitets-
   men også en **økonomisk** beslutning.
2. **Regenerering ved version-bump:** en `generationVersion` 4 vil, hvis UI'et
   kræver den som v3 gør i dag, **tvinge alle eksisterende items til ny
   generering**. 3D skal derfor introduceres som **valgfri supplement-version**,
   ikke som nyeste-krav, indtil brugeren selv beder om det.
3. **Quote-lock ved fejl:** `finish_*_server`-mønsteret (refund ved fejl) skal
   genbruges for den nye generationstype — den allerede dokumenterede
   `void`-returtype-fejl (MODEL-GENERATION-FIX) må **ikke** gentages.

---

## Bald Master + Hair System

### 1. Komponent-dekomposition (det fælles system)

```text
DRESSED MODEL (skeleton + nodes = de 15 anchors + knæ/ankler-undtagelser)
├── BODY      kanonisk mesh pr. base type          (fælles, én gang)
├── HEAD      separat mesh, bundet til head-node   (fælles form, per-user tekstur)
├── FACE      ansigtstekstur / -detaljer           (per-user, AI)
├── HAIR      separat asset bundet til head-node   (fælles bibliotek + per-user valg)
├── CLOTHING  skinned meshes bundet til nodes      (delt bibliotek, hash-genereret)
└── ACCESSORIES  små meshes pr. node               (hænder, øre, hals, hoved)
```

Alt styres af **én** transformkæde (placement3d) og **ét** skeleton — hår er
altså ikke et nyt system, men **endnu et barn af head-noden**.

### 2. Hvorfor en bald master er den rigtige beslutning (CONFIRMED behov)

Den nuværende character-prompt bekæmper allerede problemet manuelt:
"Keep the hair behind the shoulders so the area where clothing layers will be
placed stays clear" og "hats/hair-accessories … left out". Hår og tøj kolliderer
i 2D, og hår kan aldrig styles af brugeren uden ny character-generation (dyrt:
en af brugerens 3 character-kvoter).

Med bald master + separat hår:

- Frisure skiftes **uden AI** (rene assets), hvilket fjerner et helt
  kvote-forbrug.
- Hår følger hovedets rotation automatisk (forældreskab — samme mekanisme som tøj).
- Hår kolliderer korrekt med skuldre/jakke via z-buffer, i stedet for at blive
  tegnet over tøjet.

### 3. Hår-muligheder vurderet

| | **Særskilte 3D-meshes** | **Textures (på hoved-mesh)** | **Blend shapes** | **AI-genererede billeder** | **Hybrid (anbefales)** |
|---|---|---|---|---|---|
| Kort/langt/krøllet/ponytail/bob | Ja — bibliotek af meshes | Nej (kun farve/udtryk) | Kun deformation inden for én form | Kun som billboard | **Ja — mesh-bibliotek + palet** |
| Fra alle vinkler | Perfekt | Dårlig (afsløres i profil) | Perfekt | Dårlig (fladt) | Perfekt |
| Hår der følger rotation | Automatisk (head-node) | Automatisk | Automatisk | Følger kun hvis det er et lag | Automatisk |
| Bevægelse (friktion, spring) | Muligt senere (spring-bone) | Nej | Delvist | Nej | Muligt senere |
| AI-omkostning | 0 (kurateret bibliotek) | 0 | 0 | Pr. bruger, pr. skift | **0 pr. skift** |
| Kvalitet | Høj hvis modelarbejdet er godt | Mellem | Mellem | Variabel | Høj |
| Lagringsstørrelse | ~0,2–2 MB pr. frisure | Lille | Lille | ~1 MB | Som mesh |

**Anbefaling:** **Hybrid:** et **kurateret bibliotek af hårmeshes** (start: kort,
lang, krøllet, ponytail, bob — 5 stilarter × 6–8 farver via
tekstur/vertex-palette) bundet til head-noden, evt. suppleret med
AI-genereret **hårt tekstur** (albedo til et card-baseret hår-mesh), aldrig som
fladt billede. **Ikke** blendshapes som primær metode (de ændrer form, ikke stil),
**ikke** AI-billeder (brud på rotation).

Praktisk note: hårmeshes bør modelleres som **hair cards** (flade strimler med
gennemsigtig tekstur) — standardteknik, lav polygon-tæthed, nemt at style til
1990s-illustrationslooket.

---

## Adult / Teen / Child System

### 1. Kerneprincippet: **én** garderobe, **flere** kroppe

> Krævet: "Vi ønsker IKKE tre separate wardrobe-systemer."

I dag er `base_type` en binær `woman | man`, som går igen **tre steder**:
`wardrobe_item_ai_assets.base_type`, `saved_dressed_outfits.base_type`,
`dressed_characters.gender` + `profiles.gender`. Det er allerede et
*kategorisystem*, ikke et kønssystem — og det er den rigtige hængeplads for
alderstrin:

```text
base_type (udvides, ALDRIG ændres):        EKSEMPEL-VÆRDIER
  woman            (findes i dag)          → kvinde/voksen
  man              (findes i dag)          → mand/voksen
  teen-woman       (NY)                    → pige/teen
  teen-man         (NY)                    → dreng/teen
  child            (NY, evt. med undertyper) → barn
```

**Én** `wardrobe_items`-tabel, **én** `saved_dressed_outfits`-tabel, **én**
placement-kontrakt, **én** placement3d-kontrakt — kun værdi-mængden udvides.
Eksisterende rækker er fortsat gyldige (`woman`/`man` er stadig gyldige værdier), så
**ingen data-migration kræves** (samme additiv-princip som `202610060002`).

### 2. Hvordan modellerne bedst implementeres

| Aspekt | Anbefaling | Begrundelse |
|---|---|---|
| Body proportions / height | **Én baseline-mesh pr. alderskategori + skeleton-skala + morph targets** (hovedstørrelse, lemmelængde, torso-forhold) | Bevarer ét skelet ⇒ **én anchorsæt** ⇒ tøj og placement virker uændret på tværs |
| Anchors | Samme 15 navne, samme skelet, **forskellige default-værdier pr. kategori** (præcis som `MAN_ANCHOR_Y` allerede gør for mænd) | Genbruger den eksisterende mekanisme, hvor `dressedAnchor(anchor, baseType)` allerede er base-type-specifik |
| Clothing fit | **Skinned mesh + fit-parameter** (skala/shell) — én asset til alle størrelser inden for samme kategori | Skinning deformerer automatisk |
| Size-variationer | Først **auto-fit**; kun hvis auto-fit fejler → `fit_variant` (f.eks. `fit = 'teen'`) genereret **on-demand** | Holder AI-omkostninger nede |
| Face / head | Samme hoved-mesh-form pr. kategori, per-user tekstur | Identitet uændret |
| Hair | Samme bibliotek, evt. mindre skala for barn | Genbrug |
| AI generation | **Samme pipeline**, ny `base_type`-værdi som input-parameter til canonical-form-valg | Ingen ny AI-arkitektur |
| Database | Udvidede værdier + (valgfrit) `body_types`-opslagstabel til højder/proportioner-metadata | Additivt |

### 3. Kan ét clothing-asset bruges på adult/teen/child?

```text
INDEN for samme kategori (f.eks. adult woman → teen woman):
  JA via skinning + skala/skal-justering. Anbefales som default.

PÅ TVÆRS af meget forskellige proportioner (voksen → lille barn):
  KRAVER fit-variant. Årsag: barn har andre forhold (større hoved, kortere lemmer),
  så en voksen-ærme-strækning ser forkert ud.
  Løsning: LAZY variant-generering først når et item faktisk bruges på en anden
  alderskategori — cache på (asset_hash, body_type).
```

**Vigtig afhængighed (risiko):** dette virker **kun**, hvis skeletterne deler
benævnelser. Derfor er "anchors = bones" en **hard forudsætning**, der skal
fastlægges i selve PoC'en, ikke senere.

---

## Database Architecture

> **INGEN SQL er skrevet eller kørt i denne analyse** (Rule 7 + opgavens punkt 15).
> Nedenfor er kun en arkitekturvurdering.

### 1. Designprincipper (arvet fra SQL-auditten)

1. **Additivt altid:** nye kolonner er `nullable`, ingen default-tvingning, ingen
   backfill, ingen omskrivning af eksisterende migrations (præcis som
   `202610060002` kun ændrede CHECK'en i en ny fil).
2. **Præcis-nøgle-validering** gentages i tre led: client `parsePlacement`,
   server `parsePlacement`, SQL CHECK (samme kontrakt — den fejl, F1 viste,
   må ikke gentages: `jsonb_typeof`-typerne er `'string'`/`'number'`, ikke
   PostgreSQL-castnavne).
3. **RLS følger AUTH-analysen §16:** nye tabeller får egne policies; **nye
   read-policies tilføjes** for delte assets — de eksisterende erstattes aldrig.
4. **Ingen binære data i DB** — kun stier, hashes, versioner, transforms.
5. **F9/F4 høres:** `saved_dressed_outfits.user_id` mangler FK, `profiles` lever
   delvist uden for VC, bucket `profile-images` findes kun live. Enhver ny
   migration bør **dokumentere** disse, men **ikke** rette dem stille (Rule 19/25).

### 2. Kandidat-datamodel (forslag — ikke besluttet)

```text
TILFØJES (nullable, additivt):
  wardrobe_items.placement3d            jsonb NULL   {version,node,position[3],
                                                       rotation[3],scale[3],shell}
                                        + CHECK (præcis nøglesæt, 15 nodes,
                                          ranges, "begge eller ingen"-mønster)
  wardrobe_items.fingerprint_sha256     text NULL    (hash-link)
  dressed_characters.body_type          text NULL    (udvidet base_type-værdi)
  dressed_characters.model3d_path       text NULL    (3D-hoved/krop-reference, senere)

NYE TABELER:
  clothing_assets_3d   (asset_id PK, asset_hash, kind='garment'|'hair'|'accessory',
                        body_type, mesh_path, texture_path, render_front/side/back_path,
                        generation_version, source='ai'|'authored',
                        created_at, created_by)          ← DELT bibliotek
  asset_fingerprints   (hash_sha256 PK, phash, category, descriptor, asset_id FK)
  hair_assets          (hair_id PK, style_key, mesh_path, palette, tags)
  body_types           (body_type PK, display_name, height_cm?, anchor_defaults jsonb,
                        skeleton_path)                    ← erstatter INGEN data
  model_variants       (evt. samlet sted for adult/teen/child-mesh-versioner)

BEHOLDES UÆNDRET:
  wardrobe_items · saved_dressed_outfits · wardrobe_results ·
  wardrobe_item_ai_assets (v3) · dressed_base_forms · ai_generation_* ·
  placement (legacy-nøglesæt)
```

### 3. Hvorfor `placement3d` som JSONB (ikke som kolonner)

- Samme mønster som `placement` ⇒ genbruger hele resolver-, validator- og
  PATCH-infrastrukturen uændret.
- Præcis-nøgle-CHECK forhindrer "halve" 3D-placeringer (den lektion, F1 kostede).
- Alternativet (10 kolonner pr. item) øger risikoen for delvis-opdateringsfejl og
  giver ingen gevinst.

### 4. Migrationsstrategi (overordnet — udføres først efter godkendelse)

```text
M-A  additiv: placement3d + 3D-asset-tabel + fingerprints        (ingen data røres)
M-B  udvid base_type-værdier (adult/teen/child)                  (senere fase)
M-C  fælles-bibliotek RLS-policy (ny policy, ingen erstatning)   (senere fase)
```

Hver migration: **ny fil**, `DROP IF EXISTS`-garanti, ingen redigering af
eksisterende filer, dokumenteret i `DRESSED-SQL-MIGRATIONS-ANALYSIS.md`'s
kædemønster (original → error → corrective → current).

---

## Storage Architecture

### Nuværende (CONFIRMED)

`model-images` + `profile-images`, begge **private**, al adgang via signerede
URLs (5 min / 60 min) eller service-rolle. Upload-policyer er **UNVERIFIED**
(kan ikke læses via REST).

### Foreslået

| Bucket | Indhold | Adgang | Ejer |
|---|---|---|---|
| `model-images` (består) | personlige karaktere, outfits, try-on | privat + signerede URLs | bruger |
| `profile-images` (består) | kildefoto | privat + signerede URLs | bruger |
| **`dressed-3d` (NY, privat)** | kanoniske body-meshes, skeletter, base-form-3D | privat + **ny shared-read policy for authenticated** (AUTH §16-mønster) | system |
| **`dressed-assets` (NY, privat)** | delte garments/hair (GLB + tekstur + renders), hash-navngivet | privat + shared-read for authenticated | system |
| Bruger-specifikke 3D-filer (hoved/ansigt) | `{userId}/model3d/…` | privat + signerede URLs | bruger |

**Regler:** filnavne indeholder **asset_hash + version**
(`{hash}-{version}.glb`) ⇒ naturlig CDN-cache, ingen purge, automatisk
idempotens (samme fil = samme navn = ingen dubletter). Download af GLB
komprimeres (Draco/meshopt) og teksturer som KTX2/Basis, hvor browseren
understøtter det — ellers PNG-fallback (Responsive-image-lignende strategi).

**Størrelsesestimater (INFERRED, skal måles i PoC):** krop ~1–5 MB (Draco),
garment ~0,3–2 MB, hår ~0,2–1 MB, render-thumbnail ~50–150 KB. Med hash-deling
skal **kun én kopi** findes pr. unikt item — det er hele økonomien i §AI Cost.

---

## Mobile Considerations

Mobil implementeres **ikke nu**, men arkitekturen skal tage højde for det
(opgavens punkt 13). Den gode nyhed: DRESSED' pointer-arkitektur er allerede
**den rigtige** til 3D, fordi den er bygget på Pointer Events med capture og
lokalt `touch-action`.

### 1. Gestus-mapping (2D → 3D)

| Gestus | 2D i dag | 3D (forslag) | Konflikt-håndtering |
|---|---|---|---|
| **Tap** (≤8 px, pointerup) | Vælg lag | Vælg mesh (raycast mod lag) | Bevar `TAP_SLOP_PX`; raycast erstatter `clothingLayerAtPoint` |
| **Drag (1 finger) på item** | Flyt x/y | Flyt i nodens tangentplan (u/v) | Samme; skriver `placement3d.position[0..1]` |
| **Drag (1 finger) på tom flade** | ingen | **Orbit** (roter kamera/model) | Kun når ingen item er valgt/redigeres |
| **Pinch på item** | `placement.scale` | **Behold** — skala af item | Bevar nuværende opførsel 1:1 (Rule 6) |
| **Pinch på tom flade** | ingen | **Zoom** (kamera) | Skal IKKE røre placement |
| **Wheel + venstre-hold** | `placement.scale` | **Behold** + evt. shift = zoom | Bevar `WHEEL_SCALE_RATE`-mønster med én konstant |
| **Side/front/back-knapper** | findes ikke | **Kamera-preset** (anime 90°) | Data ændres aldrig |

**Hård regel:** de tre nuværende inputs (slider, wheel, pinch) må fortsat skrive
**præcis samme felt** (`placement.scale` / `placement3d.scale`) — ét system, én
værdi (Wheel-Pinch-analysen §4).

### 2. Performance (forslag, måles i PoC)

- **DPR-clamp** (≤2) + `powerPreference:"low-power"` på mobil; antal draw calls
  holdes lavt (ét mesh pr. item + ét kropsmesh ≈ 5–8 calls pr. outfit).
- **Lazy loading:** først base-mesh + valgte items; fælles assets forudindlæses
  kun ved behov.
- **Resolution-tier:** tekstur 1024² mobil / 2048² desktop; KTX2 hvis muligt.
- **Fallback:** understøtter browseren ikke WebGL(2), eller FPS < tærskel →
  **fal automatisk tilbage til den nuværende 2D-renderer** (begge spor lever
  side om side; se Backward Compatibility).
- **Memory:** glTF-disposal ved skift af karakter/outfit (three.js `dispose()`),
  ellers lækker mobil-browseren ved gentagen navigation.

### 3. Bevar den nuværende touch-model

`touch-action: none` må **kun** lægges på den redigerede flade/orbit-området,
aldrig globalt (Rule 16). System-gestusser (langt-tryk, iOS-callout) skal
undertrykkes på samme snævre område som i dag
(`-webkit-touch-callout: none` i `wardrobe.css:1065-1074`).

---

## Backward Compatibility

### 1. Migrationsstrategi (to spor, én data-model)

```text
SPOR 1 — EKSISTERENDE ITEM (beholdes uden konvertering)
  OLD ITEM (v3 asset, placement {anchor,x,y,scale[,scaleX,scaleY]})
        ↓
  2D KOMPATIBILITETSLAYER  →  den nuværende CSS-transform, uændret
        ↓ (hvis bruger åbner 3D for det pågældende item)
  LAZY placement3d-afledning (deterministisk, ingen AI)  →  3D-render

SPOR 2 — NYT ELLER OPGRADERET ITEM
  NEW ITEM  →  3D garment asset (genereres én gang, hash-gated)
        ↓
  placement3d (node + local T/R/S + shell) skrevet af 3D-editoren
        ↓
  2D-kompatibilitetslaget kan stadig vise det (front-render som billboard)
```

**Ét item kan altså have begge dele:** `placement` (legacy) +
`placement3d` (ny). Resolveren vælger efter renderer-tilstand — **aldrig ved at
slette det ene**.

### 2. Hvad der bevareres 100 % (ingen ændring)

| Eksisterende | Status |
|---|---|
| `wardrobe_items`-rækker og `placement` (inkl. X/Y-scaling) | **Uændret, fortsat gældende** |
| `saved_dressed_outfits.item_ids` (text[]) | **Uændret** — outfits afhænger ikke af renderer |
| `wardrobe_item_ai_assets` v3 | **Uændret og fortsat gyldig**; v3 er ikke "forældet" af 3D |
| Profile- og DRESSED-renderernes fælles resolver | **Bevares** (3D tilføjes som ekstra led) |
| Kvote-, RPC- og background-job-infrastruktur | **Genbruges** |
| Eksisterende brugeres visning | Ser **identisk** ud, indtil 3D ekspllicit aktiveres |

### 3. Feature-flag / aktiveringsmodel (anbefaling)

```text
1. GLOBALT FLAG i client (f.eks. PUBLIC_)      → 3D overhovedet muligt
2. PER-BRUGER valg ("3D VIEW" toggle)          → bruger styrer det
3. PER-ITEM capability (asset findes?)         → ellers 2D-billboard-fallback
4. Tøm-aldrig-tvang: ingen automatic regeneration af eksisterende assets
```

Dette opfylder Rule 1 (fjern ikke funktionalitet), Rule 6 (bevar brugeradfærd)
og gør rullet tilbage til ren 2D til **én flagændring**.

---

## Visual Identity (Clueless / 1990s / pink)

3D må **ikke** få DRESSED til at ligne en generisk avatar-app.

### Hvad der skal bevares (CONFIRMED fra UI/css/prompts)

- **Placeringen:** modellen til højre/centrum i `.model-window` med
  `MY DRESSED CHARACTER`-header, clothing-panel til venstre, outfit-panel til højre
  (`wardrobe-main`-grid: `clothing | model | outfit`).
- **Formatet:** 2:3-rammen (`aspect-ratio: 2/3`, maks 493→413→333 px) — 3D-canvaset
  skal sidde i **præcis samme boks**, så layout, breakpoints og screenshots ikke
  ændres.
- **Farver/typografi:** `--pink-100…600`, `--cream`, DM Mono/DM Sans/Playfair,
  `--pixel-shadow` (4/7 px), 90s-computer-æstetik (`.computer-ramme`).
- **Stemningen:** "playful 1990s/Clueless-inspired fashion illustration",
  "illustration, not a photograph" — gælder også 3D-shading.
- **Knapper/piller:** placement-panelets knapper (ADJUST/RESET/DONE, sliders)
  skal genbruges til 3D-kommandoer, ikke erstattes af nye design-systemer.

### Konkrete greb, så 3D forbliver "DRESSED"

1. **Toon-shading + ink-outline** i stedet for PBR/glossy 3D-look; bundne
   baggrundsfarver (hvid/hvid-canvas som i dag, evt. `--pink-100`-skygge).
2. **Front/side/back som 90s-knap-piller** ("◀ FRONT · SIDE · BACK ▶") i samme
   DM Mono-stil som øvrige knapper — ikke som moderne 3D-widget-kontroller.
3. **Kamera-preserved komposition:** samme figur-størrelse i canvaset som i dag
   (intet "3D-zoom-default", der ændrer første indtryk).
4. **Pixel-shadow/ramme** bibeholdes omkring viewporten; ingen raytracede
   skygger der bryder illustrationssproget.
5. **Modelstatus-linjen** (`model-status`) og flow-progress-panelet genbruges
   til 3D-status ("BUILDING 3D WARDROBE…").

---

## Risks

| Risk | Severity | Probability | Mitigation |
|---|---|---|---|
| **3D-performance på desktop** (f.eks. store GLB'er, mange lag) | Medium | Medium | Draco/meshopt + KTX2, draw-call-budget, lazy loading, måling i PoC før UI-fase |
| **3D-performance på mobil** (GPU/deler hukommelse) | **High** | High | DPR-clamp, resolution-tiers, automatic fallback til 2D-renderer, mobil først *efter* desktop-godkendelse |
| **AI-konsistens: front/side/back viser forskelligt tøj** | **High** | High | **Én mesh-kilde, renders afledt**; aldrig 3 uafhængige kald; automatisk accept/reject (farve/logo/silhuet); fail-closed til 2D |
| **Clothing fitting på tværs af kroppe (teen/child)** | High | Medium | Fælles skeleton = fælles anchors; auto-fit først; lazy `fit_variant`; batch-måling som i `Phase2-Woman-Tshirt-Test` |
| **Identity preservation (ansigt passer ikke på 3D-hoved)** | High | Medium | Bevar 2D-identitetsstrategien (base form = geometry, foto = identity); toon-shading; start med front-projicering, senere image→3D-head |
| **Storage-omkostning / dubletter** | Medium | Medium | Hash-navngivne filer, delt bibliotek, ingen per-user kopier af fælles assets, estimer før idriftsættelse |
| **AI-omkostning (især ved version-bump)** | Medium | High | 3D som **supplement** (ingen tvungen regenerering af v3), hash-cache, kvote-RPC med refund-ved-fejl |
| **Browser-kompatibilitet (WebGL mangler/deaktiveret)** | Medium | Low–Medium | Bevar 2D-spor som permanent fallback (ikke fjernet) |
| **Kompleksitet/vedligehold (2 renderere, monolitisk side)** | **High** | High | Først bryd `wardrobe.astro` op i `lib/client`-moduler pr. ASTRO-analysen; én delt resolver; skriv tests ind i repoet (findes kun i `%TEMP%` i dag) |
| **Migrations-risiko (F1 gentages, live≠repo, F4)** | High | Medium | Additive migrations, præcis-nøgle-CHECK i 3 led, `jsonb_typeof` = `'string'`/`'number'`, read-only verifikation efter kørsel, ingen redigering af gamle filer |
| **Eksisterende wardrobe-kompatibilitet (9 items, 3 outfits, X/Y-scaling)** | **High** | Low | Legacy-nøglesæt bevares uændret; dobbelt-nøgle-model (`placement` + `placement3d`); feature-flag; ingen batch-konvertering; visuel diff-test før/efter |
| **Visual identity forringes ("generisk avatar-app")** | Medium | Medium | Toon-shading, samme ramme/layout/farver, design-review i hver fase |
| **Leverandørrisiko (tredjeparts AI/avatar-services lukker — jf. RPM-eksemplet)** | Medium | Medium | Hold kerner i egne filer (glTF i egen bucket); kun *generering* er tredjeparts, aldrig *levering* |
| **Accept/reject findes ikke (BestFit §8.4) → dårlige assets lagres** | Medium | High | Indfør valideringstrin som en del af den nye pipeline fra dag ét |
| **Køns-/alder-bias i kanoniske former** (kun woman/man i dag) | Low–Medium | Medium | Udvid `base_type` additivt; dokumentér, at live `profiles` har kolonner uden for VC (F4) før ændringer |

---

## Recommended Architecture

```text
DRESSED — ANBEFALET 3D-ARKITEKTUR

3D ENGINE:
  three.js (vanilla, MIT) som ét Astro <script>-modul i lib/client/three/*,
  bag samme facade som i dag: applyLayerPlacement() skriver scene-tilstand i
  stedet for CSS-variabler. Fallback til eksisterende 2D-renderer ved manglende
  WebGL eller lav FPS. Ingen React/framework-islands.

MODEL FORMAT:
  glTF 2.0 (.glb) + Draco/meshopt + KTX2-teksturer, lagret hash-navngivet i
  Supabase Storage (nye private buckets: dressed-3d, dressed-assets).

BODY SYSTEM:
  ÉN kanonisk stylized body-mesh pr. base type (Blender, ét engangsarbejde),
  skinned til ét skelet hvor de 15 EKSISTENDE anchors er knudepunkter.
  Shading = toon/gradient + ink-outline (matcher 1990s/Clueless-illustrationen).
  Krop = geometry authority, præcis som master forms er det i dag.

CLOTHING FORMAT:
  Pr. item ÉN garment-mesh (skinned, tilpasset canonical body) + tekstur.
  Fallback: nuværende v3 front-PNG som billboard ("NOT 3D-READY").
  Delt bibliotek nøglet på asset_hash — ingen per-user kopier af fælles assets.

FRONT/SIDE/BACK:
  Afledt ved RENDERING fra samme mesh (konsistens ved konstruktion).
  Kamera-presets FRONT/SIDE/BACK i UI; aldrig tre uafhængige AI-genereringer.
  Automatisk accept/reject (farve/logo/silhuet) før lagring.

HAIR:
  Bald master + separat hair-mesh (hair cards) bundet til head-noden;
  kurateret bibliotek (kort/lang/krøllet/ponytail/bob × farvepalet);
  skiftes UDEN AI; følger hovedets rotation via forældreskab.

ADULT/TEEN/CHILD:
  Samme garderobe, samme skeletonsprog, udvidet base_type-værdimængde
  (woman/man + teen-*/child) + morph/skeleton-skala pr. kategori.
  Tøj genbruges via skinning; kun nødvendige fit-varianter genereres (lazy).

PLACEMENT:
  placement3d = {version, node, position[3], rotation[3], scale[3], shell}
  gemt pr. item (JSONB), valideret præcis som i dag (client + server + SQL).
  Legacy {anchor,x,y,scale[,scaleX,scaleY]} bevares uændret og konverteres
  deterministisk (ingen AI) ved behov. Anchor = node; x/y = tangent-offset;
  scale/scaleX/scaleY = lokal skala; z = shell/normal-offset (ikke fri verdens-z).

DATABASE:
  Additive: wardrobe_items.placement3d + fingerprint_sha256;
  nye tabeller clothing_assets_3d, asset_fingerprints, hair_assets,
  body_types (+ evt. model_variants); base_type-værdier udvides senere.
  Præcis-nøgle-CHECK i tre led. RLS: nye policies, aldrig erstatning (AUTH §16).
  INGEN SQL før godkendelse.

AI:
  Kun tre steder: (1) identitet/hoved, (2) garment 3D-asset (hash-gated),
  (3) evt. final look-billede (outfit_key-cache). Alt andet er deterministisk.
  Kø via eksisterende background-job + reserve/finish-RPC med refund ved fejl.

STORAGE:
  Private buckets + signerede URLs (personligt) og ny shared-read policy
  (fælles assets) for authenticated. Hash-navngivne filer ⇒ naturlig CDN-cache.
  Kun én kopi pr. unikt design.

MOBILE:
  Samme pointer-model (tap/drag/pinch/wheel) udvidet med orbit-på-tom-flade;
  pinch på item = scale (uændret), pinch på tom flade = zoom (kamera).
  DPR-clamp, resolution-tiers, automatic 2D-fallback, touch-action kun lokalt.
```

### Hvorfor lige præcis dette

1. **Det bevarer alt, der allerede virker:** anchors, resolver, persistence,
   kvoter, jobs, outfits, X/Y-scaling — og udskifter kun renderingslaget.
2. **Det løser konsistens ved konstruktion** (én mesh → alle vinkler), hvilket er
   den eneste teknisk robuste måde at opfylde "front = side = back".
3. **Det udnytter DRESSEDs hemmelige fordel:** fast geometri pr. base type ⇒
   tøj passes én gang, genbruges af alle brugere og alle aldersgrupper.
4. **Det minimerer AI-omkostninger** (hash-cache, ingen tvungen regenerering,
   ingen multi-view-dobbeltskalering).
5. **Det kan rulles tilbage** med én flagændring, fordi 2D-sporet bevares.

---

## Implementation Roadmap

Rækkefølgen er **bevidst ændret** i forhold til det foreslåede eksempel: datamodel
og kompatibilitet skal fastlægges **før** det første 3D-clothing-asset (ellers
skal alle assets laves om), og hair/adult-teen-child kommer **efter** at skelettet
er bevist — mens AI-pipeline og hash-genbrug starter **tidligt**, fordi det er
det, der styrer omkostningerne. **Ingen fase indebærer implementering nu.**

```text
FASE 0 — FORUD FOR ALT (analyse-phase er afsluttet her)
  · Godkendelse af denne analyse + valg three.js vs. babylon
  · Indhent reelle AI-priser + licenser (image→3D-udbyder, SMPL-hvis-overvejet)
  · Beslut: feature-flag-navn, 3D-asset-version-nummer, ny generation_type
  Exit: skriftlig godkendelse. Ingen kode.

FASE 1 — 3D PROOF OF CONCEPT (isoleret, ingen produktionseffekt)
  · Egen route/flag: én scene i samme 2:3-boks, kanonisk testmesh + orbit
  · Mål: load-tid, draw calls, FPS desktop + emuleret mobil, filstørrelser
  · BEVIS anchors = bones (15 navne som knudepunkter) — den hårde forudsætning
  Exit: måltetal dokumenteret; fallback-plan skrevet. 2D uberørt.

FASE 2 — 3D MODEL VIEWER (synlig, men stadig bag flag)
  · Body-mesh (Blender) + toon-shading + identitetstekstur fra eksisterende 2D-character
  · Samme .model-window, samme breakpoints, samme statuslinje
  Exit: visuel godkendelse af at 3D ser ud som DRESSED, ikke som avatar-app.

FASE 3 — MODEL ROTATION (front/side/back)
  · Orbit + kamera-presets; UI-piller i 90s-stil; bevare alle nuværende gestusser
  Exit: rotation uden artefakter; data uændret.

FASE 4 — PLACEMENT3D-DATAMODEL + KOMPATIBILITET  (additiv migration, godkendt)
  · placement3d-kolonne + CHECK (client/server/SQL), dual-resolver, lazy
    konvertering af legacy-placement, 2D-spor bevares intakt
  Exit: legacy-items renderer 100 % identisk i 2D; 3D-placement kan persistere
        og overleve refresh (samme test som live-persistens-milepælen).

FASE 5 — CLOTHING ASSET (3D) FOR ÉN PILOTKATEGORI (fx tops)
  · AI foto→garment-mesh på canonical body; accept/reject; hash-cache fra dag ét
  · Fallback til v3-billboard ved fejl
  Exit: ét item roterbart fra alle vinkler; konsistens verificeret målt (farve/logo).

FASE 6 — CLOTHING ATTACHMENT + SHELL-ORDNING
  · Skinning, shell-baseret lag-sortering (erstatter z-index-semantik),
    placement-editor i 3D (drag/slider/wheel/pinch skriver placement3d)
  Exit: outfit med 3–5 items roterer korrekt; Profile viser samme resultat.

FASE 7 — FRONT/SIDE/BACK FOR ALLE KATEGORIER + MULTI-VIEW-VALIDERING
  · Udvid pipeline; fejlhåndtering; "NOT 3D-READY"-markering i Closet
  Exit: ingen item kan lagres uden at bestå validering.

FASE 8 — HAIR SYSTEM (bald master + bibliotek)
  · Fase 2-character erstattes af bald master; frisurevælger uden AI;
    hår følger rotation; hats/hair-accessories genbruger head-noden
  Exit: skift af frisure ændrer ikke kvote-forbrug.

FASE 9 — ADULT / TEEN / CHILD
  · base_type-udvidelse (additiv), morph/skeleton-skala, auto-fit + lazy
    fit-varianter, samme garderobe-data
  Exit: ét item bruges på 2 kategorier uden ny AI-generation (målt).

FASE 10 — AI-PIPELINE + ASSET-DELING (kørsel i produktion)
  · asset_fingerprints, fælles bibliotek, shared-read policy, omkostnings-dashboard
  Exit: samme foto uploadet af to brugere ⇒ 1 generering (bevist).

FASE 11 — MOBIL + LIVE-ACCEPTERING
  · Fysisk enhed, orbit/pinch/zoom, performance-tiers, fps-fallback
  Exit: live-godkendelse (jf. nuværende kendte mangler: wheel/pinch og
        fysisk telefon er stadig kun automatiseret-testet).
```

**Parallel spor gennem hele forløbet (obligatorisk):**
`wardrobe.astro` brydes op i `lib/client`-moduler pr. ASTRO-analysen §6, tests
flyttes ind i repoet (`tests/` + `npm test`), og `docs/` opdateres pr. fase
(Rule 19). Uden dette bliver 3D-implementeringen umulig at teste sikkert.

---

## Final Recommendation

1. **Gå videre med 3D — men som et additivt parallelspor, ikke som en erstatning.**
   Den nuværende 2D-løsning (inkl. X/Y-scaling fra `b5b6610`/`e77b86b` og
   migration `202610060002`) forbliver produktionsversionen, indtil 3D er
   live-verificeret. Intet eksisterende data røres.

2. **Vælg three.js (vanilla) + glTF/GLB + Draco/KTX2.** Afvis React Three Fiber
   (bryder bevidst arkitekturvalg), afvis hostede avatar-platforme
   (leverandørrisiko — Ready Player Me-lukningen er advarslen), overvej Babylon
   kun hvis spiket viser konkret fordel.

3. **Glem "x, y, z".** Den korrekte model er `node + lokal position + lokal
   rotation + lokal skala + shell`, hvor **anchor = node** og **z = normal-offset**.
   Kamerarotation er aldrig data. Legacy-placement konverteres deterministisk og
   lazily — aldrig batch, aldrig med AI.

4. **Én 3D-garment pr. item; front/side/back er renders.** Det er samtidig den
   eneste løsning, der både er billigst, mest konsistent og mest realistisk.
   Tilføj automatisk accept/reject — det savnede trin, `BestFitAnalyse` §8.4
   dokumenterede, at systemet mangler i dag.

5. **Byg på den fordel, DRESSED allerede har:** én kanonisk geometri pr. base
   type ⇒ ét body-mesh, ét skelet, anchors = bones, tøj der passes én gang og
   genbruges af alle — hvilket også er vejen ind til adult/teen/child og til et
   hårsystem uden AI-forbrug.

6. **Indfør hash-baseret asset-identitet fra dag ét.** Det er billigere at
   lægge `asset_fingerprints` ind i første 3D-migration end at indføre det
   bagefter, når kopierne allerede findes.

7. **Brug tid på at bryde `wardrobe.astro` op og lægge tests i repoet, FØR
   3D-implementering.** Ellers løber risikoen (2 renderere i én 1.486-linjers
   monolit uden test-suite) løbende.

**Samlet vurdering:** 3D er **realistisk og teknisk forsvarligt** for DRESSED,
fordi geometrien allerede er kanonisk, placementsystemet allerede er
resolver-baseret, og pipeline'en allerede kører i baggrunden med kvoter. De
tre faktorer, der kan få projektet til at fejle, er **AI-konsistens**,
**mobil-performance** og **kompleksitet** — alle tre adresseres eksplicit i
roadmap'en ovenfor.

---

## Open Questions

1. **AI-priser:** hvad koster ét image→3D-generering vs. ét gpt-image-kald i
   dag? (Ingen prisanalyse findes i repoet — kun kvoter.)
2. **Udbyder/licens:** hvilken image→3D-tjeneste/åben model må bruges kommercielt,
   og hvad er deres licens på genererede assets? (Skal verificeres i Fase 0.)
3. **three.js vs. Babylon:** afgøres bedst empirisk i Fase 1.
4. **Hoved/ansigt:** er front-projicering af den eksisterende 2D-character
   acceptabel i profil, eller kræves image→3D-head fra start? (Afgøres i Fase 2.)
5. **Skal legacy-items overhovedet konverteres?** Alternativ: kun nye/opgraderede
   items får `placement3d`, og legacy forbliver evigt 2D (billigere, men
   halverer værdien af "alle items roterbare").
6. **Fælles bibliotek vs. privat:** juridisk/go-to-market afgrænsning for at
   dele genererede assets mellem brugere (anbefalingen deler kun asset, aldrig
   foto — men det bør bekræftes).
7. **`base_type`-navngivning:** udvid `woman`/`man` med `teen-*`/`child`, eller
   indfør et separat `age_group`-felt? (Sidstnævnte giver dobbelt-dimension og
   mere kompleks validering; førstnævnte er additivt og enkelt.)
8. **Kø-model:** ny `generation_type` ('cloth3d') eller udvidelse af 'clothing'?
   (Afhænger af kvote-design og af, om 3D skal tælle separat.)
9. **2D-sportens levetid:** skal den bevares permanent som fallback, eller kan
   den udfases på sigt? (Anbefaling: permanent fallback — Rule 1.)
10. **Måling af "konsistens":** hvilke tærskler (ΔE, Hamming, silhouette-IoU)
    er acceptable, før et asset afvises?

---

## Appendix — Selvtjek (opgavens punkt 22)

| # | Kontrol | Status |
|---|---|---|
| 1 | Gennemlæst igen | ✓ alle afsnit læst ved skrivning |
| 2 | Anbefalinger passer til den nuværende DRESSED-kode | ✓ alle kodelinje-henvisninger (`wardrobe.css:651/652`, `profile.css:619`, `clothing-placement.ts`, `clothing-categories.ts:86-104/154-177`, `wardrobe.astro` events, `character-job.ts:20-53`, `clothing-job.ts:72-116`, `dress-model.ts:145-160`, `items/[id].ts` PATCH) er læst i kilde under analysen |
| 3 | Tidligere analyser er med | ✓ §Previous Analysis Review dækker alle 15 `analysis/`-filer + 3 docs + 3 `.txt`; ingen overskrevet |
| 4 | X/Y-scaling fra `b5b6610` er med | ✓ omtalt i header, §Existing Project State, §Current Architecture, §Backward Compatibility og Risks (inkl. `e77b86b` = HEAD) |
| 5 | Migration `202610060002_placement_free_scale.sql` er taget med | ✓ gennemgået linje-for-linje og indarbejdet i kontrakten (4- vs. 6-nøgle, begge-eller-ingen, ranges) |
| 6 | Intet anbefales der konflikter med eksisterende arkitektur uden forklaret migration | ✓ R3F afvist (Rule 2/ASTRO-§2), placement bevares (Rule 10), dobbelt-nøgle-model + lazy konvertering forklarer overgangen, RLS udvides via nye policies (AUTH §16), base_type udvides additivt |
| 7 | Adult/teen/child + bald master/hair + front/side/back analyseret som ét system | ✓ fælles skeleton/anchor-sprog binder de tre afsnit sammen (se §Adult/Teen/Child §1 og §Bald Master §1); roadmap'en kobler dem til Fase 4/8/9 |
| 8 | Ingen implementation, ingen commit/push/merge/stash/reset/rebase/checkout | ✓ kun denne fil er oprettet (`git status` viser kun den nye analyse-fil) |
| 9 | Ingen SQL skrevet eller kørt | ✓ §Database Architecture er udelukkende arkitekturforslag, markeret som "ikke besluttet" |

---

*Slut på analysen. Næste skridt (kræver særskilt godkendelse): godkendelse af
anbefaling, indhentning af AI-priser/licenser, og eventuel Fase-1 PoC på en ny
gren. Denne fil opdaterer ingen tidligere analyse og indeholder ingen
kodeændringer.*

















