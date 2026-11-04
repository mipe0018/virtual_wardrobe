# DRESSED — Gate A: Rig & Deformation Test (`dressed-base.glb`)

> **Type: EXPERIMENT REPORT (numerical).** No source file, migration, Supabase
> setting, package, configuration or git state was modified. **This file is the
> only new artifact in the repository.** No commit/push/merge/stash/reset/rebase
> was performed. `main` was not touched. The 2D wardrobe, the body mesh
> (`public/model-3d/dressed-base.glb`), the skeleton design, the weights, all
> clothing/hair/accessory work, AI and Supabase were **not** touched — the rig
> experiment ran entirely offline against a copy of the GLB and wrote its
> outputs to the system temp directory.
>
> **Branch:** `dressed-3d-development` (HEAD `4db0d55` — working tree already
> contained pre-existing modifications/untracked files from earlier unrelated
> work — untouched here; note the untracked temp script `.gate-a-run.mjs` at the
> repo root is a leftover copy of the experiment driver, not a production file).
>
> **Built on (re-verified against code and raw logs, not assumed):**
> - `analysis/dressed-fashion-doll-poseable-architecture-analysis.md`
>   (Gate A definition: *seam verdict on the overlapping-shell mesh — keep vs
>   retopo — plus acceptable deformation at fashion-envelope extremes*; §21
>   Phase 2; conditions C2/C3; relaxed A-pose ≈30° arm clearance target).
> - `analysis/dressed-3d-implementation-readiness.md` (roadmap, contract
>   `poc-v1`, ModelView abstraction, one-mesh→all-views rendering).
> - Raw experiment logs: `%TEMP%\gate-a-out.txt` (full run) and
>   `%TEMP%\gate-a-analyze-out.txt` (mesh topology probe), both UTF-16, decoded
>   for this report.
> - Experiment drivers: `%TEMP%\gate-a-analyze.mjs`, `%TEMP%\gate-a-run.mjs`
>   (repo-root copy: `.gate-a-run.mjs`) — **temporary files outside the product
>   pipeline**.
> - Outputs: `%TEMP%\gate-a\gate-a-rigged.glb` and
>   `%TEMP%\gate-a\renders\*.png` (12 files, generated but **never inspected** —
>   see UNKNOWN).
>
> **Evidence markers:** **CONFIRMED** = measured/logged in this experiment ·
> **INFERRED** = logical conclusion from confirmed measurements · **UNVERIFIED**
> = needs a measurement or inspection that was not successfully completed here
> (notably: any visual inspection of renders).

---

## Executive Summary

1. **Gate A's core question — "can the existing overlapping-shell body be
   rigged at all?" — is answered YES, numerically.** The current
   `dressed-base.glb` (25,026 verts / 49,960 tris) was loaded, given a 20-bone
   humanoid skeleton, auto-weighted (region-masked distance-to-bone falloff +
   Laplacian smoothing), validated (no negative weights, valid weight sums, ≤4
   influences per vertex after the top-4 cap), and the bind pose reproduced the
   original mesh to a max error of **5.960e-8 m** — i.e. the rig is lossless at
   rest. CONFIRMED.

2. **All 10 test poses (A–J) deformed without a single NaN or non-finite
   result.** Arm-up, elbow, torso, knee and the combined fashion pose all
   produce finite, bounded geometry. The rigged GLB exported cleanly
   (2,005,224 bytes) and re-loaded through `GLTFLoader` with `ok: true`,
   20 bones / 20 skin joints, skin index + weight attributes present. CONFIRMED.

3. **But three numerical problems are real and material:** (a) arm-up
   deformation hotspots up to **≈4.86×** local edge stretch with **26 vertices
   per arm** over the 2.5× threshold — all located in the *torso* shell at the
   shoulder (y ∈ [1.18, 1.43]); (b) **torso drift of 3.8 cm (sternum) / 3.3 cm
   (upper back)** in the combined fashion pose; (c) the bind pose has the arms
   at only **2.22° from vertical** versus the intended relaxed A-pose of
   **≈30°** arm clearance. CONFIRMED.

4. **The body is still built from 23 overlapping closed shells** with measured
   mutual containment (e.g. 294/3522 torso verts inside the left-arm shell's
   region, 865/7586 head verts overlapping the neck shell). Seam-gap changes
   stayed ≤2.6 mm numerically across all poses, but whether those seams *look*
   like cracks or bulges is UNVERIFIED. CONFIRMED topology / UNVERIFIED
   appearance.

5. **Visual quality has NOT been verified.** 12 preview PNGs were rendered, but
   the image-inspection operation repeatedly failed with
   `HTTP 400 — Invalid request parameters`, so **no render was ever looked at**.
   Nothing in this report should be read as a visual sign-off.

6. **Verdict: PASS WITH CONDITIONS — VISUAL INSPECTION REQUIRED.** The existing
   body is technically riggable and poseable; it is **not** approved as the
   final DRESSED poseable fashion-doll body. See §6.

---

## 1. Scope: what Gate A was supposed to answer

From `dressed-fashion-doll-poseable-architecture-analysis.md` (§21 Phase 2,
conditions C2/C3):

- **Gate A =** rig the *current* `dressed-base.glb` with computed weights,
  pose-test it through the fashion envelope, and produce a **seam verdict**
  (keep procedural body vs Blender retopology) plus evidence of acceptable
  deformation at envelope extremes.
- **No rebuild before evidence** — Gate A is explicitly the cheapest decisive
  experiment that de-risks everything downstream.
- Target bind pose: **relaxed A-pose, ~30° arm clearance** (not T-pose).
- Planned envelope: **±75° shoulder, 90° elbow, hip flexion, head turn, torso
  twist**.

### What this run actually tested (method, all CONFIRMED from the driver)

| Step | What was done |
|---|---|
| Load | Direct GLB JSON-chunk parse of `public/model-3d/dressed-base.glb` — 25,026 verts, 49,960 tris, bounds x[−0.205, 0.205] y[≈0, 1.750] z[−0.116, 0.164] m |
| Topology probe (`gate-a-analyze.mjs`) | Connected-component split (**23 closed shells**), per-shell bboxes, arm/leg centerline slicing, torso width profile, shell-overlap probe (bbox overlap + vertex containment) |
| Skeleton | 20 bones placed from measured centerlines: root, pelvis, spine, chest, neck, head, clavicle.L/R, upperArm.L/R, lowerArm.L/R, hand.L/R, thigh.L/R, shin.L/R, foot.L/R |
| Weights | Region-masked distance-to-bone-segment falloff + top-4 normalization → 30 Laplacian smoothing iterations (α = 0.5) over a 74,940-edge graph (avg degree 5.99) |
| Validation | Weight sums, sign check, influence-count cap, bind-pose reconstruction error |
| Poses | 10 poses A–J (see table in §2.2) — CPU linear-blend skinning, per-edge stretch ratio posed vs bind, seam-gap probes at shoulder/wrist/hip/ankle/neck, torso landmark drift |
| Export | Rigged GLB written to temp; re-validated by loading through `GLTFLoader` |
| Renders | 12 software-rasterized PNGs (front + ¾ views) — **generated, never viewed** |

**Envelope caveat (INFERRED):** the tested extremes (70° shoulder, 85° elbow,
45° knee, 20° chest twist) sit **slightly inside** the architecture report's
planned ±75° shoulder / 90° elbow envelope, and hip flexion and full head turn
were only lightly covered (fashion pose: thigh −8°, head yaw 14°). Results at
the true envelope extremes are therefore **not yet measured**.

---

## 2. PROVEN

What the numerical rigging experiment successfully demonstrated.

### 2.1 Rig pipeline is sound end-to-end

| Check | Result | Status |
|---|---|---|
| Source GLB loads | 25,026 verts / 49,960 tris | CONFIRMED |
| Skeleton | 20 bones, correct hierarchy (root→pelvis→spine→chest→neck→head; clavicle/arm chains; thigh/shin/foot chains) | CONFIRMED |
| Weight graph | 74,940 edges, avg degree 5.99 | CONFIRMED |
| Weight sums valid | `badSum = 0` | CONFIRMED |
| No negative weights | `badNeg = 0` | CONFIRMED |
| Influences per vertex | `maxInfluences = 4` after the top-4 cap | CONFIRMED |
| **Bind pose reproduces original mesh** | **max error 5.960e-8 m (≈0.06 µm) — PASS** | CONFIRMED |
| NaN / non-finite deformation | **0 across all 10 poses** | CONFIRMED |
| Rigged GLB export | `%TEMP%\gate-a\gate-a-rigged.glb`, 2,005,224 bytes, 20 bones / 20 skin joints | CONFIRMED |
| `GLTFLoader` round-trip | `ok: true`, scene `GATED_RIG`, skinned mesh `body_gated`, `skinIndexAttr`/`skinWeightAttr` present, `posCount` 25,026, `bindTransformMaxErr` 1.296e-7, `bindRepresentsOriginal: true` | CONFIRMED |

**Meaning:** the existing body can be rigged, exported, and re-imported with a
mathematically lossless rest pose and well-formed skin data. The *plumbing* of
the hybrid attachment architecture (Option D — shared skeleton) is proven.

### 2.2 Every test pose deforms — numerically finite and bounded

Per-pose stretch statistics (ratio of posed to bind edge lengths; p99 / p99.9 /
max; counts over 1.5× and 2.5× thresholds) and seam-gap deltas (posed − bind,
mm):

| Pose | Definition | p99 | p99.9 | max | >1.5× | >2.5× | Notable seam Δ | Torso drift |
|---|---|---:|---:|---:|---:|---:|---|---|
| A_bind | rest | 1.000 | 1.000 | 1.000 | 0 | 0 | 0.0 mm all probes | 0 |
| B_armL_up | upperArm.L +70° | 1.098 | 1.894 | 4.855 | 187 | 26 | shoulderL −0.6 mm | 0 |
| C_armR_up | upperArm.R −70° | 1.097 | 1.879 | 4.701 | 186 | 26 | shoulderR −0.6 mm | 0 |
| D_both_up | both arms +70°/−70° | 1.309 | 2.221 | 4.855 | 373 | 52 | shoulder ±0.6 mm | 0 |
| E_elbowL | lowerArm.L −85° | 1.035 | 1.161 | 1.229 | 0 | 0 | shoulderL −2.6 mm, wristL +1.1 mm | 0 |
| F_elbowR | lowerArm.R −85° | 1.035 | 1.161 | 1.229 | 0 | 0 | shoulderR −2.6 mm | 0 |
| G_torso | chest yaw 20° | 1.007 | 1.091 | 1.361 | 0 | 0 | shoulderR −1.7 mm | sternum 2.6 cm, upper back 2.3 cm, waist 0.3 cm |
| H_kneeL | shin.L 45° | 1.017 | 1.044 | 1.073 | 0 | 0 | hipL 1.0 mm, ankleL −0.2 mm | 0 |
| I_kneeR | shin.R 45° | 1.017 | 1.044 | 1.073 | 0 | 0 | — | 0 |
| J_fashion | combined (spine 8°, chest 18°, head 14°, arms, left leg) | 1.055 | 1.222 | 1.903 | 5 | 0 | shoulderL −2.3 mm, shoulderR −1.8 mm | sternum 3.8 cm, upper back 3.3 cm, waist 0.9 cm |

Proven sub-points:

- **Elbow, knee and torso-twist poses stay well behaved** — max stretch ≤1.36×,
  zero vertices over either threshold. The elbow hinge and knee hinge are the
  cleanest deformers in the rig.
- **Seam-gap changes stayed ≤2.6 mm** at every probed seam (shoulder, wrist,
  hip, ankle, neck) in every pose — no numeric evidence of the shells
  *detaching* by a large margin.
- **Feet stay grounded** in bind and isolated poses (minY ≈ 0.000); only the
  combined fashion pose dips the left foot 1.6 cm below y = 0.
- **Influence structure is regionally sane:** arm shells are dominated by their
  upper arm (1,065/1,122 verts >5% upper-arm weight), legs by the thigh
  (885/1,010), and every class shows multi-bone blending (≥2 bones >5% on all
  verts) — i.e. weights are blended, not hard-segmented.

### 2.3 Shell topology fully mapped (input to the keep-vs-retopo decision)

The body is **23 disconnected closed shells**, largest first: head 7,586 ·
torso 3,522 · each hand 1,256 (994 + 262) · each arm 1,122 · each foot 1,122 ·
each leg 1,010 · neck 626 · face/eye/ear sub-shells (6×534, 2×362, 2×172).
Measured inter-shell containment includes: torso↔arm
(294/3522 torso verts inside the arm region, y-span overlap 0.62 m),
head↔neck (865/7586), torso↔leg (299/3522), foot↔leg (118/1122),
left-leg↔right-leg bbox overlap y-span 0.89 m. CONFIRMED — this is the
topological basis of the seam risk discussed below.

---

## 3. PROBLEMS / RISKS

### 3.1 Arm-up deformation hotspots — up to ≈4.86×

- **B_armL_up max local stretch 4.855×** (C_armR_up 4.701×); **26 vertices per
  arm exceed the 2.5× threshold** (52 for both arms up), 187/186 over 1.5×.
- **All >2.5× hotspot vertices belong to the `torso` shell** (49 for left,
  47 for right, 96 for both), clustered in bbox y ∈ [1.18, 1.43] — the
  **shoulder/upper-chest region** — not inside the arm itself.
- Worst edges reach **4.86× / 4.71× / 4.31×** at positions like
  `[0.059, 1.254, −0.068]`, where the two endpoints have arm weights of
  **0.000 vs 0.168** (chest 0.254/0.246, spine 0.433/0.422).
- **INFERRED cause:** the top-4 influence cap creates a *weight cliff* between
  neighbouring torso vertices — one keeps ~17 % arm weight, its neighbour
  truncates to 0 — so when the arm rises the boundary jumps instead of
  blending. The experiment's own code comment acknowledges this mechanism
  (medial chest/back arm weight must be forced to 0, otherwise top-4 truncation
  produces "0-vs-15 % cliffs between neighbours (the measured >2.5x stretch
  hotspots)").
- **RISK:** 4.8× local stretch is a large number; whether it reads as a visible
  pucker/crack at the shoulder is **unknown** (see §4). The counts (≈26/arm out
  of 25,026 verts) are small and localized, consistent with a "spot defect"
  rather than a "global failure" — INFERRED, not verified visually.

### 3.2 Torso drift — 3.8 cm / 3.3 cm in the combined fashion pose

- **J_fashion: sternum 3.8 cm, upper back 3.3 cm, waist 0.9 cm** landmark drift
  versus bind; **G_torso (20° chest twist alone): sternum 2.6 cm, upper back
  2.3 cm**.
- **RISK:** torso landmarks moving centimetres under a modest multi-joint pose
  means garment anchor points parented to chest/spine (necklines, shoulder
  seams, waistbands) will migrate with them. For a fashion system where fit is
  judged against body landmarks, a ~4 cm sternum shift is material — it can
  read as the chest "sinking" or the torso "shrinking" under twist. Whether it
  is *visible* is UNVERIFIED.
- **INFERRED contributing factor:** the same shoulder-region weight cliffs
  (§3.1) and the near-vertical arms (§3.3) mean the chest/shoulder blend region
  carries most of the deformation load.

### 3.3 Bind arm angle is 2.22°, not ~30°

- Measured: **bind arm angle from vertical = 2.22°** (report target: relaxed
  A-pose ≈30° clearance); shoulder→wrist length 0.567 m.
- **RISK 1 — deformation range:** raising the arm to a natural fashion pose
  from a 2.22° bind requires ~70° of rotation *and* a large medial-to-lateral
  translation of a shell that currently sits almost against the torso. The
  hotspots in §3.1 are exactly what this geometry predicts.
- **RISK 2 — planned geometry change invalidates this rig:** Phase 3 of the
  architecture roadmap explicitly *widens the arms to ~30° clearance* and does
  a face/style pass. Any such change re-positions the shells, so **these
  weights would have to be recomputed** — Gate A proves riggability of the
  *current* mesh, not of the final doll master. (C3: bind pose must be locked
  before garments.)
- **RISK 3 — 2D heritage mismatch:** the 2D AI clothing prompts draw garments
  arms-down; a 30° A-pose bind is a deliberate divergence that must be frozen
  in the vocabulary/contract step before any garment GLB is authored.

### 3.4 Overlapping-shell topology remains a seam/deformation risk

- **23 closed shells with measured mutual containment** (§2.3). Skin weights
  are assigned per-shell by distance; there is **no topological continuity**
  across an interpenetration seam, so continuity depends entirely on the
  smoothing pass producing similar weights on both sides of a boundary it
  cannot see.
- Seam-gap *magnitudes* stayed ≤2.6 mm numerically (§2.2) — good, but that is
  a point-probe measure at a handful of landmarks. It cannot detect shell
  *intersection* (one shell pushing through another), shading discontinuity at
  overlaps, or crumpling on the hidden side of a seam.
- **RISK:** this was the single biggest technical risk Gate A was created to
  adjudicate; the numbers say "no catastrophic tearing," but the **keep-vs-
  retopo verdict requires seeing the seams** — which did not happen (§4).

### 3.5 Smaller numerical observations

- Fashion pose left foot dips **1.6 cm below the floor plane** (minY −0.016) —
  minor; likely pose-design or ankle-weight related, not a blocker by itself.
- Arm-down poses show **zero** over-threshold vertices and the hinge poses are
  clean — the residual problems concentrate entirely in *shoulder abduction +
  torso twist*, i.e. exactly the fashion-pose envelope.
- **Envelope coverage gap:** tested 70°/85° vs planned ±75°/90°; hip flexion
  and head turn lightly covered. Extreme-envelope numbers are UNVERIFIED.
- Weighting method was **distance-falloff + smoothing, not bone-heat** — a
  deliberately cheap first pass. Whether Blender bone-heat (if installed)
  materially improves the hotspots is UNVERIFIED and was not tested here.

---

## 4. UNKNOWN

### Visual quality has NOT been verified

- 12 preview PNGs exist (`%TEMP%\gate-a\renders\`): `bind-front`, `bind-34`,
  `armL-front`, `armL-34`, `armR-front`, `armR-34`, `elbow-front`,
  `torso-front`, `torso-34`, `knee-front`, `fashion-front`, `fashion-34`
  (front + ¾ views of the 7 headline poses).
- **The image-inspection operation repeatedly failed with:**

  ```
  [object Object]
  {"error":{"code":"400","message":"Invalid request parameters","param":"","type":"BadRequestError"}}
  ```

  so **no render was ever examined**. Every attempt across the previous runs of
  this task ended the same way. This report therefore makes **no visual
  claims**.
- Consequently all of the following remain **UNKNOWN**:
  - whether the ≈4.86× shoulder hotspots are visible to the eye, or invisible
    at render resolution;
  - whether shell seams (shoulder, hip, neck, wrist) show cracks, gaps,
    bulges or shading breaks in any pose — i.e. the literal **Gate A seam
    verdict (keep vs Blender retopology) cannot be issued yet**;
  - whether the 3.8 cm torso drift reads as an obvious chest collapse;
  - whether silhouettes, proportions and shading in the bind/¾ views match the
    fashion-doll aesthetic at all;
  - whether the rigged mesh looks correct in the real three.js viewer (the
    software rasterizer used here is a preview proxy, not the product
    renderer).
- Also UNVERIFIED: performance inside the actual `/model-3d` route, garment
  attachment behaviour (Gate B territory), and any Blender bone-heat
  comparison.

**Do not treat this report as visual approval. Do not claim visual inspection
succeeded anywhere downstream.**

---

## 5. Artifacts & reproduction

| Artifact | Location | Note |
|---|---|---|
| Full run log | `%TEMP%\gate-a-out.txt` (UTF-16) | load → skeleton → weights → bind check → poses A–J → export → GLTFLoader validation → render list |
| Topology log | `%TEMP%\gate-a-analyze-out.txt` (UTF-16) | 23 components, centerlines, torso widths, shell-overlap probe |
| Experiment drivers | `%TEMP%\gate-a-analyze.mjs`, `%TEMP%\gate-a-run.mjs`; repo-root copy `.gate-a-run.mjs` (untracked) | temporary; outside the product pipeline |
| Rigged GLB | `%TEMP%\gate-a\gate-a-rigged.glb` (2,005,224 bytes) | **not** placed in `public/`; the product asset `public/model-3d/dressed-base.glb` is unchanged |
| Renders | `%TEMP%\gate-a\renders\*.png` (12) | generated, **never inspected** |

Nothing was merged, pushed, committed, or started beyond writing this report.

---

## 6. Final verdict

# **PASS WITH CONDITIONS — VISUAL INSPECTION REQUIRED**

**What this means:** the existing `dressed-base.glb` is **technically riggable
and poseable** — proven numerically (lossless bind at 5.960e-8 m, clean weight
data with no negative weights and ≤4 influences after the top-4 cap, a 20-bone
skeleton, 10/10 poses deforming finitely with zero NaN, and a valid 20-bone /
20-skin-joint GLB round-trip). It has **NOT** been approved as the final DRESSED
poseable fashion-doll body, because visual quality was never verified (image
inspection failed with HTTP 400) and three material numerical problems —
shoulder hotspots ≈4.86×, 3.8 cm torso drift, and the 2.22° bind pose — plus
the overlapping-shell seam risk remain open.

### Conditions (all must be satisfied before the body is adopted or Phase 3 begins)

1. **Visual inspection of the 12 renders** (or an equivalent re-render through
   a working image path) — shoulder region in `armL-34`/`armR-34`, seams in
   `bind-34`/`fashion-front`, torso in `torso-34`. This is the blocking
   condition; the Gate A **keep-vs-retopo seam verdict cannot be issued without
   it**.
2. **Explicit visual disposition of the ≈4.86× shoulder hotspots** — visible
   defect (→ weight/region fix or retopo) vs invisible (→ accept and record).
3. **Explicit visual disposition of the 3.8 cm fashion-pose torso drift.**
4. **Bind-pose decision recorded before any garment work:** keep the 2.22°
   arms-down bind for now *or* widen to the ~30° A-pose — recognizing that the
   latter changes geometry and forces a weight recompute (condition C3: bind
   pose locked before garments).
5. **Envelope completion:** if final sign-off relies on ±75° shoulder / 90°
   elbow / full hip flexion / head turn, those extremes must be measured —
   this run stopped slightly inside them.
6. **No scope creep from this report** — no body rebuild, weight tuning,
   skeleton change, clothing, hair, accessories, AI, Supabase or 2D-wardrobe
   work is authorized by Gate A; it only establishes that the pipeline works
   and where the risks are.

---

### What would flip this to FAIL

Confirmed *visible* tearing or intersection at the shell seams under the fashion
envelope, or *visible* shoulder collapse from the weight cliffs, with no fix
short of a full retopology rebuild — at which point the architecture report's
"keep vs Blender retopo" decision must be re-opened with the visual evidence
attached.





