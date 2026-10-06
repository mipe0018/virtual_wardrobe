# DRESSED — Current Project Status

> Teknisk status for DRESSED-projektet pr. dokumentationsrunden (pre-backup).
> Alt nedenfor er baseret på faktisk kode, faktiske migrations, faktiske kørsler af testsuites og live-verifikation. Ikke-verificerede ting er mærket eksplicit.

## Milestone (nuværende)

**LIVE-PERSISTENCE ER VERIFICERET.** Et clothing item er live-verificeret gennem hele kæden:

```text
ADJUST → DONE → PATCH /api/wardrobe/items/[id] → SUPABASE → REFRESH → SAME PLACEMENT
```

Faktisk verificeret live-eksempel gemt i `wardrobe_items.placement`:

```json
{ "placement": { "x": 0, "y": -4.2106, "scale": 0.63, "anchor": "torso" } }
```

Milepælen markerer: placement redigering virker i browseren, gemmes pr. clothing item og overlever refresh — klar til projekt-gemmning/backup (via dokumentation; commit/backup er ikke udført her).



## Project purpose

DRESSED er en AI-baseret dressing room web-app (Astro + Supabase + OpenAI):
brugeren opretter en personlig AI-model ud fra sit eget billede, uploader
tøj, lader AI'en generere "AI-ready" clothing-layers, komponerer outfits på
modellen i browseren, gemmer outfits og viser sit valg på Profile.

```text
USER → PROFILE (foto + model) → WARDROBE ITEMS (tøj-uploads)
     → AI CLOTHING PROCESSING → AI-READY CLOTHING LAYERS
     → DRESSED (browser-komposition) → OUTFIT COMPOSITION (saved outfits)
```

Relationerne: **Profile** = stedet hvor identitet/model/oprettelse sker;
**Closet** = bibliotek over clothing items (thumbnails, styring);
**DRESSED** (siden `wardrobe`) = komposition/visning/redigering; **Saved
Outfits** = navngivne sæt af `item_ids`, der kan loades i begge sammenhænge.

## AI architecture (kort)

```text
Canonical master forms (woman.png / man.png, 1024×1536)
        ↓  geometry source of truth
AI character generation (personlig model, samme canvas)
        ↓
AI clothing generation (garment FITTES til canonical form; design fra brugerens foto)
        ↓
1024×1536 transparent clothing layer (AI-ready asset, generationVersion = CURRENT)
        ↓
Browser: CSS-composition over modellen (endelig placement-autoritet)
```

- **Master forms:** `src/assets/system-reference/base-forms/{woman,man}.png` — verificeret **1024×1536** begge; derudover en Supabase-kopi i tabellen `dressed_base_forms` (migration0010, read-only for authenticated) som `server/ai/base-forms.ts` henter og validerer ("must be exactly1024×1536", base-forms.ts:54).
- **Coordinate system:** ét kanonisk1024×1536/2:3-koordinatsystem bruges af character-job, clothing-job, personal-model og dress-model (alle `size:"1024x1536"` + PNG-dim-tjek). AI-prompts forbyder zoom/crop/skift af canvas.
- **Clothing generation:** `lib/server/ai/jobs/clothing-job.ts` — "Image1 = canonical base form (geometry), Image2 = clothing source (design)"; output = transparent layer der pixel-for-pixel matcher image1.
- **Personal models:** `api/ai/personal-model.ts` + `server/ai/*` — personfoto + base form → character på samme canvas; geometry contract `normalized-v1` (`shared/clothing-geometry.ts`).
- **AI-ready assets:** `wardrobe_item_ai_assets` pr. `(user_id, item_id, base_type)`; UI kræver `generationVersion === CURRENT_CLOTHING_ASSET_VERSION` (3) for at kunne vælges.

## Placement (per clothing item)

- **Model:** `wardrobe_items.placement` = **nullable JSONB** `{anchor, x, y, scale}`; `NULL` = brug eksisterende category-defaults. Placement tilhører **item'et, aldrig et outfit**.
- **Resolver-prioritet** (`src/lib/shared/clothing-placement.ts`, `resolveItemPlacement`):
  `session override (placementOverrides-Map)` → `persisted (item.placement)` → `category default (clothingPlacement)`.
- **Defaults:** `CLOTHING_PLACEMENT` + `DRESSED_ANCHORS` (15 anchors) + `dressedAnchor(anchor, baseType)` inkl. `MAN_ANCHOR_Y` — uændrede.
- **Editor (siden `wardrobe`):** ADJUST åbner panelet; **scale-slider**, **desktop left-click+wheel** og **mobil pinch** skriver alle samme `placement.scale` via `setPlacementOverride` (ét system, clamp **0.4–2.0**); drag skriver x/y; anchor-vælger skriver anchor; **RESET** = permanent `placement = null` (defaults); **DONE** = valider (`parsePlacement`) + **PATCH** per-item.
- **Persistence:** `saveItemPlacement()` → `PATCH /api/wardrobe/items/[id]` → service-klient-UPDATE af `placement + updated_at` (ejerskab via auth-JWT + `user_id`+`id`-filtre). **LIVE-VERIFICERET** (ovenstående JSON).

## Layer system (separat fra placement)

- Rækkefølge: `selectedItems`-indsætningsrækkefølge sorteret efter `clothingLayerOrder` (socks…tops…jackets…); **z-index = array-indeks**; base-billede `z-index:0`.
- Lag-container `.dressed-clothing-layers` = `pointer-events: none`; **kun** det redigerede lag (`.dressed-clothing-layer--editing`) opt-in'er `pointer-events: auto`.
- Placement skriver **kun** CSS-variabler (`--anchor-x/y`, `--clothing-scale`, `--clothing-x/y`); **scale/x/y/anchor ændrer aldrig z-index/layer** (testet).

## DRESSED (siden `wardrobe`)

Model-canvas (`.dressed-canvas`, `aspect-ratio 2/3`, max-bredde493/413/333px) indeholder base-`img` + clothing-lags `<img>`'s — samme `absolute inset:0`-boks ⇒ samme koordinatsystem. Transform pr. lag:
`transform-origin: anchor%` → `translate(--clothing-x/y)` → `scale(calc(--clothing-base-scale × --clothing-scale))` (uniform).

## Profile

`profile.astro` + `lib/client/profile-outfits.ts`: henter wardrobe via **samme** `loadPersistentWardrobe` og renderer valgt outfit på modellen med **samme** `resolveItemPlacement(item.placement)` ⇒ **same id + same placement = same proportions** som DRESSED. Bruger kun `#profile-outfits`-panelet og localStorage til valgt outfit-id.

## Closet

`closet.astro` — thumbnail-bibliotek over clothing items (filtrering, AI-ready-state, sletning via `DELETE /api/wardrobe/items/[id]`). **Ingen layer-rendering/placement vises her** (placement er irrelevant for thumbnails).

## Saved outfits

- `saved_dressed_outfits`: **kun `item_ids`** (+ character_id, base_type, name, outfit_key) via RPC `save_dressed_outfit`. **Ingen placement/scale/x/y/anchor gemmes i outfits** — placement følger altid `wardrobe_items.id`.
- Trigger (0012): sletning af et wardrobe_item rydder outfits der refererer det.
- LOAD i wardrobe: `selectedItems = itemIds.map(id => clothingItems.find(...))` ⇒ **genbruger samme objekter/samme id** — opretter aldrig nye records.

## Persistence-flow (verificeret)

```text
Editör (slider/wheel/pinch/drag/anchor) → placementOverrides (session)
  DONE → parsePlacement → saveItemPlacement → PATCH {placement:{anchor,x,y,scale}}
  → wardrobe_items.placement (JSONB) → GET /api/wardrobe/items → item.placement
  → resolveItemPlacement → CSS-variabler → DRESSED + Profile
  RESET → placement = null (permanent) → defaults
```

Uden for sessionen: ingen gemt værdi ⇒ `NULL` ⇒ defaults — præcis som før featuren.

## Supabase & API (nuværende)

- **Nøgletabeller:** `profiles`, `dressed_characters`, `dressed_base_forms` (master-form-referencer, select-only), `wardrobe_items` (PK `(user_id,id)`, kolonnen **`placement jsonb NULL`**), `wardrobe_item_ai_assets` (+legacy), `wardrobe_results`, `saved_dressed_outfits` (**kun `item_ids`**), `ai_generation_usage/limits/limit_overrides`.
- **Migrations:**14 filer: `202610040001,0002,0005,0008,0010,0011,0012,0013,0014,0015,0016`, `202610050001`, **`202610050002`** (placement-kolonne + CHECK), **`202610050003`** (CHECK-fix).
  **Hvorfor0003 findes:** CHECK'en i0002 brugte `jsonb_typeof(...) = 'text'` — PostgreSQL returnerer `'string'` for JSON-strings ⇒ betingelsen var altid false ⇒ **enhver** non-null placement blev afvist med `23514`.0003 erstatter constrainten med `= 'string'` (øvrige semantik uændret:15 anchors, x/y ±60, scale0.4–2, `NULL` gyldig).
- **API-overflade (11 ruter):**
  - `GET/POST /api/wardrobe/items` · `DELETE/PATCH /api/wardrobe/items/[id]` (PATCH = placement)
  - `GET/POST /api/wardrobe/outfits` · `DELETE /api/wardrobe/outfits/[id]`
  - `DELETE /api/characters/[id]`
  - `POST /api/ai/{process-clothing, dress-model, personal-model, try-on}` · `GET /api/ai/usage` (RPC `get_ai_generation_usage`)
  - `POST /api/profile/source-photo`
- **Auth:** alle ruter bruger `authenticateSupabaseRequest` (Bearer-JWT, anon-client med bruger-RLS). Placement-UPDATE'en kører på `createSupabaseServiceClient()` (service-rolle) med explicit `user_id`+`id`-filtre — bekræftet virkende live.

## Touch (status)

- **Regler:** kun2 `touch-action: none` i hele appen — `.dressed-clothing-layer--editing` og `.placement-field input[type=range]`. **Ingen global lås** (verificeret via CSSOM-runtime: body/main/`.wardrobe-screen` = `auto`).
- **Arkitektur:** én Pointer Events-sti på `#wardrobe-model` (delegation via `closest`), én aktiv pointer-id, `setPointerCapture` (try/catch), cleanup på `pointerup`/`pointercancel`/`lostpointercapture`.
- **Status:** automatiseret **33/33** (CDP-touch) + Device-Mode-probe **14/14**; **IKKE live-godkendt på fysisk telefon** (seneste telefon-test inden fix var negativ; GUI Device-Mode kan ikke simulere pinch — kørt via DevTools-protokollen).

## Wheel / pinch (status)

**IMPLEMENTED + AUTOMATED TESTED BUT NOT LIVE-ACCEPTED.**
- Ét scale-system: slider + `left-click+wheel` + `pinch` → `setPlacementOverride({scale})` → clamp0.4–2.0 → DONE → PATCH. Ingen `zoomState`, ingen canvas/model-zoom (grep=0), `transform:none` på canvas/base (runtime-målt).
- Automatiseret: wheel/pinch-suite **25/25**; touch-suite **33/33**. Live desktop-wheel blev rapporteret ikke-fungerende i én session (diagnosticeret: kode + serveret kilde + tests er grønne; kandidater = lukket editor efter DONE, gammel klientkontekst/cache, ikke-Chrome browser) — **afventer live-accept**.

## Testmatrix (kun reelle resultater)

| System | Automated | Live | Status | Notes |
|---|---|---|---|---|
| Build (`npm run build`) | ✓ | — | **VERIFIED** | Complete ved seneste kørsel |
| TypeScript (`tsc --noEmit`) | ✓ | — | **VERIFIED** |12 pre-eksistente fejl (pngjs/ArrayBuffer/astro.config),0 nye |
| Placement-editor (mouse) | ✓ CDP43/43 + Chrome43/43 + jsdom39/39 | ✓ | **VERIFIED** | ADJUST/drag/anchor/RESET/DONE/CLEAR |
| Placement **persistence** | ✓ E2E25/25 (stub) | **✓ PATCH200 + refresh + GET** | **VERIFIED** | Live-JSON: `{x:0, y:-4.2106, scale:0.63, anchor:"torso"}` |
| Scale **slider** | ✓ | ✓ | **VERIFIED** | Live visuel virkning bekræftet |
| **Wheel (left-click+wheel)** | ✓25/25 | ✗ rapporteret ikke-fungerende | **NOT YET ACCEPTED** | Diagnose klar; se Wheel/Pinch-analysen |
| **Pinch** | ✓25/25 + Device-Mode14/14 | ✗ ikke testet på fysisk enhed | **AUTOMATED ONLY** | GUI Device-Mode kan ikke — kørt via DevTools-protokollen (CDP) |
| Touch (drag/cancel/scroll) | ✓33/33 | ✗ seneste telefon-test negativ (før fix) | **AUTOMATED ONLY** | Webkit-fix ikke live-godkendt endnu |
| Profile = DRESSED placement | ✓ E2E (stub) | – afventer live-persistens-kæde | **AUTOMATED ONLY** | Samme resolver bekræftet i kode+stub |
| Saved outfits (ids, ingen placement) | ✓ E2E25/25 | ✓ historisk | **VERIFIED** | `item_ids`-kun bekræftet i kode+RPC |

**Vigtigt om testgrundlaget:** alle automatiserede suites er **eksterne midlertidige harnesses i `%TEMP%`** (jsdom, CDP-native, Chrome-syntetisk, touch, persistence-E2E, wheel/pinch, Device-Mode-probe) — de er **ikke committet til repoet**. `package.json` har **ingen test-script**. Dette er en kendt begrænsning (se nedenfor).

## Known limitations

1. Wheel/pinch: **ikke live-accepteret** (kun automatiseret).
2. Fysisk telefon: placement-touch **ikke live-godkendt** efter webkit-fix (kun syntetisk/Device-Mode).
3. Automatiserede tests **findes ikke i repoet** — kun som midlertidige harnesses; gentages ved næste fase.
4. `placement`-CHECK krævede `0003`-fix (`jsonb_typeof` = `'string'`) — validering findes nu3 steder (client/server/DB).
5. GET-fallback kan ikke skelne manglende kolonne fra "ingen værdier" (begge giver `placement:null`) — bevidst deploy-sikkerhed, men et debugging-kompromis.
6. `.env` indeholder **dublerede** `PUBLIC_SUPABASE_*`-nøgler (ryd op ved lejlighed; ingen kendt fejl).
7. **Alt siden persistence-runden er uncommitted** (`git status`:6 modificerede + nye filer; `origin/clothes =16fc958`) — commit/backup er det næste trin.
8. Ældre analyse-dokumenter er delvist forældte (se doc-inventory nedenfor).

## Current milestone

**Pre-backup dokumentations-milepæl:** live-persistence verificeret (`ADJUST → DONE → PATCH → SUPABASE → REFRESH → SAME PLACEMENT` med bekræftet JSON), placement-editoren verificeret, hovedpositionen dokumenteret i nye `docs/`-specifikationer. Klar til commit/backup (ikke udført her).

## Next planned development

1. **Commit + backup** af det nuværende arbejde (alt er uncommitted).
2. **Live-accept af wheel** (diagnose efter event-log) og **pinch/touch på fysisk telefon**.
3. Flyt de midlertidige testsuites **ind i repoet** (f.eks. `tests/` + `npm test`).
4. Ryd `.env`-dubletter; overvej PATCH-fejlrespons med `code` (debuggability).
5. Evt. godkendt Supabase-implementeringsplan (M0–M6 fra `DRESSED-SUPABASE-IMPLEMENTATION-PLAN.txt`) — afventer særskilt godkendelse.

## Documentation inventory (status pr. i dag)

| Dokument | Status |
|---|---|
| `docs/DRESSED-PROJECT-SPECIFICATION.md` | **NY — gældende regler/kilder** |
| `docs/DRESSED-CODEBASE-OVERVIEW.md` | **NY — gældende kodeoversigt** |
| `docs/DRESSED-ASSETS-AND-MEDIA.md` | **NY — gældende asset-inventory** |
| `analysis/DRESSED-CURRENT-STATUS.md` | **NY — denne fil, gældende status** |
| `analysis/Wheel-Pinch-Placement-Scale-Analysis.md` | Gældende mht. wheel/pinch; persistence-afsnittet er overhalet af live-verifikation (se dens efterfølgende note) |
| `DRESSED-CLOTHING-ANALYSIS.txt` | **Historisk** — pipeline/generering stadig relevant; savner placement/persistence/touch |
| `DRESSED-SUPABASE-ANALYSIS.txt` | **Historisk** — schema/RLS reference; mangler `placement`-kolonne +0002/0003 |
| `DRESSED-SUPABASE-IMPLEMENTATION-PLAN.txt` | **Afventende plan** (M0–M6), ikke implementeret |
| `analysis/BestFitAnalyse*.md` (3) | **Gældende reference** for anchor-matematik |
| `analysis/ClothingPlacement-Implementation-Analysis.md` | **Delvist forældet** (identity-transform-era; overrides/persistence kom senere) |
| `analysis/Phase2-Woman-Tshirt-Test.md` | **Historisk** engangstest |
| `AGENTS.md` / `CLAUDE.md` | Duplikat-indhold for to værktøjskonventioner — bevaret bevidst (kan være i brug af hhv. agent-CLI'er) |


