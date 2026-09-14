import * as THREE from "three";

/**
 * VertexEditor
 * Lets the user drop control points anywhere on a mesh surface and drag them.
 * Dragging a point pulls nearby vertices with a smooth falloff (soft selection),
 * so the mesh deforms organically.
 */

interface ControlPoint {
  /** position of the point in the mesh local space */
  local: THREE.Vector3;
  /** vertex index -> falloff weight */
  weights: Map<number, number>;
  marker: THREE.Mesh;
}

const POINT_COLOR = 0x38bdf8;
const POINT_ACTIVE = 0xf59e0b;

export class VertexEditor {
  public group: THREE.Group;
  public dragging = false;
  public enabled = false;

  private camera: THREE.Camera;
  private domElement: HTMLElement;
  private onTick: () => void;
  private onDragChange: (dragging: boolean) => void;
  private onCountChange: (n: number) => void;

  private mesh: THREE.Mesh | null = null;
  private basePositions: Float32Array | null = null;
  /** original geometry positions from the moment the mesh was first attached */
  private pristinePositions: Float32Array | null = null;
  /** welded groups: representative index -> all indices sharing that position */
  private weld: Map<number, number[]> = new Map();
  private vertexOf: number[] = [];

  private points: ControlPoint[] = [];
  private activeIndex = -1;

  private radius = 0.9;
  private strength = 1;

  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private dragPlane = new THREE.Plane();
  private dragStartLocal = new THREE.Vector3();
  private hitLocal = new THREE.Vector3();

  private markerGeom = new THREE.SphereGeometry(0.085, 18, 14);
  private ringGeom = new THREE.RingGeometry(0.1, 0.13, 24);

  private boundDown: (e: PointerEvent) => void;
  private boundMove: (e: PointerEvent) => void;
  private boundUp: () => void;

  constructor(
    camera: THREE.Camera,
    domElement: HTMLElement,
    onTick: () => void,
    onDragChange: (dragging: boolean) => void,
    onCountChange: (n: number) => void,
  ) {
    this.camera = camera;
    this.domElement = domElement;
    this.onTick = onTick;
    this.onDragChange = onDragChange;
    this.onCountChange = onCountChange;

    this.group = new THREE.Group();
    this.group.visible = false;

    this.boundDown = this.onPointerDown.bind(this);
    this.boundMove = this.onPointerMove.bind(this);
    this.boundUp = this.onPointerUp.bind(this);

    domElement.addEventListener("pointerdown", this.boundDown);
    window.addEventListener("pointermove", this.boundMove);
    window.addEventListener("pointerup", this.boundUp);
  }

  /* ------------------------------------------------ public api */

  public setEnabled(v: boolean) {
    this.enabled = v;
    this.group.visible = v && !!this.mesh && this.points.length > 0;
  }

  public setRadius(r: number) {
    this.radius = r;
  }

  public setStrength(s: number) {
    this.strength = s;
  }

  public getCount() {
    return this.points.length;
  }

  public attach(object: THREE.Object3D | null) {
    const mesh =
      object && (object as THREE.Mesh).isMesh && (object as THREE.Mesh).geometry
        ? (object as THREE.Mesh)
        : null;
    if (mesh === this.mesh) return;

    this.clearPoints();
    this.mesh = mesh;
    this.basePositions = null;
    this.pristinePositions = null;
    this.weld.clear();
    this.vertexOf = [];

    if (mesh) {
      const geo = mesh.geometry;
      // a shared geometry must never be deformed for every instance at once
      if (geo.userData["vertexEditOwned"] !== true) {
        const cloned = geo.clone();
        cloned.userData["vertexEditOwned"] = true;
        mesh.geometry = cloned;
      }
      const attr = mesh.geometry.getAttribute("position") as THREE.BufferAttribute;
      if (attr) {
        this.basePositions = new Float32Array(attr.array as ArrayLike<number>);
        this.pristinePositions = new Float32Array(attr.array as ArrayLike<number>);
        this.buildWeld(attr);
      }
    }
    this.group.visible = this.enabled && !!mesh && this.points.length > 0;
  }

  /** Adds a control point at a world-space point on the mesh surface. */
  public addPointAtWorld(world: THREE.Vector3): boolean {
    const mesh = this.mesh;
    const base = this.basePositions;
    if (!mesh || !base) return false;

    mesh.updateMatrixWorld(true);
    const local = world.clone().applyMatrix4(new THREE.Matrix4().copy(mesh.matrixWorld).invert());

    const weights = this.computeWeights(local);
    if (weights.size === 0) return false;

    const marker = new THREE.Mesh(
      this.markerGeom,
      new THREE.MeshBasicMaterial({ color: POINT_COLOR, depthTest: false }),
    );
    marker.renderOrder = 1000;
    marker.userData["pointIndex"] = this.points.length;

    const ring = new THREE.Mesh(
      this.ringGeom,
      new THREE.MeshBasicMaterial({
        color: POINT_COLOR,
        depthTest: false,
        transparent: true,
        opacity: 0.65,
        side: THREE.DoubleSide,
      }),
    );
    ring.renderOrder = 1000;
    ring.userData["isRing"] = true;
    marker.add(ring);

    this.group.add(marker);
    this.points.push({ local, weights, marker });
    this.group.visible = this.enabled;
    this.onCountChange(this.points.length);
    this.update();
    this.onTick();
    return true;
  }

  public clearPoints() {
    for (const p of this.points) {
      (p.marker.material as THREE.Material).dispose();
      p.marker.children.forEach((c) => {
        const m = (c as THREE.Mesh).material as THREE.Material | undefined;
        m?.dispose();
      });
      this.group.remove(p.marker);
    }
    this.points = [];
    this.activeIndex = -1;
    this.group.visible = false;
    this.onCountChange(0);
  }

  public removeLastPoint() {
    const p = this.points.pop();
    if (!p) return;
    (p.marker.material as THREE.Material).dispose();
    this.group.remove(p.marker);
    this.points.forEach((pt, i) => (pt.marker.userData["pointIndex"] = i));
    this.group.visible = this.enabled && this.points.length > 0;
    this.onCountChange(this.points.length);
    this.onTick();
  }

  /** Restores the mesh to the shape it had when it was first attached. */
  public resetShape() {
    const mesh = this.mesh;
    if (!mesh || !this.pristinePositions || !this.basePositions) return;
    const attr = mesh.geometry.getAttribute("position") as THREE.BufferAttribute;
    attr.array as Float32Array;
    (attr.array as Float32Array).set(this.pristinePositions);
    attr.needsUpdate = true;
    mesh.geometry.computeVertexNormals();
    mesh.geometry.computeBoundingSphere();
    this.basePositions.set(this.pristinePositions);
    // recompute point weights against the restored shape
    for (const p of this.points) p.weights = this.computeWeights(p.local);
    this.update();
    this.onTick();
  }

  public update() {
    const mesh = this.mesh;
    if (!mesh || !this.group.visible) return;
    const camPos = this.camera.getWorldPosition(new THREE.Vector3());
    for (const p of this.points) {
      const world = p.local.clone().applyMatrix4(mesh.matrixWorld);
      p.marker.position.copy(world);
      // keep markers a stable screen-ish size and rings facing the camera
      const dist = camPos.distanceTo(world);
      const s = THREE.MathUtils.clamp(dist * 0.14, 0.35, 3);
      p.marker.scale.setScalar(s);
      p.marker.children.forEach((c) => c.lookAt(camPos));
    }
  }

  public dispose() {
    this.domElement.removeEventListener("pointerdown", this.boundDown);
    window.removeEventListener("pointermove", this.boundMove);
    window.removeEventListener("pointerup", this.boundUp);
    this.clearPoints();
    this.markerGeom.dispose();
    this.ringGeom.dispose();
    this.group.clear();
  }

  /* ------------------------------------------------ internals */

  private buildWeld(attr: THREE.BufferAttribute) {
    const map = new Map<string, number>();
    this.weld.clear();
    this.vertexOf = new Array(attr.count);
    for (let i = 0; i < attr.count; i++) {
      const key =
        `${attr.getX(i).toFixed(4)}|${attr.getY(i).toFixed(4)}|${attr.getZ(i).toFixed(4)}`;
      const rep = map.get(key);
      if (rep === undefined) {
        map.set(key, i);
        this.weld.set(i, [i]);
        this.vertexOf[i] = i;
      } else {
        this.weld.get(rep)!.push(i);
        this.vertexOf[i] = rep;
      }
    }
  }

  /** radius falloff weights over welded representative vertices */
  private computeWeights(local: THREE.Vector3): Map<number, number> {
    const weights = new Map<number, number>();
    const base = this.basePositions;
    const mesh = this.mesh;
    if (!base || !mesh) return weights;

    // radius is given in world units; convert with the largest scale axis
    const s = Math.max(
      Math.abs(mesh.scale.x),
      Math.abs(mesh.scale.y),
      Math.abs(mesh.scale.z),
      1e-4,
    );
    const r = Math.max(this.radius / s, 1e-4);
    const v = new THREE.Vector3();

    let nearestRep = -1;
    let nearestDist = Infinity;

    for (const rep of this.weld.keys()) {
      v.set(base[rep * 3]!, base[rep * 3 + 1]!, base[rep * 3 + 2]!);
      const d = v.distanceTo(local);
      if (d < nearestDist) {
        nearestDist = d;
        nearestRep = rep;
      }
      if (d <= r) {
        const t = 1 - d / r;
        weights.set(rep, t * t * (3 - 2 * t)); // smoothstep falloff
      }
    }
    if (weights.size === 0 && nearestRep >= 0) weights.set(nearestRep, 1);
    return weights;
  }

  private setPointer(e: PointerEvent) {
    const rect = this.domElement.getBoundingClientRect();
    this.pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
  }

  private onPointerDown(e: PointerEvent) {
    if (!this.enabled || !this.mesh || e.button !== 0 || !this.points.length) return;
    this.setPointer(e);
    const hits = this.raycaster.intersectObjects(
      this.points.map((p) => p.marker),
      false,
    );
    if (!hits.length) return;

    let obj: THREE.Object3D | null = hits[0]!.object;
    while (obj && obj.userData["pointIndex"] === undefined) obj = obj.parent;
    const idx = obj?.userData["pointIndex"];
    if (typeof idx !== "number") return;

    this.activeIndex = idx;
    this.dragging = true;
    this.onDragChange(true);
    (this.points[idx]!.marker.material as THREE.MeshBasicMaterial).color.setHex(POINT_ACTIVE);

    const camDir = new THREE.Vector3();
    this.camera.getWorldDirection(camDir);
    this.dragPlane.setFromNormalAndCoplanarPoint(
      camDir.negate(),
      this.points[idx]!.marker.position.clone(),
    );
    const hit = new THREE.Vector3();
    if (this.raycaster.ray.intersectPlane(this.dragPlane, hit)) {
      this.dragStartLocal
        .copy(hit)
        .applyMatrix4(new THREE.Matrix4().copy(this.mesh.matrixWorld).invert());
    } else {
      this.dragStartLocal.copy(this.points[idx]!.local);
    }
    e.stopPropagation();
  }

  private onPointerMove(e: PointerEvent) {
    if (!this.dragging || this.activeIndex < 0 || !this.mesh || !this.basePositions) return;
    this.setPointer(e);
    const hit = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(this.dragPlane, hit)) return;

    this.hitLocal
      .copy(hit)
      .applyMatrix4(new THREE.Matrix4().copy(this.mesh.matrixWorld).invert());
    const delta = this.hitLocal.clone().sub(this.dragStartLocal).multiplyScalar(this.strength);

    const pt = this.points[this.activeIndex]!;
    const attr = this.mesh.geometry.getAttribute("position") as THREE.BufferAttribute;
    const base = this.basePositions;

    for (const [rep, w] of pt.weights) {
      const nx = base[rep * 3]! + delta.x * w;
      const ny = base[rep * 3 + 1]! + delta.y * w;
      const nz = base[rep * 3 + 2]! + delta.z * w;
      for (const i of this.weld.get(rep)!) attr.setXYZ(i, nx, ny, nz);
    }
    attr.needsUpdate = true;
    this.mesh.geometry.computeVertexNormals();
    this.mesh.geometry.computeBoundingSphere();
    this.mesh.userData["deformed"] = true;

    // drag the marker itself, plus any other marker inside the affected area
    pt.local.copy(pt.dragOrigin ?? pt.local);
    this.moveMarkers(delta);
    this.update();
    this.onTick();
  }

  /** stored drag origins so repeated move events stay absolute, not cumulative */
  private dragOrigins: THREE.Vector3[] = [];

  private moveMarkers(delta: THREE.Vector3) {
    if (!this.dragOrigins.length) return;
    const active = this.points[this.activeIndex];
    this.points.forEach((p, i) => {
      const origin = this.dragOrigins[i];
      if (!origin) return;
      if (p === active) {
        p.local.copy(origin).add(delta);
      } else {
        // other points follow the surface deformation with their own falloff
        const w = active?.weights.get(this.nearestRep(origin)) ?? 0;
        p.local.copy(origin).addScaledVector(delta, w);
      }
    });
  }

  private nearestRep(local: THREE.Vector3): number {
    const base = this.basePositions;
    if (!base) return -1;
    let best = -1;
    let bestD = Infinity;
    const v = new THREE.Vector3();
    for (const rep of this.weld.keys()) {
      v.set(base[rep * 3]!, base[rep * 3 + 1]!, base[rep * 3 + 2]!);
      const d = v.distanceToSquared(local);
      if (d < bestD) {
        bestD = d;
        best = rep;
      }
    }
    return best;
  }

  private onPointerUp() {
    if (!this.dragging) return;
    const pt = this.points[this.activeIndex];
    if (pt) (pt.marker.material as THREE.MeshBasicMaterial).color.setHex(POINT_COLOR);
    this.dragging = false;
    this.activeIndex = -1;
    this.dragOrigins = [];

    // bake the new shape as the base for the next drag
    if (this.mesh && this.basePositions) {
      const attr = this.mesh.geometry.getAttribute("position") as THREE.BufferAttribute;
      this.basePositions.set(attr.array as Float32Array);
      for (const p of this.points) p.weights = this.computeWeights(p.local);
    }
    this.onDragChange(false);
    this.onTick();
  }
}
