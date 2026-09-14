import * as THREE from "three";
import { createGeometry, isLight, type Kind } from "./geometry";

/**
 * Snapshot based undo / redo.
 * Every committed edit stores a full description of the scene, so undo can
 * restore deleted objects, transforms, materials and sculpted geometry alike.
 */

export interface ObjSnap {
  id: string;
  name: string;
  kind: Kind;
  pos: [number, number, number];
  rot: [number, number, number];
  scale: [number, number, number];
  visible: boolean;
  solid: boolean;
  deformed: boolean;
  /** material */
  color?: number;
  metalness?: number;
  roughness?: number;
  wireframe?: boolean;
  flatShading?: boolean;
  opacity?: number;
  transparent?: boolean;
  /** lights */
  intensity?: number;
  distance?: number;
  angle?: number;
  /** custom / sculpted geometry */
  positions?: number[];
  index?: number[];
}

export interface Snapshot {
  items: { id: string; name: string; kind: Kind }[];
  objects: ObjSnap[];
  selected: string | null;
}

function snapObject(
  id: string,
  name: string,
  kind: Kind,
  obj: THREE.Object3D,
): ObjSnap {
  const s: ObjSnap = {
    id,
    name,
    kind,
    pos: [obj.position.x, obj.position.y, obj.position.z],
    rot: [obj.rotation.x, obj.rotation.y, obj.rotation.z],
    scale: [obj.scale.x, obj.scale.y, obj.scale.z],
    visible: obj.visible,
    solid: obj.userData["solid"] === true,
    deformed: obj.userData["deformed"] === true,
  };

  const light = obj as THREE.Light & { distance?: number; angle?: number };
  if (light.isLight) {
    s.intensity = light.intensity;
    s.color = light.color?.getHex();
    if (typeof light.distance === "number") s.distance = light.distance;
    if (typeof light.angle === "number") s.angle = light.angle;
    return s;
  }

  const mesh = obj as THREE.Mesh;
  const mat = mesh.material as THREE.MeshStandardMaterial | undefined;
  if (mat) {
    s.color = mat.color?.getHex();
    s.metalness = mat.metalness;
    s.roughness = mat.roughness;
    s.wireframe = mat.wireframe;
    s.flatShading = mat.flatShading;
    s.opacity = mat.opacity;
    s.transparent = mat.transparent;
  }
  const geo = mesh.geometry;
  if (geo) {
    const custom =
      s.deformed || geo.userData["vertexEditOwned"] === true || geo.userData["custom"] === true;
    if (custom) {
      const p = geo.getAttribute("position") as THREE.BufferAttribute | undefined;
      if (p) s.positions = Array.from(p.array as ArrayLike<number>);
      const idx = geo.getIndex();
      if (idx) s.index = Array.from(idx.array as ArrayLike<number>);
    }
  }
  return s;
}

export function captureSnapshot(
  items: { id: string; name: string; kind: Kind }[],
  objects: Map<string, THREE.Object3D>,
  selected: string | null,
): Snapshot {
  const objs: ObjSnap[] = [];
  for (const it of items) {
    const obj = objects.get(it.id);
    if (obj) objs.push(snapObject(it.id, it.name, it.kind, obj));
  }
  return { items: items.map((i) => ({ ...i })), objects: objs, selected };
}

function buildFromSnap(s: ObjSnap): THREE.Object3D {
  if (isLight(s.kind)) {
    let l: THREE.Light;
    if (s.kind === "ambientLight") l = new THREE.AmbientLight(s.color ?? 0xffffff, s.intensity ?? 0.4);
    else if (s.kind === "directionalLight")
      l = new THREE.DirectionalLight(s.color ?? 0xffffff, s.intensity ?? 2.2);
    else if (s.kind === "pointLight")
      l = new THREE.PointLight(s.color ?? 0xffe6b0, s.intensity ?? 12, s.distance ?? 0, 2);
    else
      l = new THREE.SpotLight(
        s.color ?? 0xffffff,
        s.intensity ?? 25,
        s.distance ?? 0,
        s.angle ?? Math.PI / 6,
        0.35,
      );
    if (s.kind !== "ambientLight") l.castShadow = true;
    l.userData["kind"] = s.kind;
    return l;
  }

  let geo: THREE.BufferGeometry;
  if (s.positions && s.positions.length) {
    geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(s.positions, 3));
    if (s.index && s.index.length) geo.setIndex(s.index);
    geo.computeVertexNormals();
    geo.userData["vertexEditOwned"] = true;
    geo.userData["custom"] = true;
  } else {
    geo = createGeometry(s.kind as Exclude<Kind, never>);
  }
  const mesh = new THREE.Mesh(
    geo,
    new THREE.MeshStandardMaterial({
      color: s.color ?? 0xb9bec7,
      metalness: s.metalness ?? 0.1,
      roughness: s.roughness ?? 0.55,
      side: THREE.DoubleSide,
    }),
  );
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData["kind"] = s.kind;
  return mesh;
}

function applySnap(obj: THREE.Object3D, s: ObjSnap) {
  obj.position.set(s.pos[0], s.pos[1], s.pos[2]);
  obj.rotation.set(s.rot[0], s.rot[1], s.rot[2]);
  obj.scale.set(s.scale[0], s.scale[1], s.scale[2]);
  obj.visible = s.visible;
  obj.userData["kind"] = s.kind;
  obj.userData["solid"] = s.solid;
  obj.userData["deformed"] = s.deformed;

  const light = obj as THREE.Light & { distance?: number; angle?: number };
  if (light.isLight) {
    if (s.intensity !== undefined) light.intensity = s.intensity;
    if (s.color !== undefined) light.color?.setHex(s.color);
    if (s.distance !== undefined && typeof light.distance === "number") light.distance = s.distance;
    if (s.angle !== undefined && typeof light.angle === "number") light.angle = s.angle;
    return;
  }

  const mesh = obj as THREE.Mesh;
  const mat = mesh.material as THREE.MeshStandardMaterial | undefined;
  if (mat) {
    if (s.color !== undefined) mat.color.setHex(s.color);
    if (s.metalness !== undefined) mat.metalness = s.metalness;
    if (s.roughness !== undefined) mat.roughness = s.roughness;
    if (s.wireframe !== undefined) mat.wireframe = s.wireframe;
    if (s.flatShading !== undefined) mat.flatShading = s.flatShading;
    if (s.opacity !== undefined) mat.opacity = s.opacity;
    if (s.transparent !== undefined) mat.transparent = s.transparent;
    mat.needsUpdate = true;
  }

  if (s.positions && s.positions.length && mesh.geometry) {
    const attr = mesh.geometry.getAttribute("position") as THREE.BufferAttribute | undefined;
    if (attr && attr.count * 3 === s.positions.length) {
      (attr.array as Float32Array).set(s.positions);
      attr.needsUpdate = true;
    } else {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(s.positions, 3));
      if (s.index && s.index.length) geo.setIndex(s.index);
      geo.userData["vertexEditOwned"] = true;
      geo.userData["custom"] = true;
      mesh.geometry.dispose();
      mesh.geometry = geo;
    }
    mesh.geometry.computeVertexNormals();
    mesh.geometry.computeBoundingSphere();
    mesh.geometry.computeBoundingBox();
  }
}

/** Rebuilds the scene so it matches the snapshot. Returns the outliner items. */
export function restoreSnapshot(
  snap: Snapshot,
  scene: THREE.Scene,
  objects: Map<string, THREE.Object3D>,
) {
  const keep = new Set(snap.objects.map((o) => o.id));
  for (const [id, obj] of [...objects.entries()]) {
    if (keep.has(id)) continue;
    scene.remove(obj);
    const mesh = obj as THREE.Mesh;
    mesh.geometry?.dispose?.();
    (mesh.material as THREE.Material | undefined)?.dispose?.();
    objects.delete(id);
  }
  for (const s of snap.objects) {
    let obj = objects.get(s.id);
    if (!obj) {
      obj = buildFromSnap(s);
      objects.set(s.id, obj);
      scene.add(obj);
    }
    applySnap(obj, s);
  }
  return snap.items.map((i) => ({ ...i }));
}

export class HistoryStack {
  private past: Snapshot[] = [];
  private future: Snapshot[] = [];
  private present: Snapshot | null = null;
  private limit = 60;

  public reset(s: Snapshot) {
    this.past = [];
    this.future = [];
    this.present = s;
  }

  public commit(s: Snapshot) {
    if (this.present) {
      this.past.push(this.present);
      if (this.past.length > this.limit) this.past.shift();
    }
    this.present = s;
    this.future = [];
  }

  public undo(): Snapshot | null {
    const prev = this.past.pop();
    if (!prev) return null;
    if (this.present) this.future.unshift(this.present);
    this.present = prev;
    return prev;
  }

  public redo(): Snapshot | null {
    const next = this.future.shift();
    if (!next) return null;
    if (this.present) this.past.push(this.present);
    this.present = next;
    return next;
  }

  public get canUndo() {
    return this.past.length > 0;
  }
  public get canRedo() {
    return this.future.length > 0;
  }
}
