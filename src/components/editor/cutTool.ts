import * as THREE from "three";

/**
 * CutTool
 * The user clicks points in the viewport (4 by default, more allowed).
 * The area enclosed by the points is filled with a colourful translucent
 * surface, each point can be dragged, and alignment guides show when the
 * points line up on an axis or lie on a straight line.
 * Applying the cut slices the target mesh along the plane of those points.
 */

const POINT_COLOR = 0x22d3ee;
const POINT_ACTIVE = 0xf59e0b;
const ALIGN_TOL = 0.06;

interface CutPoint {
  world: THREE.Vector3;
  marker: THREE.Mesh;
}

export interface CutStatus {
  count: number;
  /** human readable alignment hints, e.g. "P1-P3 X aligned" */
  aligned: string[];
  /** true when every point sits on one flat plane */
  planar: boolean;
}

export class CutTool {
  public group: THREE.Group;
  public dragging = false;
  public enabled = false;

  private camera: THREE.Camera;
  private domElement: HTMLElement;
  private onTick: () => void;
  private onDragChange: (d: boolean) => void;
  private onStatus: (s: CutStatus) => void;

  private points: CutPoint[] = [];
  private activeIndex = -1;

  private fill: THREE.Mesh;
  private outline: THREE.LineLoop;
  private guides: THREE.Group;

  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private dragPlane = new THREE.Plane();

  private markerGeom = new THREE.SphereGeometry(0.09, 18, 14);

  private boundDown: (e: PointerEvent) => void;
  private boundMove: (e: PointerEvent) => void;
  private boundUp: () => void;

  constructor(
    camera: THREE.Camera,
    domElement: HTMLElement,
    onTick: () => void,
    onDragChange: (d: boolean) => void,
    onStatus: (s: CutStatus) => void,
  ) {
    this.camera = camera;
    this.domElement = domElement;
    this.onTick = onTick;
    this.onDragChange = onDragChange;
    this.onStatus = onStatus;

    this.group = new THREE.Group();
    this.group.visible = false;

    const fillGeom = new THREE.BufferGeometry();
    fillGeom.setAttribute("position", new THREE.BufferAttribute(new Float32Array(0), 3));
    fillGeom.setAttribute("color", new THREE.BufferAttribute(new Float32Array(0), 3));
    this.fill = new THREE.Mesh(
      fillGeom,
      new THREE.MeshBasicMaterial({
        vertexColors: true,
        transparent: true,
        opacity: 0.45,
        side: THREE.DoubleSide,
        depthTest: false,
        depthWrite: false,
      }),
    );
    this.fill.renderOrder = 998;
    this.fill.frustumCulled = false;
    this.group.add(this.fill);

    const outlineGeom = new THREE.BufferGeometry();
    outlineGeom.setAttribute("position", new THREE.BufferAttribute(new Float32Array(0), 3));
    this.outline = new THREE.LineLoop(
      outlineGeom,
      new THREE.LineBasicMaterial({ color: 0x22d3ee, depthTest: false, transparent: true }),
    );
    this.outline.renderOrder = 999;
    this.outline.frustumCulled = false;
    this.group.add(this.outline);

    this.guides = new THREE.Group();
    this.group.add(this.guides);

    this.boundDown = this.onPointerDown.bind(this);
    this.boundMove = this.onPointerMove.bind(this);
    this.boundUp = this.onPointerUp.bind(this);
    domElement.addEventListener("pointerdown", this.boundDown);
    window.addEventListener("pointermove", this.boundMove);
    window.addEventListener("pointerup", this.boundUp);
  }

  /* ---------------------------------------------- public api */

  public setEnabled(v: boolean) {
    this.enabled = v;
    this.group.visible = v && this.points.length > 0;
    this.onTick();
  }

  public getCount() {
    return this.points.length;
  }

  public getPoints() {
    return this.points.map((p) => p.world.clone());
  }

  public addPoint(world: THREE.Vector3) {
    const marker = new THREE.Mesh(
      this.markerGeom,
      new THREE.MeshBasicMaterial({ color: POINT_COLOR, depthTest: false }),
    );
    marker.renderOrder = 1000;
    marker.position.copy(world);
    marker.userData["cutIndex"] = this.points.length;
    this.group.add(marker);
    this.points.push({ world: world.clone(), marker });
    this.group.visible = this.enabled;
    this.rebuild();
  }

  public removeLast() {
    const p = this.points.pop();
    if (!p) return;
    (p.marker.material as THREE.Material).dispose();
    this.group.remove(p.marker);
    this.points.forEach((pt, i) => (pt.marker.userData["cutIndex"] = i));
    this.group.visible = this.enabled && this.points.length > 0;
    this.rebuild();
  }

  public clear() {
    for (const p of this.points) {
      (p.marker.material as THREE.Material).dispose();
      this.group.remove(p.marker);
    }
    this.points = [];
    this.activeIndex = -1;
    this.group.visible = false;
    this.rebuild();
  }

  /** Snaps every point onto its own best fit plane so the region is perfectly flat. */
  public flatten() {
    const plane = this.getPlane();
    if (!plane) return;
    for (const p of this.points) {
      plane.projectPoint(p.world, p.world);
      p.marker.position.copy(p.world);
    }
    this.rebuild();
  }

  /** Best fit plane through the placed points (Newell's method). */
  public getPlane(): THREE.Plane | null {
    if (this.points.length < 3) return null;
    const normal = new THREE.Vector3();
    const centroid = new THREE.Vector3();
    const n = this.points.length;
    for (let i = 0; i < n; i++) {
      const cur = this.points[i]!.world;
      const nxt = this.points[(i + 1) % n]!.world;
      normal.x += (cur.y - nxt.y) * (cur.z + nxt.z);
      normal.y += (cur.z - nxt.z) * (cur.x + nxt.x);
      normal.z += (cur.x - nxt.x) * (cur.y + nxt.y);
      centroid.add(cur);
    }
    if (normal.lengthSq() < 1e-10) return null;
    normal.normalize();
    centroid.multiplyScalar(1 / n);
    return new THREE.Plane().setFromNormalAndCoplanarPoint(normal, centroid);
  }

  public update() {
    if (!this.group.visible) return;
    const camPos = this.camera.getWorldPosition(new THREE.Vector3());
    for (const p of this.points) {
      const d = camPos.distanceTo(p.world);
      p.marker.scale.setScalar(THREE.MathUtils.clamp(d * 0.12, 0.35, 3));
    }
  }

  public dispose() {
    this.domElement.removeEventListener("pointerdown", this.boundDown);
    window.removeEventListener("pointermove", this.boundMove);
    window.removeEventListener("pointerup", this.boundUp);
    this.clear();
    this.markerGeom.dispose();
    this.fill.geometry.dispose();
    (this.fill.material as THREE.Material).dispose();
    this.outline.geometry.dispose();
    (this.outline.material as THREE.Material).dispose();
    this.clearGuides();
    this.group.clear();
  }

  /* ---------------------------------------------- internals */

  private clearGuides() {
    for (const c of [...this.guides.children]) {
      const l = c as THREE.Line;
      l.geometry.dispose();
      (l.material as THREE.Material).dispose();
    }
    this.guides.clear();
  }

  private rebuild() {
    this.buildFill();
    this.buildGuides();
    this.onStatus(this.status());
    this.onTick();
  }

  private status(): CutStatus {
    return {
      count: this.points.length,
      aligned: this.alignments().map((a) => a.label),
      planar: this.isPlanar(),
    };
  }

  private isPlanar() {
    const plane = this.getPlane();
    if (!plane) return false;
    return this.points.every((p) => Math.abs(plane.distanceToPoint(p.world)) < 0.02);
  }

  private alignments() {
    const out: { label: string; a: THREE.Vector3; b: THREE.Vector3; color: number }[] = [];
    const axes: ("x" | "y" | "z")[] = ["x", "y", "z"];
    const colors = { x: 0xf87171, y: 0x4ade80, z: 0x60a5fa };
    for (let i = 0; i < this.points.length; i++) {
      for (let j = i + 1; j < this.points.length; j++) {
        const a = this.points[i]!.world;
        const b = this.points[j]!.world;
        for (const ax of axes) {
          const others = axes.filter((o) => o !== ax);
          // aligned along `ax` means the two other coordinates match
          if (others.every((o) => Math.abs(a[o] - b[o]) < ALIGN_TOL)) {
            out.push({
              label: `P${i + 1}-P${j + 1} straight on ${ax.toUpperCase()}`,
              a,
              b,
              color: colors[ax],
            });
          }
        }
      }
    }
    // collinearity of consecutive triples
    for (let i = 0; i + 2 < this.points.length; i++) {
      const a = this.points[i]!.world;
      const b = this.points[i + 1]!.world;
      const c = this.points[i + 2]!.world;
      const ab = b.clone().sub(a);
      const ac = c.clone().sub(a);
      if (ab.lengthSq() < 1e-8 || ac.lengthSq() < 1e-8) continue;
      const cross = ab.clone().cross(ac).length() / Math.max(ab.length(), 1e-6);
      if (cross < ALIGN_TOL * 2) {
        out.push({
          label: `P${i + 1}-P${i + 3} in one line`,
          a,
          b: c,
          color: 0xfacc15,
        });
      }
    }
    return out;
  }

  private buildGuides() {
    this.clearGuides();
    if (this.points.length < 2) return;
    for (const g of this.alignments()) {
      const dir = g.b.clone().sub(g.a);
      if (dir.lengthSq() < 1e-8) continue;
      dir.normalize();
      const from = g.a.clone().addScaledVector(dir, -2.5);
      const to = g.b.clone().addScaledVector(dir, 2.5);
      const geom = new THREE.BufferGeometry().setFromPoints([from, to]);
      const line = new THREE.Line(
        geom,
        new THREE.LineDashedMaterial({
          color: g.color,
          dashSize: 0.18,
          gapSize: 0.12,
          depthTest: false,
          transparent: true,
          opacity: 0.9,
        }),
      );
      line.computeLineDistances();
      line.renderOrder = 1001;
      line.frustumCulled = false;
      this.guides.add(line);
    }
  }

  private buildFill() {
    const n = this.points.length;
    const fillGeom = this.fill.geometry;
    const outGeom = this.outline.geometry;

    // outline follows every point
    const outPos = new Float32Array(n * 3);
    this.points.forEach((p, i) => {
      outPos[i * 3] = p.world.x;
      outPos[i * 3 + 1] = p.world.y;
      outPos[i * 3 + 2] = p.world.z;
    });
    outGeom.setAttribute("position", new THREE.BufferAttribute(outPos, 3));
    outGeom.computeBoundingSphere();
    this.outline.visible = n > 1;

    if (n < 3) {
      fillGeom.setAttribute("position", new THREE.BufferAttribute(new Float32Array(0), 3));
      fillGeom.setAttribute("color", new THREE.BufferAttribute(new Float32Array(0), 3));
      this.fill.visible = false;
      return;
    }

    // triangle fan from the centroid, coloured as a rainbow gradient
    const centroid = new THREE.Vector3();
    this.points.forEach((p) => centroid.add(p.world));
    centroid.multiplyScalar(1 / n);

    const tri = n; // one triangle per edge
    const pos = new Float32Array(tri * 9);
    const col = new Float32Array(tri * 9);
    const cCol = new THREE.Color(0xffffff);
    for (let i = 0; i < n; i++) {
      const a = this.points[i]!.world;
      const b = this.points[(i + 1) % n]!.world;
      const ca = new THREE.Color().setHSL(i / n, 0.85, 0.6);
      const cb = new THREE.Color().setHSL(((i + 1) % n) / n, 0.85, 0.6);
      const o = i * 9;
      pos.set([centroid.x, centroid.y, centroid.z, a.x, a.y, a.z, b.x, b.y, b.z], o);
      col.set([cCol.r, cCol.g, cCol.b, ca.r, ca.g, ca.b, cb.r, cb.g, cb.b], o);
    }
    fillGeom.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    fillGeom.setAttribute("color", new THREE.BufferAttribute(col, 3));
    fillGeom.computeVertexNormals();
    fillGeom.computeBoundingSphere();
    this.fill.visible = true;
  }

  private setPointer(e: PointerEvent) {
    const rect = this.domElement.getBoundingClientRect();
    this.pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
  }

  private onPointerDown(e: PointerEvent) {
    if (!this.enabled || e.button !== 0 || !this.points.length) return;
    this.setPointer(e);
    const hits = this.raycaster.intersectObjects(
      this.points.map((p) => p.marker),
      false,
    );
    if (!hits.length) return;
    const idx = hits[0]!.object.userData["cutIndex"];
    if (typeof idx !== "number") return;

    this.activeIndex = idx;
    this.dragging = true;
    this.onDragChange(true);
    (this.points[idx]!.marker.material as THREE.MeshBasicMaterial).color.setHex(POINT_ACTIVE);

    const camDir = new THREE.Vector3();
    this.camera.getWorldDirection(camDir);
    this.dragPlane.setFromNormalAndCoplanarPoint(camDir.negate(), this.points[idx]!.world.clone());
    e.stopPropagation();
  }

  private onPointerMove(e: PointerEvent) {
    if (!this.dragging || this.activeIndex < 0) return;
    this.setPointer(e);
    const hit = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(this.dragPlane, hit)) return;

    const p = this.points[this.activeIndex]!;
    // magnetic alignment with the other points, Blender style
    for (const ax of ["x", "y", "z"] as const) {
      let best = Infinity;
      let val = hit[ax];
      this.points.forEach((other, i) => {
        if (i === this.activeIndex) return;
        const d = Math.abs(other.world[ax] - hit[ax]);
        if (d < ALIGN_TOL && d < best) {
          best = d;
          val = other.world[ax];
        }
      });
      hit[ax] = val;
    }

    p.world.copy(hit);
    p.marker.position.copy(hit);
    this.rebuild();
  }

  private onPointerUp() {
    if (!this.dragging) return;
    const p = this.points[this.activeIndex];
    if (p) (p.marker.material as THREE.MeshBasicMaterial).color.setHex(POINT_COLOR);
    this.dragging = false;
    this.activeIndex = -1;
    this.onDragChange(false);
    this.rebuild();
  }
}

/* ------------------------------------------------ mesh slicing */

function clipPolygon(poly: THREE.Vector3[], plane: THREE.Plane, keepPositive: boolean) {
  const out: THREE.Vector3[] = [];
  const sgn = keepPositive ? 1 : -1;
  for (let i = 0; i < poly.length; i++) {
    const cur = poly[i]!;
    const nxt = poly[(i + 1) % poly.length]!;
    const dc = plane.distanceToPoint(cur) * sgn;
    const dn = plane.distanceToPoint(nxt) * sgn;
    if (dc >= 0) out.push(cur.clone());
    if ((dc > 0 && dn < 0) || (dc < 0 && dn > 0)) {
      const t = dc / (dc - dn);
      out.push(cur.clone().lerp(nxt, t));
    }
  }
  return out;
}

/**
 * Splits a mesh geometry with a plane given in the mesh's local space.
 * Returns two position arrays (positive and negative half), or null when the
 * plane misses the mesh entirely.
 */
export function sliceGeometry(
  geo: THREE.BufferGeometry,
  planeLocal: THREE.Plane,
): { a: Float32Array; b: Float32Array } | null {
  const src = geo.index ? geo.toNonIndexed() : geo;
  const pos = src.getAttribute("position") as THREE.BufferAttribute | undefined;
  if (!pos) return null;

  const sideA: number[] = [];
  const sideB: number[] = [];
  const v = (i: number) => new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i));

  for (let i = 0; i < pos.count; i += 3) {
    const tri = [v(i), v(i + 1), v(i + 2)];
    for (const [keep, sink] of [
      [true, sideA],
      [false, sideB],
    ] as [boolean, number[]][]) {
      const clipped = clipPolygon(tri, planeLocal, keep);
      for (let k = 1; k + 1 < clipped.length; k++) {
        const p0 = clipped[0]!;
        const p1 = clipped[k]!;
        const p2 = clipped[k + 1]!;
        sink.push(p0.x, p0.y, p0.z, p1.x, p1.y, p1.z, p2.x, p2.y, p2.z);
      }
    }
  }
  if (src !== geo) src.dispose();
  if (!sideA.length || !sideB.length) return null;
  return { a: new Float32Array(sideA), b: new Float32Array(sideB) };
}
