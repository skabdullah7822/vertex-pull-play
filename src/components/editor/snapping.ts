import * as THREE from "three";

export function hitsSolid(obj: THREE.Object3D, solids: THREE.Object3D[]): boolean {
  if (!solids.length) return false;
  const boxObj = new THREE.Box3().setFromObject(obj);

  // Slightly shrink box to prevent false positives when resting surface-to-surface
  boxObj.min.addScalar(0.01);
  boxObj.max.subScalar(0.01);

  for (const solid of solids) {
    if (solid === obj) continue;
    const boxSolid = new THREE.Box3().setFromObject(solid);
    if (boxObj.intersectsBox(boxSolid)) {
      return true;
    }
  }
  return false;
}

type Axis = "x" | "y" | "z";

interface Candidate {
  /** how far the object has to move on this axis */
  delta: number;
  /** absolute distance, used to pick the best candidate */
  dist: number;
  /** world coordinate the object snapped to */
  at: number;
  label: string;
}

const GUIDE_COLORS: Record<Axis, number> = {
  x: 0xf87171,
  y: 0x4ade80,
  z: 0x60a5fa,
};

/**
 * Blender-like magnetic snapping.
 * Checks every axis independently against the centers, edges and faces of the
 * other objects, plus the ground plane and the grid, and draws a dashed guide
 * for each axis that actually snapped.
 */
export class SnapGuides {
  public group: THREE.Group;
  /** short human readable description of the last snap, for the HUD */
  public info: string[] = [];

  private lines: Record<Axis, THREE.Line>;
  private threshold = 0.22;
  private gridStep = 0.5;
  private gridEnabled = true;

  constructor() {
    this.group = new THREE.Group();
    this.group.renderOrder = 1000;
    this.lines = {
      x: this.makeLine("x"),
      y: this.makeLine("y"),
      z: this.makeLine("z"),
    };
    (Object.keys(this.lines) as Axis[]).forEach((a) => this.group.add(this.lines[a]));
  }

  private makeLine(axis: Axis) {
    const geom = new THREE.BufferGeometry();
    geom.setAttribute("position", new THREE.BufferAttribute(new Float32Array(6), 3));
    const mat = new THREE.LineDashedMaterial({
      color: GUIDE_COLORS[axis],
      dashSize: 0.25,
      gapSize: 0.14,
      depthTest: false,
      transparent: true,
      opacity: 0.95,
    });
    const line = new THREE.Line(geom, mat);
    line.visible = false;
    line.renderOrder = 1001;
    line.frustumCulled = false;
    return line;
  }

  public setGridSnap(on: boolean) {
    this.gridEnabled = on;
  }

  public setThreshold(t: number) {
    this.threshold = t;
  }

  public clear() {
    (Object.keys(this.lines) as Axis[]).forEach((a) => (this.lines[a].visible = false));
    this.info = [];
  }

  private showGuide(axis: Axis, from: THREE.Vector3, to: THREE.Vector3) {
    const line = this.lines[axis];
    const attr = line.geometry.getAttribute("position") as THREE.BufferAttribute;
    attr.setXYZ(0, from.x, from.y, from.z);
    attr.setXYZ(1, to.x, to.y, to.z);
    attr.needsUpdate = true;
    line.geometry.computeBoundingSphere();
    line.computeLineDistances();
    line.visible = true;
  }

  public apply(currentObj: THREE.Object3D, others: THREE.Object3D[]) {
    this.clear();

    const box = new THREE.Box3().setFromObject(currentObj);
    if (box.isEmpty()) return;
    const center = box.getCenter(new THREE.Vector3());

    const axes: Axis[] = ["x", "y", "z"];
    const otherBoxes = others
      .map((o) => {
        const b = new THREE.Box3().setFromObject(o);
        return b.isEmpty() ? null : { box: b, center: b.getCenter(new THREE.Vector3()) };
      })
      .filter(Boolean) as { box: THREE.Box3; center: THREE.Vector3 }[];

    for (const axis of axes) {
      const candidates: Candidate[] = [];
      const cur = { min: box.min[axis], max: box.max[axis], mid: center[axis] };

      const push = (target: number, from: number, label: string) => {
        const delta = target - from;
        const dist = Math.abs(delta);
        if (dist <= this.threshold) candidates.push({ delta, dist, at: target, label });
      };

      for (const o of otherBoxes) {
        const oMin = o.box.min[axis];
        const oMax = o.box.max[axis];
        const oMid = o.center[axis];
        push(oMid, cur.mid, "center");
        push(oMin, cur.min, "edge");
        push(oMax, cur.max, "edge");
        // stacking: our bottom/near face against their top/far face
        push(oMax, cur.min, "surface");
        push(oMin, cur.max, "surface");
      }

      // ground plane / world origin
      if (axis === "y") push(0, cur.min, "ground");
      else push(0, cur.mid, "origin");

      // grid increments
      if (this.gridEnabled) {
        const g = this.gridStep;
        push(Math.round(cur.mid / g) * g, cur.mid, "grid");
      }

      if (!candidates.length) continue;
      candidates.sort((a, b) => a.dist - b.dist);
      const best = candidates[0]!;
      currentObj.position[axis] += best.delta;
      center[axis] += best.delta;
      box.min[axis] += best.delta;
      box.max[axis] += best.delta;
      this.info.push(`${axis.toUpperCase()} ${best.label}`);

      const span = 6;
      const from = center.clone();
      const to = center.clone();
      if (axis === "x") {
        from.y -= span;
        to.y += span;
      } else if (axis === "y") {
        from.x -= span;
        to.x += span;
      } else {
        from.y -= span;
        to.y += span;
      }
      if (axis === "z") {
        from.x -= span * 0.4;
        to.x += span * 0.4;
      }
      this.showGuide(axis, from, to);
    }
  }

  /** Rotation snapping in fixed angle steps (Blender style). */
  public snapRotation(obj: THREE.Object3D, stepDeg = 15) {
    const step = THREE.MathUtils.degToRad(stepDeg);
    obj.rotation.x = Math.round(obj.rotation.x / step) * step;
    obj.rotation.y = Math.round(obj.rotation.y / step) * step;
    obj.rotation.z = Math.round(obj.rotation.z / step) * step;
  }

  /** Scale snapping to clean increments. */
  public snapScale(obj: THREE.Object3D, step = 0.1) {
    obj.scale.x = Math.max(0.001, Math.round(obj.scale.x / step) * step);
    obj.scale.y = Math.max(0.001, Math.round(obj.scale.y / step) * step);
    obj.scale.z = Math.max(0.001, Math.round(obj.scale.z / step) * step);
  }

  public dispose() {
    (Object.keys(this.lines) as Axis[]).forEach((a) => {
      this.lines[a].geometry.dispose();
      (this.lines[a].material as THREE.Material).dispose();
    });
    this.group.clear();
  }
}
