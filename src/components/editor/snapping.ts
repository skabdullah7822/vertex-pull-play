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

export class SnapGuides {
  public group: THREE.Group;
  private lineMat: THREE.LineDashedMaterial;
  private lineGeom: THREE.BufferGeometry;
  private line: THREE.Line;
  private snapThreshold = 0.25;

  constructor() {
    this.group = new THREE.Group();
    this.lineGeom = new THREE.BufferGeometry();
    const positions = new Float32Array(6);
    this.lineGeom.setAttribute("position", new THREE.BufferAttribute(positions, 3));

    this.lineMat = new THREE.LineDashedMaterial({
      color: 0x38bdf8,
      dashSize: 0.2,
      gapSize: 0.1,
      depthTest: false,
    });

    this.line = new THREE.Line(this.lineGeom, this.lineMat);
    this.line.visible = false;
    this.line.renderOrder = 1000;
    this.group.add(this.line);
  }

  public clear() {
    this.line.visible = false;
  }

  public apply(currentObj: THREE.Object3D, others: THREE.Object3D[]) {
    this.clear();
    const curBox = new THREE.Box3().setFromObject(currentObj);
    const curCenter = new THREE.Vector3();
    curBox.getCenter(curCenter);

    let snapped = false;
    let guideStart = new THREE.Vector3();
    let guideEnd = new THREE.Vector3();

    // Check snapping against each other mesh center or bounds
    for (const other of others) {
      if (other === currentObj) continue;
      const otherBox = new THREE.Box3().setFromObject(other);
      const otherCenter = new THREE.Vector3();
      otherBox.getCenter(otherCenter);

      // Snap X center
      if (Math.abs(curCenter.x - otherCenter.x) < this.snapThreshold) {
        currentObj.position.x += otherCenter.x - curCenter.x;
        guideStart.set(otherCenter.x, -10, otherCenter.z);
        guideEnd.set(otherCenter.x, 10, otherCenter.z);
        snapped = true;
        break;
      }

      // Snap Z center
      if (Math.abs(curCenter.z - otherCenter.z) < this.snapThreshold) {
        currentObj.position.z += otherCenter.z - curCenter.z;
        guideStart.set(otherCenter.x, -10, otherCenter.z);
        guideEnd.set(otherCenter.x, 10, otherCenter.z);
        snapped = true;
        break;
      }

      // Snap Y (top-to-bottom resting snap)
      if (Math.abs(curBox.min.y - otherBox.max.y) < this.snapThreshold) {
        currentObj.position.y += otherBox.max.y - curBox.min.y;
        guideStart.set(curCenter.x - 2, otherBox.max.y, curCenter.z - 2);
        guideEnd.set(curCenter.x + 2, otherBox.max.y, curCenter.z + 2);
        snapped = true;
        break;
      }
    }

    // Ground plane snap (y = 0)
    if (!snapped && Math.abs(curBox.min.y) < this.snapThreshold) {
      currentObj.position.y -= curBox.min.y;
      guideStart.set(curCenter.x - 3, 0, curCenter.z);
      guideEnd.set(curCenter.x + 3, 0, curCenter.z);
      snapped = true;
    }

    if (snapped) {
      const posAttr = this.lineGeom.getAttribute("position") as THREE.BufferAttribute;
      posAttr.setXYZ(0, guideStart.x, guideStart.y, guideStart.z);
      posAttr.setXYZ(1, guideEnd.x, guideEnd.y, guideEnd.z);
      posAttr.needsUpdate = true;
      this.line.computeLineDistances();
      this.line.visible = true;
    }
  }

  public dispose() {
    this.lineGeom.dispose();
    this.lineMat.dispose();
    this.group.clear();
  }
}
