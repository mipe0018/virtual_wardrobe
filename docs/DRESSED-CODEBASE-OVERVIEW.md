# DRESSED — CODEBASE OVERVIEW

> Komplet oversigt over kodebasen pr. dokumentationsrunden. Alle stier, metoder og
> linjetal er verificeret mod koden (ikke gæt). Ved tvivl: læs filen selv.

## 3.1 DIRECTORY TREE

```text
virtual_wardrobe/
├── package.json                 (scripts: dev/build/preview/astro — INGEN test-script)
├── astro.config.mjs, tsconfig.json, package-lock.json
├── .env, .env.example, .gitignore
├── AGENTS.md, CLAUDE.md, README.md
├── DRESSED-CLOTHING-ANALYSIS.txt
├── DRESSED-SUPABASE-ANALYSIS.txt
├── DRESSED-SUPABASE-IMPLEMENTATION-PLAN.txt   (afventende M0–M6-plan)
├── analysis/                    (7 .md: BestFit ×3, ClothingPlacement,
│                                  Phase2-Woman-Tshirt-Test, Wheel-Pinch,
│                                  DRESSED-CURRENT-STATUS)
├── docs/                        (PROJECT-SPECIFICATION, CODEBASE-OVERVIEW,
│                                  ASSETS-AND-MEDIA)
├── supabase/migrations/         (14 .sql — se §3.8)
├── public/                      favicon.ico, favicon.svg
└── src/
    ├── assets/system-reference/
    │   ├── base-forms/          woman.png, man.png          (1024×1536)
    │   └── clothes/             8 PNG'er (referencer til AI-processering)
    ├── components/              Footer.astro, Header.astro, ProfileTheme.astro
    ├── layouts/                 Layout.astro
    ├── pages/
    │   ├── index.astro, login.astro, signup.astro
    │   ├── profile.astro, closet.astro, wardrobe.astro   (= DRESSED)
    │   └── api/
    │       ├── ai/              dress-model, personal-model, process-clothing,
    │       │                    try-on (POST), usage (GET)
    │       ├── characters/[id].ts          (DELETE)
    │       ├── profile/source-photo.ts     (POST)
    │       └── wardrobe/
    │           ├── items/index.ts          (GET, POST)
    │           ├── items/[id].ts           (DELETE, PATCH)
    │           ├── outfits/index.ts        (GET, POST)
    │           └── outfits/[id].ts         (DELETE)
    ├── lib/
    │   ├── supabase.ts
    │   ├── client/  dressed-character, generation-flow, generation-usage,
    │   │            profile-outfits, wardrobe-ai
    │   ├── server/  supabase.ts
    │   │   └── ai/  background, base-forms, config, fashn-space,
    │   │            generation-usage, image-input, job-launcher,
    │   │            openai-images, jobs/{character-job, clothing-job}
    │   └── shared/  clothing-assets, clothing-categories, clothing-geometry,
    │                clothing-placement, dressed-base-forms
    └── styles/      closet, flow-progress, global, home, layout, login,
                     profile-theme, profile, signup, wardrobe (.css)
```

## 3.2 EVERY IMPORTANT FILE

### Sider (pages)

```text
FILE:
src/pages/wardrobe.astro          ← DRESSED (hovedsiden)

PURPOSE:
Komposition af outfits på modellen: model-canvas, clothing-lags, layer-styring,
placement-editor (ADJUST/RESET/DONE), saved-outfits, alle AI-flows (character,
process-clothing, dress-model, try-on), quota/usage, responsive tuning.

IMPORTS (server):
src/lib/supabase (auth til faneblad), @/lib/server/ai/generation-usage,
@/lib/server/supabase (reservation service-klient) — alt inde i
{Astro.props.frontmatter}-script, så bundle ikke indeholder service-koder.

IMPORTANT STATE:
landingCharacterModel, selectedCharacterId, uploadStatus (idle/ready/processing/
failed), clothingItems, baseForm, characterModel, characterTransforms,
selectedItems (id→item + insertion-ordre = layers), placementOverrides (Map),
editingItemId, dressedAnchor(=anchor valgt), saveState, saveQueue, statusQueue.

IMPORTANT FUNCTIONS:
loadPersistentWardrobe() (kaldt3 steder), selectClothing (ADD genbruger id),
saveOutfitsAction (queue+retry), applyLayerPlacement/setPlacementOverride
(session-scaling), renderClothingLayers (skriver CSS-variabler, KUN ændrer style
på forskellige lag), saveItemPlacement (saveStore→fetch PATCH),
processClothing/dressModel/tryOn/bindToCharacter/resultApiFetch.

IMPORTANT DEPENDENCIES:
@/styles/wardrobe.css, @/components/ProfileTheme, layout-transform i
@applyLayoutTransform, DRESSED_ANCHORS/MAN_ANCHOR_Y, clothingLayerOrder.

DO NOT CHANGE WITHOUT:
Godkendelse (Rule1/2/6/10/11) — touched af placement/persistence/touch/wheel/
pinch-kredsene.
```

```text
FILE:
src/pages/profile.astro

PURPOSE:
Side med profilinfo, kilde-foto-upload, model-tekster/AI-model-flow,
quoter og outfit-visning på modellen.

IMPORTANT STATE:
dressedCharacter/characterModel (via lib/client/dressed-character),
dressedOutfits + dressedSourceOutfitId (localStorage-kontrakt:
dressedSourceOutfitId med magisk nøgle er ENESTE bridge til valg på wardrobe).

IMPORTANT FUNCTIONS:
renderSourceOutfit (klik→localStorage→reload /dressed), quota-tekst (korrekt
reserved≥failed, uden lokal tæller-dublet).

IMPORTANT DEPENDENCIES:
@/styles/profile.css, @/components/ProfileTheme, @/lib/client/profile-outfits.


DO NOT CHANGE WITHOUT:
Godkendelse — globale querySelectors og localStorage-kontrakten må ikke brydes.
```

### lib (klient, server, shared)

```text
FILE: src/lib/supabase.ts
PURPOSE: Browserens anon-klient (PUBLIC_SUPABASE_URL/ANON_KEY); null hvis ikke sat.
IMPORTS: @supabase/supabase-js.   USED BY: Header.astro, ProfileTheme.astro (m.fl.)
DO NOT CHANGE WITHOUT: godkendelse — ændrer global client-adfærd.
```

```text
FILE: src/lib/server/supabase.ts
PURPOSE: createSupabaseServiceClient() (service-rolle, bypasser RLS) +
         authenticateSupabaseRequest() (Bearer-JWT → anon-client m. bruger).
USED BY: alle /api/*-ruter; PATCH-placement bruger service-klienten (Rule7/8/11).
DO NOT CHANGE WITHOUT: godkendelse — RLS- og API-sikkerhed afhænger heraf.
```

```text
FILE: src/lib/client/wardrobe-ai.ts
PURPOSE: Alle wardrobe-flows for klienten: load/apply AI-ready state, ADD-genbrug
         af item-id, DELETE-optimisme, outfit-rudedelegation (klik-ruter via
         closest på OPRET/knap-recognisere), saveOutfitsAction (queue+retry),
         resultApiFetch (SAVE→KUN ved success), quota-reservation fra frontend.
         EKSPORTERER OGSÅ typen Placement + saveItemPlacement() (PATCH).
IMPORTANT STATE: saveQueue/statusQueue/lastError, dressedSourceOutfitId-nøgler.
USED BY: wardrobe.astro.
DO NOT CHANGE WITHOUT: godkendelse — Rule1/4/6/11 (genbrug af id, save-flow).
```

```text
FILE: src/lib/client/profile-outfits.ts
PURPOSE: Henter outfits (API med fallback mod REST) + wardrobe og renderer valgte
         outfit PÅ MODELEN via resolveItemPlacement — samme matematik som
         DRESSED (netop det der gør "same id + same placement = same render").
IMPORTANT STATE: dressedSourceOutfitId (localStorage-kontrakt m. magisk nøgle).
USED BY: profile.astro.
DO NOT CHANGE WITHOUT: godkendelse — localStorage- og render-kontrakter.
```

```text
FILE: src/lib/client/dressed-character.ts, generation-flow.ts,
      generation-usage.ts
PURPOSE: Klient-utilities omkring AI-karakterdata, genererings-flow (bruges af
         Layout.astro) og quota/usage-læsning til UI.
DO NOT CHANGE WITHOUT: at have læst filen først (bruges på tværs af sider).
```

```text
FILE: src/lib/shared/clothing-placement.ts   (NY i persistence-runden)
PURPOSE: EN resolver for hele appen: resolveItemPlacement(item, anchor?,
         placement?, dressingForm?, baseType) = session → persisted → default;
         parsePlacement (strenge skriv-validering af {anchor,x,y,scale});
         CLAMP_SCALE [0.4,2.0], CLAMP_PLACEMENT_OFFSET 60, isEmptyPlacement.
USED BY: api/wardrobe/items/[id].ts (PATCH-validering), profile-outfits.ts,
         wardrobe.astro (client-side).
DO NOT CHANGE WITHOUT: godkendelse — tre-parts-kontrakt (client/server/DB) og
         Rule11 (item-ejerskab).
```

```text
FILE: src/lib/shared/clothing-categories.ts
PURPOSE: Kategorisystem, CLOTHING_PLACEMENT-defaults, DRESSED_ANCHORS (15
         anchors), MAN_ANCHOR_Y, CLOTHING_LAYER_ORDER, baseTypeDerivations.
USED BY: process-clothing, items/index, wardrobe.astro, profile, dress-model.
DO NOT CHANGE WITHOUT: godkendelse — defaults/anchors/lag er låst (Rule10/12).
```

```text
FILE: src/lib/shared/clothing-geometry.ts  (normalized-v1 contract),
      clothing-assets.ts (AI-ready assets/URLs/version),
      dressed-base-forms (base-form-metadata)
PURPOSE: Geometry-kontrakt (PNG-dimensioner → normaliserede %), AI-ready
         asset-håndtering, base-form-metadata delt mellem klient og server.
USED BY: items/[id].ts (geometry-validering), items/index, dress-model,
         process-clothing, personal-model, wardrobe.astro.
DO NOT CHANGE WITHOUT: godkendelse (Rule9/12).
```

```text
FILE: src/lib/server/ai/*
PURPOSE:
  base-forms.ts      Henter master form fra storage/tabel dressed_base_forms,
                     GATE = "must be exactly1024×1536" (linje54); garderet adgang.
  config.ts          Model/endpoint-konfiguration (INKL. global BYPASS der
                     sletter billeder — LÆS før brug).
  openai-images.ts   OpenAI-kald; LOCKED ved25s timeout → job skal rette asynkront.
  fashn-space.ts     Try-on leverandør (endepunkt for try-on).
  image-input.ts     Input-håndtering (5MB PNG, base64, dimensioner).
  job-launcher.ts    Oprettelse af generation-jobs (proces-sikkerhed).
  background.ts      Baggrunds-finalisering af jobs (BACKGROUND_JOB_SECRET).
  generation-usage.ts Server-side kvote-tælling (reservation m. regresstjek).
  jobs/character-job.ts   AI-karakter-job (prompt+input-jobs i transaktion).
  jobs/clothing-job.ts    AI-tøj-job (canonical form = geometry, foto = design).
USED BY: /api/ai/*-ruter.
DO NOT CHANGE WITHOUT: godkendelse (Rule9) — kanon1024×1536-låsning og25s-timeout.
```

### components / layouts / styles / configuration

```text
FILE: src/layouts/Layout.astro
PURPOSE: HTML-skal med <Header variant={header}> + <Footer />, importerer
         global.css + generation-flow; sørger for session-faneblad.
DO NOT CHANGE WITHOUT: godkendelse — påvirker alle sider.
FILE: src/components/Header.astro, Footer.astro, ProfileTheme.astro
PURPOSE: Header (navigation, bruger via lib/supabase), Footer, ProfileTheme
         (side-tema; bruges af closet/profile/wardrobe via <ProfileTheme />).
DO NOT CHANGE WITHOUT: godkendelse (Rule6).
FILE: src/styles/*.css (10 filer)
PURPOSE: global (tokens+computer-ramme), layout, wardrobe (DRESSED+editor),
         profile, closet, home, login, signup, profile-theme, flow-progress.
         DETALJER: §3.8/Del5 nedenfor.
FILE: astro.config.mjs, tsconfig.json, package.json, .env(.example)
PURPOSE: Astro/TS-konfiguration (paths:@/*→src/*), afhængigheder (astro, supabase-js,
         openai, pngjs, zod) og miljønøgler (PUBLIC_SUPABASE_* gentaget i .env —
         kendt rod, se status). INGEN test-script i package.json.
DO NOT CHANGE WITHOUT: godkendelse (konfiguration = uden for scope).
```

## 3.3 PAGE STRUCTURE (oversigt)

Alle sider renderer i `Layout.astro` (Header + Footer), undtagen hvor andet er sagt.

```text
PAGE: DRESSED            FILE: src/pages/wardrobe.astro (+ wardrobe.css)
SECTIONS (efter classnavne i kode/CSS):
1.  Layout (Header/Footer/ProfileTheme)
2.  .dressed-flow-progress      (AI-genererings trin-indikator)
3.  .stage-area / .dressed-canvas (model-canvas, aspect2/3)
    └ .dressed-clothing-layers  (lag-container, pointer-events:none)
       ├ base <img> (z0)
       └ .dressed-clothing-layer (pr. item, absolute+inset:0, transform-vars)
4.  aside.outfit-panel
    ├ .outfit-grid              (clothing thumbnails + AI-ready-state)
    ├ .outfit-bar               (knapgruppe + ADJUST/placement-panel)
    ├ saved-outfits liste (SAVE/OUTFITS via dataset-routing i wardrobe-ai)
    └ .ai-usage-*               (kvote-visning/reservation)
5.  .placement-panel            (slider, anchor-select, RESET, DONE) —
                                placeret INDE i .outfit-bar (clipping-fix)
6.  .dressed-character-*        (AI-model-flow)
7.  .dressed-result-dialog      (resultat-preview af AI-kørsler)
8.  .dressed-tiktok-toast       (notifikationer)
JS:   state + layers + editor + pointer/wheel/pinch + persistence + AI-calls.
API:  items GET/POST/DELETE/PATCH · outfits GET/POST/DELETE · ai/* · usage.
```

```text
PAGE: PROFILE            FILE: src/pages/profile.astro (+ profile.css, profile-theme.css)
SECTIONS:
1.  Layout + <ProfileTheme />
2.  Profilinformation (identity/avatar/stat)
3.  Character/model (kilde-foto + AI-model-flow, .profile-source-*)
4.  Wardrobe-upload / kilde-foto-knap (POST /api/profile/source-photo)
5.  Model-visning med outfit (.profile-model-*, .character-model-frame)
6.  #profile-outfits (outfit-vælger; localStorage dressedSourceOutfitId →
    genvisning på /dressed)
7.  Kvote/usage-tekst (reserved≥failed, ingen dublet-tæller)
```

```text
PAGE: CLOSET             FILE: src/pages/closet.astro (+ closet.css)
SECTIONS: 1 Layout + <ProfileTheme/> · 2 .closet-library-heading ·
3 liste/grid over wardrobe_items (thumbnail, kategori, AI-ready-state) ·
4 sletning (DELETE) · 5 ingen model/lag/placement-visning.
```

```text
PAGE: INDEX/LOGIN/SIGNUP FILE: src/pages/{index,login,signup}.astro
SECTIONS: landing ("Your closet. Reimagined.") / auth-formularer → Supabase.
```

## 3.4 PROFILE (sektion for sektion)

Bygget på `profile.astro` + `lib/client/{dressed-character,profile-outfits}`:

1. **Header/identitet** — `.profile-theme-*` (ProfileTheme-tema) + profilnavn/stat.
2. **Kilde-foto** — `.profile-source-collage/-photo/-actions`: upload-knap der
   poster til `/api/profile/source-photo` (OpenAI image-input) og starter
   model-generering via `generation-flow`.
3. **Character/model** — `.profile-model-*` + `.character-model-frame`: viser det
   valgte outfit på samme måde som DRESSED.
4. **Wardrobe/AI-ready workflow** — tekster/knapper der fører til closet/wardrobe.
5. **Outfit-vælger (`#profile-outfits`)** — henter outfits via
   `loadDressedOutfits()` (API med REST-fallback) og wardrobe via den **samme**
   `loadPersistentWardrobe()`; vælg ⇒ `dressedSourceOutfitId` i localStorage ⇒
   render med `resolveItemPlacement(item.placement)` ⇒ klik ⇒ navigation til
   /dressed med det samme valg (kontrakt med wardrobe-siden).
6. **Kvote** — usage-tekst (server-reservation, ingen lokal tæller-dublet).

**Vigtige fakta:** kun `#profile-outfits`-panelet og localStorage-nøglen må
påvirkes af outfit-valg. Profile og DRESSED er ikke forbundet via nogen særskilt
model-forbindelse — de deler data via `wardrobe_items`-id'er og den fælles resolver.

## 3.5 CLOSET

- **Page-structure:** `Layout` (Header/Footer) → `<ProfileTheme />` →
  `.closet-library-heading` → liste/grid af items (`.closet-grid` i layout.css).
- **Item cards:** thumbnail = AI-ready asset-URL (via `clothing-assets`),
  kategori-farve/badge, AI-ready-state-angivelse.
- **Images:** kun fjern-thumbnails fra Supabase Storage (signerede URLs) —
  **ingen** billedfiler udover faviconer ligger i repoet til closet (se
  `docs/DRESSED-ASSETS-AND-MEDIA.md`).
- **Delete:** `DELETE /api/wardrobe/items/[id]` (auth + bruger-ejerskab; trigger
  i migration0012 rydder referencer i `saved_dressed_outfits`).
- **Item IDs:** de **samme** `wardrobe_items.id` som i DRESSED — closet opretter
  aldrig kopier.
- **API:** `GET /api/wardrobe/items` (inkl. `placement`), `DELETE .../[id]`.
- **Forhold til DRESSED:** closet = bibliotek/styring; DRESSED = komposition.
  Placement vises/behandles kun i DRESSED (og Profile-render).

## 3.6 DRESSED (siden wardrobe.astro — komplet)

**Model canvas:** `.dressed-canvas` (aspect-ratio2/3; max bredde
493px >1050bp,413px >800bp,333px nedenunder; kortere kadre >750bp) med base-`img`
og `.dressed-clothing-layers` ovenpå — alt i **samme** `position:absolute; inset:0`
-boks ⇒ ét koordinatsystem. `.dressed-stage-skip` skjuler stage/slides før
`--dressed-stage-on`. Skift af model: udskift base-`src` (samme tilstand; ingen
gen-indlæsning).

**Clothing layers:** pr. item ét `<img class="dressed-clothing-layer">` med
inline `z-index` = indeks i det stablet sorterede `selectedItems`
(`clothingLayerOrder`: socks…tops…jackets…; base =0). Containeren er
`pointer-events:none`; kun det **redigerede** lag får `--editing`
(`pointer-events:auto` + `touch-action:none` + webkit-select/callout-sikring).
`renderClothingLayers` opretter/omplacerer `<img>`'s og ændrer **kun**
`style.cssText`/anchor/class på de relevante lag.

**Placement (per item):** inline CSS-variabler sat af `applyLayerPlacement`:
`--anchor-x/--anchor-y` (fra `dressedAnchor(anchor, baseType)` — procent),
`--clothing-scale` (placement.scale), `--clothing-x/--clothing-y`
(placement x/y, `%`). Transform: `translate(...) scale(calc(--clothing-base-scale ×
--clothing-scale))` med `transform-origin: calc(--anchor-x*100%) …`.

**Editor (ADJUST):** `.placement-panel` inde i `.outfit-bar` med:
- **scale-slider** (`.placement-field` input=range, `touch-action:none`) —
- **left-click + wheel** over det redigerede lag (desktop; `passive:false`,
  `e.preventDefault()`, jitter-guard `wheelScaleActive`),
- **pinch** (to pege → kun `{scale}`), alt via `setPlacementOverride({scale})`
  → clamp0.4–2.0;
- **drag** (pege-capture, offset-korrekt, flytter IKKE pga. wheel-guard);
- **anchor-select** (15 anchors);
- **RESET** (permanent `placement=null` → defaults) og **DONE**
  (`parsePlacement` → `saveItemPlacement` → PATCH per-item → toast-tekst
  "Clothing placement saved." / "Clothing placement not saved.").
Redigeringstilstand: `editingItemId`, `editingAnchor`, `placementOverrides`
(session), `dirtyPlacementIds` → `beforeunload`-advarsel.

**Persistence:** GET-fragmentet på `wardrobe_items` inkluderer `placement`
(fallback `null` hvis kolonnen mangler i deploy); ADD-genbruger id; profil-render
bruger samme resolver ⇒ samme placering.

**Controls/øvrigt:** outfit-grid, kvote (`ai-usage-*` med server-reservation),
SAVE/OUTFITS (dataset-routing i `wardrobe-ai.ts`), AI-dialog-flows
(character/process/dress/try-on), `.dressed-result-dialog` preview, toast.

**Lag vs. placement (adskilt!**): at flytte i tab rækken ændrer **kun**
z-index; at flytte/skalere ændrer **kun** CSS-variabler — aldrig hinanden.

## 3.7 API ROUTES (komplet)

Fælles: alle ruter har `export const prerender = false`, kalder
`authenticateSupabaseRequest` (Bearer-JWT →401 ved manglende/ugyldig),
svarer JSON, logger `console.error` ved DB-fejl. Fejl-bodyer skjuler
`code/details/hint` (kun serverlog) — kendt debuggning-brist.

```text
METHOD  ROUTE                              PURPOSE / IO / DB / VALIDATION
GET     /api/wardrobe/items                Liste brugerens wardrobe_items med
                                           {id, category, base_type, gender,
                                           image_url, placement} (+AI-ready
                                           URL'er). placement-kolonnen er
                                           med-fallback: mangler kolonnen i
                                           deploy → null (fejl-hårdhed, ikke
                                           "ingen data").  DB: wardrobe_items
                                           (+storage-URLer).
POST    /api/wardrobe/items                Opret/registrer clothing item
                                           (gender/base_type/category/
                                           reference_path). Bruges af ADD-
                                           flowet; genbruger id ved re-add.
                                           DB: wardrobe_items (+assets).

DELETE  /api/wardrobe/items/[id]           Slet item + tilhørende storage.
                                           Auth + ejerskab; trigger0012 rydder
                                           saved_dressed_outfits. DB:
                                           wardrobe_items, outfits.
PATCH   /api/wardrobe/items/[id]           PERSISTENCE AF PLACEMENT.
                                           Input: {placement:{anchor,x,y,scale}}
                                           → parsePlacement (server) →
                                           createSupabaseServiceClient().update
                                           {placement, updated_at} m. filtre
                                           user_id+id. Output: {placement};
                                           400 invalid, 404 hvis0 rækker,
                                           generisk 5xx ved DB-fejl.
                                           DB: wardrobe_items.placement (JSONB).

GET     /api/wardrobe/outfits              Liste gemte outfits ({id,name,
                                           item_ids, ...}). DB: saved_dressed_outfits.
POST    /api/wardrobe/outfits              Gem outfit via RPC
                                           save_dressed_outfit (item_ids;
                                           status-queue med retry på klienten).
DELETE  /api/wardrobe/outfits/[id]         Slet outfit. DB: saved_dressed_outfits.

DELETE  /api/characters/[id]               Slet character + relaterede data
                                           (læser dressed_characters +
                                           wardrobe_results; afsluttes med
                                           RPC-kald). DB: dressed_characters,
                                           wardrobe_results m.fl.

POST    /api/ai/process-clothing           Tøjfoto → AI-ready clothing layer
                                           (job via job-launcher/clothing-job:
                                           canonical form = geometry, foto =
                                           design; dimensioner valideres).
                                           Kvoter reservation. DB:
                                           wardrobe_items,
                                           wardrobe_item_ai_assets,
                                           ai_generation_*.
POST    /api/ai/personal-model             Personfoto → personal model
                                           (job-launcher/character-job,
                                           base-forms, image-input).
                                           DB: dressed_characters, generation-*.
POST    /api/ai/dress-model                Komponer outfit på model
                                           (openai-images, clothing-categories/
                                           assets, generation-usage).
POST    /api/ai/try-on                     Prøv-tøj-å-visning via
                                           fashn-space-leverandøren. DB:
                                           generation-*.
GET     /api/ai/usage                      Kvote-status via RPC
                                           get_ai_generation_usage (reserved/
                                           failed/succes).

```

## 3.8 DATABASE CODE + CURRENT DATABASE / SUPABASE SPECIFICATION

### Migrations (14 filer i `supabase/migrations/` — beskrivelse efter filnavn + forbrug i kode)

```text
202610040001_dressed_ai_wardrobe.sql                     Grundlæggende schema + RLS + RPC'er
202610040002_character_bound_clothing_assets.sql          AI-ready assets bundet til character
202610040005_clothing_previews_and_asset_versions.sql     Previews + asset-versioner
202610040008_clothing_ai_generation_commit.sql            Generation-commit flow
202610040010_base_type_clothing_assets.sql                base_type + OPRETTELSE AF
                                                          dressed_base_forms (rows indsatet:
                                                          base_type + storage_path; RLS:
                                                          select-only authenticated)
202610040011_secure_clothing_generation_finalization.sql  Sikker job-finalisering
202610040012_normalized_character_geometry_and_saved_outfits.sql
                                                          normalized-v1 geometry +
                                                          saved_dressed_outfits +
                                                          delete-trigger (rydder outfits ved
                                                          sletning af wardrobe_item)
202610040013_add_socks_category.sql                       socks-kategori
202610040014_fix_save_dressed_outfit_ambiguity.sql        RPC-ambiguitetsfix
202610040015_ai_quota_limits_and_owner_exemption.sql      Kvote-limits + owner-fritagelse
202610040016_background_ai_generation_finalization.sql    Baggrunds-finalisering (jobs)
202610050001_clothing_quota_override_test_user.sql        Kvote-override for testbruger
202610050002_wardrobe_items_placement.sql                 + placement jsonb NULL, CHECK
                                                          (anchor15 værdier, x/y ±60,
                                                          scale0.4–2), nullable = OK
202610050003_fix_wardrobe_items_placement_check.sql       RETTELSE AF0002-CHECK
```

### HVORFOR 0003 EKSISTERER

I0002 blev CHECK'en skrevet med `jsonb_typeof(placement -> 'anchor') = 'text'`.
**PostgreSQL returnerer `'string'`** (JSON-types hedder `string`, ikke `text`) ⇒
betingelsen var **altid false** for non-null placement ⇒ enhver gyldig
`{anchor,x,y,scale}` blev afvist med **`23514`** ⇒ PATCH svarede generisk **5xx**
⇒ placement blev aldrig skrevet (kun session) ⇒ forsvandt ved refresh.
0003 dropper og genskaber constrainten med `= 'string'` — **øvrige semantik er
uændret** (samme anchors, clamps, nullable). Verificering efter kørsel:
`select convalidated from pg_constraint where conname='wardrobe_items_placement_check'` → `true`.

### Tabeller (nøgler)

```text
profiles                       Brugerprofil (auth.uid())
dressed_characters             Personlig AI-model pr. bruger
dressed_base_forms             REFERENCE til master forms (base_type, storage_path;
                               select-only authenticated; bruges af server/ai/base-forms)
wardrobe_items                 Clothing items. PK (user_id, id).
                               KOLONNER (udvalg): name, category, reference_path,
                               original_path, preview_path, created_at, updated_at,
                               PLACEMENT JSONB NULL  ← {anchor,x,y,scale}
wardrobe_item_ai_assets        AI-ready layer pr. (user,item,base_type) med
                               generationVersion (CURRENT =3) + asset_version;
                               signerede URLs
wardrobe_results               AI-resultat-billeder m.m.
saved_dressed_outfits          item_ids text[] + character_id + base_type + name
                               (+ outfit_key); INGEN placement
ai_generation_usage/limits/
limit_overrides                Kvote-system (RPC get_ai_generation_usage)
wardrobe_assets (legacy)       Ældre asset-tabel — bevist bevaret (Rule4)
```

### Constraints / datatyper

- `wardrobe_items.placement`: **jsonb** (IKKE text), `NULL` gyldigt = default.
- CHECK (efter0003): `anchor`-typeof = `'string'` og værdi ∈15 anchors; `x`,`y`
  numerisk ±60; `scale` numerisk0.4–2.0; `placement IS NULL` eller komplet.
- PK `(user_id, id)`; outfits-FK: `saved_dressed_outfits` → `dressed_characters`
  (kun dén FK; `user_id` på outfit-tabellen har INGEN FK); trigger0012.

### RLS + service-rolle + adgangsmønstre

- **Klient-læs/skriv:** `authenticateSupabaseRequest` → anon-client med
  bruger-JWT → RLS (`auth.uid() = user_id`-mønstre; `revoke ... from public, anon`).
- **Service-rolle (`createSupabaseServiceClient()`)** bruges bevidst kun steder
  hvor RLS er i vejen eller ejerskab håndteres explicit: **placement-UPDATE
  (PATCH)**, job-finalisering/storage-signering. UPDATE'en filtrerer stadig på
  `user_id` + `id`.
- **RPC'er:** `save_dressed_outfit`, `get_ai_generation_usage`, character-
  sletnings-RPC m.fl. — kalder via `.rpc(...)`.

### Kendt database-relateret svaghed (dokumenteret, ikke løst her)

- Tre-parts validering (client `parsePlacement` / server `parsePlacement` / DB
  CHECK) kan drive fra hinanden —0002/0003 var netop et eksempel.
- GET-fallback `placement:null` ved MANGLENDE kolonne er uadskelligt fra "ingen
  værdier" (deploy-sikkerhed vs. debuggning).
- PATCH-fejlbodyer skjuler DB-fejl-koder (kun serverlog).

## 3.9 CSS / DESIGN SYSTEM OVERVIEW (Del 5)

### Filroller

```text
global.css        Google Fonts @import (DM Mono400/500, DM Sans400–700,
                  Playfair Display500/600) + :root-tokens + reset + body-baggrund
                  + .computer-ramme (min(1400px,100%-40px)) + header/footer.
layout.css        Sidens skeletter: .outfit-panel/.outfit-grid (kolonner
                  152px → layout-bp700), .profile-banner, .closet-grid, m.fl.
wardrobe.css      HELE DRESSED: .wardrobe-screen, .stage-area, .dressed-canvas,
                  lag, thumbs, editor (.placement-panel), karakter-panel,
                  flow-progress, kvote, result-dialog, toast + breakpoints.
profile.css       Profil-side (character, source, outfits) + kvote-tekst.
profile-theme.css ProfileTheme-tema (--profile-theme-*/--profile-model-*).
closet.css        Bibliotek (liste/grid/kort).
home/login/signup.css + flow-progress.css  (flow-progress har kun
                  prefers-reduced-motion).
```

### Tokens (global.css `:root`)

Farver: `--pink-100…600` (#fff0f6→#d93676), `--cream`, `--white`,
`--grey-100…900` (#f1edf0→#29242a), `--purple`, `--blue`, `--yellow`,
`--border` (#5d535b), `--pixel-shadow` (4px/7px offset). Typografi: body
`"DM Sans"`, UI `"DM Mono", monospace`, display `Playfair Display`.
Baggrund: radial-gradient pink/lilla over #f7e8ef. Ingen lokale font-filer —
kun Google-Fonts-import.

### Responsive breakpoints (faktiske `@media` pr. fil)

| Fil | Breakpoints |
|---|---|
| wardrobe.css | ≤1050, ≤800 (canvas max493→413), ≤750 (kortere kadre), ≤550 (333px) |
| global.css | ≤900, ≤600 |
| profile.css / home.css | ≤850, ≤550 |
| closet.css | ≤700, ≤900 |
| layout.css | ≤700 |
| flow-progress.css | prefers-reduced-motion: reduce |
| login/signup/profile-theme.css | ingen media queries |

### Model canvas

`.dressed-canvas`: `aspect-ratio:2/3` (locked), maks-bredde493 →413 →333 px,
`overflow:hidden`/`--dressed-stage-skip`-skjul, base-`img` + `.dressed-clothing-layers`
begge `position:absolute; inset:0` ⇒ ét fælles koordinatsystem. Visning
styrkes af `--dressed-*`-variabler (gender, panel, grid, result-*, scale-on).

### HVOR CLOTHING SCALE KOMMER FRA (kæden — vigtigst)

```text
KILDE: placement.scale (0.4–2.0)  ← slider | left-click+wheel | pinch
        ↓ setPlacementOverride / applyLayerPlacement (inline pr. lag)
--clothing-scale      : per-lag placement-scale (fallback = CLOTHING_PLACEMENT.default)
--clothing-x / -y     : placementens position, i `%` (aldrig px)
--anchor-x / -y       : procent fra dressedAnchor(anchor, baseType)
        ↓
--clothing-base-scale : wardrobe.css = var(--dressed-clothing-scale, 1)
                        profile.css  = 1
--dressed-clothing-scale : GLOBAL zoom-hook — sættes af INGEN kode i dag
                        ⇒ faller til1 (bevidst åbent hook, ikke skjult skala)
        ↓
transform: translate(--clothing-x, --clothing-y)
           scale(calc(--clothing-base-scale × --clothing-scale))
transform-origin: calc(--anchor-x * 100%) calc(--anchor-y * 100%)
```

Regler: uniform scale (ingen x/y-forskel), kun `transform-origin`-variationer pr.
anchor, **ingen skjulte faktorer** (Rule14). `touch-action:none` findes kun på
`.dressed-clothing-layer--editing` og placementslidersen (Rule16).




```text
FILE:
src/pages/closet.astro            ← bibliotek
src/pages/index.astro             ← landing ("Your closet. Reimagined.")
src/pages/login.astro, signup.astro ← Supabase auth

PURPOSE:
Closet: liste/filtrering/sletning af wardrobe_items (AI-ready-state).
Index: præsentationsside. Login/signup: auth og omdirigering.

IMPORTANT DEPENDENCIES:
@/styles/closet.css (+home/login/signup), @/components/ProfileTheme (kun closet),
Layout (Header+Footer).
```
