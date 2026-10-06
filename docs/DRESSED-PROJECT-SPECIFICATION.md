# DRESSED PROJECT SPECIFICATION & DEVELOPMENT RULES

> Denne fil er projektets **source of truth** for arkitektur og udviklingsregler.
> Enhver AI-agent (Cline, Claude Code, GitHub Copilot) skal læse dette dokument
> **før** den ændrer noget. Tilstanden er baseret på faktisk kode pr. dokumentationsrunden.

---

## 2.1 PROJECT PURPOSE

**DRESSED** er en AI-dressing room web-app bygget i **Astro + Supabase + OpenAI**.

Brugeren kan:
1. Oprette konto og uploade et personligt foto (**Profile**) → AI genererer en
   personlig model ("character") baseret på projektets **canonical master forms**.
2. Uploade tøj (**wardrobe items**) → AI processorer det til et **AI-ready clothing
   layer** på det kanoniske1024×1536-canvas.
3. Komponere outfits på modellen (**DRESSED**/siden `wardrobe`): tilføje/fjerne tøj,
   omarrangere lag (layer order), **justere placement pr. item** (anchor/x/y/scale
   med slider, desktop-wheel og pinch), gemme **saved outfits**.
4. Se sit valgte outfit på **Profile** med samme visning som DRESSED.
5. Styre biblioteket i **Closet** (se/filtere/slette clothing items).

Sammenhængen: **Profile** (identitet + model + upload) → **Closet** (bibliotek) →
**DRESSED** (komposition + placement) → **Saved Outfits** (genbrugelige sæt af item-ids).

```text
USER
 ↓
PROFILE          (foto, model, AI-generation, outfit-valg)
 ↓
WARDROBE ITEMS   (tøj-uploads; wardrobe_items.id = identitet)
 ↓
AI CLOTHING PROCESSING  (canonical form = geometry, foto = design)
 ↓
AI-READY CLOTHING       (1024×1536 transparent layer pr. base_type, version3)
 ↓
DRESSED          (browser-komposition: layer order + placement)
 ↓
OUTFIT COMPOSITION (saved_dressed_outfits = item_ids; ingen placement)
```

## 2.2 CORE ARCHITECTURE

```text
┌──────────── CLIENT (Astro pages + vanilla TS) ────────────┐
│ wardrobe.astro   DRESSED: model-canvas, layers, editor    │
│ profile.astro    Profile: model + outfit-vælger           │
│ closet.astro     Bibliotek (thumbnails)                   │
│ lib/client/*     wardrobe-ai, profile-outfits, character  │
└───────────────┬───────────────────────────────────────────┘
                │ fetch (Bearer-JWT)             ┌──────────┐
┌───────────────▼───────────────────────────────┐│ Supabase │
│ /api/* routes (authenticateSupabaseRequest)   ││          │
│  wardrobe items/outfits · ai/* · profile ·    │├──────────┤
│  placement-UPDATE på service-klient           ││ REST +   │
└───────────────┬───────────────────────────────┘│ Storage  │
                │ server/lib/ai/* (OpenAI)       │ + RPC    │
┌───────────────▼──────────────────┐             └──────────┘
│ AI jobs: character/clothing/     │
│ personal-model · try-on ·        │
│ canonical master forms (geometry)│
└──────────────────────────────────┘
```

```text
WARDROBE ITEM (wardrobe_items.id = identitet)
      ↓
placement {anchor,x,y,scale}  ← JSONB på samme række (aldrig i outfits)
      ↓
Supabase (GET /api/wardrobe/items)
      ↓
resolveItemPlacement: session → persisted → default
      ↓
CSS-variabler → Profile OG DRESSED (samme renderer-matematik)
```


---

# NON-NEGOTIABLE RULES FOR AI CODING AGENTS (§2.3)

Disse regler gælder altid. Overtrædelse = stop og spørg brugeren.

### Rule 1 – Never remove existing functionality
Ingen eksisterende funktionalitet må fjernes eller ændres utilsigtet.
Hvis en ændring påvirker eksisterende funktionalitet:
**STOP → analyse → test → implement.**

### Rule 2 – Preserve existing architecture
AI-agenter må ikke opfinde en ny arkitektur, når projektet allerede har en
fungerende løsning (f.eks. én pointer-sti i stedet for parallelle touch-mekanikker,
CSS-variabel-placement i stedet for transform-pixel-lagring).

### Rule 3 – Minimal changes
Ændr kun det, der er nødvendigt for den aktuelle opgave.

### Rule 4 – No unrelated refactoring
Ingen "cleanup", restructuring eller refactoring uden eksplicit godkendelse —
selvom koden ser forældet ud (legacy-tabeller som `wardrobe_assets` er bevist
hensigt).

### Rule 5 – Read before modifying
Undersøg altid først: components, APIs, CSS, shared logic, database/migrations og
eksisterende dokumentation (`docs/`, `analysis/`) — også for at se, om lignende
problemer allerede er løst/analyséret (f.eks. skalering via layout-transform).

### Rule 6 – Preserve user-facing behaviour
Eksisterende flows (login → profil → closet → DRESSED → gem outfit → profile)
skal fortsat virke uændret.

### Rule 7 – Database safety
Ingen ændringer til tabeller, kolonner, constraints, RLS, policies eller migrations
uden eksplicit godkendelse. Én migration pr. navngivet ændring; idempotente
`IF NOT EXISTS/EXISTS`-opgraderinger.

### Rule 8 – API safety
Eksisterende API contracts (stier, metoder, JSON-felter) må ikke ændres uden
eksplicit godkendelse. Nye felter tilføjes kompatibelt.

### Rule 9 – AI safety
AI prompts, job-struktur og generation architecture må ikke ændres uden eksplicit
godkendelse. Canonical1024×1536-koordinatsystemet (mål, PNG-dim-tjek, JSON-schema)
må ikke rokkes.

### Rule 10 – Placement safety
**Placement og layer er separate systemer.**
Layer = z-index/renderingsrækkefølge. Placement = position/scale/anchor pr. item.
Brug ALDRIG layer-logik til at løse placement-problemer eller omvendt; placement
ændrer aldrig z-index, og z-index ændrer aldrig placement.

### Rule 11 – Persistence safety
`wardrobe_items.id` er identiteten for et clothing item. **Placement tilhører
item'et — ikke et outfit.** Saved outfits indeholder kun `item_ids`. `NULL`
placement betyder "brug category-defaults".

### Rule 12 – Coordinate system
Canonical master forms (`woman.png`/`man.png`,1024×1536) er geometry source of
truth. AI må ikke opfinde alternative koordinatsystemer, croppe, zoome eller
skifte canvas — og klienten må ikke gemme enhedsløse place-værdier.

### Rule 13 – Browser authority
CSS/browser-komposition er den endelige autoritet for tøjplacement. Layout-transform
(`position:absolute` + `inset:0` + `object-fit:contain` + `transform` med
`transform-origin`) registreres/beholder, hvad browseren faktisk render.

### Rule 14 – No hidden scaling
Ingen skjulte scale-faktorer må introduceres (ingen dobbelt-normalisering, ingen
uiZoom i stedet for den valgte scale, `===` før værdi-logning).

### Rule 15 – Responsive safety
Desktop/mobile-ændringer må ikke ødelægge andre breakpoints; responsive updates
skal breakpoint-logges på tværs (gældende breakpoints: wardrobe1050/800/750/550,
global900/600, profile/home850/550, closet700/900, layout700).

### Rule 16 – Touch safety
Touch-interaktion må aldrig implementeres ved at blokere scrolling globalt.
Kun lokale `touch-action: none` på det element der aktivt manipuleres
(aktuel: `.dressed-clothing-layer--editing` + placementslideren).

### Rule 17 – Testing
Efter ændringer køres relevante eksisterende tests (`npm run build`,
`npx tsc --noEmit`; testsuites er pt. eksterne harnesses — se testmatrixen i
`analysis/DRESSED-CURRENT-STATUS.md`).

### Rule 18 – Do not claim verification without verification
Skriv aldrig "verified" uden faktisk test (live eller automatiseret) — og markér
klart forskellen mellem automatiseret test, live-test og feature-implementeret.

### Rule 19 – Documentation
Når arkitektur ændres efter godkendelse, opdateres relevante dokumenter
(særlig `docs/DRESSED-PROJECT-SPECIFICATION.md`, `docs/DRESSED-CODEBASE-OVERVIEW.md`,
`analysis/DRESSED-CURRENT-STATUS.md`).

### Rule 20 – STOP condition
Hvis en opgave kræver ændring af eksisterende arkitektur eller kan påvirke
central funktionalitet: **STOP AND ASK BEFORE IMPLEMENTING.**

---

## 2.4 CRITICAL SYSTEMS

| System | Purpose | Files | Må IKKE ændres uden godkendelse | Typiske fejl |
|---|---|---|---|---|
| **wardrobe_items** | Identitet + metadata pr. item | migrations 0001 → 00040002 → 0005 → 0012 → 0013 → 202610050002 → 202610050003, `api/wardrobe/items/*` | PK `(user_id,id)`, NOT NULL-kolonner, slet-adfærd (trigger0012) | Dubletter ved re-add (lukket af ADD-genbrug); forkert user-filter |
| **placement** | Pr. item: anchor/x/y/scale | `202610050002`+`0003`, `api/wardrobe/items/[id].ts` PATCH, `lib/shared/clothing-placement.ts`, `wardrobe.astro` editor | JSONB-typen, CHECK-semantik, resolver-prioritet, clamp | CHECK=`'text'`-fejlen (fix0003);9-lags determinisme; session-glemt ved refresh |
| **AI clothing generation** | Tøj-foto → AI-ready layer | `api/ai/process-clothing.ts`, `server/ai/jobs/clothing-job.ts`, `server/ai/{config,openai-images,fashn-space,image-input,job-launcher,background}.ts`, prompts | Canvas/mål, PNG-dim-tjek, job-status 4-tilstande, retry/25s-baghold, idempotens | Leverandør-SOLV reference-fallback; dev-throw blokkerer pipeline |
| **Canonical master forms** | Geometry source of truth | `src/assets/system-reference/base-forms/{woman,man}.png` (1024×1536), `server/ai/base-forms.ts`, tabel `dressed_base_forms` | Filstørrelser/dimensioner, tabel, storage-bane | "must be exactly1024×1536"-assert fail; forkert base_type-valg |
| **Personal models** | Personfoto → character | `api/ai/personal-model.ts`, `character-job.ts`, `lib/client/dressed-character.ts` | geometry contract `normalized-v1`, `character_transforms` | Forkert transform-overlay (`DRESSED_ANCHORS` er char-positionering, IKKE fotoskala) |
| **AI-ready assets** | Versioneret output | `wardrobe_item_ai_assets`, `clothing-assets.ts`, `api/ai/process-clothing.ts` | `generationVersion ===3`, `(user,item,base_type)`, signerede URLs | Legacy-tabeller (`wardrobe_assets`) refaktoreres IKKE væk |
| **DRESSED renderer** | Browser-komposition | `wardrobe.astro`, `wardrobe.css` | Lag-HTML-paradigme, `pointer-events`-modellen, ADD-genbrug af id | Ny image-runtime pr. frame (tung); scaling via px-transform |
| **Saved outfits** | Genbrugelige sæt | `saved_dressed_outfits`, RPC `save_dressed_outfit`, `api/wardrobe/outfits/*` | Kun `item_ids` (ingen placement), status-queue + retry | Indlejret duplicering af items; save-action kaldt ved ANDEN knap (klik-ruteredelekation) |
| **Profile renderer** | Samme visning som DRESSED | `profile.astro`, `profile-outfits.ts` | Samme resolver, KUN `#profile-outfits`-panelet, ingen model-subscription | Global querySelectors ændrer andre sider; localStorage-contract brudt |
| **Supabase** | Data/storage/auth | `.env` (nøgler), `lib/server/supabase.ts`, migrations | RLS-policies, service-rolle-brug, triggers/RPC | RLS med `auth.uid()` = null; ad-hoc SQL uden migration |
| **API authentication** | Alle ruter | `authenticateSupabaseRequest` i hver rute, Bearer-JWT | Auth-flow, `x-client-info`, fejl-adfærd | Hårdefejl500 ved manglende bruger; tidskrævende RLS-kæder |
| **RLS** | Sikkerhed pr. bruger | alle migrations' policies | `USING`/`WITH CHECK`, service-klient-undtagelser | CHECK der afviser gyldige værdier (0002→0003); policy-konflikt |
| **Layer system** | Renderingsrækkefølge | `clothingLayerOrder`, `zoneLayerOrder`, z-index = indeks, `.dressed-clothing-layers{pointer-events:none}` | Rækkefølgen, `--editing`-opt-in, base z=0 | At bruge z-index til at "fixe" placement (Rule10) |
| **Responsive model canvas** | 2:3 canvas på alle skærme | `wardrobe.css` `.dressed-canvas` (aspect-ratio2/3; max493/413/333px), profilens kadre | aspect-ratio, breakpoints, layout-transform-varianter | Fusionér breakpoints forkert ⇒ kæmpet {308,284,198}-regression |

## 2.5 DATA OWNERSHIP RULES

```text
wardrobe_items.id
    = identity of individual clothing item
      (PK (user_id, id); ADD genbruger samme id → ingen dubletter)

wardrobe_items.placement
    = placement belonging to that clothing item
      (nullable JSONB {anchor,x,y,scale}; NULL = category-defaults;
       BEKRÆFTET live: PATCH → refresh → samme placement)

saved_dressed_outfits.item_ids
    = references to clothing items
      (text[] — KUN referencer; ingen placement/scale/x/y/anchor gemmes her)

layer / z-index
    = rendering order ONLY (sorteret ud fra selectedItems + clothingLayerOrder)

placement (anchor, x, y, scale)
    = position/scale ONLY (skriver CSS-variabler; ændrer aldrig z-index)
```

**Forskellen:** identitet (`id`) bestemmer *hvad* der vises; `placement` bestemmer
*hvor/så stort* det vises på netop det item; `item_ids` bestemmer *hvilke sæt*
der vises (sammensætningen); `layer` bestemmer *i hvilken rækkefølge* lagene
ligger. At kopiere placement ind i outfits → data-duplicering og forkerte værdier
når et item ændres. At bruge z-index til positionering → ustabil render.

---

## 2.6 APPROVED ARCHITECTURE (source of truth — ingen ændring uden godkendelse)

1. **Stack:** Astro (SSR) + vanilla TS i pages + egne CSS-filer; Supabase
   (Postgres+RLS+Storage+RPC) med Bearer-JWT pr. API; OpenAI-image-Jobs via
   `server/ai/*` (job-launcher + baggrundsjob med `BACKGROUND_JOB_SECRET`).
2. **Kanonske master forms** `woman.png`/`man.png` (1024×1536) = geometry;
   både AI-karakter og clothing-generation bruger **det samme** koordinatsystem
   (`size:"1024x1536"` + PNG-dim-tjek + JSON-contract).
3. **Placement = CSS-variabel-transform pr. lag** (ikke px-lagring), med
   resolver-prioritet `session → persisted → category default` gennem én delt
   `resolveItemPlacement` brugt af **både** Profile og DRESSED.
4. **Persistence:** `wardrobe_items.placement` (nullable JSONB) via
   `PATCH /api/wardrobe/items/[id]` på service-klienten; outfits gemmer **kun
   `item_ids`**; ADD-genbruger samme `wardrobe_items.id`.
5. **Layer = z-index fra selectedItems** (stable `clothingLayerOrder`-sortering);
   én pointer-events-model (delegeret på `#wardrobe-model`, `--editing`-opt-in).
6. **Ét scale-system:** slider + wheel + pinch skriver samme `placement.scale`
   (clamp0.4–2.0). Der findes **ingen** zoomState/panState/canvas-transform.
7. **Touch-model:** lokal `touch-action: none` kun på aktive manipulationsflader;
   ingen global scroll-lås.
8. **Ruter** (11) og deres contracts: se `docs/DRESSED-CODEBASE-OVERVIEW.md` §3.7.

## 2.7 DOCUMENTATION RULES FOR AI AGENTS

- **Læs projekt-specifikationen (denne fil) først**, derefter de relevante sektioner
  i `docs/DRESSED-CODEBASE-OVERVIEW.md` før du modificerer filer.
- **Antag aldrig at en fil er ubenyttet** — spore imports/referencer før sletning.
- **Slet aldrig arkitektur uden at have sporet alle afhængigheder** (klient, server,
  database, tests, docs).
- **Opdater dokumentation efter godkendte arkitekturendringer** (Rule19) —
  spec + codebase-overview + current-status.
- **Erstat aldrig dokumentation med gæt.** Brug faktiske stier, faktiske
  tabeller, faktiske målinger (grep/read/build).
- **Marker aldrig en feature "verified" uden test** der faktisk er kørt
  (automatiseret vs. live angives altid).
- **Bevar historisk information hvor den er nyttig**, men **markér tydeligt
  obsolete/delvist forældte dokumenter** (status-tabellen i
  `analysis/DRESSED-CURRENT-STATUS.md` er den officielle statusliste).
- `analysis/` = historiske/tematiske analyser; `docs/` = gældende projektstate.
  Ved modstrid er **denne fil + codebase-overview** korrekte kilder.

## 2.8 FILE RELATIONSHIP MAPS

```text
Profile
  ↓ (uploader foto → personal model)   (uploader tøj)
wardrobe_items  ←──  Closet (bibliotek over de samme id'er)
  ↓
AI processing   (process-clothing: canonical form = geometry, foto = design)
  ↓
AI-ready asset  (wardrobe_item_ai_assets, generationVersion =3)
  ↓
DRESSED         (layer order + placement per id)
  ↓
Saved Outfit    (saved_dressed_outfits.item_ids → genbruger de samme id'er)
```

```text
wardrobe_items.id
      ↓
placement (JSONB på samme række)
      ↓
resolveItemPlacement  (session → persisted → default)
      ↓
Profile  ⇄  DRESSED   (samme renderer-matematik)
      ↓
Saved Outfit          (kun id'erne — placement følger stadig item'et)
```

```text
Master Form (woman.png / man.png,1024×1536)
      ↓
AI Clothing Generation (size:"1024x1536", PNG-dim-tjek, JSON-contract)
      ↓
1024×1536 Clothing Asset (transparent, AI-ready, versioneret)
      ↓
Browser Coordinate System (absolute+inset:0 = samme boks som modellen)
      ↓
Placement {anchor, x, y, scale} → CSS-variabel-transform
      ↓
Persistence (wardrobe_items.placement, PATCH via DONE)
```



