# DRESSED 3D Implementation Readiness

> **Type: READ-ONLY ANALYSIS.** No production code, no migrations, no Supabase
> changes, no dependencies, no UI and no placement behavior were modified.
> **This file is the only new artifact.** No commit/push/merge/stash/reset was
> performed.
>
> **Branch:** `safety-branch` (the working tree already contained pre-existing
> modifications from the account-security work before this task started — see
> §Verification; those files are untouched by this analysis).
>
> **Built on (read first):**
> - `analysis/dressed-3d-model-z-axis-analysis.md` (3D engine choice,
>   `placement3d`, front/side/back, hair, adult/teen/child, AI cost)
> - `analysis/dressed-3d-model-view-clothing-navigation-analysis.md`
>   (slot navigation, gesture priority, `editingItemId` as sole selection state)
> - `analysis/DRESSED-ASTRO-ARCHITECTURE-ANALYSIS.md` (no UI frameworks, plain
>   `<script>` modules, `lib/shared` = contract layer)
> - `analysis/dressed-account-security-and-user-isolation-analysis.md` +
>   `supabase/migrations/202610070001_account_security_and_user_isolation.sql`
>
> **Evidence marking (consistent with the prior reports):**
> **CONFIRMED** = read directly in code/migration/analysis in this repo ·
> **INFERRED** = logical conclusion from confirmed material ·
> **UNVERIFIED** = needs external research, a live measurement or an experiment
> that was not run here (Three.js packaging details, model quality, licenses).

---

## Executive Summary

1. **DRESSED is a 2D CSS-composited PNG system today.** One canonical 1024×1536
   (2:3) canvas, one personal AI model image, one transparent PNG layer per
   garment, positioned by a CSS transform chain
   (`translate(x%,y%) scale(scaleX,scaleY)` around `transform-origin = anchor`).
   There is **no rotation of any kind** in the current model view (CONFIRMED —
   no rotate state exists in `wardrobe.astro`).

2. **The render seam is narrow and already shared.** All 2D rendering flows
   through three functions in `wardrobe.astro` (`setCharacterImage`,
   `renderCharacterLayers`, `applyLayerPlacement`) plus a second, identical
   consumer in `src/lib/client/profile-outfits.ts`. Everything else —
   selection, outfits, persistence, AI, security — is renderer-agnostic. This
   is what makes a safe 3D introduction possible.

3. **Recommended integration point: Option C — a model-view abstraction that
   can host both 2D and 3D — implemented first as an *isolated* module
   (Option B's containment) behind a separate route, never by replacing the 2D
   view.** The 2D renderer remains the default and fallback throughout Phases
   0–5. See §2.

4. **Astro supports vanilla Three.js cleanly.** The project has **zero
   framework client directives** (CONFIRMED — no `client:*` anywhere);
   interactivity is plain bundled `<script>` modules. Three.js must be
   dynamically imported from browser-only code under `src/lib/client/three/`,
   never from `lib/shared` or `lib/server` (imported by API routes). See §3.

5. **The first 3D POC = one new page + one new client module + one static GLB.**
   No database, no API, no AI, no gesture and no wardrobe changes. It must
   prove the ten listed capabilities. See §4.

6. **One canonical coordinate system: glTF conventions.** Y-up, meters, model
   origin at the feet, model faces +Z, **model yaw about world +Y** (the model
   rotates; camera framing is deterministic, never persisted state).
   "Clothing Z" is **never world Z** — it is a local shell offset along the
   anchor's surface normal inside
   `bone → anchor → local(u,v,w) → local rotation → local scale → shell`.
   One shared contract module owns these definitions. See §5.

7. **Master-model architecture:** one canonical skeleton per body family, body
   types as data (not code forks), the **existing 16 `DRESSED_ANCHORS` names
   reused as the anchor/slot vocabulary**, bald body GLB + separate hair asset,
   rigid anchor attachment first, skinned garments later. See §6–§9.

8. **Front/side/back is solved by construction, not by prompt:** ONE garment
   GLB, three camera angles, three derived renders — never three AI
   generations. Shoulder-bag placement likewise becomes deterministic anchor
   metadata; **the successful clothing prompt does not need to change.** See
   §8, §10.

9. **2D stays canonical for persistence until proven otherwise.** A future
   `placement3d` would be a *sibling* of `wardrobe_items.placement` — same row,
   independent validation, NULL default, deterministic defaults on read, **no
   backfill, no migration of existing rows** (legacy 4-key/6-key placements
   keep working exactly as today). Do not create it yet. See §11–§12.

10. **This task produced exactly one file:**
    `analysis/dressed-3d-implementation-readiness.md`. No package installed,
    no schema touched, no prompt touched. See §24 for the exact next
    implementation task.

## 1. Map of the Current Model View (dependency map)

### 1.1 Where the model is rendered (CONFIRMED)

| Concern | Location | Evidence |
|---|---|---|
| Model window markup | `src/pages/wardrobe.astro:21–37` (`#wardrobe-model`, empty state) | `.wardrobe-model` inside `.model-window` |
| Canvas construction | `wardrobe.astro:229–243` `setCharacterImage()` — creates `.dressed-canvas` > `img.dressed-character-base` + `.dressed-clothing-layers` | replaces children of `#wardrobe-model` |
| Clothing layers | `wardrobe.astro:458–484` `renderCharacterLayers()` — one `<img class="dressed-clothing-layer">` per selected item, `zIndex = index+1` | filters `generationVersion === 3` |
| Layer placement | `wardrobe.astro:317–331` `applyLayerPlacement()` — writes CSS variables only | never touches z-index or assets |
| Second renderer (Profile) | `src/lib/client/profile-outfits.ts:22–59` `renderLayers()` — same resolver, same CSS variables | comment: "Same shared resolver as DRESSED" |
| Transform contract | `src/styles/wardrobe.css:640–659`; `src/styles/profile.css` (same math) | see §1.3 |

### 1.2 Where images come from (CONFIRMED)

| Image | Source | Path pattern | Access |
|---|---|---|---|
| Personal DRESSED model | `dressed_characters.model_path` (primary) | `{userId}/personal-model-{uuid}.*` in bucket `model-images` | signed URL 60 min (`wardrobe.astro:1030–1032`) + localStorage cache (`src/lib/client/dressed-character.ts`) |
| Fallbacks | `profiles.source_photo_path` (`profile-images`) → legacy `localStorage["closet-source-photo"]` | `{userId}/...` | signed URL 60 min / data URL |
| AI-ready clothing layer | `wardrobe_item_ai_assets.reference_path` per `(user, item, base_type)` | `{userId}/clothing/{characterId}/*.png` | signed URL 60 min (`api/wardrobe/items/index.ts:283–289`) |
| Original / clean previews | `wardrobe_items.original_path`, `.preview_path` | `{userId}/...` | signed URL 5 min (`index.ts:307–329`) |
| Global base forms | `dressed_base_forms.storage_path` | `system-reference/base-forms/{woman,man}.png` | table + storage read; SELECT policy for authenticated (`202610040010:91–101`); exact 1024×1536 gate (`src/lib/server/ai/base-forms.ts:53–55`) |

Model and clothing images are **PNG end-to-end** (AI jobs enforce PNG
1024×1536 — `character-job.ts:106–111`; uploads allow jpeg/png/webp —
`image-input.ts:3–7`).

### 1.3 The exact 2D render chain (CONFIRMED)

```text
selectedItems[] (ordered by clothingLayerOrder at insert time)
  → renderCharacterLayers()        filters: asset.generationVersion === 3
  → <img class="dressed-clothing-layer" style="z-index = index+1">
  → applyLayerPlacement()
       resolveLayerPlacement(item) = session override
                                   -> wardrobe_items.placement (JSONB)
                                   -> clothingPlacement(category) default
       dressedAnchor(anchor, baseType)   (man-specific Y overrides)
       writes --anchor-x/y, --clothing-scale, --clothing-scale-x/y,
              --clothing-x/y
  → CSS (wardrobe.css:651–658):
       --clothing-base-scale: var(--dressed-clothing-scale, 1)  // never set → 1
       transform-origin: (anchor-x·100%) (anchor-y·100%)
       transform: translate(--clothing-x, --clothing-y)
                  scale(base·scaleX, base·scaleY)
```

- **Scale:** one canonical proportional `placement.scale` (0.4–2) written by
  slider, pinch and wheel; optional FREE `scaleX`/`scaleY` (always stored
  together) written only by the WIDTH/HEIGHT sliders (`wardrobe.astro:569–589`).
- **Rotation:** **none** — no rotate key, no rotate state, no CSS `rotate()`.
  The model is a fixed front-facing photograph.
- **Selection:** `editingItemId` is the single source of truth
  (`wardrobe.astro:269`; comment at `:854`: *"editingItemId is the ONLY
  selection state"*). Tap = topmost-box test (`clothingLayerAtPoint`,
  `:688–704`) committed on `pointerup` within `TAP_SLOP_PX = 8`.
- **Dragging:** one Pointer-Events path on `#wardrobe-model`; only the
  `.dressed-clothing-layer--editing` layer receives events; delta → canvas % →
  `setPlacementOverride({x,y})` (`:706–806`).
- **Pinch:** two pointers that began on the active layer → ratio → `scale`
  only (`:786–799`). **Wheel:** only while the left button is held on the
  editing layer → same `placement.scale` (`:884–906`).
- **Persistence:** only on DONE, ADJUST-toggle close and RESET →
  `commitPlacementOverride` → `persistItemPlacement` → `PATCH
  /api/wardrobe/items/[id]` (server re-validates with the same
  `parsePlacement`; service-client UPDATE filtered by `user_id` + `id`).

### 1.4 Outfit state, saved outfits, data stores (CONFIRMED)

| Concept | Representation | Location |
|---|---|---|
| Current outfit (session) | `selectedItems: WardrobeItem[]` (max 5, insertion-sorted by `clothingLayerOrder`), `activeCategory`, `editingItemId`, `placementOverrides: Map`, `freeScale` (UI-only) | `wardrobe.astro:205–277` |
| Saved outfits (persisted) | `saved_dressed_outfits(user_id, id, character_id, base_type, name, outfit_key, item_ids[1..5])`, written via RPC `save_dressed_outfit` | `202610040012:19–52`; RPC `:53–164` |
| Outfit API | GET/POST `/api/wardrobe/outfits`, DELETE `/api/wardrobe/outfits/[id]` (validates normalized-v1 primary character + version-3 assets before saving) | `api/wardrobe/outfits/index.ts` |
| Character (model identity) | `dressed_characters(user_id, id, model_path, gender, is_primary, geometry_contract_version 'legacy'\|'normalized-v1')` | `202610040001:41–55`, `202610040012:4–17` |
| Items | `wardrobe_items(user_id, id TEXT, name, category CHECK(21), reference_path, original/preview path, placement JSONB)` PK `(user_id, id)` | `202610040001:169–215`, placement `202610050002` + `202610060002` |
| Placement column | JSONB exactly `{anchor,x,y,scale}` OR `+{scaleX,scaleY}` together; NULL = category default; anchor ∈ 16 named anchors | `202610060002:20–99` |
| Geometry contract | `DRESSED_GEOMETRY_CONTRACT_VERSION = "normalized-v1"` shared constant, checked in wardrobe page, outfits API and profile flows | `src/lib/shared/clothing-geometry.ts` |
| Layer ordering | `CLOTHING_LAYER_ORDER` (socks 5 → … → glasses 90) | `clothing-categories.ts:51–74` |
| Anchor defaults | `DRESSED_ANCHORS` (16 anchors, canvas fractions) + `MAN_ANCHOR_Y` overrides + `CLOTHING_PLACEMENT` category→anchor table | `clothing-categories.ts:86–177` |

### 1.5 Dependency map (what depends on what)

```text
PAGES (server-rendered HTML + client <script> modules)
  wardrobe.astro ──┬─ lib/client/wardrobe-ai.ts ──HTTP──> /api/wardrobe/items, /outfits
                   ├─ lib/client/dressed-character.ts (localStorage image cache)
                   ├─ lib/supabase.ts (session + storage signed URLs)
                   ├─ lib/shared/clothing-categories.ts   (anchors, layer order)
                   ├─ lib/shared/clothing-placement.ts    (resolver/validator)
                   ├─ lib/shared/clothing-assets.ts       (version 3, base types)
                   └─ CSS: styles/wardrobe.css            (transform contract)
  profile.astro ───┬─ lib/client/profile-outfits.ts ──> SAME shared resolver
                   └─ CSS: styles/profile.css             (same math)
  closet.astro ────> /api/wardrobe/items (read-only listing, same signed URLs)

API ROUTES (Netlify functions, `prerender = false`)
  /api/wardrobe/items        GET  → items + aiReadyAssets + signed URLs + placement
                     [id]    PATCH → placement only (parsePlacement, service client)
                              DELETE → item + asset files + saved-outfit cleanup
  /api/wardrobe/outfits      GET/POST → saved outfits (RPC save_dressed_outfit)
  /api/ai/*                  personal-model, process-clothing, dress-model, try-on
  /api/account/delete        deletes account + storage files (202610070001 era)
        └─ lib/server/supabase.ts (JWT auth, service client)
        └─ lib/server/ai/* (OpenAI, jobs, base-forms, background launcher)
        └─ netlify/functions/* (background AI finalization)

DATA (Supabase)
  public.* tables (RLS owner policies)   →  wardrobe_items, dressed_characters,
     saved_dressed_outfits, wardrobe_item_ai_assets[_legacy], dressed_base_forms,
     wardrobe_results, ai_generation_* , profiles
  storage buckets "model-images" / "profile-images"
     → user files `{userId}/...` (owner-folder policies, 202610070001)
     → global files `system-reference/...` (authenticated read, 202610040010)

CONTRACTS shared by both sides (lib/shared — imported by pages AND API routes):
  clothing-placement · clothing-categories · clothing-assets · clothing-geometry
  ⚠ rule: anything in lib/shared must stay three-free / browser-API-free.
```

**Key property (INFERRED):** the *only* renderer-specific code paths are §1.1's
three functions + two CSS files. Outfit logic, `editingItemId`, persistence,
signed-URL issuance, RLS and AI never inspect how a layer is drawn. A 3D
renderer can therefore be added **beside** these functions without touching
anything else — provided the introduction is staged (§2).

## 2. Best 3D Integration Point

### 2.1 Options compared

#### A. Replace the existing 2D model-view completely

- **Advantages:** one renderer, one code path long-term; no dual maintenance.
- **Disadvantages:** every confirmed behavior (tap-select, drag, pinch, wheel,
  FREE scaling, layer order, Profile's second renderer, localStorage character
  cache, empty states, geometry-contract gate) must be re-proven at once;
  garment GLBs do not exist yet, so most outfits would render *nothing*.
- **Migration risk:** **CRITICAL** — the 2D view is the product's core screen;
  a regression here fails the entire §22 checklist.
- **Placement impact:** `placement` semantics (%, canvas fractions) have no
  3D equivalent yet — replacing the renderer strands every persisted value.
- **Mobile / outfits / AI / accessories / hair / body types:** all simultaneously
  invalidated until 3D reaches feature parity (months of exposure).
- **Verdict: rejected.**

#### B. Add a separate 3D view beside/behind the existing architecture

- **Advantages:** zero risk to 2D (nothing existing is edited); independent
  iteration; easy to delete; ideal for a POC; matches how the repo already
  adds features (additive migrations, additive APIs).
- **Disadvantages:** two renderers can drift; duplicated wiring (outfit state,
  asset loading) if naively copy-pasted; UI must express "which view is
  active" without disturbing the default.
- **Migration risk:** **LOW** if it lives on its own route/module and is not
  reachable from the wardrobe flow until approved.
- **Placement/outfits/AI impact:** none (it reads the same read-only APIs).
- **Verdict: correct *containment strategy* for Phases 1–2, insufficient as
  the *end state*.**

#### C. Model-view abstraction supporting both 2D and 3D

- **Advantages:** formalizes the seam that already exists (§1.5): one
  interface — `setCharacter(image)`, `setOutfit(items, baseType)`,
  `setSelection(itemId)`, `setRotation(yaw)`, `dispose()` — with the current
  2D behavior wrapped as `ModelView2D` *without rewriting it*, and
  `ModelView3D` added beside it. Outfit logic, `editingItemId` and persistence
  stay renderer-agnostic (they already are). Profile, Closet and future pages
  reuse the same contract. Adult/teen/child and hair plug into the same
  interface later.
- **Disadvantages:** requires a small, careful refactor *later* (extracting
  the three wardrobe functions behind the interface) — that refactor must be
  explicitly approved because it touches `wardrobe.astro`.
- **Migration risk:** **LOW→MEDIUM**, staged: abstraction is introduced
  around the *existing* functions first (behavior-identical), 3D becomes a
  second implementation only after Phases 1–2 prove it.
- **Placement impact:** none — 2D keeps `placement`; 3D keeps its own state
  (§11). The abstraction passes *resolved items*, not CSS variables.
- **Mobile / outfits / future AI / accessories / hair / body types:** all get
  one extension point instead of N page-level special cases.
- **Verdict: correct end state.**

#### D. Other options considered

- **D1 — `<model-viewer>` web component:** rejected previously (z-axis report
  §3): limited camera/orbit control, no skeleton-level attachment, extra
  dependency surface. **UNVERIFIED** against current versions, but the
  attachment requirements alone rule it out (INFERRED).
- **D2 — 3D as a full-screen overlay route only (B without any interface):**
  viable for Phase 1, but forces a copy of outfit state wiring; becomes debt
  by Phase 5. Use as the *Phase-1 shape*, not the destination.
- **D3 — replace CSS transform with CSS 3D (`transform-style: preserve-3d`):**
  rejected — no real mesh, no lighting, no skeleton, cannot meet §4 proof
  points 1/7/10.

### 2.2 Recommendation

**Recommended: C (model-view abstraction), introduced in two safe steps:**

1. **Step 1 (Phases 1–2): deliver as B** — a self-contained
   `src/lib/client/three/` module mounted by a dedicated, non-linked prototype
   route. `wardrobe.astro` is **not edited**. This proves the engine, the
   lifecycle and the coordinate contract with zero product risk.
2. **Step 2 (Phase 5): converge to C** — extract the three existing 2D
   functions behind a `ModelView` interface *by moving them unchanged*, make
   the current DOM renderer the `ModelView2D` implementation (byte-identical
   behavior), then mount `ModelView3D` behind an explicit, user-visible
   toggle. If anything in Step 2 regresses, the toggle defaults back to 2D
   and nothing is lost.

Why not A: the 2D system is fully validated (33/33 touch suite + persistence
live checks per `Wheel-Pinch-Placement-Scale-Analysis.md`) and most 3D assets
don't exist yet; replacing it buys nothing today and risks everything.
Why not B-as-end-state: outfit/selection wiring would fork and drift, and
Profile's second renderer would need a third copy.

## 3. Three.js / Renderer Check

### 3.1 Current Astro architecture (CONFIRMED)

| Aspect | Finding |
|---|---|
| Framework islands | **None.** `client:*` directive search across the repo = 0 hits. All interactivity lives in page `<script>` blocks (`wardrobe.astro:128+`, two script blocks per page). |
| Rendering mode | Netlify adapter (`astro.config.mjs`), API routes export `prerender = false`; pages are server-rendered HTML + bundled client scripts. No client-side router — navigation is classic page loads (`DRESSED-ASTRO-ARCHITECTURE-ANALYSIS.md`). |
| TypeScript | `tsconfig.json` extends `astro/tsconfigs/strict`, includes `**/*` — new `.ts` modules are type-checked with full strictness. |
| Bundling | Vite (via Astro) bundles `<script>` imports; dynamic `import()` creates a separate chunk loaded on demand. |
| Existing deps | `astro`, `@astrojs/netlify`, `@supabase/supabase-js`, `pngjs` only. No rendering libs. |

### 3.2 Can Three.js be introduced cleanly? — YES, with four rules (INFERRED from confirmed structure)

1. **Browser-only import.** Three.js touches `window`/`document`/WebGL. It may
   only be imported from code that executes in the browser: page `<script>`
   modules (or functions they call). It must **never** be imported from
   `lib/shared/**` (imported by API routes, e.g. `items/[id].ts` imports
   `clothing-placement`) or `lib/server/**`.
2. **Dynamic import at mount time.** `const { createViewer } = await
   import("../lib/client/three/viewer")` inside the view-init function — keeps
   three.js out of the initial bundle, loads it only when the 3D view is
   actually opened, and makes SSR/prerender irrelevant (the code path cannot
   run during prerender because it sits behind browser-only event wiring).
3. **Server boundary respected.** API routes and AI jobs stay three-free; the
   server's only future 3D job (Phase 9, optional) would be *producing* GLB
   files offline, never running Three.js in a request.
4. **One module owns the renderer.** No inline WebGL code in pages; pages only
   call the lifecycle API (§3.4).

### 3.3 Expected package & locations (do NOT install yet)

| Item | Expected choice | Notes |
|---|---|---|
| Package | `three` (npm, MIT) — reaffirms z-axis report §3 | UNVERIFIED exact current version — **pin at install time (open question §23)** |
| Types | `@types/three` (dev) | UNVERIFIED whether current `three` bundles its own types — check at install |
| Loaders (from `three/examples/jsm/...`) | `GLTFLoader`; later `DRACOLoader` (+ `jsm/libs/draco/` decoder), `KTX2Loader` (+ basis transcoder), `MeshoptDecoder` | Only `GLTFLoader` needed for the POC; the rest Phase 3+ |
| Module location | `src/lib/client/three/` | Matches the established `lib/client` convention |
| Component location | `src/components/ModelView3D.astro` (markup shell only) + prototype page `src/pages/model-3d.astro` | Markup in `.astro`, behavior in `lib/client` |
| Shared contract | `src/lib/shared/dressed-3d-contract.ts` (created when Phase 1 starts) | Constants only (axes, yaw names, anchor↔slot table) — importable by server too, so **no three import** |
| Styles | `src/styles/model-3d.css` or a scoped block | Must reuse existing design tokens (`wardrobe.css`) — no redesign |

### 3.4 Initialization & cleanup lifecycle (must not leak)

```text
mount(hostElement)
  1. dynamic import("three") + GLTFLoader           (chunk loaded once, cached)
  2. create WebGLRenderer({antialias, alpha:false}); append its canvas
  3. create Scene, PerspectiveCamera, lights, load GLB (async, cancellable)
  4. ResizeObserver on host → renderer.setSize + camera.aspect + updateProjectionMatrix
  5. requestAnimationFrame loop stored in a handle; render only while visible
  6. pointer/wheel listeners registered on the 3D host ONLY (never on #wardrobe-model
     until Phase 5 explicitly wires them)

dispose() — idempotent, called on: page unload, host removal, view toggle OFF,
            view re-init (before mounting a new one)
  1. cancelAnimationFrame(handle); handle = null
  2. ResizeObserver.disconnect(); remove all listeners added in step 6
  3. scene.traverse → geometry.dispose(); material(s).dispose(); texture.dispose()
  4. loader/cache clear for the POC asset (Phase 3 adds a shared cache with LRU)
  5. renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove()
  6. drop references (scene, camera, renderer) so GC can reclaim
```

Additional safeguards (repo-specific, CONFIRMED patterns to follow):
- The site already re-runs its session guard on **bfcache restore**
  (`wardrobe.astro:1490` `pageshow` persisted) — the 3D view must hook the same
  events: `pagehide` → dispose, `pageshow` → re-init if the host exists.
- **One WebGL context at a time.** Mobile browsers cap contexts (~8–16);
  mounting a second viewer without disposing the first evicts the oldest
  context (blank canvas). The module keeps a module-level `activeViewer` and
  disposes it before creating another.
- Test matrix for leaks: open/close the view 10×, then check
  `renderer.info.memory.geometries/textures == 0` after the last dispose and
  that DevTools shows no growing listener count.

## 4. The First 3D POC (what exactly to build — NOT built here)

### 4.1 What the POC must prove (acceptance criteria)

| # | Proof | How it is demonstrated |
|---|---|---|
| 1 | GLB/glTF can load | `GLTFLoader.loadAsync()` on a static file; load state shown in the page (READY / ERROR text in existing status-line style) |
| 2 | Model renders correctly | Mesh visible, correct proportions/materials, no z-fighting; screenshots front/side/back |
| 3 | Camera works | Perspective camera framed from the GLB bounding box (fit-to-view), aspect handled |
| 4 | Y-rotation works | Buttons/sliders drive `modelRoot.rotation.y`; smooth rAF render |
| 5 | Front/side/back | Snap buttons: yaw = 0° / ±90° / 180° show the same single mesh |
| 6 | Model stays centered | Model origin at feet; camera targets bbox center — resize never drifts it off-center |
| 7 | Lighting/shading works | Key + fill + ambient (or hemisphere light); materials respond as the model turns |
| 8 | Responsive resize | ResizeObserver keeps correct aspect on window/panel resize (no stretching) |
| 9 | Clean destroy | Open/close 10×: no context loss, no listener growth, `dispose()` verified (§3.4) |
| 10 | Clothing attach hook exists | A named **anchor node** (`dress`/`torso`) with a small marker parented to it — rotating the model carries the marker exactly, proving "attach → follows rotation" without any real garment |

**Explicitly NOT in the POC:** no DB reads/writes, no API calls, no Supabase,
no outfit logic, no tap/drag/pinch redefinition, no wardrobe UI change, no AI,
no compression pipeline (Draco/KTX2 deferred to Phase 3), no hair, no
accessories.

### 4.2 Files needed (all NEW; none modify existing files)

```text
src/pages/model-3d.astro                prototype route (NOT linked in nav;
                                        dev-only access until Phase 5)
src/components/ModelView3D.astro        markup: host div + status line +
                                        rotate/front-side-back buttons
src/lib/client/three/viewer.ts          createViewer({host}) →
                                        { setModel(url), setYaw(yaw),
                                          setView('front'|'side'|'back'),
                                          resize(), dispose() }
src/lib/client/three/dispose-scene.ts   idempotent traversal disposal helper
src/lib/client/three/asset-sources.ts   constants: POC GLB URL only
src/lib/shared/dressed-3d-contract.ts   constants: FRONT=0°, SIDE=±90°,
                                        BACK=180°, Y_UP, units, anchor names
src/styles/model-3d.css                 layout for the prototype route only
public/model-3d/prototype-body.glb      static test GLB (global, no storage,
                                        no RLS — placeholder body with a
                                        `dress` anchor node + marker)
```

Precedent for a static, non-user file served from `public/`:
`public/favicon.svg` (CONFIRMED pattern — global assets never live under a
user path, per §14).

**Optional dependency decision (BLOCKING, approval required):** `three` +
`@types/three` in `package.json`. Until approved the POC cannot be built — a
CSS-box substitute would prove nothing about GLB loading, so we do not fake it.

### 4.3 Definition of done for the first implementation task

- `npm run build` passes with strict TS; `npm run dev` serves `/model-3d`.
- All ten proofs demonstrable manually; dispose loop verified in DevTools.
- `git status` shows only the new files above + the package-lock change (only
  when the dependency was approved).
- Every item on the §22 regression checklist behaves identically (nothing
  else was edited, so this holds by construction — verify with `git diff --stat`).

## 5. Z-Axis Definition (the one canonical coordinate system)

### 5.1 What must be distinguished (the five different "Z"s)

| Term | Meaning in DRESSED | Never means |
|---|---|---|
| **Model rotation** | A single scalar `modelYaw` — rotation of the model root about **world +Y**. Front/side/back = yaw 0°/±90°/180°. | Camera movement; a per-garment value |
| **Camera rotation** | Presentation detail: camera fixed at +Z looking at the model (recommended default). Any orbit UI *aliases* to `modelYaw`, so canonical state stays one number | A persisted or normalized value; a second competing "who rotates" convention |
| **Clothing depth ("Z position")** | The **local shell offset** `w` — distance along the anchor's surface normal so the garment sits on top of skin/inner layers and depth-sorts correctly | World Z; a free axis the user drags |
| **Clothing local position** | `(u, v)` in the anchor's local frame (horizontal / vertical along the body) | Percent of canvas (that is the 2D system) |
| **Clothing attachment** | *Which node the garment is a child of*: `bone → anchor node → garment`; model rotation propagates through the parent chain automatically | A coordinate — it is hierarchy |

### 5.2 Evaluation of the proposed chain against the actual project

Previous proposal (z-axis report):
`node → inherited anchor → local position (u,v) → local rotation → local scale → shell/depth`.

Evaluated against the real code (CONFIRMED):

- Maps 1:1 onto today's data model: `anchor` (16 names in `DRESSED_ANCHORS`) =
  *node selection*; `x,y` (canvas %) = *local position (u,v)*;
  `scale/scaleX/scaleY` = *local scale*; the missing third value = *shell/depth
  w*, which in 2D is implicit (z-index ordering via `clothingLayerOrder`) and
  becomes explicit in 3D.
- Correctly treats `z` as **not** a world axis: garments must follow the body
  when `modelYaw` changes — a world-Z offset would leave the shirt floating
  beside the model after a 90° turn.
- Preserves the resolver pattern
  `session override → persisted → default` per phase.
- Gap found in this review: the proposal does not fix the **yaw sign** nor the
  **units**. Both must be pinned in one shared contract module (§5.4), or
  different parts of the app will disagree — the exact failure mode this
  section exists to prevent.

### 5.3 Recommended canonical coordinate system

```text
WORLD (glTF defaults — no custom axes):
  units        : meters (1 unit = 1 m)
  up           : +Y
  origin       : model root at the FEET, centered on the body axis (ground y = 0)
  model forward: +Z   (chest faces +Z when yaw = 0)
  +X           : to the RIGHT ON SCREEN in the default front view
                 (camera at +Z looking down −Z, up = +Y)
  front view   : camera ~(0, chestHeight, +distance), lookAt (0, chestHeight, 0)

ROTATION:
  axis         : world +Y through the model origin (turntable)
  value        : modelYaw  (radians in code, degrees in UI/contract)
  convention   : right-hand rule about +Y
  named views  : FRONT = 0°, BACK = 180°, SIDE = ±90°
                 (which sign shows the model's RIGHT profile is fixed ONCE in
                  dressed-3d-contract.ts and never re-derived anywhere else)
  camera       : never persisted, never per-garment; framing = f(bbox)

CLOTHING LOCAL FRAME (per anchor node — all garment data lives here):
  anchor node  : small Object3D parented to a bone (or body node in the POC)
  u            : anchor-local X (horizontal, body width direction)
  v            : anchor-local Y (vertical, body height direction)
  w (shell)    : anchor-local Z ≈ surface normal (garment sits proud of skin;
                 inner layers get smaller w, outer layers bigger w)
  rotation     : rx, ry, rz about the anchor's local axes
  scale        : sx [, sy, sz] — 3D analogue of scale/scaleX/scaleY
  hierarchy    : skeleton bone → anchor → (u,v,w) → rotation → scale → mesh
```

Mapping rules from 2D (deterministic pure functions — defined later, NOT
implemented now):

- `placement.anchor` (name) carries over **as-is** — same 16-name vocabulary.
- `placement.x/y` (canvas %, ±60) are **not** interpreted as meters; 3D uses
  its own defaults unless an explicit conversion function is approved (§12).
- `placement.scale/scaleX/scaleY` seed `sx/sy` only if deliberately approved
  (open question §23); default = ignored in 3D.

### 5.4 One contract, one owner (rule)

A single future module — `src/lib/shared/dressed-3d-contract.ts` — defines:
axis names, units, yaw convention + named views, the anchor vocabulary, the
category→slot table, and `DRESSED_3D_CONTRACT_VERSION` (mirroring
`DRESSED_GEOMETRY_CONTRACT_VERSION` in `clothing-geometry.ts`).
**No page, component, shader, API route or AI job may define its own axes.**
Where 2D and 3D meet, only this module is allowed to translate.

## 6. Master Model Architecture

### 6.1 Target system (recap)

bald master model · separate hair assets · adult / teen / child · shared
wardrobe assets · accessories (jewelry, glasses, hats, shoulder bags).

### 6.2 Concept evaluation (which are needed, and when)

| Concept | Definition | Needed for first implementation? | Phase |
|---|---|---|---|
| **body_type** | Which body this is. **Reuse the existing `base_type` vocabulary (`woman`/`man`)** — CONFIRMED everywhere (`dressed_characters.gender`, `wardrobe_item_ai_assets.base_type`, `dressed_base_forms.base_type`, profile gender-lock). A second vocabulary would immediately fork. | **YES — as a concept** (no new column; the POC is one placeholder body) | 1 (concept), 8 (adult/teen/child rows) |
| **skeleton** | Fixed bone hierarchy that body and garments share | YES as design constraint; the POC placeholder GLB must already carry the intended structure | 3 |
| **bone** | Individual skeleton joint | Part of skeleton — no separate store | 3 |
| **anchor** | Named attach point bound to a bone (Object3D). **Vocabulary = the existing 16 `DRESSED_ANCHORS` names** (head, face, ears, neck, shoulders, torso, waist, hips, left-hand, right-hand, knees, ankles, feet, full-body, dress) | **YES** — POC proof #10 is exactly this | 1 (proof), 3 (authoritative table) |
| **clothing_slot** | Behavioral unit for wearing/navigating ("one top per slot"). Navigation report: *slot ↔ node* = `placement3d.node` | NO — 2D uses category today; slots would touch outfit logic | 5 (with navigation) |
| **body_region** | Presentation grouping (upper/lower/head…) for UI | NO — `CLOTHING_FILTER_GROUPS` already covers the 2D need | 5+ |
| **asset / garment_asset** | Versioned 3D file + metadata (what `wardrobe_item_ai_assets` is for 2D) | NO | 9 |
| **hair_asset** | Global swappable hair GLB + color variant | NO | 7 |
| **accessory_asset** | Global/user accessory GLB with anchor binding | NO | 6 |
| **asset_variant** | LOD/texture/color alternatives of one asset | NO | 10 |

### 6.3 Skeleton strategy (INFERRED, recommended)

- **One skeleton per body *family*, not per body type.** Bone names are a
  frozen contract; adult/teen/child and woman/man are *proportioned meshes
  skinned to the same hierarchy* (retargeting then works for free). Same
  insight as the z-axis report's "IMAGE 2 ALWAYS WIN": geometry is canonical,
  identity is per user.
- **Separate skeletons only if proportions exceed retargetable range** (e.g.
  child vs adult limb ratios) — decide in Phase 8, data-driven:
  `body_type → skeleton_version`, never an `if (type === 'child')` fork in
  rendering code.
- **Anchor nodes are extra empties in the skeleton** (not bones), parented to
  the nearest relevant bone, so adding an anchor never changes skinning.
- **Attachment points** = anchor nodes; **clothing slots** = logical names
  mapped 1:1 to anchors where possible (waist slot ↔ waist anchor), with
  slot-exclusion rules (dress occupies top+bottom) as **data**, per the
  navigation report.
- **Hair** attaches to the `head` anchor (§9); **accessories** to their
  anchors (§10); **shared wardrobe assets** are global rows keyed by
  `body_type` + `slot` — parallel to today's
  `wardrobe_item_ai_assets (user, item, base_type)` but global, in Phase 9
  only, after licensing/dedup decisions (§14, §23).

### 6.4 Slot mapping seed (deferred, one table)

`category → slot` will re-express `CLOTHING_PLACEMENT`
(`clothing-categories.ts:154–177`) — tops→torso, jackets→shoulders,
bags→right-hand… This table belongs in `dressed-3d-contract.ts` **once, as
data**; 2D category defaults and 3D slots must derive from the same source so
they can never disagree (§5.4).

## 7. Clothing Attachment

### 7.1 Approaches compared

| Criterion | A. Static parented mesh | B. Skinned mesh / skeleton-based | C. Hybrid |
|---|---|---|---|
| Implementation complexity | **Low** — child an Object3D to an anchor node | High — authoring, weights, validation, retargeting | Medium, staged |
| Visual quality | Perfect while the body is rigid; gaps appear once the body deforms | Best — garment moves with the body | Same as B for garments, A for rigid items |
| Rotation behavior (the POC requirement) | **Already correct** — yaw propagates through the parent chain | Correct | Correct |
| Future animation | Breaks (rigid garment on a bending body) | Native | Native for skinned parts |
| Clothing deformation | None | Full | Full where it matters; none needed for rigid parts |
| adult/teen/child fit | Offsets must be re-authored per body | Retarget via shared skeleton | Retarget skinned parts; rigid anchors adapt automatically |
| Accessories (glasses, hats, bags) | **Ideal** — rigid by nature | Overkill | **Exactly this** |
| Suitability for DRESSED | Good first step, insufficient end state | Right end state, too heavy as step one | **Best** |

### 7.2 Recommendation

**Hybrid (C), phased:**

1. **Phase 4a — anchor-parented rigid garments.** For *pure Y-rotation* (the
   only motion that exists until animation is approved) rigid parenting is
   already visually correct, needs no skin weights, and proves the whole
   attach→follows-rotation chain cheaply (POC proof #10 upgraded to a real
   garment). Recommended as the first clothing attachment.
2. **Phase 4b — skinned garments** once posing/animation/fitting is on the
   roadmap: garment meshes share the body skeleton (same bone names, their
   own weights), enabling deformation and body-type retargeting.
3. **Rigid items stay rigid forever:** glasses, hats, jewelry, bags = parented
   to a single anchor with an authored local transform (§10).

Rationale: with A alone DRESSED hits a wall at the first animation; with B
alone the first attachment proof is months away and is the riskiest object in
the system. C delivers the proof in Phase 4a and the correct destination at
4b, and matches how character pipelines split "rigid props" from "skinned
clothing" (INFERRED best practice).

---

## 8. Front / Side / Back Requirement

### 8.1 The rule (unchanged from the z-axis report)

> **ONE garment asset. Three derived views. Never three AI generations.**

Any pipeline that produces "front garment", "side garment", "back garment"
as independent outputs can disagree with itself (different hems, different
colors, different fit) and triples cost. The 3D architecture removes the
question entirely: the views are *camera angles*, not *assets*.

### 8.2 How the pieces work together (technical explanation)

| Piece | Role in front/side/back |
|---|---|
| **GLB** | The single container: scene graph (nodes), mesh geometry, materials, textures, skeleton/skins, and optionally animations, in one binary file. One file per garment ⇒ one source of truth |
| **Mesh** | The garment's actual surface geometry — it exists identically from every angle; no per-view geometry is ever authored |
| **Textures** | Raster images mapped onto the mesh (albedo/normal/roughness). They are sampled according to view/light; they are *not* "views". A back-side print is part of the texture map, not a separate asset |
| **Materials** | How the surface responds to light (fabric vs metal vs skin). Consistency across angles is automatic because the material definition doesn't change with the camera |
| **Skeleton** | (Phase 4b) deforms the same mesh for all views; never view-specific |
| **Camera** | The ONLY thing that differs between front/side/back: `modelYaw ∈ {0°, ±90°, 180°}` with a fixed framing function (§5.3). Because the garment is attached to the model, rotating the model rotates garment and body together — the side view is *correct by construction* |

Consequences DRESSED gets for free:

1. **WYSIWYG:** the user rotating the model and a generated "side preview"
   can never disagree, because both come from the same mesh (navigation
   report's "én mesh → alle vinkler").
2. **2D fallback / thumbnails:** any static preview (grid thumbnails, saved-
   outfit cards, even a future 2D layer) can be *rendered* from the GLB at
   standard angles — a deterministic render, **zero AI, zero quota** (z-axis
   report §AI: "Front/side/back-renders, thumbnails, LOD = 0 AI").
3. **Navigation is free:** switching slots or angles loads nothing new — it
   changes `modelYaw` or swaps an already-existing GLB (navigation report
   §12: no AI, no quota, no server call per switch).
4. **Prompt boundary (§19):** if an *image-only* fallback still needs a
   side/back still for a user without 3D, the correct source is a render of
   the 3D asset — not a new prompt.

**Do not** store front/side/back as three rows, three files or three
generations. Store one asset; derive views.

## 9. Hair / Bald Master Model

### 9.1 Options

| Option | Description | Pros | Cons | Verdict |
|---|---|---|---|---|
| Hair baked into body mesh | Body GLB includes hair | One file | Hair color/style changes require regenerating the *body*; breaks identity consistency and asset reuse | **Rejected** — exactly what "bald master" exists to avoid |
| Separate **static mesh** parented to `head` | Rigid hair object | Simplest swap | Long hair doesn't respond to head/shoulder motion; visible disconnects at the neckline later | OK for short hair / POC only |
| Separate **skinned mesh** | Hair has its own skin weights to the same skeleton | Follows head/neck/shoulder motion; real animation support | Weight authoring needed | **Recommended baseline** |
| **Hair cards** (alpha-tested planes/shells over a scalp mesh) | Industry-standard game approach | Good volume/look at low cost, easy recolor, small files | Needs alpha handling in materials; authoring care at edges | **Recommended technique inside the skinned mesh** |
| Strand/groom simulation | Per-strand physics | Best fidelity | Far too heavy for low-end mobile; tooling burden | **Rejected for now** (UNVERIFIED perf; revisit only with evidence) |

### 9.2 Recommended architecture

```text
BALD MASTER MODEL (global GLB)
  body mesh (skinned, identity-neutral) + skeleton + anchors
  └── HEAD ANCHOR / head bone
        └── HAIR ASSET (global library, separate GLB)
              skinned to the SAME skeleton (head, neck, shoulders)
              hair cards / shell mesh
              material tint = hair color (uniform parameter or texture variant)
```

- **Swap semantics:** changing hairstyle/hair color replaces only the hair
  node's asset — the body skeleton, anchors and every garment attachment stay
  untouched, so **clothing stays attached and the model identity is stable**
  (the face/head geometry lives in the master + personal identity layer, not
  in the hair).
- **Library:** hair styles are a *global* asset catalog (styles/colors are not
  personal content), user selection is a per-user *reference* (which style id +
  color) — exactly the global-asset/user-reference split of §14. **No
  migration now**; when introduced it is a user row pointing at a global id.
- **Wigs** = just another hair asset in the same catalog (possibly a
  "full-wig" variant flag); no special case needed in code (INFERRED).
- **2D parity (later):** the existing 2D flow keeps hair as part of the
  generated character image (today's behavior, untouched); 3D hair only
  matters when the 3D body is active. The two never fight because only one
  renderer is active at a time (§2, §11).
- Defer: hair physics, per-strand rendering, dynamic re-coloring of the 2D
  image — none are needed for the first implementation.

---

## 10. Accessories

### 10.1 Attachment requirements per type

| Accessory | Anchor / bone (existing vocabulary) | Attachment mode | Notes |
|---|---|---|---|
| Glasses / sunglasses | `face` (bridge) | Rigid parent + authored local rotation | Temple arms may intersect hair — collision is authoring-time, not runtime (INFERRED) |
| Hats | `head` | Rigid | Sits above hair; hair asset may need a "flattened under hat" variant later (open question §23) |
| Earrings | `ears` (pair — needs a left/right sub-offset inside the anchor) | Rigid | Tiny meshes; scale floor to avoid shimmer at distance (mipmaps, Phase 10) |
| Necklaces | `neck` / `torso` | Rigid now; **skinned later** (a necklace on a bending body needs deformation) | Shell offset `w` keeps it proud of skin and under collars via layer order |
| Bracelets / watches / rings | `left-hand` / `right-hand` | Rigid | Hand bones exist in the skeleton plan |
| **Shoulder bags** | `shoulders` (clavicle side) **or** a dedicated sub-anchor on the shoulder bone | Rigid + authored orientation; strap may be skinned later | The critical case — see 10.2 |
| Handbags / backpacks | `right-hand` grip / `torso` (two straps) | Rigid | Backpack = torso anchor with back-facing local rotation (local +Z ≈ back) |

### 10.2 Can 3D solve the shoulder-bag placement problem *without* touching the prompt?

**Yes (INFERRED, strongly).** Diagnosis:

- Today the bag is a *flat PNG on the 2D canvas*: its position is the
  category default (`bags → right-hand` anchor, `clothing-categories.ts:165`)
  plus whatever the AI drew *inside* the image. The AI is implicitly asked to
  "draw a bag AND place it correctly relative to a body" in one generation —
  and being a 2D composited layer, the system has no way to correct it
  afterwards except manual X/Y placement.
- In 3D these are two separate, independently solvable problems:
  1. **Asset:** AI (or a catalog) produces *the bag* — shape, material,
     texture. Orientation relative to a body is irrelevant at this step.
  2. **Attachment:** the app parents the bag GLB to the `shoulders` anchor
     with a **baked local transform** (offset + rotation) stored as attachment
     metadata on the asset. Deterministic, testable, fixable in code — and
     identical for every user.
- Therefore the placement/orientation defect is an **attachment-metadata
  problem, not a generation problem**. The successful clothing prompt stays
  untouched; only the *consumer* of the generated asset changes (Phase 6/9).
- What must NOT happen: "fixing" the bag by prompt-engineering a side view or
  by generating bag-specific variants (front/side/back) — that reintroduces
  the §8 failure mode and spends quota per attempt.

Prerequisite (Phase 3): an authoring convention that every accessory GLB
ships with its `anchor` name + local transform declared alongside it (glTF
extras or a sidecar metadata row — decision in §23).

## 11. Existing 2D Compatibility (coexistence)

### 11.1 Options compared

| Option | Advantages | Disadvantages / risk | Verdict |
|---|---|---|---|
| **A. 2D remains canonical (forever)** | Zero work now; 3D stays a preview gimmick | 3D can never own garment truth (attachment, depth); front/side/back stays stuck on images | Acceptable *transitional* state only |
| **B. 3D becomes canonical immediately** | Single source long-term | Destroys validated 2D behavior; garment GLBs don't exist; `placement` unmappable — fails §22 | **Rejected** |
| **C. Shared logical item/slot representation; per-mode placement side-by-side** | Outfit identity (`saved_dressed_outfits.item_ids`), item identity (`wardrobe_items`), category→slot/anchor vocabulary and selection (`editingItemId`) are **already renderer-neutral** — only *placement* is mode-specific. Each mode keeps its own placement column; neither reads the other's | Requires discipline: two columns, two validators, one vocabulary | **Recommended** |
| **D. Derived placements (compute 3D from 2D or vice versa)** | No new storage | Canvas % ≠ meters; FREE x/y scaling has no 3D meaning; derivation would silently corrupt both | **Rejected** |

### 11.2 Recommended architecture (C) and how `placement3d` would relate

**What already exists and stays untouched (CONFIRMED):**

- `wardrobe_items.placement` (JSONB, 4- or 6-key, NULL = default) — the 2D
  override; validator `parsePlacement`/`sanitizePlacement` shared by client
  and PATCH route; DB CHECK in `202610060002`.
- All outfit identity: `item_ids` in `saved_dressed_outfits` — mode-agnostic
  by construction (it stores *which items*, never *how they are drawn*).
- Selection: `editingItemId` — renderer-neutral (navigation report §3).

**Future (NOT created now) `wardrobe_items.placement3d`:**

| Property | Rule |
|---|---|
| Shape (sketch only) | `{ anchor?, u, v, w, rx?, ry?, rz?, s[, sx, sy] }` — validated by its own `parsePlacement3d` in `lib/shared`, exact-shape check mirroring `parsePlacement` |
| Relationship to `placement` | **Sibling, not successor.** Same row, independent column, independent CHECK. 2D rendering never reads it; 3D rendering never reads `placement` except `anchor` (§12) |
| Default | NULL ⇒ deterministic default from `category → slot → anchor` table (§6.4) |
| Who writes it | Only a future 3D editor, via its own PATCH (or an extended PATCH that validates each key independently), same auth pattern as `items/[id].ts:149` |
| What it must never do | Overwrite/clear `placement`; be backfilled from `placement`; block 2D when NULL; appear in 2D validation paths |
| Versioning | Carry/derive a contract version like `DRESSED_GEOMETRY_CONTRACT_VERSION` so old 3D rows can be detected (`legacy` vs `normalized3d-v1`) |

**Coexistence rule of thumb (INFERRED):** *2D is the fallback and the
canonical representation of record until 3D has proven itself for a full
release; 3D is additive and toggleable; the toggle's default is 2D until
Phase 5 exit criteria are met.* Neither mode may delete or rewrite the other's
state — exactly how `placement` NULL meant "defaults" and nothing changed for
existing rows in `202610050002`.

---

## 12. Legacy Data

### 12.1 What existing users actually have (CONFIRMED)

| Shape | Keys | Produced by | Rendering today |
|---|---|---|---|
| NULL | — | Never adjusted | Category default (`clothingPlacement` + `dressedAnchor`) |
| 4-key | `anchor,x,y,scale` | Original placement editor + early saves | Identical to defaults when x=0,y=0,scale=1 |
| 6-key | `+ scaleX,scaleY` | FREE scaling (`202610060002`) | Effective axes via `effectiveScaleX/Y` |
| (Any) | Both validators accept both shapes; single-axis or unknown keys rejected | — | Never crashes — `sanitizePlacement` returns null → defaults |

No rows are ever rewritten by compatibility logic today — the migration
explicitly states "No rows are rewritten" (`202610050002:1–6`). That property
must survive 3D.

### 12.2 How legacy data should behave after 3D exists

**Rule: DO NOT migrate. Deterministic compatibility + lazy, read-only
interpretation.**

1. **2D stays byte-identical.** Any row that renders today must render the
   same after 3D ships — guaranteed by not touching `placement`, its
   validators, its CSS or its resolver.
2. **3D reads at most the `anchor` from `placement`.** The anchor *name* is
   shared vocabulary between systems (same 16 keys in the DB CHECK), so it is
   the only key with a safe cross-mode meaning. `x/y/scale/scaleX/scaleY`
   are canvas-percent/relative-scale semantics and are **ignored** in 3D.
3. **Everything else defaults lazily:** `placement3d IS NULL` ⇒ resolve
   `category → slot → anchor → default (u,v,w,rotation,scale)` at read time —
   a pure function, no write-back, no background job, no data migration.
4. **If a user later edits in 3D,** only `placement3d` is written (lazily
   materialized by the first save); the 2D value remains exactly what it was.
   Editing back in 2D writes only `placement`. The two can legitimately
   disagree — they describe different modes (INFERRED: acceptable because no
   code path ever combines them in one calculation).
5. **Explicitly forbidden:** batch `UPDATE` scripts that "convert" x/y into
   u/v; deleting `scaleX/scaleY`; re-validating old rows under a new CHECK in
   a way that could fail (always additive columns, new constraints only on
   new keys — the `202610060002` pattern: drop *our own* constraint, re-add a
   strictly-widening one; existing rows valid by construction).

## 13. Database / Supabase (existing inventory + minimum future additions)

### 13.1 What exists today (CONFIRMED from migrations)

| Table / object | Purpose | RLS / grants |
|---|---|---|
| `profiles` | gender (locked), `model_photo_path`, `source_photo_path`, status | Owner-only policies **added in `202610070001`** (was a gap) |
| `dressed_characters` | Personal model rows; PK `(user_id,id)`; path-prefix CHECK; one primary per user; `geometry_contract_version` | SELECT own; insert via `publish_dressed_character` definer RPC |
| `wardrobe_items` | Clothing items; TEXT ids; category CHECK (21); **`placement` JSONB** | Owner CRUD; path-prefix CHECK on `reference_path` |
| `wardrobe_item_ai_assets` | AI-ready 2D layers; PK `(user_id,item_id,base_type)`; `generation_version` (current = 3); path CHECK | SELECT/DELETE own; full grants to service_role (jobs) |
| `wardrobe_item_ai_assets_legacy` | Pre-base-type history | Kept read-only |
| `saved_dressed_outfits` | Saved outfits: `item_ids[1..5]`, `outfit_key`, FK to character | SELECT/DELETE own; INSERT only via `save_dressed_outfit` definer RPC |
| `wardrobe_results` | Generated try-on images + `outfit_key` cache | Owner policies |
| `dressed_base_forms` | **Global** base-form registry (`woman`/`man` → `system-reference/...` path) | SELECT all authenticated (read-only global pattern) |
| `ai_generation_limits/usage/overrides` | Quotas | limits readable; usage own; overrides admin |
| `storage.objects` | Buckets `model-images` (user folders **and** `system-reference/...`) + `profile-images` | `202610070001`: 8 owner-folder policies (SELECT/INSERT/UPDATE/DELETE × 2 buckets) + base-form READ policy from `0010`; anon revoked |
| Placement CHECKs | `202610050002` (4-key) → `202610050003` fix → `202610060002` (4- or 6-key) | Widen-only evolution — **the pattern to copy** |

Also relevant: `save_dressed_outfit` RPC validates normalized-v1 +
version-3 assets; the item-delete trigger removes outfits referencing a
deleted item; `delete_dressed_character` / `POST /api/account/delete` cascade
data and storage files.

### 13.2 Minimum future schema additions (PROPOSALS ONLY — do not create)

| Object | Purpose | Owner | Relationship | User/Global | RLS needed | When |
|---|---|---|---|---|---|---|
| *(nothing)* | — | — | — | — | — | **Phases 0–4: NO SCHEMA AT ALL** (POC GLB lives in `public/`) |
| `wardrobe_items.placement3d` (JSONB, NULL default, own CHECK) | 3D placement sibling | user row | same PK as item | User | Covered by existing `wardrobe_items` policies; new UPDATE path must follow the PATCH auth pattern | Phase 5 |
| `dressed_body_types` (or widen `dressed_base_forms`) | body_type → body GLB path + skeleton version | **global** | read-only reference | Global | SELECT authenticated (copy `dressed_base_forms` pattern) | Phase 3 (or defer — storage-path constants may suffice, §14) |
| `dressed_3d_assets` (id, kind `garment\|hair\|accessory\|body`, path, body_type, slot/anchor, contract_version, fingerprint) | Catalog of global 3D assets | **global** | referenced by user rows later | Global | SELECT authenticated; writes service-role only | Phase 6/7 |
| `wardrobe_item_3d_assets` (user_id, item_id, path/asset_id, generation_version) | Per-user 3D garments (2D analogue of `wardrobe_item_ai_assets`) | user | FK to `wardrobe_items`; PK `(user_id,item_id[,body_type])` | User | Owner SELECT/DELETE + service_role full (exact copy of `0010` grants) | Phase 9 |
| `asset_fingerprints` (hash/pHash → shared asset) | Dedup/global reuse (z-axis report §AI Cost) | global | m:1 to `dressed_3d_assets` | Global (GDPR-sensitive, §14) | service-role only | Phase 9+ (after licensing decision §23) |

Owner for all future 3D schema: same as today — additive files under
`supabase/migrations/`, never editing existing ones, widen-only CHECKs,
explicit grants, definer RPCs for writes the browser must not do directly.

## 14. Global vs User-Owned Assets

### 14.1 Classification (CONFIRMED patterns + recommendations)

| Class | Examples | Storage | Access | Caching |
|---|---|---|---|---|
| **GLOBAL — system** | Master body GLBs (bald), skeletons, global hair assets, accessory templates, base-form images (`system-reference/base-forms/...` today), UI/SVG graphics | `system-reference/...` prefix (today in `model-images`) — or a dedicated 3D bucket (§23); POC files in `public/` | Authenticated read policy (the `0010` pattern); never a `{userId}/` path | Long-lived, immutable; content-hashed filenames ⇒ CDN-cacheable forever |
| **USER — private** | Generated personal model (2D now, identity/head GLB later), uploaded clothing photos, generated AI layers (2D now, 3D later), outfits, placements, profile photos | `{userId}/...` in `model-images` / `profile-images` | Owner-folder storage policies (`202610070001`) + row RLS + **signed URLs** (TTL as today: 60 min / 5 min) | Signed URLs are non-cacheable secrets — short TTL, re-issue (existing behavior) |
| **GLOBAL — shared wardrobe (future)** | Hash-deduplicated garment GLBs derived from *user uploads* | Only after the licensing/GDPR decision (§23) | Read-only catalog | CDN-cacheable; **pHash matching restricted within one user until legal review** (pricing/SVG analysis §13) |

### 14.2 Hard rules

1. **A global asset never gets a user path; a user asset never lacks the
   `{userId}/` prefix.** Already stated in `202610070001`'s header ("System
   files live at `system-reference/...` and are NOT user data") and enforced
   by every path-prefix CHECK — 3D must follow it exactly.
2. **GLB serving for globals:** POC = `public/` (unauthenticated, acceptable
   for a non-linked prototype body). Production globals = `system-reference/`
   + authenticated READ policy (base-form precedent), keeping all assets in
   one governed place. Fully public CDN serving is a §23 decision (easier
   caching, but exposes the full catalog before licensing is settled).
3. **Fingerprinting:** sha256 for exact duplicates + optional pHash for
   near-duplicates (z-axis report §AI Cost) — dedup prevents the
   "three users generate the same shirt" cost explosion. Store hashes in a
   global table only when Phase 9 lands.
4. **Security boundary (2D → 3D must not regress):** every read path today
   filters `user_id` before signing (`items/index.ts` checks
   `referencePath.startsWith(user.id + "/")` before `createSignedUrl`).
   The 3D equivalent must do the same for user GLBs — sign **only after**
   ownership proof, never from a client-supplied path.
5. **Account deletion:** when user GLBs exist they must join the deletion
   sweep alongside today's images (`api/account/delete` already removes
   storage files) — otherwise private 3D bodies outlive the account.

---

## 15. File Formats

### 15.1 Where SVG is appropriate — and where it is technically inappropriate

**SVG is right for:** flat, system-owned, resolution-independent vector
graphics — UI icons, buttons, empty-state illustrations, logos, diagrams,
category silhouettes, favicon (the repo's only SVG today, `public/favicon.svg`).
It is cheap, CDN-cacheable and carries no personal data.

**SVG is wrong for:** anything photorealistic or AI-produced (model imagery,
clothing layers, try-on results), anything with photographic textures, and —
decisively for this phase — **3D content**: SVG cannot represent a mesh,
cannot rotate with correct shading, cannot be skinned, and cannot produce
front/side/back by camera. The pricing/storage analysis reached the same
conclusion (§9/§15: "GLB til fremtidig 3D? JA … SVG kan ikke rotére/placere").
Also note the security rule: user-uploaded SVG stays **forbidden** (XSS
surface; `image-input.ts` allows only jpeg/png/webp) — SVG is for *our* global
assets served via `<img>`, never inline DOM.

### 15.2 Recommended format matrix

| Asset | Recommended format | Why | Notes |
|---|---|---|---|
| AI-generated model imagery (personal character) | **PNG** (status quo) | Photo-like, alpha not required, AI outputs PNG, geometry gate reads PNG dims | WebP/AVIF *derivatives* for previews later — no pipeline change now |
| AI-generated clothing previews (2D layers) | **PNG** | Transparency is mandatory for compositing layers | Same as above; do not change |
| User-uploaded photos | JPEG/PNG/WebP | Current allowed set (`image-input.ts:3–7`) | Keep |
| UI icons | **SVG** (system-owned) or current text/emoji | Vector, tiny, recolorable | Never user-supplied |
| Logos / vector / system graphics | **SVG** | Vector brand assets | Only global |
| 3D bodies (master models) | **GLB** (binary glTF) | Single self-contained file: mesh+materials+textures+skeleton; native to Three.js | Author in Blender → export; compression: **Draco or meshopt** geometry + **KTX2** textures (Phase 3; UNVERIFIED toolchain choice) |
| 3D clothing (garments) | **GLB** | Same; one asset → all views (§8) | glTF `.gltf`+bin only as authoring/interchange; runtime uses GLB |
| 3D hair | **GLB** (skinned, alpha-tested cards) | Same container; alpha materials for cards | See §9 |
| 3D textures (inside GLB) | **KTX2** (GPU-transcoded) with PNG/WebP source | Fast load, GPU-native compression, mip support | Fallback to plain PNG textures until KTX2 pipeline exists |
| Thumbnails (grid, saved outfits, 2D fallback of 3D assets) | **WebP** (small raster) | Small, alpha-capable, universally supported | Generated deterministically from 3D renders or existing PNGs — **0 AI** |
| Rendered 3D stills (front/side/back, final look) | **PNG** master → WebP derivative | Renders may need alpha (clothing thumbnails) | Derived views (§8) |

SVG appears **only** in the three vector rows. Everything the AI produces,
everything photographic and everything 3D is raster or GLB.

## 16. Performance

### 16.1 Expected constraints

| Tier | Expectation | Risks |
|---|---|---|
| Desktop | Comfortable for one body GLB + ≤5 garment GLBs | Texture memory with uncompressed 4K maps; multiple WebGL contexts |
| Mobile (mid-range) | Feasible with compressed meshes/textures, ≤1 context, capped pixel ratio | GPU memory ceilings, thermal throttling during rAF |
| **Low-end mobile** | The binding constraint (same population the existing touch suite targets) | Context loss, long GLB downloads on cellular, GC hitches from large buffers |
| Many clothing assets | The 2D grid lazy-loads `<img>` thumbnails — 3D must never eagerly load every GLB | Loading 50 GLBs = instant OOM |
| Many outfits | Saved-outfit cards show thumbnails + names only (CONFIRMED `renderSavedOutfits`) | Must stay thumbnails — never a viewer per card |

### 16.2 Strategy (decide now, implement in the phases — no optimization work yet)

- **Lazy loading:** three.js chunk + body GLB load only when the 3D view is
  opened (§3.2). Garment GLBs load per visible slot on demand with a
  generation-token stale-guard exactly like the navigation report §11.4
  (newest request wins; failure keeps the current mesh).
- **Texture sizes:** body ≤2048², garments ≤1024², mipmaps on; KTX2 when the
  pipeline exists (§15).
- **Mesh compression:** Draco or meshopt at export (glTF-transform) — decision
  in §23, required *before* the first real asset is authored so uncompressed
  masters are never shipped as runtime files.
- **Caching:** (a) global GLBs = immutable + hashed filename → CDN/browser
  cache indefinitely; (b) user GLBs via signed URLs → in-memory Map keyed by
  asset id for the session; (c) API `Cache-Control: no-store` stays as is
  (CONFIRMED on all wardrobe routes).
- **Disposal:** every swapped garment/hair asset disposed on eviction (§3.4);
  an LRU budget (e.g. body + 8 garments) once Phase 3 lands.
- **Thumbnails:** static WebP renders (§15) — closet grid, outfit cards and
  Profile list never touch WebGL.
- **Preload:** at most the *body GLB* when the user first enables 3D; no
  speculative prefetch of garments for slots not shown.
- **Frame loop:** render on demand (rotation/animation active) rather than
  unconditional 60 fps rAF — idle scenes draw nothing (battery on mobile).

---

## 17. Mobile

### 17.1 What exists today (CONFIRMED — must not be redefined)

| Gesture | Scope today | Effect |
|---|---|---|
| Tap | model area (topmost garment box, ≤8 px slop) | select → opens editor for that item (`editingItemId`) |
| Drag (1 finger) | **only** the `--editing` layer | move selected item (x/y in canvas %) |
| Pinch (2 fingers on the active layer) | editing layer | proportional `placement.scale` (0.4–2) |
| Wheel + left-button hold | editing layer (desktop) | same `placement.scale` |
| `touch-action: none` | exactly two elements: `.dressed-clothing-layer--editing` and range inputs | no global scroll lock |

### 17.2 How 3D gestures must coexist

**Principle (INFERRED): gestures are scoped by *surface* AND *mode*; no
gesture changes meaning inside a scope it already owns.**

| Intent | 2D (unchanged) | 3D view (new surface) |
|---|---|---|
| **Rotate the model** | does not exist | 1-finger horizontal drag **on the 3D canvas** → `modelYaw`; FRONT/SIDE/BACK buttons as the accessible alternative |
| **Move a selected garment** | drag on `--editing` layer | NOT on-model: keeps the existing placement panel (sliders/u-v inputs). A drag-on-model mode may be added only if it cannot be confused with rotation (e.g. requires a garment grab handle) |
| **Scale a garment** | pinch / wheel / sliders (unchanged) | placement panel sliders (existing UI); pinch **in 3D** = camera dolly (view zoom), NOT garment scale |
| **Navigate slots** | outfit-list ↑/↓ + ADJUST buttons (unchanged) | explicit slot arrows/pill — **never** a horizontal swipe (§18) |
| **Select** | tap (unchanged) | tap in 3D = raycast select *later* (Phase 5); until then selection stays in the outfit list |

Conflict rules:

1. The 3D canvas registers its own pointer handlers **on its own element**;
   `#wardrobe-model`'s handler chain is untouched in Phases 1–4 (the 3D view
   isn't mounted there yet).
2. When both coexist (Phase 5), the two surfaces are **mutually exclusive hit
   targets** — the 3D canvas overlays or replaces the model box; it never sits
   underneath the 2D layers listening to the same events.
3. Pinch means *one thing per surface*: garment scale in 2D, camera dolly in
   3D; exclusive surfaces mean no arbitration is needed.
4. Existing `TAP_SLOP_PX`, pointer-capture and cleanup logic stay exactly as
   written (`wardrobe.astro:662–906`).

## 18. Model View Navigation (compatibility with the navigation analysis)

The navigation analysis already decided the model (CONFIRMED, its §4/§16):

- **Focused Slot Navigation:** slot changes happen via the outfit-list arrows
  plus a small on-model pill for the focused item — **never** via horizontal
  swipe on the model, precisely because horizontal drag is reserved for
  moving the selected garment (2D) and will be reserved for **model rotation
  (3D)**.
- `editingItemId` stays the **only** selection state; navigation writes only
  to it; no second selection model may be introduced.
- Navigation is a pure client-side asset swap: no AI, no quota, no server call
  per switch; in 3D that maps to "swap the GLB in the slot node from the
  in-memory cache" with a stale-generation guard.

**Resulting gesture priority (one canonical order, both modes):**

```text
1. TWO-FINGER pinch    → per-surface meaning (2D: garment scale, 3D: camera dolly)
2. ONE-FINGER drag     → 2D: move selected garment (editing layer only)
                         3D: rotate model (modelYaw) — horizontal dominates;
                             vertical ignored (no vertical navigation gesture)
3. TAP (≤8 px slop)    → select (2D box test today; 3D raycast later) — never navigates
4. EXPLICIT CONTROLS   → slot navigation: outfit-list arrows, pill, ←/→ buttons,
                         keyboard — the ONLY way to change "which item is focused"
```

Why horizontal swipe must NOT navigate in 3D: that physical gesture is
already the rotation gesture; dual use would make "turn the model to see the
side" randomly swap the garment (navigation report §4: on the model the
horizontal drag is already taken). Rotation = on-model drag; navigation =
off-model controls.

Compatibility rules (from the navigation report, unchanged):

- "Placement follows the item, never the slot position"; pending overrides
  commit via the existing `commitPlacementOverride` **before** any switch.
- Async loading keeps the current mesh until the new asset is ready; a failed
  load fails closed (stay on the current item) — identical in 3D.
- Slot navigation replaces **one slot's asset**; `modelYaw` is unaffected —
  front/side/back consistency is preserved automatically (§8).

---

## 19. AI Boundary

> **Hard rule: this phase does not modify AI.** The boundary below governs all
> future work.

| Responsibility | AI? | Notes |
|---|---|---|
| Model **identity** (face/head/look), once per user | **AI** | Existing character flow, untouched |
| **Garment understanding** (what is this item, category, design) | **AI** | Existing clothing flow, untouched |
| **Garment representation** (photo → 2D layer today; photo → 3D asset later) | **AI** | Hash-gated: one generation per unique design (z-axis report) |
| Optional **final look / try-on image** | **AI** | Existing `outfit_key` cache, untouched |
| Identity regeneration on body-type/UI change | **NOT AI** | Geometry is canonical (master forms) |
| Camera, framing, `modelYaw`, front/side/back derivation | **NOT AI** | Deterministic renderer (§5, §8) |
| Z / shell position, attachment, anchor metadata, orientation | **NOT AI** | Deterministic data (§10.2) |
| Slot navigation, selection, gestures | **NOT AI** | Client state only |
| Thumbnails, LOD, renders, compression | **NOT AI** | Deterministic pipeline (§15, §16) |
| Placement math (2D or 3D) | **NOT AI** | Pure functions |
| Asset reuse / dedup / cache-hit decisions | **NOT AI** | Hash logic |
| Runtime rendering in the browser | **NOT AI, ever** | No model calls in a request or client code |

Refinements from this review:

1. **The boundary sits at the asset, not at the screen.** AI's output is an
   *asset + metadata*; everything from asset → scene → pixels is deterministic
   app code. That is what makes front/side/back, navigation and cost control
   possible at all (§8, §18).
2. **Navigation never triggers generation** (navigation report §12): a slot
   switch costs 0 quota — otherwise five swipes could drain the live clothing
   quota (5).
3. **Prompts are frozen** during Phases 0–5: the 3D foundation needs no
   prompt changes — the shoulder-bag and view-consistency problems are
   attachment/rendering problems (§10.2).
4. If Phase 9 adds a "photo → 3D garment" job, it is a **new** generation
   type beside the existing ones, hash-gated and quota-protected — an explicit
   approval item, not a silent extension of the current prompt.

## 20. Security

### 20.1 Existing guarantees that must not regress (CONFIRMED)

- JWT-authenticated API routes (`authenticateSupabaseRequest`), explicit
  `user_id` filters on every query, service client only where RLS blocks and
  always followed by owner filters.
- Row-level owner policies on every user table; owner-folder storage policies
  on both buckets (`202610070001`); anon revoked from storage and profiles.
- Path-prefix CHECKs (`split_part(path,'/',1) = user_id`) on every user-file
  column; `publish_dressed_character` verifies `storage.objects` ownership.
- Signed URLs only, issued server-side after ownership checks, short TTL.
- Account deletion cascades rows + storage files (`/api/account/delete`).

### 20.2 3D-specific requirements

| Topic | Requirement |
|---|---|
| **User-owned GLB** | Stored at `{userId}/...` in a private bucket; served only via signed URL created after the server confirms `path.startsWith(user.id + "/")` (same as `items/index.ts:279–289`). Never embedded in globally cacheable responses |
| **Global GLB** | `system-reference/...` (or `public/` for the POC) — never contains user data; authenticated-read pattern of `0010` suffices. Catalog ids are opaque; the catalog is read-only for everyone |
| **Private assets / signed URLs** | Same TTL discipline as today (60 min model / 5 min previews); GLB fetches happen client-side from the signed URL — expiry handled by re-requesting through the API, exactly as images are re-signed today |
| **RLS** | Any new 3D metadata row (Phase 5/9) gets owner policies cloned from its 2D sibling before it is ever written; service-role writes keep explicit owner filters |
| **Ownership & asset IDs** | PKs include `user_id` (existing `(user_id, item_id, base_type)` pattern); asset ids are UUIDs — a path or id supplied by the client is never authorization |
| **Cross-user isolation** | Signing is always preceded by a server-side `user_id = auth.uid()` check, so user B cannot sign user A's GLB even with a guessed id. Client caches for user assets must be keyed per user (or be session-memory only) so a shared cache can never serve A's body to B |
| **Deletion** | Add user GLBs to the account-deletion sweep when they first exist (§14.2-5) |
| **No new attack surface** | No user-uploaded SVG (§15.1), no inline SVG rendering, no new public buckets, no changes to `202610070001` |

**Net assessment (INFERRED):** the 3D architecture is *structurally safer* for
isolation because attachment metadata is deterministic data rather than pixels
baked into a private image — but only if the GLB storage rules above are
followed from day one. Nothing in Phases 0–4 touches any of these guarantees
(no DB, no storage, no auth code modified).

---

## 21. Implementation Phases

Legend for every phase: **DB** = database/storage impact · **AI** = AI/prompt
impact · **Risk** · **Tests** · **MUST NOT change**.

### PHASE 0 — Preparation

- **Goal:** lock decisions before any code (§23 questions answered and
  recorded in this report or a follow-up).
- **Files likely affected:** none (docs only).
- **DB:** none. **AI:** none.
- **Risk:** none.
- **Tests:** re-run §22 checklist baseline (record current pass state).
- **MUST NOT change:** anything in `src/`, `supabase/`, `package.json`, AI.

### PHASE 1 — Minimal 3D viewer (the POC of §4)

- **Goal:** prove GLB load/render/camera/resize/destroy + anchor hook on an
  isolated route.
- **Files likely affected (all new):** `src/pages/model-3d.astro`,
  `src/components/ModelView3D.astro`, `src/lib/client/three/{viewer,
  dispose-scene,asset-sources}.ts`, `src/lib/shared/dressed-3d-contract.ts`,
  `src/styles/model-3d.css`, `public/model-3d/prototype-body.glb`;
  `package.json` + lock (**only after approval** for `three`/`@types/three`).
- **DB:** none (static file in `public/`). **AI:** none.
- **Risk:** LOW — nothing existing is edited; bundle grows only when the route
  is visited (dynamic import).
- **Tests:** §4.1 ten proofs; leak test (§3.4); `npm run build`; §22 spot
  check; visual check that no other page loaded the three chunk.
- **MUST NOT change:** `wardrobe.astro`, gestures, CSS transforms, APIs,
  migrations, prompts, nav links.

### PHASE 2 — Model rotation (as a product behavior)

- **Goal:** yaw control (drag + FRONT/SIDE/BACK + keyboard) with correct
  lighting and centering; state = one `modelYaw` number.
- **Files likely affected:** `src/lib/client/three/viewer.ts`,
  `ModelView3D.astro`, `dressed-3d-contract.ts` (named views), styles.
- **DB:** none. **AI:** none.
- **Risk:** LOW (still isolated route).
- **Tests:** rotation on desktop + touch (device mode + CDP like the existing
  touch suite); resize mid-rotation; dispose while rotating; accessibility
  (buttons do what drag does).
- **MUST NOT change:** 2D gestures, `editingItemId`, outfit logic.

### PHASE 3 — 3D asset architecture

- **Goal:** real master body GLB (bald, canonical skeleton + 16 anchors),
  compression pipeline (Draco/meshopt + KTX2 decision), asset metadata
  conventions (anchor binding, contract version), global vs user storage rule
  applied.
- **Files likely affected:** `public/` or `system-reference/` assets,
  `dressed-3d-contract.ts`, possibly a read-only API or constants module for
  asset paths; **optional** migration only if a `dressed_body_types` /
  `dressed_3d_assets` table is approved (§13.2).
- **DB:** optional, additive, global read-only table — only with approval.
  **AI:** none.
- **Risk:** MEDIUM (authoring pipeline is new; UNVERIFIED toolchain).
- **Tests:** GLB validates (gltf-validator), anchors present with exact names,
  load-time/size budgets (§16), disposal with compressed assets, contract
  version check on load.
- **MUST NOT change:** existing storage policies, `dressed_base_forms`, AI
  jobs, `placement`.

### PHASE 4 — Clothing attachment

- **Goal:** 4a = one real garment parented to an anchor node follows rotation;
  4b (later) = skinned garments sharing the skeleton.
- **Files likely affected:** `viewer.ts` (attach/swap API),
  `dressed-3d-contract.ts` (slot↔anchor table), asset module.
- **DB:** none for 4a. **AI:** none (use an existing authored test garment).
- **Risk:** MEDIUM for 4b (weight authoring), LOW for 4a.
- **Tests:** rotate 0/±90/180 — garment stays welded; swap garment at each
  angle; layer order (socks under pants) respected via shell offsets; memory
  budget after N swaps.
- **MUST NOT change:** `wardrobe_items.placement`, 2D layer rendering, prompts.

### PHASE 5 — 2D/3D coexistence

- **Goal:** extract the `ModelView` interface (wrap, don't rewrite), add the
  2D implementation as the default, mount 3D behind an explicit toggle in the
  wardrobe, introduce `placement3d` (if approved) with lazy defaults.
- **Files likely affected:** `src/pages/wardrobe.astro` (first-ever edit —
  the three seam functions move into a `ModelView2D` module **unchanged**),
  new `src/lib/client/model-view.ts`, `profile-outfits.ts` (same seam),
  `clothing-placement` sibling `parsePlacement3d`, new migration adding
  `placement3d` (additive, NULL default).
- **DB:** one additive column + own CHECK (widen-only pattern). **AI:** none.
- **Risk:** **MEDIUM-HIGH** — first touch of production wardrobe code; mitigated
  by the interface being a *move* (git-identical behavior) and the toggle
  defaulting to 2D.
- **Tests:** full §22 regression suite, executed twice (toggle OFF and ON);
  byte-compare rendered CSS variables pre/post refactor; placement round-trip
  (DONE → PATCH → reload) in both modes; bfcache and pagehide dispose.
- **MUST NOT change:** placement semantics, gestures, saved-outfit format,
  `editingItemId`, RLS, prompts. If any §22 item fails → toggle stays OFF,
  2D remains the only path.

### PHASE 6 — Accessories

- **Goal:** rigid anchor attachment for glasses/hats/jewelry/bags with baked
  local transforms; shoulder bag placed via anchor metadata.
- **Files likely affected:** asset metadata convention, `dressed-3d-contract.ts`
  (accessory anchors), viewer attach API; optional `dressed_3d_assets` table.
- **DB:** optional global catalog (§13.2). **AI:** none — no prompt change
  (§10.2); accessories consumed as assets, not regenerated.
- **Risk:** MEDIUM (authoring quality), LOW for code.
- **Tests:** every accessory type at all three views; no interpenetration at
  anchors; user-owned vs global access tests (§20); deletion sweep includes
  any new user files.
- **MUST NOT change:** clothing prompt, 2D accessory categories/defaults,
  existing storage policies.

### PHASE 7 — Hair / wigs

- **Goal:** bald master + swappable skinned hair assets; hair color as
  material parameter; per-user hair selection stored as a reference row.
- **Files likely affected:** hair asset library, viewer (hair node slot),
  optional user selection row/migration.
- **DB:** optional user reference (additive). **AI:** none for the library;
  any *generated personal* hair would be a separately approved generation type.
- **Risk:** MEDIUM (skinning to shared skeleton; identity consistency).
- **Tests:** swap hair N times without touching garments (attach persists);
  color change updates material only; disposal of replaced hair GLB;
  cross-user isolation of personal hair if user-generated.
- **MUST NOT change:** body skeleton/anchors, existing 2D character flow,
  `geometry_contract_version` handling.

### PHASE 8 — Adult / teen / child

- **Goal:** body types as data rows (`body_type → mesh + proportions +
  skeleton_version`); no rendering-code forks.
- **Files likely affected:** contract module (body-type table), asset catalog,
  outfit/asset compatibility checks (mirror `base_type` gating).
- **DB:** body-type registry (likely reuse/widen `dressed_base_forms` — only
  with approval). **AI:** none — geometry canonical, identity re-used (z-axis
  report).
- **Risk:** MEDIUM (retargeting quality UNVERIFIED; child-safety/legal review
  may apply — §23).
- **Tests:** same garment on all body types at all views; outfit gating
  per body type; scale/anchor invariants; §22 (2D unaffected).
- **MUST NOT change:** profile gender lock semantics, existing base_type
  assets, current default body type for existing users.

### PHASE 9 — AI → 3D pipeline

- **Goal:** photo → garment GLB as a **new** hash-gated generation type with
  validation/acceptance step; optional global reuse library after legal
  review; optional render-based 2D fallbacks/thumbnails (0 AI).
- **Files likely affected:** new job under `src/lib/server/ai/jobs/`, new API
  route (pattern: reserve → job → finish_server), `netlify/functions`,
  asset tables (§13.2), client asset loaders.
- **DB:** `wardrobe_item_3d_assets` + optional `asset_fingerprints`
  (both additive). **AI:** yes — **new** prompt/job only, existing prompts
  untouched; quota for the new generation type added via the existing limits
  pattern.
- **Risk:** HIGH (cost, quality, GDPR/sharing) — gated behind approval + hash
  dedup + acceptance step (z-axis report §pipeline).
- **Tests:** hash-cache hit/miss, quota reserve/credit-back on failure, version
  gates (3D analogue of `CURRENT_CLOTHING_ASSET_VERSION`), cross-user
  isolation (user A's 3D asset never signed for user B), account deletion
  covers 3D files.
- **MUST NOT change:** existing clothing/character prompts, existing quotas'
  semantics, existing 2D asset versions, RLS of existing tables.

### PHASE 10 — Performance / mobile

- **Goal:** budgets met on low-end mobile: compressed assets everywhere,
  LRU/disposal hardening, on-demand rendering, thumbnails for all grids,
  touch rotation UX polish, context-loss recovery.
- **Files likely affected:** viewer (renderer settings, pixel ratio caps),
  asset pipeline (KTX2/Draco), thumbnail generation, styles.
- **DB:** none expected. **AI:** none.
- **Risk:** LOW-MEDIUM (regressions possible in hot paths — ship behind the
  same toggle).
- **Tests:** §16 budgets (load time, texture memory), 10× open/close leak
  test on a real device, context-loss simulation, existing touch suite +
  new rotation suite, full §22.
- **MUST NOT change:** gestures contract (§17/§18), 2D rendering performance
  characteristics, security (§20).

## 22. Regression Safety Checklist

These features **MUST remain working** after every phase. The 3D work may not
modify them unless explicitly approved later. Run before/after each phase.

| # | Feature | Where it lives (CONFIRMED) | How to verify |
|---|---|---|---|
| 1 | Login | `src/pages/login.astro` | Sign in → lands authenticated |
| 2 | Logout | header/session guard | Session cleared → wardrobe redirects to `/login` |
| 3 | Account isolation | RLS + `user_id` filters + `202610070001` | User B sees none of user A's items/outfits/characters (API + UI) |
| 4 | Account deletion | `POST /api/account/delete` | Rows + storage files removed; partial failures reported honestly |
| 5 | Profile | `src/pages/profile.astro` | Loads photo/status/outfits; gender lock intact |
| 6 | Wardrobe page load | `wardrobe.astro:1420–1455` | Items, categories, character render, status text |
| 7 | Clothing upload | `POST /api/wardrobe/items` | Upload → item appears; preview signed URL works |
| 8 | Clothing selection (ADD/REMOVE, max 5) | `renderClothingItems` `:1239–1260` | Adds in layer order; 6th item refused |
| 9 | Item dragging | `pointermove` drag path `:776–806` | Selected item moves in x/y; release stops |
| 10 | Proportional scaling | SIZE slider + pinch + wheel → `placement.scale` | 0.4–2 clamp; DONE persists |
| 11 | FREE scaling | toggle + WIDTH/HEIGHT `:537–589` | Both axes stored together; toggle-off strips axes |
| 12 | X scaling / Y scaling | `scaleX`/`scaleY` effective axes | One axis move keeps other's effective value |
| 13 | Pinch | `placementPinch` `:786–799` | Two fingers on active layer scale only |
| 14 | Wheel | `:884–906` | Only with left-button hold on active layer; page scroll elsewhere untouched |
| 15 | Tap-to-select / ADJUST | `clothingLayerAtPoint` + `:833–858` | Tap ≤8 px selects; drag/scroll does not; `editingItemId` still sole state |
| 16 | Placement persistence | DONE/RESET → `PATCH /api/wardrobe/items/[id]` | Saved after reload; failed PATCH keeps session value + error message |
| 17 | Outfit creation/saving | `#save-outfit` → `save_dressed_outfit` RPC | 1–5 items, name limits, version-3 gate |
| 18 | Outfit load/apply/clear/delete | `:1344–1372`, `#apply-outfit`, `#clear-outfit` | Loads ids; renders layers; deletes row |
| 19 | Saved outfits in Profile | `profile-outfits.ts` | Choice persists per user in localStorage |
| 20 | Existing AI generation (character) | `personal-model` + character job | Quota reserve → job → publish → primary flip |
| 21 | Existing AI generation (clothing) | `process-clothing` + clothing job | v3 asset committed per `(user,item,base_type)` |
| 22 | Existing clothing prompt | `clothing-job.ts` prompt text | **Unchanged byte-for-byte** |
| 23 | Existing generated model | `dressed_characters` + `model-images` | Signed URL renders; geometry gate messages still correct |
| 24 | Legacy placements (4-key/6-key/NULL) | `sanitizePlacement` + CHECKs | Old rows render exactly as before |
| 25 | Auth/session guard + bfcache | `wardrobe.astro:1458–1493` | Logged-out visitor redirected incl. `pageshow` restore |

Verification method per phase: `git diff --stat` shows only the phase's listed
files; run items 1–25 manually (and the existing automated touch suite where
available) after each phase; full pass required before merging any phase.

---

## 23. Open Questions (decide BEFORE implementation — no silent product choices)

**Blocking for Phase 1:**
1. Exact **Three.js version** to pin (and whether `@types/three` is still
   needed; plus Draco/KTX2 decoder versions) — UNVERIFIED today.
2. Approval to add dependencies to `package.json` (currently forbidden by
   this task's constraints).
3. Where the prototype route lives (`/model-3d`, unlinked) and who may access
   it during development.
4. Source of the placeholder/test GLB (in-house Blender export vs licensed
   sample) and its license.

**Blocking for Phase 3 (asset architecture):**
5. Body mesh source/creation workflow (Blender authoring? purchased base?
  generated?) and the **Blender/export conventions** (scale = meters, +Z
  forward, Y-up, node naming).
6. **Skeleton standard:** exact bone names/hierarchy (custom canonical set vs
  a standard like a humanoid rig) — frozen once Phase 3 ships.
7. Compression choice: **Draco vs meshopt**, KTX2 or PNG textures for v1.
8. Global asset storage: keep `system-reference/` in `model-images`, new
   bucket, or `public/` — and whether globals are served authenticated-only
   or public/CDN.

**Blocking for Phase 5 (coexistence):**
9. Is **2D the permanent fallback** (recommended) or will 3D eventually be
   default? Recommended answer: 2D default until an explicit, measured
   decision.
10. Is 3D initially **optional/hidden** or announced? (Recommended: hidden
    toggle, then opt-in.)
11. Shape/validation of `placement3d` (exact keys, ranges) and whether 3D
    editing exists at all in v1 or only viewing.
12. Whether `placement.anchor` is officially shared across modes (this report
    recommends yes — confirm).

**Blocking for Phase 6/7/8:**
13. Global asset **licensing** for bodies/hair/accessories (and for any
    shared garment derived from user uploads) — GDPR/legal review for the
    dedup library; pHash scope (within-user vs global).
14. Whether **generated clothing can become reusable 3D assets** at all
    (Phase 9) — product + legal + cost decision.
15. Hair: wig-flattening variants under hats; personal (AI-generated) hair
    yes/no.
16. Adult/teen/child: naming (`body_type` values), legal/safety review for
    teen/child models, and whether one skeleton truly retargets all three
    (prototype check).

**Deferred (non-blocking):**
17. Texture pipeline details (resolution tiers, atlas strategy).
18. Thumbnail generation location (client render vs server render job).
19. Whether a "final look" 2D image remains AI-generated when 3D exists
    (recommended: keep, it is cached and cheap — but confirm).

## 24. FINAL RECOMMENDATION

### 1. Recommended architecture

**Option C — a model-view abstraction that can host both 2D and 3D — reached
in two safe steps:** first deliver 3D as an *isolated* module (Option B's
containment) on its own unlinked route with zero edits to existing files;
only after Phases 1–4 prove it, wrap the existing 2D seam (`setCharacterImage`
/ `renderCharacterLayers` / `applyLayerPlacement` + Profile's `renderLayers`)
in a `ModelView` interface with the 2D implementation as the permanent
default/fallback. Supporting pillars:

- **Renderer:** vanilla Three.js, dynamically imported, owned entirely by
  `src/lib/client/three/`, with an explicit mount/dispose lifecycle (§3.4).
- **Coordinates:** one contract module (`dressed-3d-contract.ts`) — glTF
  Y-up/meters, model faces +Z, `modelYaw` about world +Y is the *only*
  rotation state; clothing lives in `bone → anchor → (u,v,w) → rotation →
  scale → shell` (§5).
- **Data:** item/outfit/selection identities stay shared and renderer-neutral;
  placements stay per-mode siblings (`placement` now, optional `placement3d`
  later, NULL = deterministic default, lazy, never migrated) (§11–§12).
- **Assets:** global `system-reference` (or `public/` for the POC) vs private
  `{userId}/` GLBs with signed URLs + owner RLS exactly like today (§14, §20);
  formats GLB (+ Draco/meshopt, KTX2 later), PNG/WebP images, SVG only for
  system vector UI (§15).
- **Attachment:** hybrid — rigid anchor parenting first (proves rotation),
  skinned garments later; hair and accessories are separate assets on the
  same skeleton (§7, §9, §10).
- **Views:** one GLB, derived front/side/back — never three generations (§8).

### 2. Recommended first implementation

Phase 1 only: the ten-proof POC (§4) — `/model-3d` route + `ModelView3D.astro`
+ `src/lib/client/three/{viewer,dispose-scene,asset-sources}.ts` +
`dressed-3d-contract.ts` + one static test GLB in `public/model-3d/`.
No wardrobe edit, no DB, no API, no AI, no gesture change.

### 3. What we should NOT implement yet

- No `placement3d` column/migration; no new tables of any kind (Phases 0–4
  need **zero** schema).
- No edits to `wardrobe.astro`, `profile-outfits.ts`, placement validators,
  gestures, or the placement CSS chain.
- No AI/prompt changes; no new generation type; no quota changes.
- No package installs before explicit approval (Three.js version pinned first).
- No replacement of the 2D view; no hidden default-flip to 3D; no horizontal-
  swipe navigation; no global asset sharing/dedup library; no adult/teen/child
  or hair in the first implementation.

### 4. What existing code must remain untouched

Everything on the §22 checklist — in particular: the placement system
(`clothing-placement.ts`, both CSS transforms, both placement migrations and
the PATCH route), the gesture system (`wardrobe.astro` pointer/wheel handlers,
`TAP_SLOP_PX`), `editingItemId` semantics, outfit save/load paths, all AI
prompts and jobs, all RLS/storage policies (including `202610070001`),
`package.json`, and every existing migration.

### 5. Decisions we need to make together

The §23 list — the four Phase-1 blockers first: Three.js version + dependency
approval, prototype route placement, test-GLB source/license. Then the Phase 3
authoring/skeleton/compression/storage decisions, and the Phase 5 fallback
policy (2D default vs 3D default).

### 6. Exact next implementation task (small and safe)

> **Phase 1, first slice:** *after* the §23-Phase-1 decisions are approved —
> add `three` + `@types/three` (pinned), create
> `src/lib/client/three/viewer.ts` + `src/pages/model-3d.astro` +
> `src/lib/shared/dressed-3d-contract.ts` + `public/model-3d/prototype-body.glb`,
> and demonstrate proofs #1–#9 (load → render → camera → Y-rotation →
> front/side/back → centering → lighting → responsive resize → clean dispose)
> on that unlinked route. Proof #10 (anchor marker) is the immediate follow-up
> slice. **Nothing else in the app changes**; the §22 checklist must pass
> untouched afterwards (`git diff --stat` limited to the new files).

---

## Verification (this task)

- **Files created:** exactly one — `analysis/dressed-3d-implementation-readiness.md`.
- **Files modified:** none. No migrations, no `package.json`/lock, no Supabase
  config, no AI code/prompts, no source files, no UI, no gestures, no git ops.
- The working tree contained pre-existing modifications (account-security
  work: `Header.astro`, `closet.astro`, `profile.astro`, `signup.astro`,
  `wardrobe.astro`, `profile.css`, `signup.css`, `account-state.ts`,
  `api/account/`, `202610070001_...sql` plus earlier analysis files) — these
  were present **before** this task and were not touched by it; verified by
  comparing `git status` before/after this analysis.



















