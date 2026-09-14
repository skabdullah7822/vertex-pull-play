import * as THREE from "three";

export type MeshKind =
  | "box"
  | "sphere"
  | "cylinder"
  | "cone"
  | "torus"
  | "torusKnot"
  | "plane"
  | "icosahedron"
  | "capsule"
  | "ring"
  | "dodecahedron"
  | "tetrahedron";

export type LightKind = "directionalLight" | "pointLight" | "spotLight" | "ambientLight";

export type Kind = MeshKind | LightKind;

export interface GeometrySpec {
  label: string;
  create: () => THREE.BufferGeometry;
}

export const GEOMETRY_SPECS: Record<MeshKind, GeometrySpec> = {
  box: {
    label: "Cube",
    create: () => new THREE.BoxGeometry(1.5, 1.5, 1.5, 4, 4, 4),
  },
  sphere: {
    label: "Sphere",
    create: () => new THREE.SphereGeometry(1, 32, 24),
  },
  cylinder: {
    label: "Cylinder",
    create: () => new THREE.CylinderGeometry(0.8, 0.8, 1.8, 32, 8),
  },
  cone: {
    label: "Cone",
    create: () => new THREE.ConeGeometry(0.9, 1.8, 32, 8),
  },
  torus: {
    label: "Torus",
    create: () => new THREE.TorusGeometry(1, 0.35, 24, 48),
  },
  torusKnot: {
    label: "Torus Knot",
    create: () => new THREE.TorusKnotGeometry(0.8, 0.25, 64, 16),
  },
  plane: {
    label: "Plane",
    create: () => new THREE.PlaneGeometry(2, 2, 8, 8),
  },
  icosahedron: {
    label: "Icosahedron",
    create: () => new THREE.IcosahedronGeometry(1, 1),
  },
  capsule: {
    label: "Capsule",
    create: () => new THREE.CapsuleGeometry(0.6, 1, 16, 24),
  },
  ring: {
    label: "Ring",
    create: () => new THREE.RingGeometry(0.5, 1.2, 32),
  },
  dodecahedron: {
    label: "Dodecahedron",
    create: () => new THREE.DodecahedronGeometry(1, 0),
  },
  tetrahedron: {
    label: "Tetrahedron",
    create: () => new THREE.TetrahedronGeometry(1.2, 0),
  },
};

export function createGeometry(kind: MeshKind): THREE.BufferGeometry {
  const spec = GEOMETRY_SPECS[kind];
  if (spec) return spec.create();
  return new THREE.BoxGeometry(1, 1, 1);
}

export function isLight(kind: Kind): kind is LightKind {
  return (
    kind === "directionalLight" ||
    kind === "pointLight" ||
    kind === "spotLight" ||
    kind === "ambientLight"
  );
}

export function labelFor(kind: Kind): string {
  if (isLight(kind)) {
    switch (kind) {
      case "directionalLight":
        return "Directional Light";
      case "pointLight":
        return "Point Light";
      case "spotLight":
        return "Spot Light";
      case "ambientLight":
        return "Ambient Light";
    }
  }
  return GEOMETRY_SPECS[kind]?.label ?? kind;
}
