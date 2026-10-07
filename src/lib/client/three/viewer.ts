import type { Group } from "three";
import {
  DRESSED_3D_POC_ANCHOR_NAMES,
  DRESSED_VIEWS,
  degreesToYawRadians,
  yawRadiansToDegrees,
  type Dressed3dAnchorName,
} from "../../shared/dressed-3d-contract";
import {
  MODEL_3D_POC_ANCHORS,
  MODEL_3D_POC_GLB_URL,
} from "./asset-sources";
import { disposeSceneResources } from "./dispose-scene";

/**
 * DRESSED 3D POC viewer — isolated experimental runtime.
 *
 * Proves (readiness report §4): GLB load · render · camera framing · model
 * Y-rotation (yaw) · Y-up/+Z coordinate convention · anchor markers that
 * follow the model · local depth (future clothing `w`) · responsive resize ·
 * clean, idempotent dispose + safe re-initialization · single WebGL context.
 *
 * Architecture rules honored here:
 *  - Three.js is imported ONLY dynamically inside this client module (never
 *    from lib/shared or lib/server; never during SSR/prerender).
 *  - ONE renderer/CONTEXT per page (module-level `activeViewer` guard).
 *  - All gestures are bound to this viewer's own canvas — no global handlers,
 *    nothing touches the wardrobe's pointer/wheel code.
 *  - Camera state is presentation-only and never persisted (contract).
 */

export type Model3DViewerStatus = {
  text: string;
  kind: "info" | "ready" | "error";
};

export type Model3DViewerOptions = {
  onStatus?: (status: Model3DViewerStatus) => void;
  /** Called whenever yaw changes (slider sync during canvas drag). */
  onYawChange?: (degrees: number) => void;
};

export type Model3DViewerHandle = {
  setYawDegrees: (degrees: number) => void;
  getYawDegrees: () => number;
  snapToView: (view: "front" | "right" | "back" | "left") => void;
  /** Local depth `w` in meters along the active anchor's local +Z. */
  setDepthMeters: (w: number) => void;
  getDepthMeters: () => number;
  setActiveAnchor: (name: Dressed3dAnchorName) => void;
  getActiveAnchor: () => Dressed3dAnchorName;
  resize: () => void;
  dispose: () => void;
  isDisposed: () => boolean;
};

const DEG_PER_DRAG_PIXEL = 0.35;
const DEPTH_MIN_M = -0.25;
const DEPTH_MAX_M = 0.25;
const MARKER_RADIUS_M = 0.014;
const PROBE_SIZE_M = 0.045;

/** Single-context guard: creating a new viewer disposes the previous one. */
let activeViewer: Model3DViewerHandle | null = null;

export function getActiveModel3DViewer(): Model3DViewerHandle | null {
  return activeViewer;
}

function normalizeDegrees(deg: number): number {
  return ((((deg + 180) % 360) + 360) % 360) - 180;
}

export async function createModel3DViewer(
  host: HTMLElement,
  options: Model3DViewerOptions = {}
): Promise<Model3DViewerHandle> {
  // Enforce the ONE-WebGL-context rule before allocating anything.
  if (activeViewer && !activeViewer.isDisposed()) {
    activeViewer.dispose();
  }
  activeViewer = null;

  const { onStatus } = options;
  const report = (text: string, kind: Model3DViewerStatus["kind"]) =>
    onStatus?.({ text, kind });

  // Dynamic imports: the three.js chunk loads only when this POC mounts, and
  // the code path can never execute during SSR/prerender.
  const THREE = await import("three");
  const { GLTFLoader } = await import(
    "three/examples/jsm/loaders/GLTFLoader.js"
  );

  let disposed = false;
  const cleanups: Array<() => void> = [];

  report("LOADING 3D VIEWER…", "info");

  /* ---------------- renderer / scene / camera ---------------- */
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.domElement.style.display = "block";
  renderer.domElement.style.width = "100%";
  renderer.domElement.style.height = "100%";
  renderer.domElement.style.touchAction = "none"; // this canvas only
  renderer.domElement.setAttribute("aria-label", "Experimental 3D model view");
  host.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x11131c);

  const camera = new THREE.PerspectiveCamera(35, 1, 0.05, 60);
  const lookTarget = new THREE.Vector3(0, 0.9, 0);
  let cameraDistance = 3.2;

  function applyCamera(): void {
    camera.position.set(0, lookTarget.y, cameraDistance);
    camera.lookAt(lookTarget);
  }

  /* ---------------- lights (no shadows — POC) ---------------- */
  const hemisphere = new THREE.HemisphereLight(0xffffff, 0x3a3a4a, 1.1);
  const keyLight = new THREE.DirectionalLight(0xffffff, 2.1);
  keyLight.position.set(2.5, 3.5, 2.5);
  const fillLight = new THREE.DirectionalLight(0xcfd8ff, 0.6);
  fillLight.position.set(-2.5, 1.5, -1.5);
  scene.add(hemisphere, keyLight, fillLight);

  /* ---------------- scene graph (contract structure) ----------------
   * scene
   *  ├ ground (static disc — does NOT rotate)
   *  └ DRESSED_MODEL  ← yaw lives here (model rotates, camera fixed)
   *      ├ body       ← GLB from asset-sources
   *      └ anchors    ← semantic empties; markers + depth probe as children
   * ------------------------------------------------------------------ */
  const dressedModel = new THREE.Group();
  dressedModel.name = "DRESSED_MODEL";
  scene.add(dressedModel);

  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(0.85, 48),
    new THREE.MeshStandardMaterial({ color: 0x1c1f2b, roughness: 1 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = 0.001;
  scene.add(ground);

  const anchorsGroup = new THREE.Group();
  anchorsGroup.name = "anchors";
  dressedModel.add(anchorsGroup);

  const anchorNodes = new Map<Dressed3dAnchorName, Group>();
  const markerColors: Record<Dressed3dAnchorName, number> = {
    head: 0x35d0ff,
    torso: 0xff4fd8,
    waist: 0xffd23f,
    shoulder_left: 0x3dff88,
    shoulder_right: 0x8a5cff,
  };

  for (const name of DRESSED_3D_POC_ANCHOR_NAMES) {
    const rest = MODEL_3D_POC_ANCHORS[name];
    const anchor = new THREE.Group();
    anchor.name = `anchor_${name}`;
    anchor.position.set(rest.x, rest.y, rest.z);
    const marker = new THREE.Mesh(
      new THREE.SphereGeometry(MARKER_RADIUS_M, 16, 12),
      new THREE.MeshStandardMaterial({
        color: markerColors[name],
        emissive: markerColors[name],
        emissiveIntensity: 0.55,
        roughness: 0.4,
      })
    );
    marker.name = "marker";
    anchor.add(marker);
    anchorsGroup.add(anchor);
    anchorNodes.set(name, anchor);
  }

  /* Depth probe: ONE object, reparented to the active anchor. Its local
   * position (0, 0, w) is the proof of the future clothing `w` concept —
   * changing w moves it along the ANCHOR's local +Z, and it rotates with
   * the model because it hangs off the anchor in DRESSED_MODEL. */
  let activeAnchor: Dressed3dAnchorName = "torso";
  let depthM = 0.14;
  const depthProbe = new THREE.Mesh(
    new THREE.BoxGeometry(PROBE_SIZE_M, PROBE_SIZE_M, PROBE_SIZE_M),
    new THREE.MeshStandardMaterial({
      color: 0xff8c1a,
      emissive: 0xff5a00,
      emissiveIntensity: 0.4,
      roughness: 0.5,
    })
  );
  depthProbe.name = "depth_probe";
  anchorNodes.get(activeAnchor)?.add(depthProbe);
  depthProbe.position.set(0, 0, depthM);

  /* ---------------- yaw (the one rotation state) ---------------- */
  let yawDeg = 0;
  function applyYaw(): void {
    dressedModel.rotation.y = degreesToYawRadians(yawDeg);
  }
  applyYaw();

  /* ---------------- GLB load ---------------- */
  report(`LOADING MODEL ${MODEL_3D_POC_GLB_URL}…`, "info");
  const loader = new GLTFLoader();
  let baseCameraDistance = 3.2;

  loader.load(
    MODEL_3D_POC_GLB_URL,
    (gltf) => {
      if (disposed) {
        // The viewer was disposed while the file was in flight: free it now.
        disposeSceneResources(gltf.scene);
        return;
      }
      const body = gltf.scene;
      body.name = "body";
      dressedModel.add(body);

      // Fit the camera once from the model bounds (deterministic framing).
      const bounds = new THREE.Box3().setFromObject(dressedModel);
      const size = bounds.getSize(new THREE.Vector3());
      const center = bounds.getCenter(new THREE.Vector3());
      lookTarget.set(0, center.y, 0);
      const halfFov = THREE.MathUtils.degToRad(camera.fov / 2);
      baseCameraDistance =
        (Math.max(size.x, size.y) / (2 * Math.tan(halfFov))) * 1.35;
      cameraDistance = baseCameraDistance;
      applyCamera();

      report(
        "READY — drag to rotate · anchors + depth probe active (EXPERIMENTAL)",
        "ready"
      );
      requestRender();
    },
    undefined,
    (error) => {
      if (disposed) return;
      console.error("[model-3d] GLB load failed:", error);
      report(
        `MODEL LOAD FAILED: ${MODEL_3D_POC_GLB_URL} (see console)`,
        "error"
      );
    }
  );

  /* ---------------- isolated gestures (this canvas only) ----------------
   * 1 pointer  → horizontal drag = model yaw (model rotates, camera fixed)
   * 2 pointers → pinch = camera dolly (presentation only, never persisted)
   * wheel      → camera dolly
   * Nothing here is global and nothing overlaps the wardrobe's gestures. */
  const pointers = new Map<number, { x: number; y: number }>();
  let dragging = false;
  let pinchDistance = 0;
  const canvas = renderer.domElement;

  function pointerDistance(): number {
    const [a, b] = [...pointers.values()];
    if (!a || !b) return 0;
    return Math.hypot(b.x - a.x, b.y - a.y);
  }

  function zoomBy(factor: number): void {
    const min = baseCameraDistance * 0.45;
    const max = baseCameraDistance * 2.6;
    cameraDistance = Math.min(max, Math.max(min, cameraDistance * factor));
    applyCamera();
    requestRender();
  }

  const onPointerDown = (event: PointerEvent) => {
    if (disposed) return;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.size === 1) {
      dragging = true;
      try {
        canvas.setPointerCapture(event.pointerId);
      } catch {
        /* capture is best-effort */
      }
    } else if (pointers.size === 2) {
      dragging = false;
      pinchDistance = pointerDistance();
    }
  };

  const onPointerMove = (event: PointerEvent) => {
    if (disposed || !pointers.has(event.pointerId)) return;
    const previous = pointers.get(event.pointerId)!;
    if (dragging && pointers.size === 1) {
      const deltaX = event.clientX - previous.x;
      yawDeg = normalizeDegrees(yawDeg + deltaX * DEG_PER_DRAG_PIXEL);
      applyYaw();
      options.onYawChange?.(yawDeg);
      requestRender();
    }
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.size === 2 && pinchDistance > 0) {
      const next = pointerDistance();
      if (next > 0) zoomBy(pinchDistance / next);
      pinchDistance = next;
    }
  };

  const onPointerEnd = (event: PointerEvent) => {
    pointers.delete(event.pointerId);
    if (pointers.size === 1) {
      pinchDistance = 0;
      dragging = true;
    } else if (pointers.size === 0) {
      dragging = false;
      pinchDistance = 0;
    }
    try {
      canvas.releasePointerCapture(event.pointerId);
    } catch {
      /* browser may already have released it */
    }
  };

  const onWheel = (event: WheelEvent) => {
    if (disposed) return;
    event.preventDefault(); // consumed ONLY by this canvas
    zoomBy(event.deltaY > 0 ? 1.08 : 1 / 1.08);
  };

  const onContextLost = (event: Event) => {
    event.preventDefault();
    stopLoop();
    if (!disposed) report("WEBGL CONTEXT LOST", "error");
  };
  const onContextRestored = () => {
    if (disposed) return;
    report("WEBGL CONTEXT RESTORED", "ready");
    startLoop();
  };

  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onPointerEnd);
  canvas.addEventListener("pointercancel", onPointerEnd);
  canvas.addEventListener("wheel", onWheel, { passive: false });
  canvas.addEventListener("webglcontextlost", onContextLost);
  canvas.addEventListener("webglcontextrestored", onContextRestored);
  cleanups.push(() => {
    canvas.removeEventListener("pointerdown", onPointerDown);
    canvas.removeEventListener("pointermove", onPointerMove);
    canvas.removeEventListener("pointerup", onPointerEnd);
    canvas.removeEventListener("pointercancel", onPointerEnd);
    canvas.removeEventListener("wheel", onWheel);
    canvas.removeEventListener("webglcontextlost", onContextLost);
    canvas.removeEventListener("webglcontextrestored", onContextRestored);
  });

  /* ---------------- resize ---------------- */
  function resizeNow(): void {
    if (disposed) return;
    const width = Math.max(1, host.clientWidth);
    const height = Math.max(1, host.clientHeight);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    requestRender();
  }
  const resizeObserver = new ResizeObserver(() => resizeNow());
  resizeObserver.observe(host);
  cleanups.push(() => resizeObserver.disconnect());

  /* ---------------- animation loop + page lifecycle ---------------- */
  let rafId = 0;
  let running = false;
  function loop(): void {
    if (disposed || !running) return;
    rafId = requestAnimationFrame(loop);
    renderer.render(scene, camera);
  }
  function startLoop(): void {
    if (disposed || running || document.hidden) return;
    running = true;
    loop();
  }
  function stopLoop(): void {
    running = false;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
  }
  function requestRender(): void {
    startLoop();
  }

  const onVisibility = () => {
    if (document.hidden) stopLoop();
    else startLoop();
  };
  const onPageHide = () => stopLoop();
  const onPageShow = () => startLoop();
  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("pagehide", onPageHide);
  window.addEventListener("pageshow", onPageShow);
  cleanups.push(() => {
    document.removeEventListener("visibilitychange", onVisibility);
    window.removeEventListener("pagehide", onPageHide);
    window.removeEventListener("pageshow", onPageShow);
  });

  /* ---------------- public handle ---------------- */
  const VIEW_MAP = {
    front: "FRONT",
    right: "RIGHT_SIDE",
    back: "BACK",
    left: "LEFT_SIDE",
  } as const;

  const handle: Model3DViewerHandle = {
    setYawDegrees(degrees) {
      yawDeg = normalizeDegrees(degrees);
      applyYaw();
      requestRender();
    },
    getYawDegrees: () => yawDeg,
    snapToView(view) {
      yawDeg = normalizeDegrees(
        yawRadiansToDegrees(DRESSED_VIEWS[VIEW_MAP[view]])
      );
      applyYaw();
      options.onYawChange?.(yawDeg);
      requestRender();
    },
    setDepthMeters(w) {
      depthM = Math.min(DEPTH_MAX_M, Math.max(DEPTH_MIN_M, w));
      depthProbe.position.set(0, 0, depthM);
      requestRender();
    },
    getDepthMeters: () => depthM,
    setActiveAnchor(name) {
      const node = anchorNodes.get(name);
      if (disposed || !node) return;
      node.add(depthProbe); // reparent — probe follows the chosen anchor
      depthProbe.position.set(0, 0, depthM);
      activeAnchor = name;
      requestRender();
    },
    getActiveAnchor: () => activeAnchor,
    resize: resizeNow,
    dispose,
    isDisposed: () => disposed,
  };

  /* ---------------- dispose (idempotent) ---------------- */
  function dispose(): void {
    if (disposed) return;
    disposed = true;
    stopLoop();
    for (const cleanup of cleanups.splice(0).reverse()) {
      try {
        cleanup();
      } catch (error) {
        console.warn("[model-3d] cleanup failed (ignored):", error);
      }
    }
    disposeSceneResources(scene);
    renderer.dispose();
    try {
      renderer.forceContextLoss();
    } catch {
      /* context may already be gone */
    }
    renderer.domElement.remove();
    if (activeViewer === handle) activeViewer = null;
  }

  activeViewer = handle;
  resizeNow();
  applyCamera();
  startLoop();
  return handle;
}



