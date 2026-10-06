# DRESSED — ASTRO ARCHITECTURE ANALYSIS

> ANALYSE (documentation-only). Formål: fastslå den bedste tekniske struktur for
> at bygge DRESSED som Astro-projekt — pages vs. components vs. client-side TS
> vs. API routes — **før** `prompt.txt` skrives færdig. Konklusion i bunden:
> `## RECOMMENDED ASTRO ARCHITECTURE`.
>
> Analysen er forankret i den faktiske, verificerede arkitektur:6 Astro-sider,
>11 API-ruter, `lib/{client,server,shared}`-opdeling, pladsystem baseret på
> CSS-variabeler + Pointer Events, og **intet frontend-framework** (package.json
> indeholder kun `astro`, `@supabase/supabase-js`, `openai`, `pngjs`, `zod`).

---

## 1. Eksisterende tilstand (lærepunkter)

**Det, der fungerer og skal bevares:**
- `lib/shared/`-laget (kategorier, anchors, placement-resolver, geometry) bruges af
  både klient og server — den deling er en styrke.
- Server-side API routes med `authenticateSupabaseRequest` + service-klient-skille.
- CSS-variabel-kanalen (`--clothing-scale/x/y`, `--anchor-x/y`) som eneste
  renderingsvej — browseren er final authority.

**Det, der er en svaghed (og ikke skal gentages):**
- `wardrobe.astro` er en **monolit**: state, drag, wheel, pinch, editor, persistence,
  AI-flows og DOM-render ligger i ét kæmpe page-script. Det gør læsning, test og
  sikker ændring vanskelig.
- Interaktionslogik er ikke i genbrugelige moduler, selvom Profile genbruger
  præcis samme placement-matematik.

**Konsekvens for den nye struktur:** behold arkitekturen (Astro + vanilla TS +
CSS-variabler), men **bryd monolitten op i små, rene client-moduler og genbrugelige
`.astro`-komponenter** — uden at over-dele (se §9).

---

## 2. Astro-principper og framework-spørgsmålet

**Skal vi have React/Vue/Svelte?** **Nej — seriøst vurderet og afvist:**
1. Hele interaktionen er **DOM-manipulation af `<img>`-lag + skrivning af
   CSS-variabler** — præcis det DOM gør naturligt. Et virtual-DOM-framework giver
   her ekstra kompleksitet + hydrerings-omkostning uden nytte.
2. Dataflow er "få rækker, opdater felter" — ikke kompleks tilstandstræ-rendring.
3. Pointer Events + `setPointerCapture` er browser-API'er; framework-libs tilføjer
   ikke noget.
4. Den eksisterende, testet løsning er vanilla — Rule2 (preserve architecture).

**Astro-rollen:** Astro er **page- og component-layer** (server-rendered HTML,
komponent-komposition, script-isolerede page-scripts). Interaktivitet tilføjes via
Astro's indbyggede `<script>`-moduler (bundle automatisk, ingen framework-islands).

**Hvor Astro components giver værdi:** genbrug (Header, model-viewer på to sider),
klart ansvar, kompleks markup isoleret (placement-editor), sideforståelse.
**Hvor almindelig HTML er bedre:** engangs-markup uden logik (login-formular-felter
der kun bruges ét sted), statiske tekster, tabeller uden interaktion.

**Data fra server til client:** Astro-renderede sider modtager initial data som
**server-injected JSON** (f.eks. `data-`-attribut eller indlejret `<script type="application/json">`)
— klienten hydrerer oveni uden ekstra fetch ved load; senere ændringer hentes via
API-ruter. Ingen client-side router; al navigation er klassiske side-load (Astro).


**Komponentkommunikation:** `.astro`-komponenter kommunikerer via **props +
slots** (byggetid). Klient-logik kobles via **små, navngivne `id`/`data-*`-hooks
i markup'en** + `querySelector` i komponentens egen script-blok — ikke via
framework-events. Én regel: komponenten ejer sit markup-hook; klient-modulet ejer
sin logik.

---

## 3. Hvornår er noget en `.astro`-komponent?

En komponent SKAL eksistere, hvis (flere af) disse gælder:
1. **Genbruges** (≥2 steder), f.eks. model-viewer på Profile + DRESSED.
2. **Har et klart ansvar** (én ting: "vis denne kategori af clothing cards").
3. **Isolerer kompleks markup** (placement-editorens mange felter + tilstandsklasser).
4. **Gør siden lettere at forstå** (sider bliver læsbare oversigter af ~10 navne).
5. **Gør testing/ændring lettere** (ændringer i ét kort-udseende rører ét sted).

**Må IKKE være komponent (over-engineering-guard):** bruges kun ét sted, intet
selvstændigt ansvar, ren kosmetik, eller logik der alligevel skal køre i
client-modulet (så lægges markup i siden + logik i `lib/client`). En knap er
først en komponent, hvis den har adfærd/struktur udover ét `<button>`-tag
(typisk: nej — men en *button group som placement-editorens RESET/DONE med
tilstande*, ja).

---

## 4. Anbefalet mappestruktur (med begrundelse pr. gruppe)

```text
src/
├── pages/                      Astro-ruter (server-renderede sider + API)
│   ├── index.astro             Landing (statisk intro)
│   ├── login.astro  signup.astro   Auth (Supabase)
│   ├── profile.astro           Profil + model + clothing-upload + MAKE AI READY
│   ├── closet.astro            Clothing library (read/select)
│   ├── dressed.astro           Virtual fitting room (kompositionssiden)
│   └── api/                    Server-side API routes (§24 i prompten)
│       ├── wardrobe/items/index.ts      GET, POST
│       ├── wardrobe/items/[id].ts       DELETE, PATCH (placement)
│       ├── wardrobe/outfits/index.ts    GET, POST
│       ├── wardrobe/outfits/[id].ts     DELETE
│       ├── characters/[id].ts           DELETE
│       ├── profile/source-photo.ts      POST
│       └── ai/{process-clothing,dress-model,personal-model,try-on}.ts (POST)
│                                 + ai/usage.ts (GET)
├── components/                 Kun `.astro`-komponenter (se §5)
│   ├── layout/                 Header, Footer, PageShell
│   ├── shared/                 ModelViewer, ClothingCard, ClothingGrid,
│   │                           StatusBadge, EmptyState, ConfirmButton
│   ├── profile/                ProfileSection, UploadForm, ModelPanel,
│   │                           MakeAiReadyPanel, CharacterPicker
│   ├── closet/                 ClosetFilterBar (øvrigt = shared-kort)
│   └── dressed/                OutfitPanel, OutfitToolbar, PlacementEditor,
│                               ClothingLayerList, SavedOutfitsList, GenPanel
├── lib/
│   ├── shared/                 BRUGES AF BEGGE SIDER af boundary
│   │   ├── types.ts            Placement, WardrobeItem, SavedOutfit, JobStatus …
│   │   ├── clothing-categories.ts   (22 kategorier, defaults, layer-rækkefølger)
│   │   ├── anchors.ts          (15 anchors + male overrides + dressedAnchor())
│   │   ├── placement.ts        (parsePlacement, clamps, resolveItemPlacement)
│   │   └── geometry.ts         (normalized-v1 canvas-regler, dim-tjek)
│   ├── server/                 KUN server (aldrig importeret fra sider uden
│   │   ├── supabase.ts         (auth-request + service-klient)
│   │   ├── validation.ts       (request-body validering)
│   │   └── ai/                 (openai-client, image-input, base-forms,
│   │                            job-launcher, background, quota, jobs/*)
│   └── client/                 KUN browser (små, rene moduler — se §6)
│       ├── api.ts              (typer fetch-wrappere til /api/*)
│       ├── pointer.ts          (fælles pointer-capture/håndtering)
│       ├── placement-drag.ts   (drag → x/y)
│       ├── scale-inputs.ts     (slider + wheel + pinch → placement.scale)
│       ├── layer-render.ts     (render af lag + CSS-variabler)
│       ├── outfit-state.ts     (selectedItems, lag-rækkefølge, tilstand)
│       ├── outfit-save.ts      (queue/retry til saved outfits)
│       ├── generation-flow.ts  (AI-kørsel UI-flow, polling)
│       └── editor-state.ts     (editingItemId, overrides, dirty-tracking)
├── styles/                     global.css (tokens/reset) + pr. side
└── assets/                     canonical base forms (woman/man.png,1024×1536)
                                + system-references
```

**Hvorfor hver hovedgruppe findes:**
- **`pages/`** = ruter + server-entry. Sider må gerne være tynde: markup via
  components, adfærd via `lib/client`-import i egen `<script>`.
- **`components/`** = genbrugelig/complex markup, byggetid, ingen tung logik.
- **`lib/shared/`** = den eneste filtype begge sider af server/client-boundary må
  importere (kontrakter + matematik) — sikrer at DB-validering, API og UI aldrig
  driver fra hinanden.
- **`lib/server/`** = alt med hemmeligheder/RLS/AI. Aldrig bundlet til browseren
  (Astro holder server-importer isoleret).
- **`lib/client/`** = interaktion i små moduler, så DRESSED-siden forbliver læsbar,
  og Profile kan genbruge de samme moduler.
- **`styles/`** = adfærd/geometri (CSS-variabeler, breakpoints) adskilt fra tema,
  så udseende kan udskiftes uden at røre systemet.
- **`assets/`** = kanoniske filer (jf. dokumentationen: KUN base forms er
  projekt-assets; alt andet er runtime-Supabase-Storage).

---

## 5. Komponent-inventory (konkret anbefaling)

| Komponent | Genbruges? | Ansvar | Props (eksempel) | IKKE komponent? |
|---|---|---|---|---|
| `layout/PageShell.astro` | alle sider | `<head>`, scripts-indsættelse, Grundstruktur | `title`, `activeNav` | — |
| `layout/Header.astro` | alle sider | navigation + brugerstatus | `user` | — |
| `layout/Footer.astro` | alle sider | statisk | — | — |
| `shared/ModelViewer.astro` | Profile + DRESSED | base-`<img>` + lag-container + canvas-ramme (2:3) + `data-*`-hooks | `baseSrc`, `layers[]`, `editable` | — |
| `shared/ClothingCard.astro` | Profile/Closet/DRESSED | ét item: billede, kategori, AI-ready badge, valg-handling | `item`, `variant` (select/delete/compact), `events` via hooks | — |
| `shared/ClothingGrid.astro` | Profile/Closet/DRESSED | grid over cards + empty-state | `items`, `variant` | — |
| `shared/StatusBadge.astro` | Profile/Closet | AI-ready/processing/failed-label | `state` | En `<span>`+klasse kan være nok — KUN komponent hvis logik |
| `shared/EmptyState.astro` | flere | "ingen items"-blok | `message`, `action?` | — |
| `shared/ConfirmButton.astro` | Profile/Closet/Outfits | slet-knap med bekræft-trin | `label`, `onConfirm`-hook | — |
| `profile/UploadForm.astro` | Profile | foto-upload + kategori + validering | `categories` | — |
| `profile/ModelPanel.astro` | Profile | kilde-foto, model-status, skift-model | `modelState` | — |
| `profile/MakeAiReadyPanel.astro` | Profile | **éneste** sted med AI-processeringsknapper | `quota` | — |
| `profile/CharacterPicker.astro` | Profile/DRESSED | vælg primary character | `characters`, `selectedId` | — |
| `closet/ClosetFilterBar.astro` | Closet | filtergrupper | `groups` | — |
| `dressed/OutfitPanel.astro` | DRESSED | outfit-grid + toolbar | `items` | — |
| `dressed/OutfitToolbar.astro` | DRESSED | ADJUST/SAVE/OUTFITS-knapper m. tilstande | `state` | — |
| `dressed/PlacementEditor.astro` | DRESSED | slider, anchor-select, RESET, DONE (kompleks markup) | `editorState` via hooks | — |
| `dressed/ClothingLayerList.astro` | DRESSED | lag-liste m. op/ned (layer-rækkefølge) | `layers` | — |
| `dressed/SavedOutfitsList.astro` | DRESSED | gemte outfits (load/delete) | `outfits` | — |
| `dressed/GenPanel.astro` | DRESSED | kvote/usage-visning + dress/try-on | `usage` | — |

---

**Begrænset bevidst:** ingen `Button`/`Input`-mikrokomponenter (ren kosmetik —
`.css`-klasser er nok), ingen komponent pr. side-sektion der bare er statisk HTML
(statske profiltekster forbliver inline). Hver side skal kunne læses som en
indholdsfortegnelse af komponentnavne.

---

## 6. Client-side logik (hører i `lib/client/`, ikke i `.astro`-filer)

Regel: **`.astro`-filer må indeholde kort "wire-up"-script** (find hooks, init
modulet, destruér ved navigation) — alt med vedvarende logik lever i moduler:

| Modul | Ansvar | Bruges af |
|---|---|---|
| `api.ts` | Typerne-sikre fetch-wrappere til alle `/api/*` (kaster strukturerede fejl) | alle sider |
| `pointer.ts` | Fælles Pointer Events-base: aktiv `pointerId`, `setPointerCapture` (try/catch), cleanup på `pointerup`/`pointercancel`/`lostpointercapture` | DRESSED |
| `placement-drag.ts` | `pointerdown→move` på aktivt lag → offsets → `x/y` (%). Én aktiv pointer; ignorér sekundære pointerId | DRESSED |
| `scale-inputs.ts` | **Ét system**: slider-`input`, venstre-klik+wheel (`passive:false`, `preventDefault`, jitter-guard), to-fingers-pinch → alle kalder `setScale(placement.scale)` med clamp0.4–2.0. Ingen anden state | DRESSED |
| `layer-render.ts` | Opretter/omplacerer lag-`<img>`'s (z-index = lag-indeks) og skriver **kun** `--anchor-x/y`, `--clothing-scale/x/y` på de relevante lag. Genbruges1:1 af Profile | DRESSED + Profile |
| `editor-state.ts` | `editingItemId`, `editingAnchor`, `placementOverrides` (session-Map), `dirty`-tracking + `beforeunload` | DRESSED |
| `outfit-state.ts` | `selectedItems`-rækkefølge (= lag), tilføj/fjern (genbruger samme id), stablet sortering efter `clothingLayerOrder` | DRESSED |
| `outfit-save.ts` | Kø + retry ved oprettelse/ændring af saved outfits (kun POST ved success) | DRESSED |
| `generation-flow.ts` | AI-kørsel: start → status `running → completed/failed` (polling) → opdater UI | Profile + DRESSED |
| `auth-forms.ts` | Login/signup-formularvalidering + Supabase-kald | login/signup |

**Hvad der BLIVER i sidens `<script>`:** initialisering (`const ctx = init(...)`),
sammensætning af moduler, side-specifikke event-hooks (f.eks. "klik på KORT ⇒
vælg item"), og indlæsning af server-injected JSON. Målet: et page-script på
< ~150 linjer, der læses som en oversigt.

**Regel om tilstand:** client-tilstand er **lokale objekter i modulerne** (ikke
globalt). Deles kun via eksporterede getter/setter-funktioner mellem de moduler
der faktisk skal samarbejde (f.eks. `editor-state` ⇄ `scale-inputs`).

---

## 7. Server-side logik (kun `lib/server/` + `pages/api/`)

| Område | Hvor | Regler |
|---|---|---|
| **Authentication** | `lib/server/supabase.ts` → `authenticateSupabaseRequest(request)` | Bearer-JWT → Supabase anon-client m. bruger;401 ved manglende/ugyldig. Bruges i ALLE ruter. |
| **Authorization** | i hver rute + RLS | Ownership = explicit `.eq("user_id", user.id)` (eller service-klient + samme filtre). **Client-supplied user-id må aldrig være authorization.** |
| **Database-adgang** | anon-client under RLS; `createSupabaseServiceClient()` kun når RLS er i vejen (placement-UPDATE, job-finalisering, asset-skrivning) | Service-klienten kræver altid explicit ejer-filter bagefter. |
| **Validation** | `lib/server/validation.ts` + `lib/shared/placement.ts` (samme `parsePlacement` som klienten) | IDs (string ≤100), navne (1–100/1–80), kategori ∈22, images (type/size), placement (exact keys, anchors, limits). |
| **Persistence** | PATCH-items (placement), POST-outfits (RPC), POST-items (create), DELETE | Placement gemmes KUN ved DONE (§13 i prompten). |
| **AI-kald** | `lib/server/ai/*` | OpenAI-nøgle kun server. Input-validering (PNG/JPEG ≤4MB, dim-tjek1024×1536), moderation, base-form-hentning, job-launch + background-finalisering via service-role + reservationstoken. |
| **AI-kvote** | RPC'er (`reserve_*` / `finish_*_server`) | Reservation før kørsel, token-match ved finish, credit-back ved fejl. Browseren kalder aldrig finish direkte. |
| **Image-processing** | kun server (dim-tjek m. pngjs, signerede URLs) | Brugerens browser ser kun signede URLs (60 min). |

**Server/client-boundary (absolut):**
- **Client MÅ:** UI, drag, scale, wheel, pinch, midlertidig interaktionsstate,
  outfit-komposition i browseren, læse egne data via API.
- **Server SKAL:** autentificere, autorisere, validere, gemme placement/outfits,
  al Supabase-adgang med hemmeligheder, al AI, al quota, alle sensitive operationer.

---

## 8. DATAFLOW (den anbefalede vej pr. entitet)

**Generelt mønster (side-load, ingen client-router):**

```text
Supabase  ←→  server/API (auth+validering)  ←→  Astro page (server-render)
                                                     ↓  (initial JSON i markup)
                                             Astro components (markup + hooks)
                                                     ↓
                                      client-side interaction (lib/client)
                                                     ↓  (kun ved ændring)
                                              API  →  Supabase
```

Initial data **server-renderes** (Astro henter med bruger-sessionens cookie/JWT og
sender lister ind i markup'en/JSON) — så Closet/Profile/DRESSED viser indhold
med det samme. Klienten henter kun selv, når brugeren *ændrer* noget.

| Entitet | Flow |
|---|---|
| **Wardrobe item (upload)** | Profile → `UploadForm` → **POST /api/wardrobe/items** (billede ≤4MB, navn, kategori) → server: moderering + lagring i Storage (`{uid}/clothing-originals/...`) + row i `wardrobe_items` → svar til klient → **genindlæs server-render** (eller optimistisk lokal tilføjelse + refresh). Samme `wardrobe_items.id` bruges overalt. |
| **Personal model** | Profile → kilde-foto → **POST /api/profile/source-photo** + **POST /api/ai/personal-model** (kvote-reservation) → job (async, status `running`) → background-finalisering m. service-role + token → klient-poller (`generation-flow`) → `completed` ⇒ profil-genindlæsning viser ny karakter (`dressed_characters`, primary). |
| **Clothing asset (AI-ready)** | Profile → **MAKE AI READY** → **POST /api/ai/process-clothing** (kvote-reservation, item-id, base_type) → clothing-job (image1 = canonical base form, image2 = brugerfoto) → output `1024×1536` transparent PNG → Storage + `wardrobe_item_ai_assets` (`generation_version =3`) → finish-server ⇒ Closet/DRESSED viser AI-ready badge. |
| **Placement** | DRESSED-editor (slider/wheel/pinch/drag/anchor) → `placementOverrides` (**sessionkun**, ingen skrivning) → **DONE** → `parsePlacement` → **PATCH /api/wardrobe/items/{id} {placement}** → `wardrobe_items.placement` (jsonb) → ved næste load: GET → `resolveItemPlacement` (session → persisted → default) → `layer-render` skriver CSS-variabler. Samme resolver i Profile. |
| **Outfit (komposition)** | DRESSED → `outfit-state` (id'er + lag) → browser-render (`layer-render`) — **ingen AI, ingen quota, ingen server** under selve kompositionen. |
| **Saved outfit** | DRESSED → **POST /api/wardrobe/outfits** → RPC `save_dressed_outfit(name, text[])` (validerer ejerskab + `generation_version=3`) → `saved_dressed_outfits` med `item_ids text[]` → load senere: GET → genbrug **de samme id'er** → samme placement. |

---

## 9. PLACEMENT OG INTERAKTIVITET (ekstra grundigt)

**Mål:** DRESSED-siden må IKKE blive én monolitisk client component. Løsningen:

```text
dressed.astro (tynd sammensætning)
 ├─ <ModelViewer>            markup + data-hooks          (.astro, statisk)
 ├─ <OutfitPanel>            markup                       (.astro)
 ├─ <PlacementEditor>        markup + data-hooks          (.astro)
 ├─ <ClothingLayerList>      markup                       (.astro)
 ├─ <SavedOutfitsList>       markup                       (.astro)
 └─ <script>  (~100-150 linjer = wire-up)
      import { createEditorState }   from lib/client/editor-state
      import { attachDrag }          from lib/client/placement-drag
      import { attachScaleInputs }   from lib/client/scale-inputs   (slider+wheel+pinch)
      import { createLayerRender }   from lib/client/layer-render
      import { createOutfitState }   from lib/client/outfit-state
      …
```

**Renderkanalen (ufravigelig):** én funktion i `layer-render` omdanner
`(item, resolvedPlacement, baseType)` → inline CSS-variabeler på det **enkelte**
lag (`--anchor-x/y`, `--clothing-scale`, `--clothing-x/y`). Transformen er
`translate(...) scale(calc(base × placement.scale))` med origin ved anchor-%.
**Ingen anden kode må skrive til lag-styling.**

**Ét scale-system:** `scale-inputs.ts` eksporterer **én** `setScale(v)`; sliderens
`input`, wheel-hændelsen og pinch-gesturen kalder alle den samme funktion med
`clamp(v, 0.4, 2.0)`. Der findes **ingen** `zoomState`, ingen canvas-transform
(`transform:none` på canvas), ingen separat wheel- eller pinch-state, ingen
skjulte faktorer.

**Pointer-disciplin:** ét aktivt `pointerId` pr. gesture; `setPointerCapture`
med try/catch; altid cleanup på `pointerup` + `pointercancel` +
`lostpointercapture`; to-fingers-pinch optæller aktive pointers (skifter fra
drag til pinch ved pointer2); `touch-action:none` **kun** på det redigerede lag
og slideren — al anden side fortsætter med at kunne scrolle.

**Layer vs. placement:** `outfit-state` bestemmer **kun** rækkefølge/z-index;
`layer-render` skriver **kun** transform-variabler. Ingen af dem rører den andens
domæne (testbar adskillelse).

**Profile-genbrug:** Profile-importerer `resolveItemPlacement` + `layer-render`
(samme modul) med `editable:false` ⇒ automatisk identisk placement uden dubleret
matematik.

---

## 10. DRESSED-SPECIFIKE SYSTEMER — hvor de bor

| # | System | Side (page) | Component | Client-modul | Server/API | Shared | DB |
|---|---|---|---|---|---|---|---|
|1| Profile | profile.astro | profile/* + shared/* | api, generation-flow | items/outfits/source-photo | categories | profiles |
|2| Closet | closet.astro | shared ClothingGrid/Card + ClosetFilterBar | api | items GET/DELETE | categories | wardrobe_items |
|3| DRESSED | dressed.astro | dressed/* + shared ModelViewer | alle interaktionsmoduler | items/outfits GET | placement, anchors | (læs) |
|4| Personal model | profile | ModelPanel, CharacterPicker | generation-flow | ai/personal-model | geometry | dressed_characters |
|5| Clothing upload | profile | UploadForm | api | wardrobe/items POST | categories | wardrobe_items |
|6| AI-ready processing | profile (**kun her**) | MakeAiReadyPanel | generation-flow | ai/process-clothing + usage | clothing-assets | wardrobe_item_ai_assets |
|7| Placement editor | dressed | PlacementEditor | editor-state, drag, scale-inputs | — | anchors, placement | — |
|8| Placement persistence | dressed | (DONE-knap i editor) | api + editor-state | **items/[id] PATCH** | placement (parse) | wardrobe_items.placement |
|9| Layer system | — | ClothingLayerList | outfit-state, layer-render | — | categories (order) | — |
|10| Saved outfits | dressed | SavedOutfitsList | outfit-save, api | outfits routes + RPC | types | saved_dressed_outfits |
|11| Drag | dressed | (ModelViewer-hooks) | placement-drag + pointer | — | placement clamps | — |
|12| Scale slider | dressed | PlacementEditor | scale-inputs | — | clamp | — |
|13| Desktop wheel | dressed | (ModelViewer-hooks) | scale-inputs | — | clamp | — |
|14| Mobile pinch | dressed | (ModelViewer-hooks) | scale-inputs + pointer | — | clamp | — |
|15| Responsive | alle | PageShell/CSS | — | — | — | — |
|16| Authentication | login/signup | auth-forms-script | auth-forms | authenticate i alle ruter | — | auth.users |
|17| Supabase | — | — | — | lib/server/supabase | — | alt |
|18| AI jobs | profile | MakeAiReady/ModelPanel | generation-flow | lib/server/ai/* + bg-jobs | geometry | jobs/usage |
|19| API routes | — | — | lib/client/api | pages/api/** | types + validation | via RLS |

**Over-engineering-guards (gentaget):** ingen komponent uden genbrug/ansvar;
ingen client-klasse uden side der bruger den; ingen state-management-library;
ingen framework; én renderkanal; `lib/shared` kun til det begge sider faktisk
bruger.

---

## RECOMMENDED ASTRO ARCHITECTURE

1. **Framework-beslutning:** **Ingen React/Vue/Svelte.** Astro (SSR pages +
   build-time components) + **vanilla TypeScript** i små `lib/client`-moduler.
   Interaktion = DOM + CSS-variabeler + Pointer Events — et UI-framework ville
   tilføje hydreringsomkostning uden gevinst og bryde den testede arkitektur.

2. **Recommended folder structure:**
   ```text
   src/
   ├── pages/            (6 sider + /api/** server routes)
   ├── components/       layout/ · shared/ · profile/ · closet/ · dressed/
   ├── lib/
   │   ├── shared/       types, categories, anchors, placement, geometry
   │   ├── server/       supabase(auth+service), validation, ai/**
   │   └── client/       api, pointer, placement-drag, scale-inputs,
   │                     layer-render, editor-state, outfit-state,
   │                     outfit-save, generation-flow, auth-forms
   ├── styles/           global + pr. side (geometri adskilt fra tema)
   └── assets/           canonical base forms (1024×1536)
   ```
   Sider er **tynde**: komposition af components + ~100–150 linjers wire-up-script.

3. **Component architecture:** `PageShell/Header/Footer`; `shared` = ModelViewer,
   ClothingCard, ClothingGrid, EmptyState, ConfirmButton (StatusBadge kun hvis
   logik); `profile` = UploadForm, ModelPanel, **MakeAiReadyPanel (eneste AI-sted)**,
   CharacterPicker; `closet` = ClosetFilterBar; `dressed` = OutfitPanel,
   OutfitToolbar, **PlacementEditor**, ClothingLayerList, SavedOutfitsList,
   GenPanel. **Kun** ved genbrug/ansvar/isolation — ingen mikro-komponenter;
   statisk HTML forbliver i siden.

4. **Client-moduler** (ansvarsmæssigt adskilt): én `setScale` deles af slider +
   wheel + pinch; `layer-render` er **eneste** skriver af lag-styling;
   `placement-drag` er **eneste** skriver af x/y; `outfit-state` er **eneste**
   ejer af lag-rækkefølge; tilstand er lokale objekter (ikke global state).

5. **Server-moduler:** `authenticateSupabaseRequest` i alle ruter; explicit
   `user_id`-filtre i alt (også på service-klienten); `parsePlacement` i
   `lib/shared` = fælles validering for client + server + DB-CHECK; al AI/kvote/
   Storage-adgang kun server-side; åbne kun service-rollen præcis hvor RLS er i
   vejen.

6. **Dataflow:** initial data **server-renderes** ind i siden (ingen client-router,
   ingen tom-loading); klienten kalder API **kun ved ændringer**; genindlæsning af
   server-render er den eneste "state-sync" (f.eks. efter upload/AI).

7. **Server/client-boundary:** client = UI/drag/scale/wheel/pinch/sessionstate/
   outfit-komposition; server = auth, authorization, validering, placement-
   persistence, Supabase, AI, quota.

8. **Placement-arkitektur:** `dressed.astro` = ModelViewer + editor-komponenter +
   wire-up-script; **én renderkanal** (`resolveItemPlacement` → CSS-variabeler);
   **ét scale-system** (`placement.scale`, clamp0.4–2.0, ingen zoomState/canvas-
   transform/skjulte faktorer); pointer-capture m. cancel/lost-cleanup;
   `touch-action:none` kun på redigeret lag + slider; layer ≠ placement (adskilte
   moduler); Profile genbruger præcis samme moduler med `editable:false`.

9. **Integrationspunkter (testbar):** hver client-modul eksporterer `init(...)`
   uden DOM-afhængighed ved import; API-ruter testes med strippede requests;
   DB-kontrakt følger den korrigerede SQL-kontrakt (`text[]`-item_ids,
   `jsonb`-placement med `'string'`-validering).

10. **Næste skridt:** disse punkter indarbejdes i `prompt.txt` som den
    selvstændige bygge-instruktion (prompten beskriver dette layout som den
    krævede struktur, uden at henvise til det eksisterende projekt).







