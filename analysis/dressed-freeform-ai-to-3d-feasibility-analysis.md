# DRESSED — FREEFORM + AI → 3D Feasibility Analysis

> **Type: READ-ONLY architecture and feasibility analysis.** No source files,
> no migrations, no AI prompts, no packages, no configuration were modified.
> No git operations were performed. **This file is the only new artifact.**
>
> **Built on (read first):**
> - `analysis/dressed-3d-implementation-readiness.md` (roadmap, coordinate
>   contract, ModelView abstraction, phases — most recent, authoritative)
> - `analysis/dressed-3d-model-z-axis-analysis.md` (engine, attachment chain,
>   front/side/back rule, AI cost)
> - `analysis/dressed-3d-model-view-clothing-navigation-analysis.md`
>   (slots, gestures, `editingItemId`)
> - `analysis/dressed-ai-failed-generation-cost-audit.md` (calls per action,
>   telemetry price, quota gaps)
> - `analysis/dressed-future-ai-cost-protection-architecture.md`
>   (reservation, caching/reuse, circuit breaker)
> - `analysis/dressed-pricing-storage-svg-analysis.md` (format rules)
>
> **Evidence markers (as required):**
> **CONFIRMED** = read directly in code/migration/analysis in this repo ·
> **INFERRED** = logical conclusion from confirmed material ·
> **UNVERIFIED** = needs external research, a live test or an experiment not
> run here. External facts fetched for this report (third-party pricing,
> research papers) carry their source and retrieval date (2026-10-07) and are
> UNVERIFIED against a live paid experiment.

---

## Executive Summary

1. **The current FREE mode is Level-1 freeform minus rotation (CONFIRMED).**
   `placement` = `{anchor,x,y,scale[,scaleX,scaleY]}` — X/Y position, FREE
   independent X/Y scale, proportional scale, anchors, drag/pinch/wheel.
   **No rotation exists anywhere** (no key, no UI, no CSS `rotate()`).
   Anything beyond that (perspective, skew, mesh warping, semantic edits) is
   *not* implemented and must not be described as existing.

2. **A common Freeform semantic model across 2D and 3D is possible and
   recommended** — shared: anchor vocabulary, per-item resolution chain,
   `anchor → position → rotation → scale → shell` intent. Mode-specific:
   canvas-% offsets + z-index (2D), bone parenting + depth `w` (3D). Legacy
   `placement` is never converted; `placement3d` stays a sibling (readiness
   §11–§12 unchanged).

3. **The shoulder-bag (and accessory) problem is an attachment/metadata
   problem, NOT a prompt problem (CONFIRMED by architecture).** The successful
   clothing prompt (`clothing-job.ts:77–115`) is a *front-view, body-aligned
   layer* generator; accessory placement/orientation comes from category
   defaults (`bags → right-hand`) plus pixels baked into the image. In 3D it
   becomes deterministic anchor metadata. **The prompt must not change.**

4. **One image CAN produce a useful, plausible 3D garment — with conditions
   (INFERRED + UNVERIFIED external).** Single-image image-to-3D services exist
   with published pricing (Tripo: image-to-3D = 20 credits ≈ $0.20, fetched
   2026-10-07); research (GarVerseLOD, TOG 2024) reconstructs high-fidelity
   garment meshes from one in-the-wild image but struggles with complex
   topology. The **back of the garment is guessed** from one front image —
   fine for plain garments, wrong for statement backs. Hence the progressive
   minimum-information model (Levels 1–4, §11): ask nothing by default, ask
   *one targeted question* only when hidden-surface risk is detected.

5. **Economics work only with once-per-unique-asset generation.** Today one
   garment costs ~2 image calls at upload (no quota — audit S3) + 2 calls at
   "MAKE AI READY" (quota — audit S2), ≈ $0.13 at telemetry price
   (~$0.064/call). A 3D reconstruction adds an estimated **$0.20–0.50 per
   asset** (3–8× an image call). Acceptable *once per unique design* with hash
   dedup; unacceptable per user, per retry, or per view. Multi-view image
   generation would multiply cost — instead **all views are deterministic
   renders of ONE mesh (0 AI)**, as the z-axis report already requires.

6. **Recommended target level: "Simple+" = complete Level-1 transforms in 2D
   (plus optional rotation later) + Medium 3D** (garment meshes + skeleton +
   anchors + deterministic fitting + semantic attachment parameters). Reject
   Level-2 mesh sculpting, user-driven deformation, cloth simulation, and any
   pipeline that regenerates images per view (§27).

7. **The readiness roadmap survives mostly intact (§28):** Phase 1 (viewer
   POC) unchanged; Freeform/anchor vocabulary must be decided *before* Phase 3
   (GLBs bake anchors in); a **separate garment-reconstruction experiment**
   must gate Phases 4/9; 2D and 3D develop independently at first.

8. **Critical final answer (§32): YES, WITH CONDITIONS** — plausible reusable
   3D assets from ordinary uploads, without many-image requirements and
   without excessive AI generations, are realistically achievable if the
   conditions in §32 are accepted.

## 1. Context

DRESSED is a Clueless-inspired virtual wardrobe: 2D composited model view,
personal AI character, AI clothing layers, outfits, placement with FREE
X/Y scaling, Supabase with RLS, quotas, and three prior 3D analyses. Every
listed capability is CONFIRMED in the repo except the 3D pieces themselves,
which are *analysis only* — no Three.js, no GLB, no 3D code exists (CONFIRMED:
no `three` in `package.json`, no `.glb` anywhere in the repo).

## 2. Approach to the primary question

The question is decomposed into five feasibility layers, each answered
separately before the final verdict:

| Layer | Question | Where answered |
|---|---|---|
| Technically possible? | Can any pipeline turn an image into a fitted GLB? | §9, §10 |
| Practically possible? | Can *DRESSED's* flows (one photo, background jobs, quotas) carry it? | §11, §21 |
| Visually acceptable? | Does it look convincing next to today's 2D layers? | §13, §25 |
| Economically acceptable? | Cost per asset vs today's $0.064/call world? | §21 |
| Safe for the architecture? | Does anything existing have to break? | §6, §24, §28 |

Nothing assumes the answer is yes; §32 gives the verdict with explicit
flip-to-NO conditions.

## 3. Mandatory rule: prompt problem vs asset-type/attachment/geometry problem

### 3.1 What the successful clothing prompt actually does (CONFIRMED)

`src/lib/server/ai/jobs/clothing-job.ts:72–115` — one `editImage` call with:

- **Image 1 = the canonical base form** (1024×1536, pixel-exact alignment);
  Image 2 = the user's photo as *design reference only*;
- the garment is drawn **front-facing, on-body, on a fixed canvas** with
  category-specific rules (e.g. the explicit `SKIRT SIZING` clause, `:109`);
- output = transparent 1024×1536 PNG, validated by signature, IHDR dims,
  alpha presence and **transparent corners** (`:118–154`);
- committed per `(user_id, item_id, base_type)` at
  `generation_version = 3`.

This is a **2D front-layer generator**. Its success on T-shirts, skirts,
jogging pants and strap tops is the system's proven baseline and is out of
scope for change.

### 3.2 Diagnostic table — where known problems actually come from

| Symptom | Root cause (evidence) | Verdict |
|---|---|---|
| Shoulder bag on wrong side / wrong orientation | Position = `CLOTHING_PLACEMENT` default (`bags → right-hand`, `clothing-categories.ts:165`) + pixels the AI *baked into* a flat layer. A flat PNG **cannot** put a strap behind the body (no depth), and the 2D system has no orientation channel (no rotation key — CONFIRMED) | **Attachment/geometry problem.** NOT the prompt |
| No side/back views of a garment | The pipeline generates exactly one front layer by design; 2D composition only ever shows front | **Architecture limitation.** NOT the prompt |
| Front/back inconsistency in future 3D | Only happens if views are generated independently — forbidden by the existing rule (z-axis report: one mesh → all views) | **Pipeline design problem.** NOT the prompt |
| Hat/hair/glasses not matching head curvature | Category default anchor (`hats → head`, `glasses → face`) + flat layer over a photo; no orientation metadata | **Attachment problem** |
| Accessory quality below garment quality | Same prompt template with a generic "accessories at their matching body area" clause (`clothing-job.ts:81`); accessories are rigid 3D objects with different needs than fabric | **Asset-type problem.** The garment clauses must not be bent to compensate |
| Layered/multi-piece garments (jumpsuit + belt) | Inherent reconstruction difficulty (GarVerseLOD limitations: multi-layer topology — TOG 2024, UNVERIFIED in production) | **Geometry problem** |

### 3.3 The rule for this project

> **Never modify `clothing-job.ts`'s prompt to fix an accessory, a view, or a
> 3D problem.** Accessories and views get their own asset types, metadata and
> attachment logic. If an experiment ever shows the *garment* prompt failing
> on *normal garments*, that is a regression to fix — but improving one
> category at the expense of normal clothing is explicitly forbidden.

## 4. PART A — Current 2D FREEFORM (exact current capabilities)

> Everything in this section is **CONFIRMED** by direct code reading unless
> marked otherwise. Planned features are explicitly labelled as *not existing*.

### A.1 Placement schema (CONFIRMED)

```jsonc
// wardrobe_items.placement (JSONB, nullable) — 202610050002 + 202610060002
{ "anchor": <one of 15 names>,          // required
  "x": -60..60, "y": -60..60,           // required, percent of canvas
  "scale": 0.4..2,                      // required, canonical proportional
  "scaleX": 0.4..2, "scaleY": 0.4..2 }  // optional, BOTH together or neither
// NULL = use category default. Unknown keys / single axis = rejected (DB CHECK
// + exact-shape check in code).
```

- **Validator:** `src/lib/shared/clothing-placement.ts` — `parsePlacement`
  (strict, byte-stable rounding to 4 decimals, used for WRITES/DONE/PATCH),
  `sanitizePlacement` (tolerant read, clamps, never throws),
  `effectiveScaleX/Y` (`scaleX ?? scale`), `resolveItemPlacement`
  (**session override → persisted → category default**), `isSamePlacement`
  (skip no-op writes).
- **Anchors:** exactly **15** — `head, face, ears, neck, shoulders, torso,
  waist, hips, left-hand, right-hand, knees, ankles, feet, full-body, dress`
  (`clothing-categories.ts:86–106`), canvas-fraction points; `MAN_ANCHOR_Y`
  overrides 6 of them for the man base form (`:122–129`).
  *Correction note:* the readiness report says "16 DRESSED_ANCHORS" in
  places — the code and DB CHECK both list **15** (CONFIRMED here).
- **Categories:** 21 values incl. accessories (bags, jewelry, necklaces,
  earrings, bracelets, watches, glasses, sunglasses, hats,
  hair-accessories) — `clothing-categories.ts:3–26`; DB CHECK matches.
- **Category defaults:** `CLOTHING_PLACEMENT` maps category → anchor with
  `scale 1, x 0, y 0` for every category (NEUTRAL) — `:154–177`.
- **Layer order:** `CLOTHING_LAYER_ORDER` socks 5 → … → glasses/earrings 90.

### A.2 Rendering (CONFIRMED)

- Model + layers are `<img>` elements in a 2:3 canvas (`.dressed-canvas`,
  1024×1536 basis); each layer is positioned purely by CSS variables written
  by `applyLayerPlacement` (`wardrobe.astro:317–331`) and consumed by the
  transform in `wardrobe.css:640–659`:
  `transform-origin: anchor%` → `translate(--clothing-x/y)` →
  `scale(base·scaleX, base·scaleY)`.
- **z-index = array index** of `selectedItems` (ordered at insert time by
  `clothingLayerOrder`); base image z-index 0; layer container
  `pointer-events: none`.
- Profile renders identically through `profile-outfits.ts:22–59` using the
  same shared resolver (no session overrides there).

### A.3 Selection, editing, gestures (CONFIRMED)

| Capability | Status | Evidence |
|---|---|---|
| Tap to select | **YES** — topmost-layer box test, committed on `pointerup` within `TAP_SLOP_PX = 8`; drag/scroll/second finger cancels | `wardrobe.astro:662–704, 818–874` |
| Single selection state | **YES** — `editingItemId` is the ONLY selection state | `:269`, comment `:854` |
| Drag to move (X/Y) | **YES** — only the `--editing` layer receives events; delta → canvas % → `setPlacementOverride({x,y})` | `:706–806` |
| Pinch = proportional scale | **YES** — two pointers on the active layer → ratio → `placement.scale` | `:786–799` |
| Wheel = scale | **YES** — only while left button held on the editing layer; rate 0.0005/px; `preventDefault` only on handled branch | `:876–906` |
| Proportional scale slider | **YES** — SIZE 0.4–2 | `:92–95, 525–529` |
| **FREE SCALING (independent X/Y)** | **YES** — toggle; WIDTH/HEIGHT sliders always write **both** axes together; toggle-off strips both axes; session-only UI state, never persisted | `:96–109, 531–589` |
| **Rotation of a garment** | **NO — does not exist** (no schema key, no UI, no CSS rotate, no code path) | whole-file search |
| **Rotation of the model / multi-view** | **NO — does not exist** (front-facing photo only) | whole-file search |
| Perspective / skew / mesh warp | **NO — does not exist** | — |
| Anchor re-selection | **YES** — dropdown of the 15 anchors | `:88–91, 294–300, 517–523` |

### A.4 Persistence, outfits, geometry libs (CONFIRMED)

- **Write path:** DONE, ADJUST-toggle close, or RESET only →
  `commitPlacementOverride` → `persistItemPlacement` → `PATCH
  /api/wardrobe/items/[id]` (server re-validates with the same
  `parsePlacement`; service-client UPDATE filtered by `user_id`+`id`;
  16 KB body limit). Failed PATCH keeps the session value and shows an error;
  unchanged placements skip the write (`isSamePlacement`).
- **RESET** writes `placement = null` permanently; the clothing item itself
  and its AI assets are never touched.
- **Saved outfits** store only `item_ids` (1–5) + name + character/base_type
  — placement is deliberately **per item, not per outfit**
  (`wardrobe-ai.ts:110–113` comment: "Placement belongs to the clothing
  item, never to an outfit"). Outfit load/apply never rewrites placement.
- **Profile outfit rendering:** resolved from persisted values only;
  localStorage stores only the chosen outfit id per user.
- **Geometry library:** `clothing-geometry.ts` = one constant
  (`normalized-v1`); characters with `geometry_contract_version = 'legacy'`
  are blocked from AI-ready clothing with a status message
  (`wardrobe.astro:976–983`).
- **What the user can do today, summarized:** place an item on a named body
  anchor, move it ±60% on both axes, scale it proportionally or
  independently on X and Y (0.4–2), layer it in category order, select it by
  tap, and persist all of it per item. **What they cannot do:** rotate it,
  deform it, edit its geometry, view the model from any angle, or express
  anything about depth/strap/side.

## 5. What "FREEFORM" should mean for DRESSED

### 5.1 The three levels evaluated

#### Level 1 — Transform freeform (position, scale, rotation)

| Capability | 2D status | 3D mapping | Value |
|---|---|---|---|
| X/Y position | **EXISTS** (±60% canvas) | anchor-local `(u,v)` | High — core interaction |
| Proportional scale | **EXISTS** | local uniform scale | High |
| Independent X/Y scale | **EXISTS** (FREE) | local `sx/sy` (used sparingly — over-stretching looks fake) | Medium — keep |
| **Rotation** | **MISSING** | anchor-local rotation (model yaw is separate) | Medium-high for 2D (tilted hat, bag); natural in 3D |

**Verdict:** Level 1 is the correct *2D* freeform scope. It is ~90 % built;
the only missing element is a per-item rotation angle, which would follow the
exact widen-only pattern used for `scaleX/scaleY` (additive optional key,
both-ends validation, no backfill) — **OPEN DECISION** (§30/FREEFORM), to be
scheduled as a future additive migration, NOT now.

#### Level 2 — Advanced 2D freeform (corner manipulation, perspective, skew, mesh deformation, local warping)

Technically possible on a flat `<img>` via CSS `matrix3d`/canvas warping —
and **not recommended (INFERRED):**

- Visual quality *drops*: warped raster garments show resampling artifacts,
  the opposite of "visually convincing".
- Zero AI independence: the user compensates for asset quality by hand.
- No 3D compatibility: 2D mesh warps have no skeleton-world representation —
  you would build two incompatible deformation systems.
- Performance: continuous canvas re-warping on low-end mobile conflicts with
  the readiness report's §16 budgets.
- Product fit: this turns a wardrobe app into a photo-editing tool.

#### Level 3 — Semantic freeform (move sleeve, widen waist, lengthen skirt, adjust neckline/strap, reposition glasses…)

- **In 2D:** mostly meaningless — a flat layer has no "sleeve" to move; the
  closest existing analog is anchor + X/Y + scale, which already covers
  "reposition glasses/hat" in principle.
- **In 3D:** powerful *and* cheap — but only in **parameterized form**:
  local anchor offsets, rotation, scale, and a handful of per-type parameters
  (strap length, bag drop, neckline shift as bounded local offsets). Numbers
  on an anchor frame, not mesh sculpting.
- Full mesh-level semantic editing (widen waist by editing geometry) is
  **rejected for now**: per-garment deformation rigs, broken asset reuse,
  AI-dependent quality.

### 5.2 Recommendation

> **Target "Simple+": Level 1 fully complete (2D keeps its four transforms,
> rotation added later as an additive key; 3D maps Level 1 into anchor-local
> space) + a *bounded* subset of Level 3 as semantic attachment parameters in
> 3D (§19). Reject Level 2 entirely. Reject mesh-level Level 3 until the
> Medium architecture (§27) is proven.**

Best balance: visual quality (no raster warping), simplicity (same
slider/drag mental model in both modes), performance (pure transforms), user
control (the 80 % cases), AI independence (all freeform is deterministic),
3D compatibility (identical semantic chain).

## 6. Freeform vs 3D — a common conceptual model

### 6.1 The two chains side by side

```text
2D (EXISTS):   anchor(name) → translate(x%, y%) → scale(sx, sy)   [+ z-index ordering]
3D (PROPOSED): bone → anchor(name) → position(u, v, w=shell) → rotation(r)
               → scale(sx[,sy]) → mesh
```

### 6.2 What can be shared (single source of truth)

| Shared concept | Where it lives |
|---|---|
| **Anchor vocabulary** (the 15 names) + category→anchor defaults | `clothing-categories.ts` today; extended (sided) superset in `dressed-3d-contract.ts` later (§18) |
| **Resolver pattern** `session → persisted → default` | `clothing-placement.ts` today; the 3D resolver copies the *pattern*, not the values |
| **Per-item ownership** (placement belongs to the item, never the outfit) | CONFIRMED behavior — holds in both modes |
| **Semantic intent** `anchor → position → rotation → scale → shell` | one documented chain; each mode supplies its own units |
| **Selection** (`editingItemId`) and slot navigation | renderer-neutral (navigation report §3) |
| **Bounded ranges / clamp-never-throw** philosophy | `sanitizePlacement` pattern reused |

### 6.3 What must remain mode-specific (values never shared)

| 2D-only | 3D-only |
|---|---|
| Canvas-percent offsets (±60) | Anchor-local meters `(u,v,w)` |
| z-index / `clothingLayerOrder` pixel ordering | Shell offset `w` + real depth sorting |
| FREE x/y scale as *visual stretch* | Local scale as *fit* |
| Anchor as a *fraction point on a photo* | Anchor as a *node in a skeleton* |
| Transparent-PNG layer asset | GLB mesh asset |

### 6.4 What must never be forced into one schema

- **World coordinates in 2D** and **canvas % in 3D** — the conversion is
  lossy and meaningless (readiness §5.2/§12: 3D ignores x/y entirely).
- **A single `placement` column for both modes** — the sibling-column rule
  stands: legacy `placement` untouched; future `placement3d` independent,
  NULL-defaulted, lazily resolved, never backfilled.
- **Rotation-as-model vs rotation-as-camera vs rotation-as-garment** — three
  different things with three different homes (readiness §5.1).

### 6.5 Where does "Freeform" live? (property ownership model)

| Property | Owner | Lifetime | Example |
|---|---|---|---|
| **Asset geometry** | the asset (immutable per version) | forever, shareable | mesh shape, texture, UV, canonical proportions |
| **Attachment metadata** | the asset (defaults) + catalog | versioned with asset | default anchor, orientation, side, strap offsets (AI *suggests*, catalog stores) |
| **User placement (Freeform state)** | the item row (`placement` / future `placement3d`) | per user, editable, resettable | x/y/scale/scaleX/scaleY [+rotation]; u/v/w/rot/scale |
| **Deformation state** | exists only if semantic parameters ship; then it is *placement-like* (per item), never baked into the asset | per user | strap length 0.8, bag drop 12 cm |

**Conclusion (INFERRED):** Freeform is **a combination** — the *asset* carries
geometry + default attachment; *placement* carries the user's transform and
future semantic deltas; *deformation* (if ever) is placement-like, not
asset-like, so one user's edits can never leak into another user's shared
asset (this also keeps §22 reuse sound: the canonical asset stays pristine).

---

## 7. Clothing type analysis (Freeform behavior per asset type)

Legend: **T** = simple transforms (move/scale[/rotate]) suffice · **A** =
anchor needed (**A2** = multiple/paired anchors) · **DEF** = deformation
needed in 3D · **SLOT** = semantic slot needed (exclusion/navigation) ·
**3D** = special 3D geometry · **AI+** = AI must understand something special ·
**REUSE** = one asset reusable across views/bodies · **VIEWS** = front/back/side
matter · **MIN** = minimum input (§12 codes: **1x** = one image, **Q** =
targeted question, **B** = back image, **S** = side image, **M** = multiple
views).

### 7.1 Wearing garments

| Asset | T | Anchor(s) | DEF | SLOT | 3D geometry | AI+ | REUSE | VIEWS | MIN |
|---|---|---|---|---|---|---|---|---|---|
| T-shirt | Yes | torso (A: shoulders+waist implicit) | light (skinned) | top | standard shell | no — baseline case | yes | front dominates; back only if print | **1x** + Q if print |
| Shirt (button) | Yes | torso | light | top | shell + collar/cuffs | collar/placket detail | yes | back matters (yokes) | **1x** + Q |
| Blouse | Yes | torso | light | top | shell, thin | fabric drape | yes | mild | **1x** |
| Tank/strap top | Yes | torso | light | top | shell + straps (thin geometry) | strap width | yes | strap routing on back | **1x** + Q (back straps) |
| Sweater | Yes | torso | light | top | thicker shell | knit texture | yes | low | **1x** |
| Jacket | Yes | shoulders | light–medium | outerwear | shell + open front option | open/closed state | yes | medium (back panel) | **1x** + Q (open/closed) |
| Coat | Yes | shoulders | medium | outerwear | shell, heavy | length/hem | yes | medium | **1x** + Q |
| Dress | Yes | **dress/neck** anchor | medium | dress (occupies top+bottom slots) | full shell | waist definition | yes | high (back often detailed) | **1x** + Q |
| Skirt | Yes | hips | medium (sway) | bottom | shell + open cylinder | length class (mini/knee/maxi — already prompt-specialized) | yes | mild | **1x** |
| Trousers | Yes | waist | medium | bottom | two tubes + waist | fit (slim/loose) | yes | mild | **1x** |
| Jeans | Yes | waist | medium | bottom | two tubes + pockets/rivets | pocket/stitch detail | yes | back pockets = signature → back matters | **1x** + **Q (strong)** |
| Shorts | Yes | hips | light | bottom | two short tubes | length | yes | low | **1x** |
| Leggings | Yes | waist | medium | bottom | tight two tubes | — | yes | low | **1x** |
| Jumpsuit | Yes | dress-like (shoulder→feet) | high (one piece over 2 joints) | dress-like | full shell + waist join | topology complexity (multi-layer risk) | yes | medium | **1x** + Q; higher fail risk |
| Socks | Yes | ankles | light | sock | thin tubes | — | yes | none | **1x** |
| Shoes | Partial (fit, not position) | feet | semi-rigid | shoe | closed volume pair (L/R mirror) | left/right pair detection | yes | side profile matters (silhouette) | **1x** (+side useful) |
| Underwear | Yes | hips/torso | light | (own slot) | shell | modesty handling in UI (product) | yes | low | **1x** |

### 7.2 Reading of the table (INFERRED)

- **All wearing garments are Level-1 transform-manageable in 2D** — that is
  what the current system already demonstrates (CONFIRMED baseline).
- **In 3D every wearing garment wants skinned deformation** *eventually*,
  but for yaw-only viewing a static shell suffices first (readiness §7:
  rigid-first, skinned later).
- **Semantic slots are needed for navigation/exclusion, not for freeform**
  (dress vs top+bottom is the canonical case).
- **AI+ never means "change the prompt"** — it means the *3D pipeline* must
  know jacket-open-state or jean-pocket-backs as classification/metadata, or
  ask one targeted question (§11).
- Front/back/side rarely gates the *minimum* input; it gates *fidelity*. The
  targeted question system exists precisely for jeans/prints/dress-backs.

### 7.3 Accessories (summary table — detailed in §8)

| Asset | T | Anchor(s) | DEF | SLOT | 3D geometry | AI+ | REUSE | VIEWS | MIN |
|---|---|---|---|---|---|---|---|---|---|
| Bags (handheld) | Partial | right-hand (grip) | none (rigid) | bag | rigid object | grip orientation | yes | full 3D (all sides visible) | **1x** + side useful |
| **Shoulder bags** | Partial | shoulder + side + strap/bag sub-anchors (A2) | none v1 (strap later) | bag | rigid + strap curve | strap style (drop length, cross-body vs shoulder) | yes | **critical** — back/side show strap routing | **1x** + **S** optional + **Q** (how it's worn) |
| Backpacks | No — absolute X/Y fails | torso-back (A2 shoulder L/R) | none v1 | bag | rigid box + 2 straps | worn-on-back detection | yes | **back is the primary view** | **1x + B (near-required)** or worn-photo |
| Glasses/sunglasses | Partial | face (+ ears support) | none | glasses | rigid pair + temples | L/R symmetry, lens opacity (sunglasses) | yes | side shows temple arms | **1x** + side useful |
| Hats | Partial | head | none | hat | rigid dome | crown/brim class | yes | full 3D visible | **1x** (+side useful) |
| Earrings | Partial | ears (**needs ear_left/right**) | none | earring | tiny rigid pair | pair vs single | yes | visible from side | **1x** |
| Necklaces | Partial | neck | light (chain may later drape) | necklace | rigid/curve | chain vs pendant | yes | back = clasp (low detail ok) | **1x** |
| Bracelets/watches/rings | Partial | wrists/hands (needs wrist_l/r) | none | jewelry | rigid | watch face detail | yes | full 3D | **1x** |
| Scarves | Partial | neck | **medium (drape)** — hardest accessory | scarf | flexible loop + tails | wrap style | yes | high (knot at back/side) | **1x** + **Q** (how worn) |
| Belts | Partial | waist | light | belt | loop + buckle | buckle orientation | yes | side buckle position matters | **1x** |
| Hair accessories | Partial | head/hair anchor | none–light | hair-acc | rigid on hair | depends on hairstyle present | yes | full 3D | **1x** |

### 7.4 Cross-cutting conclusions (INFERRED)

1. **Transforms are enough for exactly one class:** wearing garments in 2D.
   Everything else — accessories above all — is *underdetermined* by X/Y
   alone because orientation and side carry most of the meaning.
2. **Accessories need anchors with sidedness** (ear_left/right,
   shoulder_left/right, wrist_left/right — the current 15-anchor vocabulary
   lacks these; see §18) — not new freeform controls.
3. **Only scarves (drape) and necklaces (long chains) genuinely need
   deformation** in 3D; both can start rigid with a "best-effort" curve baked
   at authoring time (INFERRED acceptable at viewing distances).
4. **Backpacks are the single strongest case for a back image** — the back
   IS the presentation surface. This is a metadata/input question, not a
   prompt question.

---

## 8. Accessories (separate analysis)

### 8.1 What should an accessory be in DRESSED?

> **Recommendation: anchor-attached rigid assets with attachment metadata and
> bounded local freeform — not "clothing", not skinned (v1), not free-floating
> absolute-positioned objects.**

| Treatment option | Verdict |
|---|---|
| Same as clothing (2D layer with X/Y/scale) | Status quo; acceptable as **2D fallback only** — it is precisely what makes bags/hats feel "stuck on" |
| Rigid asset, anchor-attached | **Recommended default** (glasses, hats, jewelry, bags, belts) |
| Independently transformable (world-space) | Rejected as primary — re-introduces the orientation problem; allowed only as bounded anchor-local nudges |
| Skinned asset | Only for future strap/drape cases (scarf, long chain, bag strap over shoulder) |
| Semantic attachment (parameters) | **Recommended for the multi-part cases** (shoulder bag, backpack) — §8.3 |

### 8.2 Why the shoulder-bag issue is NOT a prompt problem (verification)

Evidence chain (all CONFIRMED):

1. The bag enters the system exactly like a garment: category `bags` →
   AI-ready layer via the same `clothing-job.ts` front-layer prompt whose only
   bag-specific guidance is the generic clause "accessories at their matching
   body area" (`:81`).
2. Its resting position is `CLOTHING_PLACEMENT.bags = { anchor:
   "right-hand", NEUTRAL }` (`clothing-categories.ts:165`) — a single canvas
   point; there is no side, orientation, depth or strap channel anywhere in
   `placement` (§A.1) and no rotation key (§A.3).
3. A transparent PNG composited *over* the model can never place a strap
   *behind* the torso; z-ordering is global per layer, not per sub-part.
4. Therefore any mis-orientation the user sees is (a) baked into the
   generated pixels and/or (b) a consequence of the anchor default — both
   **attachment/geometry** causes. The prompt cannot encode "hang from the
   right shoulder, strap behind the back" because the output format (one flat
   front layer) cannot represent it.

**Consequence:** fixing bags means giving them an asset type with attachment
metadata in 3D (§8.3) and, in 2D, leaving the current defaults alone. The
clothing prompt stays frozen (§3.3).

### 8.3 Shoulder bag — required attachment metadata (proposed, NOT implemented)

```yaml
asset: shoulder-bag.glb                  # geometry: bag body + strap (rigid v1)
attachment:
  kind: rigid                            # later: strap skinned
  anchors:
    shoulder: shoulder_right | shoulder_left     # side selection
    body_fallback: torso                          # where the strap crosses
  side: right | left
  orientation: { rx, ry, rz }            # authored once per asset (bag hangs
                                         # under the shoulder, faces outward)
  offset_shoulder: { u, v, w }           # strap contact point
  offset_bag:      { u, v, w }           # bag body relative to strap end
  scale: s                               # fit to body proportions
  strap:
    style: shoulder | crossbody
    length: 0..1                         # semantic freeform parameter (§19)
  depth_priority: outer                  # renders above torso, below open coat
defaults_source: attachment-metadata (asset)  → overridable by placement3d (user)
```

**Determinism assessment (INFERRED): YES — fully deterministic.** Every field
above is a number or enum resolved at runtime by the same resolver pattern
used today. No AI runs at view time. AI's only future role is *suggesting*
this metadata once per asset (classification step, §9/§20), and even that can
start as authored defaults per category. Rotation of the model propagates
through the parent chain automatically (readiness §7), so the bag is correct
at front/side/back *by construction*.

### 8.4 Accessories vs clothing — summary

| Dimension | Clothing | Accessories |
|---|---|---|
| Geometry | deformable shell → skinned | rigid object (v1) |
| Anchor count | one primary anchor | often 2+ (side + sub-offsets) |
| Orientation meaning | low (front-on) | **high** |
| Freeform needed | transforms (existing) | local nudges + semantic params |
| Slot logic | exclusion rules (dress) | mostly 1:1 slots |
| AI role | existing prompt (unchanged) | classification + attachment suggestion only |
| Failure cost | fallback to existing 2D layer | fallback to existing 2D layer |

---

## 9. AI → 3D pipeline (stage ownership)

Full chain with the owner of each stage. **No stage list assumes one model
does everything (CONFIRMED as a design principle in the z-axis report: AI
stops at the asset).**

| # | Stage | Owner | Notes |
|---|---|---|---|
| 1 | User upload | **Deterministic** | existing validation: type jpeg/png/webp, ≤4 MB, moderation (audit S3) |
| 2 | Image understanding (what is it, key features, hidden-surface risk) | **AI** (vision/classification) | new, cheap, once per asset; can reuse/extend the existing moderation+classify step — new generation type, approval-gated |
| 3 | Asset classification (category, side-sensitivity, needs-back?) | **AI suggestion + user's chosen category** | user already picks category at upload (CONFIRMED upload form) — AI proposes, user's choice wins |
| 4 | Multi-view expansion (optional, only when escalation triggers) | **AI** (image→multiview, e.g. Tripo "Image to Multiview" 10 credits ≈ $0.10, fetched 2026-10-07) | only for Level-3 inputs (§11) |
| 5 | Garment/accessory reconstruction → geometry+texture | **Dedicated image-to-3D model** (AI, third-party or self-hosted; Tripo image-to-3D = 20 credits ≈ $0.20) | NOT the clothing prompt; separate pipeline |
| 6 | Geometry post-processing (orientation normalize, decimate, retopo, UV check, weld) | **Deterministic** (glTF-transform/Blender batch script) | zero AI |
| 7 | Materials/textures finalize | **Deterministic** (KTX2 encode, sRGB check) | source textures come from stage 5 |
| 8 | Front/side/back consistency | **Deterministic** — one mesh, camera angles | never generated per view (z-axis rule) |
| 9 | Fit to DRESSED master form | **Deterministic fitting first** (scale registration to master proportions + anchor alignment, §15); Blender preprocessing per template | AI-assisted fitting only as rare fallback |
| 10 | Attachment (anchor binding, orientation defaults) | **Deterministic metadata**; AI may *propose* anchor/side in stage 2 | runtime never calls AI |
| 11 | GLB assembly + validation gates | **Deterministic** (export, bounds/intersection/alpha checks, §25) | auto-reject → §26 |
| 12 | 3D wardrobe rendering | **Three.js** | deterministic, browser |
| 13 | Human intervention | **Only** for: master-model authoring, catalog curation, and (optionally) assets a user explicitly flags for repair | never in the normal loop |

**Where AI sits (boundary):** stages 2, 4, 5 (+ optional suggestions in 3/10).
Everything else is deterministic software, preprocessing, or rendering.
This matches readiness §19 and extends it with the reconstruction stage.

## 10. Can one image create a useful 3D garment?

### 10.1 What each input level realistically yields

| Input | Realistically recoverable | Lost / guessed | Practical verdict |
|---|---|---|---|
| **One front image** | Silhouette, color, pattern, front design, approximate depth from category priors — today's 2D layer already derives all of this (CONFIRMED working) | **Back hallucinated** (generic), side depth estimated, hidden closures unknown | **Sufficient for "plausible"** — fine for plain tees/skirts (back ≈ symmetric); silently wrong for statement backs. UNVERIFIED against a real reconstructor run |
| **Front + back** | Full two-sided design; logos/text preserved; consistent pair | Side silhouette still interpolated | Strong cost/benefit when back matters (jeans, prints, jackets) |
| **Front + side** | Correct depth/silhouette; hat/bag/shoe profiles exact | Back still guessed | Best single *additional* view for volume; less useful for prints |
| **Front + back + side** | Everything needed for faithful assets; enables consistent multi-view reconstruction | Only unseen undersides (soles, linings) | Highest fidelity, highest friction — must NOT be the default (§11) |
| **Text description** | Back/side *content* ("large logo on the back", "cross-body strap") — enough to condition a back-view generation or guide reconstruction | Metric shape still from geometry priors | **Cheap, effective supplement** (1 short answer; 0–1 extra image calls) |

### 10.2 Technical feasibility of "one image → garment mesh" (mixed evidence)

- **External research (UNVERIFIED for production):** GarVerseLOD (ACM TOG
  2024, arXiv 2411.03047) reconstructs high-fidelity standalone garment meshes
  **from a single in-the-wild image**, trained on 6,000 artist-created
  garments; explicitly struggles with *complex topology* (multi-layer,
  slits). This proves the research problem is solvable — not that any given
  off-the-shelf service is good enough for DRESSED.
- **Commercial services exist (quality UNVERIFIED):** Tripo API pricing
  (fetched 2026-10-07): Image to 3D = 20 credits ($0.20) / 30 ($0.30, P
  series); Image to Multiview = 10 ($0.10) → Multiview to 3D = 20–30; HD
  texture +10; retopology +10–30; auto-rig +25 ($0.25). A *complete*
  production-grade asset lands around **$0.20–0.60** before volume rates.
- **What "useful" must mean (INFERRED):** the garment looks right while the
  model rotates — silhouette holds, colors/logos match, no body intersection.
  Not millimeter accuracy on unseen seams.

### 10.3 The back-of-shirt test (the decisive case from the prompt)

Scenario: the shirt photo shows the front; the back has a large logo. Can
DRESSED ask *"Does the back contain anything important?"* (No / Yes / Not
sure), then *"Tell us what's on the back"* — and is that enough?

**YES — technically sound and cheap (INFERRED):**

1. The classifier (stage 2) flags *hidden-surface risk* automatically for
   print-heavy/branded garments — the question appears rarely, not always.
2. The text answer conditions either (a) a back-view image generation
   (~1 image call ≈ $0.064) feeding a multiview-consistent reconstruction, or
   (b) the reconstruction prompt directly. Both are standard conditioning
   patterns; effectiveness **UNVERIFIED** — needs the §32 experiment.
3. "Not sure" degrades gracefully → generic back (Level 1 outcome), zero
   extra cost.
4. Total escalation cost: **zero additional user images**; one question and
   possibly one cheap image call, only when risk was detected.

What text *cannot* supply: exact geometry of complex unseen backs (open-back
cuts, 3D knots). Those are rare Level-4 cases where a back photo genuinely
helps — offered, never required; otherwise the generic back stands.

### 10.4 Verdict

> **One image is enough to start and, for the majority category (plain
> garments), enough to finish. Multi-image is an *escalation*, not a
> requirement.** That is what makes §21's economics viable: default cost =
> one reconstruction; rare cost = one question + an occasional extra view.

## 11. Minimum information model ("ask only what materially helps")

### 11.1 The four levels

| Level | Trigger | User effort | AI cost added | Outcome |
|---|---|---|---|---|
| **Level 1 — one image** | always the default | none beyond today's upload | +1 reconstruction (~$0.20–0.30) | plausible asset; generic back |
| **Level 2 — targeted question** | classifier detects hidden-surface risk (print/text/logo visible; category with signature back like jeans/backpacks) or user taps "back matters" | one tap + optional one sentence | 0 (text conditioning) to +1 image call (~$0.064) | correct back *content* |
| **Level 3 — optional extra image** | Level 2 insufficient (complex back structure, "Not sure" + high risk) or user volunteers a photo | one more photo | better reconstruction/multiview (+$0.10–0.30) | near-faithful two-sided asset |
| **Level 4 — multiple views required** | only asset classes whose *primary presentation surface* is unseen (backpacks: back view; open-back dresses) | 2–3 photos with explicit justification in UI | multiview reconstruction | faithful asset — **never applied to ordinary garments** |

### 11.2 Is progressive escalation viable? (INFERRED: yes)

- **UX:** follows the existing "ask exactly what the flow needs" pattern
  (category select, name); the question is skippable — skipping = Level 1,
  never a failure state.
- **Cost:** the expensive path is rare *by construction* (risk-triggered), so
  average cost ≈ Level 1 cost — same philosophy as the cost-protection
  report: pay on the path actually taken, never speculatively.
- **Implementation shape (future):** record a per-item `input_level` (0–3)
  with the asset so reprocessing knows what it may assume; the existing
  generation-version cache (`process-clothing` cache-hit returns the existing
  asset with 0 AI — CONFIRMED) extends naturally: **never re-ask, never
  re-generate on level-stable retries.**
- **Failure containment:** any level may fail → the 2D asset remains (§24);
  the user is never blocked from having the item in their wardrobe.

**Verdict:** viable and recommended as the input policy (**OPEN DECISION**
on exact question wording and trigger thresholds — §30/UX).

---

## 12. Minimum input by asset type (matrix)

Codes: **1x** one image sufficient (yes) · **T** text helpful/sufficient for
back content · **B** back image useful · **S** side image useful · **M**
multiple views genuinely required · difficulty: **L/M/H** · attachment
complexity: **L/M/H**.

| Asset | Minimum image input | One image OK? | Text enough (extra info)? | Back image useful? | Side useful? | Multiple views required? | Reconstruction difficulty | Attachment complexity | When extra image *required* |
|---|---|---|---|---|---|---|---|---|---|
| T-shirt | 1x | Yes | T if print | only if print | rarely | No | L | L | never (generic back OK) |
| Shirt | 1x | Yes | T (back yoke/buttons) | mild | rare | No | L–M | L | never |
| Sweater | 1x | Yes | low | mild | no | No | L | L | never |
| Jacket | 1x | Yes | T (open/closed, back detail) | useful | mild | No | M | M | never; M only if complex |
| Coat | 1x | Yes | T (length, back vent) | useful | useful | No | M | M | never |
| Skirt | 1x | Yes | T (length class) | mild | useful (silhouette) | No | L | L | never |
| Trousers | 1x | Yes | T (fit) | mild | useful | No | L–M | L | never |
| Dress | 1x | Yes | T (back cut — often matters) | **high** | useful | No | M | M | open-back/complex → B offered |
| Jumpsuit | 1x | Yes | T | high | useful | No | **H** (topology) | M | never; expect higher failure rate |
| Shoes | 1x (+photo showing side if possible) | Yes | T (heel height, colorway) | sole rarely | **high** (silhouette) | No | M | M | never; side *offered* |
| Shoulder bag | 1x (+how-it's-worn answer) | Yes | **T strong** (shoulder/crossbody, side) | useful (strap) | **high** | No | M | **H** (attachment) | never |
| Backpack | back-facing or worn photo (1x) | only if photo is of the back | T (strap style) | **required-ish** | useful | sometimes | M | **H** | back photo needed when front-only upload (system offers) |
| Handbag | 1x | Yes | T (handle vs shoulder) | no | useful | No | L | M | never |
| Glasses | 1x | Yes | T (frame shape, lens tint) | no | **useful** (temple shape) | No | L | M | never |
| Sunglasses | 1x | Yes | T (tint darkness) | no | useful | No | L | M | never |
| Hat | 1x | Yes | T (crown/brim) | mild | **useful** (profile) | No | L | L | never |
| Jewelry (earrings/necklace/bracelet/watch/ring) | 1x | Yes | T (pair? length?) | no | mild | No | L (small detail → HD texture) | M (sided anchors) | never |
| Scarf | 1x | Yes | **T strong** (how worn: loop, knot) | useful | useful | No | M–H (drape) | M | never; wear-style question mandatory |
| Belt | 1x | Yes | T (buckle) | no | useful (buckle side) | No | L | L | never |
| Hair / wig | 1x (front/3-quarter) | Yes | T (color hex, length) | useful | useful | No | M–H (fine strands) | M (head anchor) | never; color from text/deterministic tint |

**Reading (INFERRED):** *no ordinary garment ever requires* an extra image;
extra images are **offered** where difficulty/attachment is high
(backpacks, shoes side, open-back dresses); text covers content questions in
most cases. This is the matrix that implements §11's promise.

## 13. Front / back / side consistency

### 13.1 The five approaches

| Approach | Description | Consistency | Cost | Verdict |
|---|---|---|---|---|
| **A. Generate each view independently** | three image generations per garment | **Guaranteed failure** — hems/colors/logos drift between generations (the exact failure mode the z-axis report forbids: "aldrig tre uafhængige AI-genereringer") | 3× image cost per re-render, forever | **REJECTED** |
| **B. Generate one 3D garment, render all views** | reconstruction → mesh → deterministic renders at 0°/±90°/180° | Perfect by construction (same mesh + textures) | 1 reconstruction + 0 AI renders | **Recommended as the rule** |
| **C. Canonical 3D mesh first, then render** | same as B, emphasizing pipeline order: mesh is the source of truth; *every* raster (2D fallback layer, thumbnail, side/back still) is derived from it | Perfect | same as B | **B and C are the same architecture** — C is the correct *sequencing statement*: mesh first, images second |
| **D. Multi-view reconstruction** | 2–4 photos → consistent mesh | Highest fidelity (real back instead of priors) | more user input + multiview cost | Used only when Level 3/4 escalation triggers (§11) |
| **E. Hybrid pipeline** | 1 image → reconstruction (B/C) → *validation gate* → on hidden-surface risk escalate to D via Level 2/3 questions; always render views from the one mesh; always keep 2D fallback | Best cost/quality balance | controlled | **RECOMMENDED for DRESSED** |

### 13.2 Why E is right for DRESSED (INFERRED)

- Preserves the existing hard rule (one asset → all views) while admitting
  that *one image's back is a prior, not a fact* — and handling that with
  targeted questions instead of mandatory multi-photo uploads.
- Keeps every static image the product shows (grid thumbnails, 2D fallback
  layers, saved-outfit cards) **derived** from the mesh → they can never
  disagree with the 3D view (0 AI, deterministic — z-axis report §AI).
- Isolates risk: if reconstruction quality disappoints, only the 3D branch
  degrades; the current 2D front-layer pipeline (prompt untouched) remains
  the guaranteed-good presentation (§24).

---

## 14. Garment geometry in 3D

### 14.1 Options

| Option | What it is | Fit for DRESSED |
|---|---|---|
| **A. One static mesh per garment** | rigid object parented to the body | **Correct first step**: with yaw-only viewing (the only motion until animation is approved — readiness §5), rigid parenting is visually sufficient and cheapest (readiness §7.2 Phase 4a) |
| **B. Skinned garment mesh** | garment shares the body skeleton, deforms with it | **Correct end state for wearing garments** — needed for poses/animation/body-type retargeting (Phase 4b) |
| **C. Rigid anchor-attached mesh** | prop glued to one anchor | **Permanent home for accessories** (§8) |
| **D. Hybrid** | A→B staged for garments, C for accessories/hair | **RECOMMENDED** — exactly readiness §7's hybrid, reaffirmed per type below |
| *Cloth simulation* | physics-driven drape in real time | **REJECTED** (§27 Extreme): cost, instability, mobile risk, no product need — a wardrobe viewer needs stable silhouettes, not physics |

### 14.2 Per-type requirement (INFERRED)

| Type | v1 (now) | Later | Explicitly never |
|---|---|---|---|
| T-shirts/shirts/sweaters/jackets/coats | A (static shell, rigid-parented) | B skinned | cloth sim |
| Skirts/dresses | A | B skinned (+ optional *baked* sway, not sim) | cloth sim |
| Trousers/jeans/shorts/leggings | A | B skinned | cloth sim |
| Shoes/socks | A (semi-rigid; socks skinned early since they hug ankles) | B for socks; shoes stay semi-rigid | — |
| Bags (all) | C rigid + attachment metadata | strap may become skinned curve | — |
| Glasses/hats/jewelry/belts | C rigid | stay rigid | — |
| Scarves | C rigid with authored drape | B (skinned to neck/shoulders) | cloth sim |
| Hair | C short styles / B hair-cards | B always (readiness §9) | strand sim |

Skeleton/attachment/deformation summary: **skeleton** = shared body rig (one
per family); **bone parenting** = everything; **deformation** = garments only,
later; **cloth simulation** = nobody.

## 15. Fitting to the DRESSED master form

### 15.1 Requirements recap (from the prior reports)

Consistent proportions (canonical base forms, `normalized-v1` geometry
contract — CONFIRMED), consistent body topology, consistent skeleton, fixed
anchor set, asset reuse across users, later adult/teen/child.

### 15.2 Fitting strategy — combination, deterministic-first (INFERRED)

| Step | Owner | Why |
|---|---|---|
| 1. Authoring against a template | **Blender preprocessing (offline)** | Garments are reconstructed in *garment space*; a deterministic script registers them onto the master body template (align shoulders/waist/hips landmarks) exactly once per asset |
| 2. Runtime fit | **Deterministic** — scale registration (master body metrics: shoulder width, torso length, hip width) + anchor alignment; pure math, no AI | Same body for everyone (master-form doctrine: "IMAGE 2 ALWAYS WIN") means one fit serves all users of that body type |
| 3. AI-assisted fitting | **Only fallback** when step 1–2 fail the quality gate (§25) | Keeps AI out of the deterministic path; rare by construction |
| 4. Fit failure | **Quality gate → reject 3D, keep 2D** (§26 scenarios 6–8) | Never ship a floating/intersecting garment |

### 15.3 What happens when a garment does not fit automatically?

Deterministic triage, in order:

1. **Bounded auto-correction:** uniform scale within tolerance (e.g. ±15 %)
   + shell-offset nudge — covers most mismatches.
2. **Escalate input (Level 3):** request one better photo (worn/flat-lay
   perspective matters more than resolution).
3. **Flag for manual repair** (optional human path, catalog-level only —
   NEVER in the user's critical path).
4. **Reject the 3D asset → 2D fallback** with an honest status (§26), zero
   further AI spend.

**Core principle (INFERRED):** fitting is a *geometry registration problem*,
not a generation problem. The master form is fixed and shared, which is the
single biggest gift the existing architecture gives this pipeline — the fit
is computed once and reused by everyone.

---

## 16. Adult / teen / child

### 16.1 Can one garment asset serve all body types?

| Mechanism | Works? | Notes |
|---|---|---|
| **Resize (uniform scale)** | Partially | OK for rigid accessories; wrong for garments (a child's head-to-body ratio differs — shoulders don't scale linearly) |
| **Refit (deterministic re-registration to each body's landmarks)** | **Yes — the main answer** | Same mesh re-registered per body type at authoring/preprocess time; costs compute, **0 AI** |
| **Retarget (shared skeleton, per-body skin weights)** | **Yes** for skinned garments (§14 B) | One skeleton hierarchy; weights recomputed or blended per body mesh — standard, deterministic tooling |
| **Skinned sharing with body-type morphs** | Yes, advanced | Garment blendshapes matching body morphs — later optimization |

### 16.2 What to share vs generate separately (INFERRED)

- **Share:** the canonical garment mesh, textures, attachment metadata
  (per family), the skeleton hierarchy, anchors, slot definitions.
- **Generate (deterministically) per body type:** body mesh proportions,
  garment **registration + skin weights** — derived artifacts, not AI assets.
- **Generate with AI per body type: only if** the refit fails the quality
  gate for a specific body (e.g. extreme proportion change alters silhouette
  class) — an exception path, never the default. This directly answers "do
  not create unnecessary duplicate AI assets": **default = 1 AI asset, N
  deterministic fits.**
- **Adult/teen/child** = body_type rows + `skeleton_version` (readiness §6.3,
  Phase 8) — no rendering-code forks; legal/safety review flagged in §30.

---

## 17. Bald master + hair

### 17.1 Architecture (reaffirmed from readiness §9, refined)

```text
bald master body GLB  ──(skeleton + anchors)──►  hair asset GLB attaches to head bone
```

| Question | Answer (INFERRED) |
|---|---|
| Same asset system as clothing? | **Yes** — same catalog/attachment/validation machinery; only the *slot* (`head`/hair) and skinning set (head/neck/shoulders) differ. Hair is `kind: hair` in the asset metadata, nothing more |
| Rigid vs skinned? | Short styles: rigid parent to head is acceptable v1; anything touching shoulders: **skinned hair-cards** (readiness §9 recommendation stands) |
| Multiple meshes? | One hair mesh per style is enough (cards inside one mesh); no multi-mesh requirement for v1 |
| Recolor one asset? | **Yes, deterministically** — material tint / texture variant; changing hair color must never cost an AI call |
| AI generation actually required? | **No for color; No for the catalog in principle** (a catalog can be authored/licensed like any global asset — UNVERIFIED business decision §30/LEGAL). AI is *optional* only if personalized/generated hairstyles are wanted later — a product choice, not a technical need |
| Wigs? | Same catalog entry; swapping never touches body or clothing (skeleton unchanged) — identity and outfits stay stable |
| Hair accessories? | Rigid anchors on the hair/head (§18), same accessory system |

**Key distinction:** hair color/style swapping is *attachment + material*
work (deterministic), which is why the bald-master split exists at all.

## 18. Accessory attachment system (proposed vocabulary vs existing)

### 18.1 Proposed generic attachment points vs the existing 15 anchors

| Proposed point (prompt's example) | Existing DRESSED anchor | Gap verdict |
|---|---|---|
| `head` | `head` | ✅ exists |
| `face` | `face` | ✅ exists |
| `ear_left` / `ear_right` | `ears` (single, centered) | ⚠ **sidedness missing** |
| `neck` | `neck` | ✅ exists |
| `shoulder_left` / `shoulder_right` | `shoulders` (single, centered) | ⚠ **sidedness missing** — critical for shoulder bags |
| `chest` | `torso` (≈ chest/torso line) | ✅ map chest→torso (naming alias only) |
| `waist` | `waist` | ✅ exists |
| `hand_left` / `hand_right` | `left-hand` / `right-hand` | ✅ exists (naming differs — alias) |
| `wrist_left` / `wrist_right` | **none** | ⚠ missing (watches/bracelets) |
| `hip_left` / `hip_right` | `hips` (single) | ⚠ sidedness missing (holster-side bags) |
| `foot_left` / `foot_right` | `feet` (single) | ⚠ sidedness missing (shoes are pairs) |
| *(implicit)* `torso_back` | **none** | ⚠ missing (backpacks) |
| *(implicit)* `dress`, `knees`, `ankles`, `full-body` | exist as 2D garment anchors | ✅ keep — used by clothing, harmless in 3D |

### 18.2 Verdict: extend, do not replace (INFERRED)

- The existing 15 names are **sufficient as the 2D contract forever** (they
  are baked into the DB CHECK — CONFIRMED `202610060002:41–59`).
- For 3D they are *almost* sufficient but need a **sided superset**:
  `ear_left/right`, `shoulder_left/right`, `wrist_left/right`,
  `hip_left/right`, `foot_left/right`, `torso_back` — all resolvable from
  existing anchors (single → pair with default side) so **legacy
  `placement.anchor` values keep resolving** (§6.2).
- One vocabulary lives in `dressed-3d-contract.ts` (readiness §5.4) with an
  explicit legacy→3D mapping table. **Do not invent a second, parallel anchor
  system** — that is exactly the duplicate-invention risk the prompt warns
  about; the extension is additive and mechanical.

---

## 19. Freeform × attachment (semantic attachment beats absolute positioning)

### 19.1 The two representations compared

```text
ABSOLUTE (today, 2D only):   x=123, y=456              ← meaning-less without the photo
SEMANTIC (3D proposed):      face_anchor + local_offset + rotation + scale
SHOULDER BAG (proposed):     shoulder_anchor + side + strap/bag offsets + rotation + scale  (§8.3)
```

| Criterion | Absolute x/y | Semantic anchor + local transform |
|---|---|---|
| Meaning without context | none | self-describing |
| Survives model rotation | **no** (2D is front-only anyway) | **yes** (parent chain) |
| Survives body-type change (adult/teen/child) | no — re-place per body | **yes** — anchor follows the body |
| Survives re-generation of the character | placement is canvas-% → mostly survives coincidentally | **yes** by construction |
| Side/orientation expressible | no | **yes** (enums + rotation) |
| Robustness to asset re-import (new GLB version) | breaks | holds if anchors stable |
| User editing cost | high (re-nudge everything) | low (bounded local sliders) |

### 19.2 Rules (INFERRED)

1. **In 3D, semantic attachment is the primary representation;** freeform
   edits are *bounded deltas on the anchor frame* (§5.1 Level-3 subset) —
   never world coordinates.
2. **In 2D, absolute x/y stays exactly as-is** (it works, it is validated,
   it is persisted) — do not retrofit 2D to semantic positioning; the anchor
   field already provides the semantic half (§6).
3. A garment/accessory **never stores absolute world position in 3D** —
   rejected fields in `placement3d` sketch: world x/y/z, camera-dependent
   values.
4. Freeform and attachment compose: `anchor → semantic params → local
   freeform (u,v,rot,scale) → shell w`. One chain, both features.

**Conclusion:** yes — this architecture is materially more robust than
unrestricted absolute positioning, and it is the same chain the z-axis report
already proposed (`node → inherited anchor → local position → rotation →
scale → shell`), with semantic parameters slotted in as anchor-owned
metadata.

---

## 20. AI boundary (final form)

### 20.1 AI **does**

| Responsibility | When | Frequency |
|---|---|---|
| Identify/classify asset (category confirmation, print-risk, side-sensitivity, wear-style) | at upload/first processing | once per asset (cache-gated) |
| Understand visual characteristics (colors, material hints, logo presence) | same step | once |
| Infer/​reconstruct missing geometry (back/side priors) | reconstruction | once |
| Generate textures/materials (as part of reconstruction) | reconstruction | once |
| Detect attachment type + suggest anchor/side/orientation | classification | once (AI *suggests*, catalog validates) |
| Identify important hidden details → trigger §11 questions | classification | once |
| *Optional:* final-look/try-on image | on explicit user action | cached per outfit_key (existing) |

### 20.2 AI does **not** (all deterministic — CONFIRMED as current behavior,
reaffirmed)

positioning · rotation · scaling · camera · Z/shell depth · rendering ·
attachment transform resolution · slot navigation · model rotation ·
asset reuse/dedup decisions · thumbnails/views/LOD (renders) · caching ·
fitting math · validation gates · 2D composition · freeform edits of any
kind · runtime browser rendering · re-generation of identical assets.

### 20.3 Boundary statement

> **AI owns *understanding and reconstruction*, once per unique asset;
> everything from asset → scene → pixels is deterministic code.** Freeform is
> 100 % deterministic in both modes. No AI call may ever be triggered by
> viewing, rotating, navigating, resizing, or switching — and (existing hard
> rule) the normal-clothing prompt is untouched.

## 21. AI cost (analysis only — no controls implemented)

### 21.1 Today's cost per asset (CONFIRMED from the cost audit)

```text
Upload one garment        = 1 moderation + 1 clean-preview editImage   [NO QUOTA]  (audit S3)
Make it AI-ready (S2)     = 1 moderation + 1 job editImage              [quota]     (audit S2)
  → cache-hit on S2       = 0 AI calls (existing asset returned)        (audit §3.2)
Empirical image request   ≈ $0.064 (0,43 DKK)                                        [TELEMETRY]
Typical garment total     ≈ 4 calls ≈ $0.13–0.26 depending on retries
Live quotas (per z-axis report)  character 3 · clothing 5 · tryon 1                     [UNVERIFIED here]
```

Known audit findings that matter for 3D: **clean preview is uncapped**
(highest-risk path), failed generations can consume quota on some paths,
retry behavior is client-driven. Any 3D pipeline must be attached to the
*future* reservation architecture (cost-protection report §6), not bolted on.

### 21.2 Projected cost of the AI → 3D pipeline (per asset)

| Path | Calls | Est. cost | When |
|---|---|---|---|
| **Default (Level 1):** classify + reconstruct + fit + render | 1 classification (cheap, ≈ 1 image-call or less) + 1 image-to-3D ($0.20–0.30) | **≈ $0.25–0.36** | every unique asset, once |
| Level 2 escalation | + 0–1 image call | + ≤ $0.064 | rare (print-risk) |
| Level 3/4 escalation | + image-to-multiview ($0.10) + multiview-to-3D ($0.20–0.30) | + $0.30–0.40 | rare |
| Production hardening (HD texture, retopo) | add-ons | + $0.20–0.50 | optional, per catalog policy |
| **Rendered views/thumbnails (all)** | **0** | **$0** | always (deterministic) |
| **Viewing/rotating/navigating** | **0** | **$0** | always |

*(Tripo prices fetched 2026-10-07; other providers UNVERIFIED; volume pricing
UNVERIFIED.)*

### 21.3 Where cost explodes — and what eliminates it (INFERRED)

| Explosion risk | Why | Deterministic countermeasure |
|---|---|---|
| Multi-view image generation (approach A) | 3 generations × every retry × every user | **Forbidden architecture** — one mesh, rendered views (§13) |
| Per-user regeneration | same shirt uploaded by N users | **sha256 + pHash dedup** before any AI (§22); existing S2 cache pattern proves the concept in-repo |
| Retry loops on failed reconstruction | audit's Scenario A–D patterns | reservation + attempt cap + `unknown` billing state (cost-protection §11–12 — future, not implemented) |
| Freeform edits re-triggering generation | naive "regenerate on change" | **freeform is deterministic transforms — never regenerates anything** (§20.3) |
| Regenerating to "see another angle" | naive view pipelines | views are renders (0 AI) |
| Thumbnails per garment/outfit/grid | N assets × renders | renders are free; only *store* small WebP derivatives |
| Uncapped preview-class paths | audit S3 warning | 3D must never be added as an unreserved path — attach to the future operations registry (cost-protection §4.2) |
| Uploading 50 items in a burst | worst case (audit §14.D) | per-account 3D budgets + circuit breaker (cost-protection §13) — recommendation only |

### 21.4 Should a garment be generated once and reused?

**Yes — three reuse levels (INFERRED, in increasing legal caution):**

1. **Within one user:** already proven (S2 cache, `outfit_key`, asset
   version gates) — extend the same idiom to 3D assets.
2. **Across users, identical uploads:** sha256/pHash → shared *derived* GLB —
   recommended target, **legal review required** (§22).
3. **Global catalog:** hand-authored/licensed garments for everyone — zero AI
   cost per user (parallel to `dressed_base_forms` being global — CONFIRMED
   pattern).

**Answer to "can 3D replace repeated image generation?":** yes — it *removes*
image generations (views, try-on alternatives become renders) while adding
exactly **one** new generation class (reconstruction). Net effect is
favorable **only with dedup**; unfavorable if reconstruction runs per user.

## 22. Reuse and caching (future asset reuse model)

### 22.1 Detection ladder (technical, all deterministic)

| Step | Method | Catches | Cost |
|---|---|---|---|
| 1 | **SHA-256** of the normalized source image | byte-identical re-uploads | 0 |
| 2 | **Perceptual hash** (pHash/dHash, Hamming ≤ t) | same photo re-compressed/resized | 0 |
| 3 | **Image similarity / embedding match** | "same garment, different photo" | cheap model call *or* deterministic feature match (UNVERIFIED choice) |
| 4 | **Canonical asset fingerprint** (hash of the derived GLB) | identical derived results | 0 |

Rule order: hash *before* any AI spend — the same principle as the existing
S2 cache-hit (CONFIRMED: returns existing asset, 0 AI).

### 22.2 Privacy / ownership / legal (analysis — no policy decided here)

| Asset class | Shareable? | Notes |
|---|---|---|
| **Source image (user upload)** | **NEVER by default** | may show a room, a person, a brand receipt; private `{userId}/` storage + signed URLs is the current, correct model (CONFIRMED `202610070001`) |
| **Derived 2D layer** (today) | Private today | stays private |
| **Derived 3D garment asset (canonical GLB)** | *Candidate* for cross-user reuse | contains the garment design, not the user's photo — **but**: design copyright, brand logos, and (EU) GDPR questions on user-derived data ⇒ **LEGAL REVIEW REQUIRED — OPEN DECISION** (§30/LEGAL) |
| **Global catalog assets** | Yes, if authored/licensed by DRESSED | zero user data involved; mirrors `dressed_base_forms` |
| **pHash index across users** | Sensitive | pricing analysis already recommends **within-user pHash only until legal review** — that constraint carries over verbatim |

### 22.3 What may never be shared

- The source photo, EXIF, or anything identifying the user.
- Any path/URL that crosses accounts (a shared GLB is served from a
  *global* location, never signed for one user and given to another —
  §readiness 20.2).
- Per-user placement/Freeform state (§6.5: it never enters the shared asset).

**Recommendation (technical only):** build the *detection* ladder and the
`asset_fingerprints` concept into the design (readiness §13.2 already lists
it as Phase 9+), but ship cross-user reuse **only after legal sign-off**.
Within-user reuse ships with Phase 9 unconditionally.

---

## 23. Image formats

| Format | Use | Do NOT use for | Notes |
|---|---|---|---|
| **PNG** | AI 2D layers (alpha mandatory), AI model images, render masters | web delivery of large photos | status quo (CONFIRMED end-to-end) |
| **JPEG** | user photo uploads (existing allowed type) | anything needing transparency | `image-input.ts` allows it |
| **WebP** | thumbnails, grid previews, outfit cards (alpha OK) | — | recommended derivative format; avoids shipping 1 MB PNGs into grids |
| **AVIF** | optional future derivative of photos | anything requiring pipeline rework now | nice-to-have; **defer** (browser matrix + encoding cost UNVERIFIED) |
| **SVG** | system-owned vector UI only: icons, logos, diagrams, favicon | **AI images, photos, anything 3D, "smaller version of a raster"** | the pricing/SVG analysis conclusion stands: SVG is for flat global vectors, never for AI output; user SVG stays forbidden (XSS surface) |
| **GLB** | **canonical 3D asset format — YES** | 2D presentation | binary glTF: single file with mesh, materials, textures, skeleton — native to Three.js; `.gltf`+bin is authoring/interchange only; compress with Draco/meshopt + KTX2 (readiness §15) |
| **glTF (non-binary)** | Blender interchange, debugging | runtime delivery | GLB wins for runtime |

**Answers:** GLB **is** the canonical 3D format (confirmed recommendation,
no change from prior reports). AI raster → SVG conversion: **never** (it
destroys photographic content and buys nothing; the earlier analysis already
closes this question).

---

## 24. 2D fallback

### 24.1 Trigger conditions (all must land on 2D, none may break the product)

AI→3D fails · reconstruction quality below gate · fit fails · device lacks
WebGL/has context loss · low-end mobile perf · network issues · user simply
prefers 2D.

### 24.2 Architecture that makes fallback trivial (CONFIRMED properties + INFERRED plan)

1. **The 2D asset is never deleted or "replaced".** `wardrobe_item_ai_assets`
   (v3 layers) remain the guaranteed presentation; a future 3D asset is an
   *additive* row/column with its own state machine
   (`absent → queued → ready_3d | failed_3d`) — mirroring how `placement`
   NULL meant "defaults" without touching anything (`202610050002` doctrine).
2. **Outfits are renderer-agnostic already (CONFIRMED):** `saved_dressed_outfits`
   stores `item_ids` only — loading an outfit works identically in 2D or 3D.
3. **Selection, navigation, `editingItemId`, categories, quotas** never
   branch on renderer (CONFIRMED — they do not inspect rendering today).
4. **Capability detection at mount:** no WebGL2 / `contextlost` / perf probe
   → mount `ModelView2D` (readiness §2: 2D is the permanent default/fallback
   implementation of the same interface).
5. **Per-asset fallback, not per-user:** one failed GLB shows the 2D layer
   for that item while 3D-capable items render in 3D (mixed mode is possible
   later; v1 can stay whole-view either/or — **OPEN DECISION** §30/PRODUCT).
6. **Failure states are honest:** the item keeps a status like today's
   `NOT AI READY` badge pattern (CONFIRMED in `renderClothingItems`) rather
   than silently missing geometry.

**Nothing in the fallback path needs new user data:** placement, outfits and
items all keep their current schema, so *breaking nothing* is achieved by
construction (readiness §11/§24 principles unchanged).

## 25. Quality thresholds ("good enough" + auto-validation)

### 25.1 Criteria by class

| Criterion | How measured | Applies to | Gate type |
|---|---|---|---|
| **Silhouette accuracy** | IoU of rendered-front mask vs the source garment mask (deterministic image compare) | all garments | hard gate (e.g. IoU ≥ threshold — exact value **OPEN DECISION**, calibrated in the §32 experiment) |
| **Color accuracy** | mean color delta (ΔE / histogram) front render vs source photo | all | hard gate (tolerance TBD) |
| **Logo/detail placement** | feature/OCR match of prominent text between photo and front render | print-risk items (Level 2 path) | hard gate when Level 2 was used |
| **Texture fidelity** | visual check + resolution floor (min texel density) | all | soft gate (warn) |
| **Attachment correctness** | distance of asset origin to its anchor ≤ tolerance; orientation within bounds | all attached assets | hard gate |
| **Body intersection** | deterministic mesh-vs-body intersection volume (sampled) | all worn garments | hard gate above small tolerance (allow sleeve-in-sleeve exceptions per slot) |
| **Floating / gap** | min/max shell distance from body surface | all worn garments | hard gate |
| **Scale sanity** | garment bbox within body-proportion bands (e.g. trousers length vs leg length) | per category | hard gate |
| **Front/back consistency** | when back was asserted (Level ≥2): back render vs described/generated back — similarity/OCR | escalated items | hard gate on Level 2/3 |
| **Side consistency** | side silhouette plausibility (width band vs body depth) | hats/shoes/bags (profile classes) | soft → hard for profile-primary items |
| **Visual plausibility** | optional cheap AI aesthetic judge (1 small call) | all | **experimental — UNVERIFIED; must be off by default** |
| Mesh health | non-empty, welded, UVs present, no NaN, tri budget | all | hard gate (pure code) |

### 25.2 When DRESSED should reject an automatic 3D asset (INFERRED policy)

Reject (→ 2D fallback, status `failed_3d`, no further spend) when:

1. Mesh-health checks fail (invalid GLB, empty geometry, missing textures).
2. Any **hard gate** fails twice after the single allowed deterministic
   correction (§15.3 step 1).
3. The user's upload fails classification confidence (scenario 1/2, §26).
4. Provider/storage/conversion failures exhausted the attempt budget
   (cost-protection attempt-cap recommendation).

Accept with warning (soft gate) when only cosmetic issues exist. **Never**
auto-accept un-validated geometry into outfits — a bad mesh that appears in
saved outfits is worse than no 3D at all.

**Automatic validation is possible for everything in the "hard gate" column
(INFERRED)** — they are geometry/image computations, not judgment calls. Only
"visual plausibility" needs a human or a model, and it should stay optional.

---

## 26. Failure strategy (15 scenarios)

| # | Scenario | Best response | Rationale |
|---|---|---|---|
| 1 | AI cannot identify the item | **Ask user** (confirm category — they picked it at upload) then retry once; else **2D only** | user input is free and authoritative |
| 2 | AI identifies wrong category | **User's chosen category wins** (deterministic override); re-run classification only if user changes category | avoids AI overriding human intent |
| 3 | Geometry incomplete | one deterministic correction attempt → else **reject 3D → 2D** | §25.2 |
| 4 | Back side unknown | **Mark asset `back=generic`** + Level 2 question if risk flagged; never block | §11 |
| 5 | Texture missing | retry texture stage (cheap, deterministic post-step or provider retry) → else reject 3D | mesh without texture is unusable |
| 6 | Asset intersects body | deterministic shell/scale correction (bounded) → else reject → 2D | §15.3 |
| 7 | Asset floats away from body | deterministic offset correction → else reject → 2D | same gate |
| 8 | Wrong proportions | scale registration retry (bounded) → else **ask user** for a better photo (Level 3) → else reject | escalation before rejection |
| 9 | Front/back inconsistent | impossible by construction (§13 B/C) — if a *claimed* back (Level 2/3) mismatches, regenerate **back conditioning once** → else downgrade to `back=generic` | never re-generate the whole mesh twice |
| 10 | 3D reconstruction fails (provider error/timeout) | retry with reservation/attempt cap (cost-protection §11) → **2D fallback** on exhaustion | mirrors audit Scenario A/B handling |
| 11 | AI provider fails (auth/billing/outage) | **circuit breaker → 2D**, queue or refuse new jobs, `unknown` billing state per cost-protection §12 | never fail-open on cost |
| 12 | Storage fails after successful generation | keep in temp, retry upload; **never** persist a row without its file (audit Scenario D ordering) → else 2D | existing lesson from the audit |
| 13 | Conversion fails (GLB build) | deterministic retry → reject → 2D | pure code, no AI spend |
| 14 | GLB invalid (schema/parse) | validation gate at upload-to-storage → reject → 2D | §25.2 hard gate 1 |
| 15 | Mobile cannot render it | capability/context-loss detection → mount/keep 2D for that session (§24) | never block the wardrobe |

**Pattern across all fifteen:** *deterministic correction first, targeted
user question second, honest 2D fallback third, AI retry only with attempt
caps.* No scenario re-enters unbounded AI spend.

## 27. Do not overengineer — the simplest viable architecture

### 27.1 Four levels compared

| Level | What it includes | Product value | Cost/risk | Verdict |
|---|---|---|---|---|
| **Simple** | 2D transforms (as today + optional rotation) + basic 3D *rigid* attachments (accessories on the POC body) | Delivers rotation + correct bags/hats on a mannequin; garment outfits stay 2D | Very low — mostly Phase 1/2 work already planned | Good **floor**, but a "3D wardrobe" without garments under-delivers the primary question |
| **Medium** | + garment meshes (static → skinned), skeleton, anchors, deterministic fitting, validation gates, semantic attachment params, 2D/3D coexistence | Full 3D wardrobe with outfits, rotation, accessories, hair; 2D fallback intact | Moderate — the readiness roadmap Phases 1–5 + a gated reconstruction experiment | **RECOMMENDED TARGET** |
| **Advanced** | + AI reconstruction at scale, mesh fitting per body type, semantic deformation (move sleeve/widen waist) | Marginal gains over Medium for a viewing app | High — deformation rigs destroy reuse, explode validation surface | **Defer** (semantic *parameters* only, §5) |
| **Extreme** | Cloth simulation, physics, dynamic deformation, strand hair | Negligible product gain; wrong genre (wardrobe ≠ game engine) | Extreme on mobile; unstable silhouettes break quality gates | **REJECTED** |

### 27.2 Why Medium (INFERRED)

DRESSED is a **wardrobe viewer and outfit builder**, not a modeling tool.
The product promises: see your clothes on your model, from any angle, saved
into outfits. Medium delivers exactly that with:

- one new generation class (reconstruction) instead of an ambitious
  deformation/editing platform;
- deterministic everything else (freeform, attachment, fitting, rendering) —
- a permanent 2D fallback, so the ambitious part is *never* load-bearing for
  the core product;
- alignment with every prior decision (readiness Phases, z-axis rules,
  navigation gestures, cost-audit protections).

Advanced/Extreme features are precisely the ones that would require touching
the working prompt, breaking asset reuse, or shipping unvalidatable visuals.

---

## 28. Implementation dependencies vs the readiness roadmap

### 28.1 Point-by-point comparison with `dressed-3d-implementation-readiness.md`

| Readiness item | Does this analysis change it? | Verdict |
|---|---|---|
| Phase 1 POC (isolated viewer, 10 proofs) | **No** — the POC proves renderer mechanics with a placeholder GLB; it does not depend on Freeform or AI→3D decisions | **Unchanged** — can start immediately |
| Phase 2 (model rotation) | No | Unchanged |
| Phase 3 (3D asset architecture, skeleton, anchors) | **Yes — a decision must PRECEDE it:** the anchor vocabulary extension (§18) and Freeform/attachment semantics (§6, §19) get baked into every GLB and contract version | **Add "Phase 3 pre-decision"** (Freeform architecture decision first) |
| Phase 4 (clothing attachment) | Yes — cannot be exercised at scale without knowing whether garment reconstruction is viable | Gate Phase 4b/9 behind the §32 experiment; Phase 4a (manually authored garment) unaffected |
| Phase 5 (2D/3D coexistence, `placement3d`) | Slightly — `placement3d` shape should include the rotation key decision and semantic attachment params (or defer them) | Decide Freeform schema **before** writing the `placement3d` migration |
| Phase 9 (AI → 3D pipeline) | Yes — this report defines its stages (§9), costs (§21), gates (§25), failures (§26) | Roadmap enriched, not reordered |
| Phases 6/7/8/10 | No structural change | Unchanged |
| New concern not in the readiness roadmap | **Freeform definition (2D rotation?)** and the **reconstruction experiment** are new pre-work items | Added as Stage 0/1 below |

### 28.2 Direct answers

- **Phase 1 POC remains unchanged?** Yes — ship it as-is.
- **Should Freeform architecture be decided before the POC?** Not *before*
  the POC, but **before Phase 3** (anchors/contracts). The POC uses a
  placeholder GLB and can tolerate a later anchor rename *once*; no more.
- **Should AI→3D feasibility be proven before Three.js integration?** Before
  *garment-scale* integration (Phases 4b/5/9), yes — via the standalone
  experiment (§31-J). Three.js integration itself (Phases 1–2) is cheap,
  isolated, and independent; delaying it buys nothing.
- **Should the garment pipeline be prototyped separately?** **Yes** — a
  non-UI, script-level experiment (upload → reconstruct → fit → render →
  human eyes) with ~10 representative garments. It touches no product code.
- **Should 2D and 3D develop independently at first?** Yes — that is exactly
  the readiness Option-B containment this report reaffirms; only the *decision
  documents* (anchor vocabulary, Freeform) must be shared up front.

## 29. Recommended development order

Compared with the prompt's candidate list, reordered where the evidence
requires it. **Why this order:** decisions are cheap, geometry is expensive;
prove the riskiest *unknown* (AI→3D quality) before building the most
*permanent* artifacts (skeleton/anchors/GLBs); keep everything touching
production code behind the already-approved containment.

| Stage | Content | Why here |
|---|---|---|
| **0. Decisions (docs only)** | Freeform scope (Level 1 + optional 2D rotation key), anchor vocabulary extension (§18), attachment-metadata format (§8.3), coordinate contract (readiness §5) | These are *frozen* into every GLB and the future `placement3d`; changing them later invalidates assets |
| **1. 3D viewer POC** (readiness Phase 1) | isolated route, placeholder GLB, lifecycle/dispose | Unchanged; cheap, independent, builds 3D competence while Stage 2 runs |
| **2. AI → 3D reconstruction experiment (standalone, §31-J)** | ~10 garments: tee, jeans, dress, jacket, coat, hat, glasses, shoulder bag, scarf, shoes → reconstruct → fit → attach → render front/side/back → human rating vs §25 criteria | **The single most valuable information in this program.** If quality fails here, Stages 5–9 change shape — learn that *before* the master-model work |
| **3. DRESSED master model + skeleton + anchors** (readiness Phase 3) | bald body GLB, sided anchor set from Stage 0, contract version | Guided by both the decisions (0) and the experiment (2) |
| **4. Basic manually created garment + attachment** (Phase 4a) | one authored GLB on the master form | Proves attachment deterministically — **no AI dependency** |
| **5. Accessory attachment system** (Phase 6 core) | rigid anchors + shoulder-bag metadata (§8.3) | Pure determinism; addresses a known pain point early with zero AI risk |
| **6. Automatic fitting + validation gates** (§15, §25) | registration scripts + hard gates | Required before any real asset volume; consumed by Stage 7 outputs |
| **7. Front/side/back consistency via renders** (§13) | render harness at 0/±90/180 + thumbnails | Free once Stage 2/3 meshes exist; permanently kills the "three generations" temptation |
| **8. Adaptive upload questions (Levels 1–4)** (§11) | classifier flag + targeted question | Only after Stage 2 shows empirically *whether* back fidelity matters |
| **9. 2D/3D model-view abstraction + coexistence** (Phase 5) | ModelView interface, toggle, `placement3d` | First production-code touch of wardrobe; everything else is proven by now |
| **10. Hair** (Phase 7) | bald master + hair assets + tint | Depends on Stage 3 skeleton only |
| **11. Adult/teen/child** (Phase 8) | body-type rows + refit | Depends on fitting (6) + skeleton (3) |
| **12. Production integration + cost controls** (Phase 9 + cost-protection) | reservations, dedup, fingerprints, reuse (legal-gated) | Last: only now does AI volume justify infrastructure; cross-user reuse needs §30 legal answers |
| **13. Performance/mobile hardening** (Phase 10) | budgets, LRU, touch polish | Optimize the real thing, not a prototype |

**Explicit changes vs the prompt's list:** the Freeform decision stays first
(it was #1 — kept); the **AI reconstruction experiment moves from #8 to #2**
(it gates everything downstream); accessory attachment moves *before* garment
AI (#5 vs original #7) because it is deterministic and addresses an
already-observed product pain point; the model-view abstraction moves *after*
attachment/fitting (#9 vs original #14) so the abstraction wraps a proven 3D
capability instead of a speculative one.

## 30. Open questions

### PRODUCT DECISIONS
- **OPEN DECISION:** Is 3D ever *default*, or permanently opt-in beside 2D?
  (Readiness recommends 2D default until measured otherwise — confirm.)
- **OPEN DECISION:** Mixed mode — per-asset 3D/2D in one view, or whole-view
  either/or for v1? (§24.2-5)
- **OPEN DECISION:** Does the product promise "every upload becomes 3D", or
  "3D where quality permits, 2D otherwise"? (Recommend the latter.)
- **OPEN DECISION:** Are accessories in scope for the *first* production 3D
  release, or only after garments?
- **OPEN DECISION:** Minimum acceptable visual bar vs today's 2D composite —
  is "plausible at phone viewing distance" enough? (§25 calibration)

### TECHNICAL DECISIONS
- Three.js version pin + dependency approval (readiness §23 items 1–2).
- Compression: Draco vs meshopt; KTX2 vs PNG textures for v1.
- GLB authoring toolchain (Blender version, export presets, meter/Y-up/
  Z-forward conventions) and ownership of the master-form script.
- Fitting tolerance numbers (§15.3's ±15 % is a placeholder).
- Whether `placement3d` ships minimal (u,v,w,rot,scale) or also rotation key
  decisions and semantic params in v1.
- Per-asset vs per-view fallback granularity (§24.2-5).

### AI DECISIONS
- Reconstruction provider: third-party API (Tripo-class) vs self-hosted
  (TripoSR-class) — quality/cost/latency/PII trade-offs all UNVERIFIED.
- Whether classification (stage 2) is a new cheap call or folded into an
  existing step; which model; cost ceiling.
- Whether the AI aesthetic judge (§25.1) is ever enabled.
- Exact escalation trigger thresholds for Level 2 (print-risk detection).
- Whether "photo → 3D" becomes a new `generation_type` (recommended) and its
  quota/reservation shape.

### UX DECISIONS
- Exact wording/flow of the "back matters?" question (No / Yes / Not sure).
- How extra-image offers are phrased so they never feel mandatory (§11).
- Where 3D freeform controls live (placement-panel sliders vs on-model
  handles) without violating the gesture contract (readiness §17–§18).
- Status language for `failed_3d` (must match the honest-failure tone of the
  existing `NOT AI READY` badge).

### SECURITY / PRIVACY
- User GLB bucket/prefix + signed-URL TTLs (readiness §20.2) — bucket choice
  unconfirmed.
- Whether reconstruction providers may receive user photos (DPA, EU egress) —
  **must be answered before Stage 2 runs on real uploads**; use owned test
  images until then.
- Account-deletion coverage for GLB files (readiness §14.2-5).
- Cache keying so one user's GLB can never be served to another (readiness
  §20.2 cross-user rule).

### LEGAL / LICENSING
- **LEGAL REVIEW REQUIRED:** cross-user reuse of *derived* garment assets
  (§22.2); pHash scope (within-user vs global).
- Licensing of purchased/curated body, hair, or catalog assets.
- Trademark/logo exposure on reconstructed garments (brand logos baked into
  textures) — is display-only use acceptable?
- Teen/child body models — safety/compliance review before Stage 11.

### COST
- Acceptable cost per unique 3D asset (estimate $0.25–0.36 default, §21.2 —
  approve or cap).
- Whether reconstruction consumes the *clothing* quota or a new one
  (recommend new; do not conflate with image quotas).
- Free-tier policy: 3D behind payment/limits? (Cost-protection reservation
  model must land first.)
- Circuit-breaker thresholds for the new generation class.

### 3D PIPELINE
- First supported garment set (start from Stage 2's proven subset; explicitly
  de-scope jumpsuits/scarves if they fail).
- Master body is always hand-authored (not generated) — confirm.
- Texture resolution tiers and LOD policy (readiness §16).
- Shoes: single-mesh pair or per-foot assets.

### FREEFORM
- **OPEN DECISION:** add 2D `rotation` as an additive placement key?
  (Recommended yes, later, widen-only pattern, own DB CHECK migration —
  explicitly NOT now.)
- **OPEN DECISION:** which semantic parameters ship in v1? Recommend **none**
  in v1 — plain local transforms first, semantic params after Stage 5 proves
  attachments.
- Confirm the property-ownership model (§6.5) as binding for `placement3d`.

## 31. Final decision document

### A. What we know (CONFIRMED)

1. The 2D system is complete and validated: placement
   `{anchor,x,y,scale[,scaleX,scaleY]}`, 15 anchors, 21 categories, tap/
   drag/pinch/wheel, per-item persistence, per-item (not per-outfit)
   placement, identical resolution in wardrobe and Profile.
2. **No rotation exists anywhere** (garment or model); FREE mode = independent
   X/Y scale + X/Y move + proportional scale only.
3. The clothing prompt is a front-layer generator fitted to the canonical base
   form; normal garments work; accessories get only a generic clause.
4. The shoulder-bag class of problems has no data channel for side, depth or
   orientation — an attachment/geometry limitation, not a prompt defect.
5. Outfits store `item_ids` only; selection is `editingItemId` only; neither
   is renderer-aware.
6. Per-action AI cost ≈ 2 image calls (~$0.064 each), clean-preview path is
   uncapped, quotas exist per generation type, and hash/version caches already
   suppress repeat generation.
7. Global-vs-user storage, RLS, path checks, signed URLs and account deletion
   are in place (`202610070001`, `0010`).
8. Prior reports already fixed: engine (Three.js), coordinate system,
   attachment chain, one-mesh-many-views rule, phases, gesture priority.

### B. What is technically feasible (high confidence)

- Level-1 freeform everywhere (already ~90 % built in 2D; maps cleanly to
  anchor-local transforms in 3D).
- Rigid anchor attachment for accessories with deterministic metadata —
  solves side/orientation/strap positioning without any AI (§8.3).
- One GLB → front/side/back + thumbnails as deterministic renders (§13).
- Progressive minimum-information upload (Levels 1–4) (§11).
- Deterministic fitting of a garment to the fixed master form, computed once
  and reused (§15).
- Deterministic refit/retarget across adult/teen/child from one AI asset
  (§16).
- Hair as separate assets with deterministic recolor (§17).
- Full 2D fallback by construction (§24).
- Automatic validation gates for geometry/attachment/scale (§25 hard gates).

### C. What is feasible but risky (needs the POC)

- **Actual visual quality of single-image garment reconstruction** for DRESSED's
  categories — plausible per research/pricing evidence, but UNVERIFIED for
  these specific garments until §31-J runs (this is the crux).
- Back-side fidelity from one image (priors vs statement backs) and the
  effectiveness of text-conditioned back repair (§10.3).
- Fitting quality on tricky items (jumpsuits, scarves, layered garments).
- Provider selection: quality, latency, PII handling, price at volume.
- Level-2 classifier precision (asking too often = annoyance; too rarely =
  silent wrong backs).

### D. What should NOT be attempted yet

- Level-2 2D freeform (perspective/skew/mesh warp) and mesh-level semantic
  editing.
- Cloth simulation, physics, strand-based hair.
- Independent per-view image generation (approach A) in any form.
- Changing the working clothing prompt for any accessory/3D reason.
- Cross-user asset reuse or global pHash indexes (legal not done).
- `placement3d` migration, new tables, or any schema change.
- Replacing 2D, default-flipping to 3D, or altering gestures.
- Mandatory multi-photo uploads for ordinary garments.

### E. Recommended DRESSED architecture

**"Medium, staged":** 2D remains canonical-of-record and fallback forever;
3D is an additive ModelView (readiness Option C via B) with: one bald master
GLB + one skeleton + a sided superset of the existing 15 anchors (single
contract module); garments as static-then-skinned meshes; accessories as
rigid anchor-attached assets with attachment metadata; semantic freeform as
bounded anchor-local parameters; placements as mode-specific siblings
(`placement` untouched, `placement3d` later, NULL/lazy); assets classified
global vs user-owned with the existing storage rules; GLB canonical,
compressed; all views rendered, never generated.

### F. Recommended AI boundary

**AI (once per unique asset):** identify/classify · understand visual
characteristics · suggest attachment/side · detect hidden-surface risk ·
reconstruct geometry + textures · optional back conditioning when escalated ·
optional final-look image (cached).
**Deterministic (always):** positioning/rotation/scaling · camera & model
yaw · Z/shell depth · attachment transform resolution · fitting math ·
validation gates · views/thumbnails/LOD renders · slot navigation · caching
and dedup decisions · 2D composition · all freeform edits · browser
rendering. **The normal-clothing prompt is frozen.** No AI on view, rotate,
navigate, resize, or switch.

### G. Recommended Freeform model (2D + 3D)

- **2D (today + additive rotation later):**
  `anchor → translate(x%,y%) → scale(sx,sy)` — the existing chain, unchanged;
  Freeform = Level 1 only; Level 2 rejected.
- **3D:**
  `bone → anchor → (u,v,w=shell) → rotation → scale → mesh`, with bounded
  semantic parameters (none in v1).
- **Shared:** anchor vocabulary, resolver pattern, per-item ownership,
  clamp-never-throw, selection/navigation state.
- **Never shared:** units, ordering (z-index vs depth), asset formats,
  world-vs-canvas coordinates.
- **Ownership:** asset = geometry + attachment defaults; placement = user
  transform; deformation (future) = placement-like. Legacy `placement`
  untouched; `placement3d` is a lazy, NULL-default sibling.

### H. Recommended minimum-information upload model

**One image always; ask only what materially helps.** Level 1 (default, one
photo, generic hidden surfaces) → Level 2 (targeted No/Yes/Not-sure question
only when the classifier flags hidden-surface risk) → Level 3 (optional
extra image) → Level 4 (multiple views only for classes whose primary
surface is unseen — backpacks, open-back items). Never mandatory multi-photo
uploads for ordinary garments; skipping any level is always valid and costs
nothing extra.

### I. Recommended asset pipeline

```text
upload (moderation, private storage)
  → understand + classify (AI, once, cached; user category wins)
  → [hidden-surface risk?] → Level 2/3/4 escalation (questions / extra views)
  → reconstruct (one image-to-3D call; multiview only if escalated)
  → deterministic post (normalize, decimate, UV/texture checks)
  → fit to master form (deterministic registration; bounded auto-correct;
                        Level-3 offer; then reject → 2D)
  → attach (anchor binding + attachment metadata; AI only suggested it)
  → validate (hard gates: mesh health, silhouette, color, intersection,
              scale, claimed-back consistency)
  → GLB (canonical, compressed, versioned, fingerprinted)
  → render all views/thumbnails (0 AI)
  → store (user-owned or global) + reuse (within-user now;
           cross-user only after legal review)
  → 2D asset retained forever as fallback
```

### J. Recommended next technical experiment (smallest, most valuable)

> **The 10-garment reconstruction trial (Stage 2, §29)** — a standalone,
> non-UI experiment using *owned* test images (no real user photos until the
> privacy question in §30 is answered):
>
> 1. Pick 10 items spanning the difficulty table: plain tee, printed tee,
>    jeans, dress, jacket, wool coat, hat, glasses, shoulder bag, sneakers
>    (+ scarf and jumpsuit as deliberate stress cases).
> 2. For each: one front photo → one image-to-3D call → deterministic
>    orientation/decimate → fit onto a stand-in master-form proxy → attach
>    via anchors → render front/side/back.
> 3. Rate each result against §25's hard gates + a 1–5 plausibility score,
>    and record exact cost and wall-time per asset.
> 4. Repeat once with the Level-2 back question on the printed tee, and once
>    with front+back photos on the jeans.
>
> **Decision outputs:** (a) go/no-go for Stage 5+; (b) calibrated gate
> thresholds; (c) real per-asset cost vs the $0.25–0.36 estimate; (d) whether
> Level 2 earns its complexity. Estimated effort: days, not weeks; touches no
> product code, no schema, no prompts.

---

## 32. Critical final question

> *If we invest significant development time into the 3D architecture, is
> there a realistic path to making DRESSED's uploaded clothing and
> accessories into reusable, visually convincing 3D assets without requiring
> the user to provide many images and without requiring an excessive number
> of AI generations?*

### **ANSWER: YES, WITH CONDITIONS.**

**Why YES:**

1. **Input side:** one image per garment is technically sufficient for
   *plausible* reconstruction — supported by research (single-image garment
   reconstruction exists, TOG 2024) and by commercial image-to-3D services
   (pricing fetched 2026-10-07). Ordinary garments — the confirmed successful
   class: tees, skirts, joggers, strap tops — are precisely the easy class;
   their backs are near-symmetric priors, so the single-image guess is usually
   *visually indistinguishable from truth*. Escalation stays optional
   (Levels 2–4), so "many images" never becomes the default.
2. **Generation side:** exactly **one** new AI generation per unique design
   (reconstruction) + one cheap classification; every view, thumbnail,
   rotation and outfit combination is a deterministic render (0 AI) — the
   one-mesh-many-views rule already mandated by the z-axis report. Existing
   reuse patterns (version caches, `outfit_key`, sha256/pHash) make
   "generate once, use many times" the natural default, so AI volume does not
   multiply with users or views.
3. **Architecture side:** the risky part (3D) is never load-bearing — 2D
   remains canonical-of-record and fallback; outfits/selection/placement are
   renderer-neutral (CONFIRMED), so a failed 3D asset degrades to today's
   working experience instead of breaking the product.
4. **Attachment side:** accessories — the weakest input class — do not even
   depend on reconstruction fidelity to improve: deterministic anchor
   metadata alone fixes side/orientation/strap placement in 3D.

**The CONDITIONS (all must hold — the answer flips to NO if any fails):**

1. **"Visually convincing" is scoped** to plausible-and-consistent under
   rotation at product viewing distance — not exact reproduction of unseen
   details. If the requirement becomes "pixel-exact backs from one photo
   always", one image is insufficient (⇒ always Level 3/4 ⇒ friction/cost).
2. **Once-per-unique-asset economics are enforced** (hash-before-AI +
   reservations). If reconstruction runs per user, per retry or per view,
   ~$0.25–0.36 × N makes it economically non-viable.
3. **Validation gates + 2D fallback ship together with the pipeline** — no
   unvalidated mesh ever enters an outfit.
4. **The working clothing prompt stays frozen**; 3D is a parallel asset
   pipeline. Any plan that must rewrite the proven prompt to fix accessories
   or views risks the confirmed baseline and is rejected.
5. **The §31-J experiment confirms quality on DRESSED's actual garment mix
   before Phase 4b/9 scale-up.** Current quality evidence is UNVERIFIED for
   this specific use; skipping the ~10-item trial would be betting, not
   engineering.

**One-line engineering/product answer:** *the path is realistic because the
pipeline's cost and input scale are constant (1 image + 1 reconstruction per
unique design), its consistency is structural (renders, not generations), and
its risk is contained (2D fallback) — provided we validate quality early and
refuse to let AI touch anything deterministic.*

## 33. Required report quality — how this report distinguishes its claims

| Category | Marker used | Examples in this report |
|---|---|---|
| Current implementation | **CONFIRMED** (file:line cited) | placement schema, gestures, prompt behavior, costs per action, outfit storage, storage/RLS |
| Previous architectural decisions | referenced by report name | Three.js choice, coordinate contract, gesture priority, one-mesh-many-views |
| Proposed architecture | labelled "proposed / recommended", no marker of fact | attachment metadata (§8.3), anchor superset (§18), pipeline ownership (§9) |
| Experimental ideas | labelled "experiment" / Stage 2 | §31-J reconstruction trial |
| Unresolved | **OPEN DECISION** | §30 (all categories), §5 rotation key, §24 mixed mode |
| External facts | source + retrieval date, **UNVERIFIED** against live runs | Tripo pricing (2026-10-07), GarVerseLOD results (2024) |

## 34. Strict read-only rules — compliance statement

During this task I did **not**: edit `src/`, `public/`, `supabase/`, any
existing analysis file, `package.json`, `package-lock.json`, environment
files, AI prompts, database schema, or configuration; did **not** install
dependencies, create migrations, test assets, or GLB files; did **not** run
destructive commands or any git operation (no commit/push/reset/stash/
checkout).

The ONLY new file is `analysis/dressed-freeform-ai-to-3d-feasibility-analysis.md`.

## 35. Verification (performed)

1. **Report exists** — `analysis/dressed-freeform-ai-to-3d-feasibility-analysis.md`
   created; all required sections present (§1–§35 + Part A).
2. **No source files changed** — `git status` compared with the pre-task
   snapshot: same modified/untracked set as before, plus only this report.
3. **No migrations changed** — `git diff --stat -- supabase` empty; the
   pre-existing untracked `202610070001_account_security_and_user_isolation.sql`
   was already present before this task and untouched.
4. **Package files unchanged** — `git diff --stat -- package.json
   package-lock.json` empty; no installs.
5. **No AI prompts changed** — `clothing-job.ts`, `character-job.ts`,
   `openai-images.ts` untouched (read-only).
6. **No configuration changed** — `astro.config.mjs`, `tsconfig.json`,
   `.env*` untouched.
7. **No git operations performed** — only read-only `git status` /
   `git diff --stat` inspection commands were run.
8. **Exactly what changed:** one new file:
   `analysis/dressed-freeform-ai-to-3d-feasibility-analysis.md`.
   (The working tree's pre-existing modifications from the account-security
   work remain as they were before this task.)






















