import type { Material, Mesh, Object3D, Texture } from "three";

/**
 * Idempotent disposal of every GPU resource reachable from `root`.
 *
 * Walks the scene graph and disposes: geometries, materials (single or
 * arrays) and the textures referenced by those materials. Safe to call on an
 * already-disposed tree (three's dispose() is a no-op for freed resources),
 * and it never throws on meshes without geometry/material.
 *
 * Type-only imports of three: this module performs no WebGL work itself and
 * adds nothing to the runtime bundle beyond the traversal logic.
 */

function disposeTexture(value: unknown): void {
  if (value && typeof value === "object" && "isTexture" in value) {
    (value as Texture).dispose();
  }
}

function disposeMaterial(material: Material | Material[]): void {
  if (Array.isArray(material)) {
    material.forEach(disposeMaterial);
    return;
  }
  if (!material || typeof material !== "object") return;
  // Dispose every texture-like property on the material (map, normalMap, …).
  for (const value of Object.values(
    material as unknown as Record<string, unknown>
  )) {
    disposeTexture(value);
  }
  material.dispose();
}

export function disposeSceneResources(root: Object3D): void {
  root.traverse((object) => {
    const mesh = object as Mesh;
    if (mesh.geometry) {
      mesh.geometry.dispose();
    }
    if (mesh.material !== undefined) {
      disposeMaterial(mesh.material);
    }
  });
}
