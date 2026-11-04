/**
 * GATE A — rig & deformation feasibility experiment for dressed-base.glb
 * TEMP EXPERIMENT FILE (outside repo) — delete after the report is written.
 * Phases: load → skeleton → region-masked auto-weights + Laplacian smoothing
 *         → validations → 10 poses (metrics) → rigged GLB export → GLTFLoader
 *         → software-rasterized preview PNGs.
 */
import fs from "node:fs";
import zlib from "node:zlib";

const SRC = "C:\\Users\\Liva\\Desktop\\Project Folder MMD\\virtual_wardrobe\\public\\model-3d\\dressed-base.glb";
const OUT_DIR = "C:\\Users\\Liva\\AppData\\Local\\Temp\\gate-a";
fs.mkdirSync(OUT_DIR, { recursive: true });
fs.mkdirSync(OUT_DIR + "\\renders", { recursive: true });

/* ================= GLB READ ================= */
const buf = fs.readFileSync(SRC);
const jsonLen = buf.readUInt32LE(12);
const G = JSON.parse(buf.slice(20, 20 + jsonLen).toString("utf8"));
const BIN_START = 20 + jsonLen + 8;
function acc(i) {
  const a = G.accessors[i], bv = G.bufferViews[a.bufferView];
  const off = BIN_START + (bv.byteOffset || 0) + (a.byteOffset || 0);
  const nc = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 }[a.type];
  const ct = a.componentType;
  const ctor = ct === 5126 ? Float32Array : ct === 5125 ? Uint32Array : ct === 5123 ? Uint16Array : Uint8Array;
  return { arr: new ctor(buf.buffer, buf.byteOffset + off, a.count * nc), n: a.count, nc, a };
}
const SRC_POS = acc(0), SRC_NRM = acc(1), SRC_COL = acc(2), SRC_IDX = acc(3);
const N = SRC_POS.n, P = SRC_POS.arr, I = SRC_IDX.arr, COL = SRC_COL.arr;
console.log(`[load] verts=${N} tris=${I.length / 3}`);

/* ================= SKELETON (world bind positions) ================= */
// Derived from component/centerline analysis (gate-a-analyze.mjs):
//  arm axis: x≈0.148@y1.40 → x≈0.167@y0.86  | leg axis x≈0.05 | ankle y≈0.07
//  shoulder y≈1.435 · elbow y≈1.13 · wrist y≈0.868 · hip y≈0.90 · knee y≈0.46
const SK = [
  { n: "root", p: null, w: [0, 0, 0] },
  { n: "pelvis", p: "root", w: [0, 0.88, 0] },
  { n: "spine", p: "pelvis", w: [0, 1.10, 0] },
  { n: "chest", p: "spine", w: [0, 1.34, 0] },
  { n: "neck", p: "chest", w: [0, 1.47, 0] },
  { n: "head", p: "neck", w: [0, 1.545, 0] },
  { n: "clavicle.L", p: "chest", w: [0.02, 1.40, 0.005] },
  { n: "upperArm.L", p: "clavicle.L", w: [0.145, 1.435, 0] },
  { n: "lowerArm.L", p: "upperArm.L", w: [0.1565, 1.13, 0] },
  { n: "hand.L", p: "lowerArm.L", w: [0.167, 0.868, 0] },
  { n: "clavicle.R", p: "chest", w: [-0.02, 1.40, 0.005] },
  { n: "upperArm.R", p: "clavicle.R", w: [-0.145, 1.435, 0] },
  { n: "lowerArm.R", p: "upperArm.R", w: [-0.1565, 1.13, 0] },
  { n: "hand.R", p: "lowerArm.R", w: [-0.167, 0.868, 0] },
  { n: "thigh.L", p: "pelvis", w: [0.05, 0.90, 0] },
  { n: "shin.L", p: "thigh.L", w: [0.052, 0.46, 0] },
  { n: "foot.L", p: "shin.L", w: [0.047, 0.07, 0.01] },
  { n: "thigh.R", p: "pelvis", w: [-0.05, 0.90, 0] },
  { n: "shin.R", p: "thigh.R", w: [-0.052, 0.46, 0] },
  { n: "foot.R", p: "shin.R", w: [-0.047, 0.07, 0.01] },
];
const BONE = SK.map((b, i) => ({ ...b, i, kids: [] }));
const byName = new Map(BONE.map(b => [b.n, b]));
for (const b of BONE) if (b.p) byName.get(b.p).kids.push(b);
// leaf tips for distance segments
const TIP = { head: [0, 1.75, 0], "hand.L": [0.174, 0.75, 0.005], "hand.R": [-0.174, 0.75, 0.005], "foot.L": [0.047, 0.02, 0.12], "foot.R": [-0.047, 0.02, 0.12] };
for (const b of BONE) {
  if (b.kids.length) { b.segA = b.w; b.segB = b.kids[0].w; } // first child defines axis
  else if (TIP[b.n]) { b.segA = b.w; b.segB = TIP[b.n]; }
  else { b.segA = b.w; b.segB = [b.w[0], b.w[1] - 0.05, b.w[2]]; }
}
console.log(`[skeleton] bones=${BONE.length} (${BONE.map(b => b.n).join(", ")})`);

function segDist(px, py, pz, a, b) {
  const abx = b[0] - a[0], aby = b[1] - a[1], abz = b[2] - a[2];
  const apx = px - a[0], apy = py - a[1], apz = pz - a[2];
  const l2 = abx * abx + aby * aby + abz * abz;
  let t = l2 > 0 ? (apx * abx + apy * aby + apz * abz) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const dx = apx - t * abx, dy = apy - t * aby, dz = apz - t * abz;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}


/* ================= COMPONENTS (region masks) ================= */
const parentUF = new Int32Array(N);
for (let i = 0; i < N; i++) parentUF[i] = i;
const find = x => { while (parentUF[x] !== x) { parentUF[x] = parentUF[parentUF[x]]; x = parentUF[x]; } return x; };
const uni = (a, b) => { a = find(a); b = find(b); if (a !== b) parentUF[a] = b; };
for (let t = 0; t < I.length; t += 3) { uni(I[t], I[t + 1]); uni(I[t + 1], I[t + 2]); }
const compOf = new Int32Array(N);
const compGroups = new Map();
for (let i = 0; i < N; i++) { const r = find(i); if (!compGroups.has(r)) compGroups.set(r, []); compGroups.get(r).push(i); }
let compId = 0;
const compInfo = [];
for (const v of compGroups.values()) {
  let minx = 1e9, maxx = -1e9, miny = 1e9, maxy = -1e9;
  for (const i of v) { compOf[i] = compId; const x = P[i * 3], y = P[i * 3 + 1]; if (x < minx) minx = x; if (x > maxx) maxx = x; if (y < miny) miny = y; if (y > maxy) maxy = y; }
  compInfo.push({ id: compId, n: v.length, minx, maxx, miny, maxy });
  compId++;
}
// classify by geometry (same logic as analyze script)
function compClass(c) {
  const cx = (c.minx + c.maxx) / 2;
  if (c.miny < 0.9 && c.maxy > 1.4 && c.minx < 0 && c.maxx > 0) return "torso";   // spans both sides & full height
  if (c.miny > 1.4 && c.maxy < 1.56 && Math.abs(c.minx) < 0.06) return "neck";
  if (c.miny >= 1.5) return "head";                                                // head + ears/eyes/brows
  if (c.maxy > 1.45 && (c.maxy - c.miny) > 0.4 && cx > 0.08) return "armL";
  if (c.maxy > 1.45 && (c.maxy - c.miny) > 0.4 && cx < -0.08) return "armR";
  if (c.maxy <= 1.45 && c.miny < 0.9 && cx > 0.1) return "handL";
  if (c.maxy <= 1.45 && c.miny < 0.9 && cx < -0.1) return "handR";
  if (c.maxy < 0.12 && cx > 0) return "footL";
  if (c.maxy < 0.12 && cx < 0) return "footR";
  if (c.maxy > 0.9 && cx > 0) return "legL";
  if (c.maxy > 0.9 && cx < 0) return "legR";
  return "other";
}
for (const c of compInfo) c.cls = compClass(c);
const clsCount = {};
for (const c of compInfo) clsCount[c.cls] = (clsCount[c.cls] || 0) + 1;
console.log("[components] classes:", JSON.stringify(clsCount));

const B = n => byName.get(n);
function candidatesFor(vi) {
  const cls = compInfo[compOf[vi]].cls;
  const y = P[vi * 3 + 1];
  switch (cls) {
    case "torso": {
      if (y >= 1.40) return ["pelvis", "spine", "chest", "neck", "clavicle.L", "clavicle.R", "upperArm.L", "upperArm.R"];
      if (y >= 1.18) return ["pelvis", "spine", "chest", "clavicle.L", "clavicle.R", "upperArm.L", "upperArm.R"];
      return ["pelvis", "spine", "chest"];
    }
    case "neck": return ["chest", "neck"];
    case "head": return ["neck", "head"];
    case "armL": return ["clavicle.L", "upperArm.L", "lowerArm.L", "hand.L"];
    case "armR": return ["clavicle.R", "upperArm.R", "lowerArm.R", "hand.R"];
    case "handL": return ["lowerArm.L", "hand.L"];
    case "handR": return ["lowerArm.R", "hand.R"];
    case "legL": return ["pelvis", "thigh.L", "shin.L", "foot.L"];
    case "legR": return ["pelvis", "thigh.R", "shin.R", "foot.R"];
    case "footL": return ["shin.L", "foot.L"];
    case "footR": return ["shin.R", "foot.R"];
    default: return ["pelvis", "spine", "chest"];
  }
}

/* ================= WEIGHTS: soft distance-blend init + Laplacian smoothing ================= */
let W = new Float32Array(N * BONE.length);
for (let i = 0; i < N; i++) {
  // soft init: w ∝ 1/(d+eps)^2 over the vertex's candidate bones → spatially
  // continuous weights from the start (hard one-hot caused armpit-band stretch)
  const cands = candidatesFor(i).map(B);
  const cls = compInfo[compOf[i]].cls;
  const eps = cls === "torso" || cls === "neck" ? 0.06 : 0.04; // flatter blends on the big shell
  const w = cands.map(b => 1 / Math.pow(segDist(P[i * 3], P[i * 3 + 1], P[i * 3 + 2], b.segA, b.segB) + eps, 2));
  if (cls === "torso") {
    // Lateral-band rule: the arm may only influence the TORSO side (armpit band).
    // Medial chest/back gets ZERO arm weight — otherwise top-4 truncation turns
    // the ~10-15% stray arm weight into 0-vs-15% cliffs between neighbours
    // (the measured >2.5x stretch hotspots).
    const t = Math.min(1, Math.max(0, (Math.abs(P[i * 3]) - 0.03) / 0.07));
    const armF = t * t * (3 - 2 * t);
    cands.forEach((b, k) => {
      if (b.n === "upperArm.L" || b.n === "upperArm.R") w[k] *= armF;
    });
  }
  const s = w.reduce((a, b) => a + b, 0);
  cands.forEach((b, k) => { W[i * BONE.length + b.i] = w[k] / s; });
}
// edge graph (unique edges overall — smoothing only mixes same-shell neighbors)
const nbr = Array.from({ length: N }, () => []);
const edgeKey = (a, b) => (a < b ? a * N + b : b * N + a);
const edges = new Set();
for (let t = 0; t < I.length; t += 3) {
  const tri = [I[t], I[t + 1], I[t + 2]];
  for (let e = 0; e < 3; e++) {
    const a = tri[e], b = tri[(e + 1) % 3], k = edgeKey(a, b);
    if (!edges.has(k)) { edges.add(k); nbr[a].push(b); nbr[b].push(a); }
  }
}
console.log(`[weights] edges=${edges.size} avgDegree=${(edges.size * 2 / N).toFixed(2)}`);
const SMOOTH = 30, ALPHA = 0.5;
// Diffusion WITHOUT per-iteration candidate zeroing: masks are enforced at init
// only, so y-band boundaries blur smoothly instead of rebuilt as cliffs each pass.
// (Shells have no cross-edges, so weights can never leak between limb regions.)
function smoothPasses(count) {
  for (let it = 0; it < count; it++) {
    const W2 = new Float32Array(N * BONE.length);
    for (let i = 0; i < N; i++) {
      const nb = nbr[i], base = i * BONE.length;
      for (let bi = 0; bi < BONE.length; bi++) {
        let s = 0;
        for (const j of nb) s += W[j * BONE.length + bi];
        const avg = nb.length ? s / nb.length : 0;
        W2[base + bi] = (1 - ALPHA) * W[base + bi] + ALPHA * avg;
      }
    }
    for (let i = 0; i < N; i++) {
      const base = i * BONE.length;
      let sum = 0;
      for (let bi = 0; bi < BONE.length; bi++) sum += W2[base + bi];
      if (sum > 0) for (let bi = 0; bi < BONE.length; bi++) W2[base + bi] /= sum;
    }
    W = W2;
  }
}
function truncateTop4() {
  for (let i = 0; i < N; i++) {
    const base = i * BONE.length;
    const arr = [];
    for (let bi = 0; bi < BONE.length; bi++) if (W[base + bi] > 1e-6) arr.push([W[base + bi], bi]);
    arr.sort((a, b) => b[0] - a[0]);
    arr.length = Math.min(4, arr.length);
    for (let bi = 0; bi < BONE.length; bi++) W[base + bi] = 0;
    let s = 0; for (const [w] of arr) s += w;
    for (const [w, bi] of arr) W[base + bi] = w / s;
  }
}
smoothPasses(SMOOTH);
truncateTop4();
smoothPasses(8);   // heal top-4 truncation discontinuities
truncateTop4();    // final 4-influence form (what the GLB ships)

// validate
let badSum = 0, badNeg = 0, maxInf = 0;
for (let i = 0; i < N; i++) {
  const base = i * BONE.length;
  let s = 0, c = 0;
  for (let bi = 0; bi < BONE.length; bi++) { const w = W[base + bi]; s += w; if (w < -1e-9) badNeg++; if (w > 1e-6) c++; }
  if (Math.abs(s - 1) > 1e-3) badSum++;
  if (c > maxInf) maxInf = c;
}
console.log(`[weights] validated: badSum=${badSum} badNeg=${badNeg} maxInfluences=${maxInf} (after top-4 cap)`);

/* ================= MATH (column-major) ================= */
const mat4Identity = () => new Float32Array([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]);
function mat4Mul(a, b) {
  const o = new Float32Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
  }
  return o;
}
const mat4Translation = (x, y, z) => { const m = mat4Identity(); m[12] = x; m[13] = y; m[14] = z; return m; };
function mat4RotX(a) { const c = Math.cos(a), s = Math.sin(a); return new Float32Array([1,0,0,0, 0,c,s,0, 0,-s,c,0, 0,0,0,1]); }
function mat4RotY(a) { const c = Math.cos(a), s = Math.sin(a); return new Float32Array([c,0,-s,0, 0,1,0,0, s,0,c,0, 0,0,0,1]); }
function mat4RotZ(a) { const c = Math.cos(a), s = Math.sin(a); return new Float32Array([c,s,0,0, -s,c,0,0, 0,0,1,0, 0,0,0,1]); }
function invertRigid(m) {
  const r = mat4Identity();
  r[0] = m[0]; r[1] = m[4]; r[2] = m[8];
  r[4] = m[1]; r[5] = m[5]; r[6] = m[9];
  r[8] = m[2]; r[9] = m[6]; r[10] = m[10];
  r[12] = -(r[0] * m[12] + r[4] * m[13] + r[8] * m[14]);
  r[13] = -(r[1] * m[12] + r[5] * m[13] + r[9] * m[14]);
  r[14] = -(r[2] * m[12] + r[6] * m[13] + r[10] * m[14]);
  return r;
}
const DEG = Math.PI / 180;

function computeGlobals(rotByName) {
  const Gm = new Array(BONE.length);
  for (const b of BONE) {
    const rel = b.p ? [b.w[0] - byName.get(b.p).w[0], b.w[1] - byName.get(b.p).w[1], b.w[2] - byName.get(b.p).w[2]] : b.w;
    let local = mat4Translation(rel[0], rel[1], rel[2]);
    const rot = rotByName[b.n];
    if (rot) {
      let R = mat4Identity();
      if (rot[0]) R = mat4Mul(R, mat4RotX(rot[0]));
      if (rot[1]) R = mat4Mul(R, mat4RotY(rot[1]));
      if (rot[2]) R = mat4Mul(R, mat4RotZ(rot[2]));
      local = mat4Mul(local, R); // rotate about joint origin after translating to it
    }
    Gm[b.i] = b.p ? mat4Mul(Gm[byName.get(b.p).i], local) : local;
  }
  return Gm;
}
const BIND_G = computeGlobals({});
const IBM = BIND_G.map(invertRigid);

/* ================= SKINNING ================= */
function skinPose(rotByName, out) {
  const Gm = computeGlobals(rotByName);
  const skin = Gm.map((g, i) => mat4Mul(g, IBM[i]));
  let nan = 0;
  for (let i = 0; i < N; i++) {
    const px = P[i * 3], py = P[i * 3 + 1], pz = P[i * 3 + 2];
    let x = 0, y = 0, z = 0;
    const base = i * BONE.length;
    for (let bi = 0; bi < BONE.length; bi++) {
      const w = W[base + bi];
      if (w === 0) continue;
      const m = skin[bi];
      x += w * (m[0] * px + m[4] * py + m[8] * pz + m[12]);
      y += w * (m[1] * px + m[5] * py + m[9] * pz + m[13]);
      z += w * (m[2] * px + m[6] * py + m[10] * pz + m[14]);
    }
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) nan++;
    out[i * 3] = x; out[i * 3 + 1] = y; out[i * 3 + 2] = z;
  }
  return nan;
}
// bind reproduction check
{
  const tmp = new Float32Array(N * 3);
  skinPose({}, tmp);
  let maxErr = 0;
  for (let i = 0; i < N * 3; i++) maxErr = Math.max(maxErr, Math.abs(tmp[i] - P[i]));
  console.log(`[check] bind pose reproduces original: maxErr=${maxErr.toExponential(3)} m ${maxErr < 1e-5 ? "PASS" : "FAIL"}`);
}

/* ================= METRICS ================= */
const edgeList = [];
{
  const seen = new Set();
  for (let t = 0; t < I.length; t += 3) {
    const tri = [I[t], I[t + 1], I[t + 2]];
    for (let e = 0; e < 3; e++) {
      const a = tri[e], b = tri[(e + 1) % 3], k = edgeKey(a, b);
      if (!seen.has(k)) { seen.add(k); edgeList.push(a, b); }
    }
  }
}
const REST_LEN = new Float32Array(edgeList.length / 2);
for (let e = 0; e < REST_LEN.length; e++) {
  const a = edgeList[e * 2], b = edgeList[e * 2 + 1];
  REST_LEN[e] = Math.hypot(P[a * 3] - P[b * 3], P[a * 3 + 1] - P[b * 3 + 1], P[a * 3 + 2] - P[b * 3 + 2]);
}
const SEAMS = [
  ["shoulderL", "armL", v => P[v * 3 + 1] > 1.36, "torso", v => P[v * 3 + 1] > 1.28],
  ["shoulderR", "armR", v => P[v * 3 + 1] > 1.36, "torso", v => P[v * 3 + 1] > 1.28],
  ["wristL", "armL", v => P[v * 3 + 1] < 0.98, "handL", () => true],
  ["hipL", "legL", v => P[v * 3 + 1] > 0.83, "torso", v => P[v * 3 + 1] < 0.97],
  ["ankleL", "legL", v => P[v * 3 + 1] < 0.17, "footL", () => true],
  ["neckSeam", "neck", () => true, "head", v => P[v * 3 + 1] < 1.60],
];
const seamSubsets = SEAMS.map(([nm, ca, fa, cb, fb]) => {
  const A = [], Bb = [];
  for (let i = 0; i < N; i++) if (compInfo[compOf[i]].cls === ca && fa(i)) A.push(i);
  for (let i = 0; i < N; i++) if (compInfo[compOf[i]].cls === cb && fb(i)) Bb.push(i);
  const stepA = Math.max(1, Math.floor(A.length / 500)), stepB = Math.max(1, Math.floor(Bb.length / 500));
  return { nm, A: A.filter((_, k) => k % stepA === 0), B: Bb.filter((_, k) => k % stepB === 0) };
});
function minDist(sub, Q) {
  let m = Infinity;
  for (const i of sub.A) for (const j of sub.B) {
    const d = Math.hypot(Q[i * 3] - Q[j * 3], Q[i * 3 + 1] - Q[j * 3 + 1], Q[i * 3 + 2] - Q[j * 3 + 2]);
    if (d < m) m = d;
  }
  return m;
}
const BIND_GAP = seamSubsets.map(s => minDist(s, P));
// torso landmark verts (drift metric: how far the quiet torso chases a raised arm)
const LANDMARKS = [["sternum", 0, 1.31, 0.109], ["upperBack", 0, 1.38, -0.08], ["waist", 0, 1.11, 0.085]]
  .map(([nm, x, y, z]) => {
    let bi = -1, bd = Infinity;
    for (let i = 0; i < N; i++) {
      const d = Math.hypot(P[i * 3] - x, P[i * 3 + 1] - y, P[i * 3 + 2] - z);
      if (d < bd) { bd = d; bi = i; }
    }
    return { nm, i: bi };
  });

function evaluatePose(name, rot) {
  const Q = new Float32Array(N * 3);
  const nan = skinPose(rot, Q);
  let minx = 1e9, maxx = -1e9, miny = 1e9, maxy = -1e9, minz = 1e9, maxz = -1e9;
  for (let i = 0; i < N; i++) {
    const x = Q[i * 3], y = Q[i * 3 + 1], z = Q[i * 3 + 2];
    if (x < minx) minx = x; if (x > maxx) maxx = x;
    if (y < miny) miny = y; if (y > maxy) maxy = y;
    if (z < minz) minz = z; if (z > maxz) maxz = z;
  }
  const ratios = [];
  const hot = []; // vertex indices in edges with ratio > 2.5
  const worst = []; // [ratio, a, b]
  let bad = 0;
  for (let e = 0; e < REST_LEN.length; e++) {
    const a = edgeList[e * 2], b = edgeList[e * 2 + 1];
    const L = Math.hypot(Q[a * 3] - Q[b * 3], Q[a * 3 + 1] - Q[b * 3 + 1], Q[a * 3 + 2] - Q[b * 3 + 2]);
    const r = REST_LEN[e] > 1e-9 ? L / REST_LEN[e] : 1;
    if (!Number.isFinite(r)) { bad++; continue; }
    ratios.push(r);
    if (r > 2.5) { hot.push(a, b); worst.push([r, a, b]); }
  }
  worst.sort((x, y) => y[0] - x[0]);
  const topWorst = worst.slice(0, 6).map(([r, a, b]) => {
    const wa = {}, wb = {};
    const uL = byName.get("upperArm.L").i, uR = byName.get("upperArm.R").i, ch = byName.get("chest").i, sp = byName.get("spine").i, nv = byName.get("neck").i;
    wa.L = +W[a * BONE.length + uL].toFixed(3); wa.R = +W[a * BONE.length + uR].toFixed(3);
    wa.chest = +W[a * BONE.length + ch].toFixed(3); wa.spine = +W[a * BONE.length + sp].toFixed(3);
    wb.L = +W[b * BONE.length + uL].toFixed(3); wb.R = +W[b * BONE.length + uR].toFixed(3);
    wb.chest = +W[b * BONE.length + ch].toFixed(3); wb.spine = +W[b * BONE.length + sp].toFixed(3);
    return { r: +r.toFixed(2), a: [+P[a * 3], +P[a * 3 + 1], +P[a * 3 + 2]].map(v => +v.toFixed(3)), b: [+P[b * 3], +P[b * 3 + 1], +P[b * 3 + 2]].map(v => +v.toFixed(3)), wa, wb };
  });
  ratios.sort((a, b) => a - b);
  const q = f => ratios[Math.min(ratios.length - 1, Math.floor(ratios.length * f))] || 1;
  const gaps = seamSubsets.map((s, k) => ({ nm: s.nm, bind: BIND_GAP[k], posed: minDist(s, Q) }));
  const drift = LANDMARKS.map(l => ({
    nm: l.nm,
    d: Math.hypot(Q[l.i * 3] - P[l.i * 3], Q[l.i * 3 + 1] - P[l.i * 3 + 1], Q[l.i * 3 + 2] - P[l.i * 3 + 2]),
  }));
  let minYi = 0;
  for (let i = 1; i < N; i++) if (Q[i * 3 + 1] < Q[minYi * 3 + 1]) minYi = i;
  // hotspot summary for edges >2.5×
  let hotInfo = null;
  if (hot.length) {
    const uniq = [...new Set(hot)];
    let hx0 = 1e9, hx1 = -1e9, hy0 = 1e9, hy1 = -1e9, hz0 = 1e9, hz1 = -1e9;
    const clsCount2 = {};
    for (const i of uniq) {
      const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2];
      if (x < hx0) hx0 = x; if (x > hx1) hx1 = x;
      if (y < hy0) hy0 = y; if (y > hy1) hy1 = y;
      if (z < hz0) hz0 = z; if (z > hz1) hz1 = z;
      const c2 = compInfo[compOf[i]].cls;
      clsCount2[c2] = (clsCount2[c2] || 0) + 1;
    }
    hotInfo = { verts: uniq.length, bbox: [hx0, hx1, hy0, hy1, hz0, hz1].map(v => +v.toFixed(3)), byClass: clsCount2 };
  }
  return {
    name, nan, bad,
    bounds: { minx, maxx, miny, maxy, minz, maxz },
    p99: q(0.99), p999: q(0.999), maxR: q(1),
    over15: ratios.filter(r => r > 1.5).length,
    over25: ratios.filter(r => r > 2.5).length,
    gaps, Q, hotInfo, topWorst,
    drift: drift.map(d => `${d.nm}:${(d.d * 100).toFixed(1)}cm`).join(" "),
    minY: { y: Q[minYi * 3 + 1], cls: compInfo[compOf[minYi]].cls },
  };
}

/* ================= POSE SUITE (A–J) ================= */
const D = v => v * DEG;
const POSES = {
  A_bind: {},
  B_armL_up: { "upperArm.L": [0, 0, D(70)] },
  C_armR_up: { "upperArm.R": [0, 0, D(-70)] },
  D_both_up: { "upperArm.L": [0, 0, D(70)], "upperArm.R": [0, 0, D(-70)] },
  E_elbowL: { "lowerArm.L": [D(-85), 0, 0] },
  F_elbowR: { "lowerArm.R": [D(-85), 0, 0] },
  G_torso: { chest: [0, D(20), 0] },
  H_kneeL: { "shin.L": [D(45), 0, 0] },
  I_kneeR: { "shin.R": [D(45), 0, 0] },
  J_fashion: {
    spine: [0, D(8), 0], chest: [0, D(18), 0], head: [0, D(14), 0],
    "upperArm.L": [0, 0, D(14)], "lowerArm.L": [D(-55), 0, 0],
    "upperArm.R": [0, 0, D(-6)],
    "thigh.L": [D(-8), 0, 0], "shin.L": [D(35), 0, 0],
  },
};
const results = {};
for (const [nm, rot] of Object.entries(POSES)) results[nm] = evaluatePose(nm, rot);

const fmt = n => n.toFixed(3);
console.log("\n=== POSE RESULTS ===");
console.log("pose | nan | bounds(x,y,z) m | p99 | p99.9 | max | >1.5 | >2.5 | seamΔ mm (posed−bind)");
for (const r of Object.values(results)) {
  const b = r.bounds;
  const gapStr = r.gaps.map(g => `${g.nm}:${((g.posed - g.bind) * 1000).toFixed(1)}`).join(" ");
  console.log(
    `${r.name} | nan=${r.nan} bad=${r.bad} | x[${fmt(b.minx)},${fmt(b.maxx)}] y[${fmt(b.miny)},${fmt(b.maxy)}] z[${fmt(b.minz)},${fmt(b.maxz)}] ` +

    `| ${r.p99.toFixed(3)} | ${r.p999.toFixed(3)} | ${r.maxR.toFixed(3)} | ${r.over15} | ${r.over25} | ${gapStr}`
  );
  if (r.hotInfo) console.log(`    HOTSPOTS>2.5x: ${JSON.stringify(r.hotInfo)}`);
  if (r.name === "B_armL_up") console.log(`    WORST: ${JSON.stringify(r.topWorst, null, 0)}`);
  console.log(`    torsoDrift: ${r.drift} | minY: ${r.minY.y.toFixed(3)} (${r.minY.cls})`);
}

/* ================= RIGGED GLB EXPORT (bind pose + skin) ================= */
function exportRiggedGLB(path) {
  const parts = [];
  let len = 0;
  const views = [];
  function addView(arr, target, compType) {
    while (len % 4 !== 0) { parts.push(Buffer.from([0, 0, 0, 0])); len += 4; }
    const bytes = Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength);
    const off = len;
    parts.push(bytes); len += bytes.length;
    views.push({ buffer: 0, byteOffset: off, byteLength: bytes.length, ...(target ? { target } : {}) });
    return views.length - 1;
  }
  const vPos = addView(P, 34962);
  const vNrm = addView(SRC_NRM.arr, 34962);
  const vCol = addView(COL, 34962);
  const joints = new Uint8Array(N * 4);
  const weights = new Float32Array(N * 4);
  for (let i = 0; i < N; i++) {
    const base = i * BONE.length, o = i * 4;
    const arr = [];
    for (let bi = 0; bi < BONE.length; bi++) if (W[base + bi] > 1e-6) arr.push([W[base + bi], bi]);
    arr.sort((a, b) => b[0] - a[0]); arr.length = Math.min(4, arr.length);
    let s = 0; for (const [w] of arr) s += w;
    for (let k = 0; k < 4; k++) {
      if (k < arr.length) { joints[o + k] = arr[k][1]; weights[o + k] = arr[k][0] / s; }
      else { joints[o + k] = 0; weights[o + k] = 0; }
    }
  }
  const vJoints = addView(joints, 34962);
  const vWeights = addView(weights, 34962);
  const idx32 = new Uint32Array(I.length); idx32.set(I);
  const vIdx = addView(idx32, 34963);
  const ibm = new Float32Array(16 * BONE.length);
  for (let i = 0; i < BONE.length; i++) ibm.set(IBM[i], i * 16);
  const vIbm = addView(ibm);

  const padEnd = () => { while (len % 4 !== 0) { parts.push(Buffer.from([0, 0, 0, 0])); len += 4; } };
  padEnd();

  // nodes: bones 0..19, mesh node 20
  const boneNodeIdx = {};
  const nodes = [];
  for (const b of BONE) {
    boneNodeIdx[b.n] = nodes.length;
    const rel = b.p ? [b.w[0] - byName.get(b.p).w[0], b.w[1] - byName.get(b.p).w[1], b.w[2] - byName.get(b.p).w[2]] : b.w;
    nodes.push({ name: b.n, translation: rel.map(v => +v.toFixed(6)), children: [] });
  }
  for (const b of BONE) if (b.p) nodes[boneNodeIdx[b.p]].children.push(boneNodeIdx[b.n]);
  for (const b of BONE) if (!nodes[boneNodeIdx[b.n]].children.length) delete nodes[boneNodeIdx[b.n]].children;
  const meshNode = nodes.length;
  nodes.push({ name: "body_gated", mesh: 0, skin: 0 });

  const out = {
    asset: { version: "2.0", generator: "DRESSED Gate A rig experiment" },
    scene: 0,
    scenes: [{ name: "GATED_RIG", nodes: [boneNodeIdx["root"], meshNode] }],
    nodes,
    meshes: [{ name: "DRESSED_BODY_GATED", primitives: [{
      attributes: { POSITION: 0, NORMAL: 1, COLOR_0: 2, JOINTS_0: 3, WEIGHTS_0: 4 },
      indices: 5, material: 0, mode: 4,
    }] }],
    materials: G.materials,
    skins: [{ inverseBindMatrices: 6, skeleton: boneNodeIdx["root"], joints: BONE.map(b => boneNodeIdx[b.n]) }],
    buffers: [{ byteLength: len }],
    bufferViews: views,
    accessors: [
      { bufferView: vPos, componentType: 5126, count: N, type: "VEC3", min: G.accessors[0].min, max: G.accessors[0].max },
      { bufferView: vNrm, componentType: 5126, count: N, type: "VEC3" },
      { bufferView: vCol, componentType: 5126, count: N, type: "VEC3" },
      { bufferView: vJoints, componentType: 5121, count: N, type: "VEC4" },
      { bufferView: vWeights, componentType: 5126, count: N, type: "VEC4" },
      { bufferView: vIdx, componentType: 5125, count: I.length, type: "SCALAR" },
      { bufferView: vIbm, componentType: 5126, count: BONE.length, type: "MAT4" },
    ],
  };
  const jsonBuf = Buffer.from(JSON.stringify(out), "utf8");
  const jsonPad = (4 - (jsonBuf.length % 4)) % 4;
  const bin = Buffer.concat(parts, len);
  const total = 12 + 8 + jsonBuf.length + jsonPad + 8 + bin.length;
  const head = Buffer.alloc(12);
  head.writeUInt32LE(0x46546c67, 0); head.writeUInt32LE(2, 4); head.writeUInt32LE(total, 8);
  const jh = Buffer.alloc(8); jh.writeUInt32LE(jsonBuf.length + jsonPad, 0); jh.writeUInt32LE(0x4e4f534a, 4);
  const bh = Buffer.alloc(8); bh.writeUInt32LE(bin.length, 0); bh.writeUInt32LE(0x004e4942, 4);
  fs.writeFileSync(path, Buffer.concat([head, jh, jsonBuf, Buffer.alloc(jsonPad, 0x20), bh, bin]));
  console.log(`[export] ${path} (${total} bytes) bones=${BONE.length} skinJoints=${out.skins[0].joints.length}`);
}
const RIGGED = OUT_DIR + "\\gate-a-rigged.glb";
exportRiggedGLB(RIGGED);

/* ================= GLTFLoader VALIDATION (real three.js) ================= */
async function validateWithGLTFLoader() {
  const { GLTFLoader } = await import("three/examples/jsm/loaders/GLTFLoader.js");
  const ab = fs.readFileSync(RIGGED);
  const arrayBuffer = ab.buffer.slice(ab.byteOffset, ab.byteOffset + ab.byteLength);
  const loader = new GLTFLoader();
  return new Promise((resolve) => {
    loader.parse(arrayBuffer, "", async (gltf) => {
      const bones = [];
      let skinned = null;
      gltf.scene.traverse((o) => {
        if (o.isBone) bones.push(o.name);
        if (o.isSkinnedMesh) skinned = o;
      });
      const report = {
        ok: true,
        sceneName: gltf.scene.name,
        bones: bones.length,
        boneNames: bones,
        skinnedMesh: !!skinned,
        skinnedName: skinned ? skinned.name : null,
        skeletonBones: skinned ? skinned.skeleton.bones.length : 0,
        skinIndexAttr: !!(skinned && skinned.geometry.attributes.skinIndex),
        skinWeightAttr: !!(skinned && skinned.geometry.attributes.skinWeight),
        posCount: skinned ? skinned.geometry.attributes.position.count : 0,
      };
      // bind-pose equivalence: applyBoneTransform on a sample vs original
      if (skinned) {
        gltf.scene.updateMatrixWorld(true);
        let maxErr = 0;
        for (let k = 0; k < 60; k++) {
          const i = Math.floor((k / 60) * N);
          const v = new (await threeVector())(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]);
          const out = skinned.applyBoneTransform(i, v);
          maxErr = Math.max(maxErr, out.distanceTo(new (v.constructor)(P[i * 3], P[i * 3 + 1], P[i * 3 + 2])));
        }
        report.bindTransformMaxErr = maxErr;
        report.bindRepresentsOriginal = maxErr < 1e-4;
      }
      resolve(report);
    }, (err) => resolve({ ok: false, error: String(err && err.message || err) }));
  });
}
let _V3 = null;
async function threeVector() {
  if (!_V3) { const t = await import("three"); _V3 = t.Vector3; }
  return _V3;
}

/* ================= PNG WRITER (dependency-free) ================= */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function crc32(b) { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC_TABLE[(c ^ b[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function pngChunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32LE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32LE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function writePNG(path, w, h, rgb /* Uint8Array w*h*3 */) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    Buffer.from(rgb.buffer, rgb.byteOffset + y * w * 3, w * 3).copy(raw, y * (w * 3 + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  fs.writeFileSync(path, Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", zlib.deflateSync(raw, { level: 6 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]));
}

/* ================= SOFTWARE RASTERIZER ================= */
function renderPose(Q, yawDeg, path, W = 560, H = 840, ss = 2) {
  const RW = W * ss, RH = H * ss;
  const fb = new Float32Array(RW * RH * 3);
  // background
  for (let i = 0; i < RW * RH; i++) { fb[i * 3] = 0x11; fb[i * 3 + 1] = 0x13; fb[i * 3 + 2] = 0x1c; }
  const a = yawDeg * DEG, ca = Math.cos(a), sa = Math.sin(a);
  // rotate: x' = c*x − s*z ; z' = s*x + c*z (rotY as mat4RotY rows)
  const rx = new Float32Array(N), ry = new Float32Array(N), rz = new Float32Array(N);
  let minx = 1e9, maxx = -1e9, miny = 1e9, maxy = -1e9;
  for (let i = 0; i < N; i++) {
    const x = Q[i * 3], y = Q[i * 3 + 1], z = Q[i * 3 + 2];
    rx[i] = ca * x - sa * z; rz[i] = sa * x + ca * z; ry[i] = y;
    if (rx[i] < minx) minx = rx[i]; if (rx[i] > maxx) maxx = rx[i];
    if (y < miny) miny = y; if (y > maxy) maxy = y;
  }
  const pad = 0.06;
  const s = Math.min((RW - 10) / (maxx - minx + pad * 2), (RH - 10) / (maxy - miny + pad * 2));
  const ox = RW / 2 - s * (minx + maxx) / 2;
  const oy = RH - (RH - s * (maxy - miny)) / 2 + s * miny; // map miny→bottom pad
  // light in view space
  const Lx = 0.35, Ly = 0.55, Lz = 0.85; const ll = Math.hypot(Lx, Ly, Lz);
  const lx = Lx / ll, ly = Ly / ll, lz = Lz / ll;
  // build visible tris
  const tris = [];
  for (let t = 0; t < I.length; t += 3) {
    const i0 = I[t], i1 = I[t + 1], i2 = I[t + 2];
    const ax = rx[i0], ay = ry[i0], az = rz[i0];
    const bx = rx[i1], by = ry[i1], bz = rz[i1];
    const cx = rx[i2], cy = ry[i2], cz = rz[i2];
    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const vx = cx - ax, vy = cy - ay, vz = cz - az;
    let nx = uy * vz - uz * vy, nyy = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const nl = Math.hypot(nx, nyy, nz);
    if (nl < 1e-12) continue;
    nx /= nl; nyy /= nl; nz /= nl;
    if (nz <= 0) continue; // backface (camera at +z)
    const zc = (az + bz + cz) / 3;
    const inten = 0.38 + 0.62 * Math.max(0, nx * lx + nyy * ly + nz * lz);
    const r = (COL[i0 * 3] + COL[i1 * 3] + COL[i2 * 3]) / 3 * inten;
    const g = (COL[i0 * 3 + 1] + COL[i1 * 3 + 1] + COL[i2 * 3 + 1]) / 3 * inten;
    const bl = (COL[i0 * 3 + 2] + COL[i1 * 3 + 2] + COL[i2 * 3 + 2]) / 3 * inten;
    tris.push([zc, ax, ay, bx, by, cx, cy, r, g, bl]);
  }
  tris.sort((p, q) => p[0] - q[0]); // far→near
  for (const tr of tris) {
    const sx0 = ox + s * tr[1], sy0 = oy - s * tr[2];
    const sx1 = ox + s * tr[3], sy1 = oy - s * tr[4];
    const sx2 = ox + s * tr[5], sy2 = oy - s * tr[6];
    const area = (sx1 - sx0) * (sy2 - sy0) - (sx2 - sx0) * (sy1 - sy0);
    if (Math.abs(area) < 1e-9) continue;
    const minX = Math.max(0, Math.floor(Math.min(sx0, sx1, sx2)));
    const maxX = Math.min(RW - 1, Math.ceil(Math.max(sx0, sx1, sx2)));
    const minY = Math.max(0, Math.floor(Math.min(sy0, sy1, sy2)));
    const maxY = Math.min(RH - 1, Math.ceil(Math.max(sy0, sy1, sy2)));
    const inv = 1 / area;
    for (let py = minY; py <= maxY; py++) {
      for (let px = minX; px <= maxX; px++) {
        const cxp = px + 0.5, cyp = py + 0.5;
        let w0 = ((sx1 - sx0) * (cyp - sy0) - (cxp - sx0) * (sy1 - sy0)) * inv;
        let w1 = ((sx2 - sx1) * (cyp - sy1) - (cxp - sx1) * (sy2 - sy1)) * inv;
        let w2 = 1 - w0 - w1;
        if (w0 < 0 || w1 < 0 || w2 < 0) continue;
        const o = (py * RW + px) * 3;
        fb[o] = tr[7] * 255; fb[o + 1] = tr[8] * 255; fb[o + 2] = tr[9] * 255;
      }
    }
  }
  // downsample + clamp
  const out = new Uint8Array(W * H * 3);
  const f = ss * ss;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let r = 0, g = 0, b = 0;
    for (let dy = 0; dy < ss; dy++) for (let dx = 0; dx < ss; dx++) {
      const o = ((y * ss + dy) * RW + x * ss + dx) * 3;
      r += fb[o]; g += fb[o + 1]; b += fb[o + 2];
    }
    const o2 = (y * W + x) * 3;
    out[o2] = Math.min(255, r / f); out[o2 + 1] = Math.min(255, g / f); out[o2 + 2] = Math.min(255, b / f);
  }
  writePNG(path, W, H, out);
}

/* ================= MAIN ================= */
async function main() {
  // skeleton/geometry summary stats for the report
  const armAngleDeg = Math.atan2(
    byName.get("hand.L").w[0] - byName.get("upperArm.L").w[0],
    byName.get("upperArm.L").w[1] - byName.get("hand.L").w[1]
  ) * 180 / Math.PI;
  console.log(`\n[stats] bind arm angle from vertical = ${armAngleDeg.toFixed(2)}° (report target: ~30°)`);
  console.log(`[stats] shoulder→wrist = ${Math.hypot(byName.get("hand.L").w[0] - byName.get("upperArm.L").w[0], byName.get("upperArm.L").w[1] - byName.get("hand.L").w[1]).toFixed(3)} m`);
  // influence stats per class
  const infl = {};
  for (let i = 0; i < N; i++) {
    const cls = compInfo[compOf[i]].cls;
    infl[cls] = infl[cls] || { n: 0, upperArm: 0, thigh: 0, twoPlus: 0 };
    infl[cls].n++;
    const base = i * BONE.length;
    if (W[base + byName.get("upperArm.L").i] + W[base + byName.get("upperArm.R").i] > 0.05) infl[cls].upperArm++;
    if (W[base + byName.get("thigh.L").i] + W[base + byName.get("thigh.R").i] > 0.05) infl[cls].thigh++;
    let c = 0; for (let bi = 0; bi < BONE.length; bi++) if (W[base + bi] > 0.05) c++;
    if (c >= 2) infl[cls].twoPlus++;
  }
  for (const [cls, s] of Object.entries(infl)) {
    console.log(`[stats] ${cls}: n=${s.n} upperArm>5%=${s.upperArm} thigh>5%=${s.thigh} multi(≥2 bones>5%)=${s.twoPlus}`);
  }

  // GLTFLoader validation
  const gltfReport = await validateWithGLTFLoader();
  console.log("\n=== GLTFLoader VALIDATION ===");
  console.log(JSON.stringify(gltfReport, null, 1));

  // previews (§10): front for all 7 required poses + 3/4 for the most important
  const plan = [
    ["A_bind", "bind"], ["B_armL_up", "armL"], ["C_armR_up", "armR"],
    ["E_elbowL", "elbow"], ["G_torso", "torso"], ["H_kneeL", "knee"], ["J_fashion", "fashion"],
  ];
  const quarter = new Set(["A_bind", "B_armL_up", "C_armR_up", "G_torso", "J_fashion"]);
  console.log("\n=== RENDERS ===");
  for (const [poseKey, file] of plan) {
    const Q = results[poseKey].Q;
    const p1 = `${OUT_DIR}\\renders\\${file}-front.png`;
    renderPose(Q, 0, p1);
    console.log(`[render] ${p1}`);
    if (quarter.has(poseKey)) {
      const p2 = `${OUT_DIR}\\renders\\${file}-34.png`;
      renderPose(Q, 40, p2);
      console.log(`[render] ${p2}`);
    }
  }
  console.log("\n[done] Gate A experiment complete.");
}
main().catch(e => { console.error("FATAL", e); process.exit(1); });








