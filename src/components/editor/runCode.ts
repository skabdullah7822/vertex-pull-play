import * as THREE from "three";
import type { Kind } from "./geometry";

/**
 * Runs a small Three.js snippet written by the user and returns every object
 * it added to `scene`, so the editor can register them as normal objects.
 */

export interface CodeRunResult {
  objects: THREE.Object3D[];
  logs: string[];
  error: string | null;
}

export const SAMPLE_CODE = `// A wall with a door hole is easier with the Cut tool,
// but anything you build here lands in the scene list.
const wall = new THREE.Mesh(
  new THREE.BoxGeometry(6, 3, 0.3),
  new THREE.MeshStandardMaterial({ color: 0xb8a58a })
);
wall.name = 'Wall';
wall.position.set(0, 1.5, 0);
scene.add(wall);

const floor = new THREE.Mesh(
  new THREE.BoxGeometry(8, 0.2, 8),
  new THREE.MeshStandardMaterial({ color: 0x6b7280 })
);
floor.name = 'Floor';
floor.position.set(0, 0.1, 0);
scene.add(floor);
`;

export function kindOf(obj: THREE.Object3D): Kind {
  const anyObj = obj as unknown as { isLight?: boolean; isDirectionalLight?: boolean; isPointLight?: boolean; isSpotLight?: boolean; isAmbientLight?: boolean };
  if (anyObj.isLight) {
    if (anyObj.isDirectionalLight) return "directionalLight";
    if (anyObj.isPointLight) return "pointLight";
    if (anyObj.isSpotLight) return "spotLight";
    return "ambientLight";
  }
  const mesh = obj as THREE.Mesh;
  const type = mesh.geometry?.type ?? "";
  const map: Record<string, Kind> = {
    BoxGeometry: "box",
    SphereGeometry: "sphere",
    CylinderGeometry: "cylinder",
    ConeGeometry: "cone",
    TorusGeometry: "torus",
    TorusKnotGeometry: "torusKnot",
    PlaneGeometry: "plane",
    IcosahedronGeometry: "icosahedron",
    CapsuleGeometry: "capsule",
    RingGeometry: "ring",
    DodecahedronGeometry: "dodecahedron",
    TetrahedronGeometry: "tetrahedron",
  };
  return map[type] ?? "box";
}

export function runUserCode(code: string): CodeRunResult {
  const logs: string[] = [];
  const root = new THREE.Group();
  const fakeConsole = {
    log: (...a: unknown[]) => logs.push(a.map(String).join(" ")),
    warn: (...a: unknown[]) => logs.push("warn: " + a.map(String).join(" ")),
    error: (...a: unknown[]) => logs.push("error: " + a.map(String).join(" ")),
  };

  try {
    const fn = new Function(
      "THREE",
      "scene",
      "console",
      `"use strict";\n${code}\n;return typeof result !== "undefined" ? result : undefined;`,
    );
    const ret = fn(THREE, root, fakeConsole) as THREE.Object3D | THREE.Object3D[] | undefined;
    if (ret) {
      const list = Array.isArray(ret) ? ret : [ret];
      for (const o of list) {
        if (o && (o as THREE.Object3D).isObject3D && o.parent !== root) root.add(o);
      }
    }
  } catch (e) {
    return { objects: [], logs, error: e instanceof Error ? e.message : String(e) };
  }

  const objects = [...root.children];
  for (const o of objects) root.remove(o);
  return { objects, logs, error: null };
}
