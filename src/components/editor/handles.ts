import * as THREE from "three";

export type HandleMode = "linked" | "free";
export type HandlePlane = "xy" | "xz" | "zy";

export interface HandleState {
  plane: HandlePlane;
  curve: number;
}

export class BoxHandles {
  public group: THREE.Group;
  public dragging = false;

  private camera: THREE.Camera;
  private domElement: HTMLElement;
  private onTick: () => void;
  private onDragChange: (dragging: boolean) => void;

  private targetObject: THREE.Object3D | null = null;
  private originalPositions: Float32Array | null = null;
  private handleSpheres: THREE.Mesh[] = [];
  private handlePoints: THREE.Vector3[] = [
    new THREE.Vector3(-1, -1, 0),
    new THREE.Vector3(1, -1, 0),
    new THREE.Vector3(1, 1, 0),
    new THREE.Vector3(-1, 1, 0),
  ];

  private mode: HandleMode = "linked";
  private plane: HandlePlane = "xy";
  private curve = 0;

  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private dragPlane = new THREE.Plane();
  private planeIntersect = new THREE.Vector3();
  private activeHandleIndex = -1;
  private initialHandleOffset = new THREE.Vector3();
  private initialHandlePos = new THREE.Vector3();
  private isCtrlPressed = false;

  private boundOnPointerDown: (e: PointerEvent) => void;
  private boundOnPointerMove: (e: PointerEvent) => void;
  private boundOnPointerUp: (e: PointerEvent) => void;
  private boundOnKeyDown: (e: KeyboardEvent) => void;
  private boundOnKeyUp: (e: KeyboardEvent) => void;

  constructor(
    camera: THREE.Camera,
    domElement: HTMLElement,
    onTick: () => void,
    onDragChange: (dragging: boolean) => void,
  ) {
    this.camera = camera;
    this.domElement = domElement;
    this.onTick = onTick;
    this.onDragChange = onDragChange;

    this.group = new THREE.Group();
    this.group.visible = false;

    const geom = new THREE.SphereGeometry(0.12, 16, 16);
    const matNormal = new THREE.MeshStandardMaterial({
      color: 0x38bdf8,
      emissive: 0x0284c7,
      emissiveIntensity: 0.4,
      roughness: 0.3,
      metalness: 0.2,
      depthTest: false,
    });

    for (let i = 0; i < 4; i++) {
      const mesh = new THREE.Mesh(geom.clone(), matNormal.clone());
      mesh.renderOrder = 999;
      mesh.userData['handleIndex'] = i;
      this.handleSpheres.push(mesh);
      this.group.add(mesh);
    }

    // Connect with dashed line loop
    const lineGeom = new THREE.BufferGeometry();
    const linePos = new Float32Array(5 * 3);
    lineGeom.setAttribute("position", new THREE.BufferAttribute(linePos, 3));
    const lineMat = new THREE.LineDashedMaterial({
      color: 0x38bdf8,
      dashSize: 0.2,
      gapSize: 0.1,
      depthTest: false,
    });
    const line = new THREE.Line(lineGeom, lineMat);
    line.renderOrder = 998;
    line.name = "cageLine";
    this.group.add(line);

    this.boundOnPointerDown = this.onPointerDown.bind(this);
    this.boundOnPointerMove = this.onPointerMove.bind(this);
    this.boundOnPointerUp = this.onPointerUp.bind(this);
    this.boundOnKeyDown = (e) => {
      if (e.ctrlKey || e.metaKey) this.isCtrlPressed = true;
    };
    this.boundOnKeyUp = (e) => {
      if (!e.ctrlKey && !e.metaKey) this.isCtrlPressed = false;
    };

    domElement.addEventListener("pointerdown", this.boundOnPointerDown);
    window.addEventListener("pointermove", this.boundOnPointerMove);
    window.addEventListener("pointerup", this.boundOnPointerUp);
    window.addEventListener("keydown", this.boundOnKeyDown);
    window.addEventListener("keyup", this.boundOnKeyUp);
  }

  public attach(object: THREE.Object3D | null) {
    if (this.targetObject === object) return;
    this.targetObject = object;
    this.originalPositions = null;
    this.curve = 0;

    if (object && (object as THREE.Mesh).isMesh) {
      const mesh = object as THREE.Mesh;
      const posAttr = mesh.geometry?.getAttribute("position");
      if (posAttr) {
        this.originalPositions = new Float32Array(posAttr.array);
      }
    }
    this.recalcHandlesFromObject();
    this.update();
  }

  public setVisible(v: boolean) {
    this.group.visible = v && !!this.targetObject;
  }

  public setMode(mode: HandleMode) {
    this.mode = mode;
  }

  public setPlane(plane: HandlePlane) {
    this.plane = plane;
    this.recalcHandlesFromObject();
    this.update();
  }

  public setCurve(curve: number) {
    this.curve = curve;
    this.applyDeformation();
    this.onTick();
  }

  public getState(): HandleState {
    return {
      plane: this.plane,
      curve: this.curve,
    };
  }

  public reset() {
    this.curve = 0;
    if (this.targetObject && (this.targetObject as THREE.Mesh).isMesh && this.originalPositions) {
      const mesh = this.targetObject as THREE.Mesh;
      const posAttr = mesh.geometry.getAttribute("position") as THREE.BufferAttribute;
      if (posAttr) {
        posAttr.array.set(this.originalPositions);
        posAttr.needsUpdate = true;
        mesh.geometry.computeVertexNormals();
      }
    }
    this.recalcHandlesFromObject();
    this.update();
    this.onTick();
  }

  private recalcHandlesFromObject() {
    if (!this.targetObject) return;
    const box = new THREE.Box3().setFromObject(this.targetObject);
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    box.getSize(size);
    box.getCenter(center);

    const hx = Math.max(size.x / 2, 0.4);
    const hy = Math.max(size.y / 2, 0.4);
    const hz = Math.max(size.z / 2, 0.4);

    if (this.plane === "xy") {
      this.handlePoints = [
        new THREE.Vector3(-hx, -hy, 0),
        new THREE.Vector3(hx, -hy, 0),
        new THREE.Vector3(hx, hy, 0),
        new THREE.Vector3(-hx, hy, 0),
      ];
    } else if (this.plane === "xz") {
      this.handlePoints = [
        new THREE.Vector3(-hx, 0, -hz),
        new THREE.Vector3(hx, 0, -hz),
        new THREE.Vector3(hx, 0, hz),
        new THREE.Vector3(-hx, 0, hz),
      ];
    } else {
      this.handlePoints = [
        new THREE.Vector3(0, -hy, -hz),
        new THREE.Vector3(0, hy, -hz),
        new THREE.Vector3(0, hy, hz),
        new THREE.Vector3(0, -hy, hz),
      ];
    }
  }

  public update() {
    if (!this.targetObject || !this.group.visible) return;

    const matrix = this.targetObject.matrixWorld;
    const line = this.group.getObjectByName("cageLine") as THREE.Line | null;
    const linePos = line?.geometry.getAttribute("position") as THREE.BufferAttribute | null;

    for (let i = 0; i < 4; i++) {
      const worldPos = this.handlePoints[i]!.clone().applyMatrix4(matrix);
      this.handleSpheres[i]!.position.copy(worldPos);

      if (linePos) {
        linePos.setXYZ(i, worldPos.x, worldPos.y, worldPos.z);
        if (i === 0) {
          linePos.setXYZ(4, worldPos.x, worldPos.y, worldPos.z);
        }
      }
    }

    if (linePos) {
      linePos.needsUpdate = true;
      if (line) line.computeLineDistances();
    }
  }

  private onPointerDown(e: PointerEvent) {
    this.isCtrlPressed = e.ctrlKey || e.metaKey;
    if (!this.group.visible || !this.targetObject || e.button !== 0) return;

    const rect = this.domElement.getBoundingClientRect();
    this.pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);

    const hits = this.raycaster.intersectObjects(this.handleSpheres, false);
    if (!hits.length) return;

    const hit = hits[0]!;
    this.activeHandleIndex = hit.object.userData['handleIndex'] ?? -1;
    if (this.activeHandleIndex === -1) return;

    this.dragging = true;
    this.onDragChange(true);

    const camDir = new THREE.Vector3();
    this.camera.getWorldDirection(camDir);
    this.dragPlane.setFromNormalAndCoplanarPoint(camDir.negate(), hit.point);

    this.raycaster.ray.intersectPlane(this.dragPlane, this.initialHandlePos);
    this.initialHandleOffset.copy(this.handlePoints[this.activeHandleIndex]!);
  }

  private onPointerMove(e: PointerEvent) {
    this.isCtrlPressed = e.ctrlKey || e.metaKey;
    if (!this.dragging || this.activeHandleIndex === -1 || !this.targetObject) return;

    const rect = this.domElement.getBoundingClientRect();
    this.pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);

    if (this.raycaster.ray.intersectPlane(this.dragPlane, this.planeIntersect)) {
      const invMatrix = this.targetObject.matrixWorld.clone().invert();
      const localIntersect = this.planeIntersect.clone().applyMatrix4(invMatrix);

      const delta = localIntersect.clone().sub(this.initialHandleOffset);

      if (this.mode === "free") {
        this.handlePoints[this.activeHandleIndex]!.copy(localIntersect);
      } else {
        // Linked / Anchor mode: scale or offset corner handles
        this.handlePoints[this.activeHandleIndex]!.copy(localIntersect);
        if (this.isCtrlPressed) {
          // Symmetrical scale on opposite side
          const oppIdx = (this.activeHandleIndex + 2) % 4;
          this.handlePoints[oppIdx]!.sub(delta.multiplyScalar(0.5));
        }
      }

      this.applyDeformation();
      this.update();
      this.onTick();
    }
  }

  private onPointerUp() {
    if (this.dragging) {
      this.dragging = false;
      this.activeHandleIndex = -1;
      this.onDragChange(false);
      this.onTick();
    }
  }

  private applyDeformation() {
    if (
      !this.targetObject ||
      !(this.targetObject as THREE.Mesh).isMesh ||
      !this.originalPositions
    )
      return;

    const mesh = this.targetObject as THREE.Mesh;
    const posAttr = mesh.geometry.getAttribute("position") as THREE.BufferAttribute;
    if (!posAttr) return;

    const orig = this.originalPositions;
    const count = posAttr.count;

    // Apply curve bulge and corner offsets
    for (let i = 0; i < count; i++) {
      let x = orig[i * 3]!;
      let y = orig[i * 3 + 1]!;
      let z = orig[i * 3 + 2]!;

      if (this.curve !== 0) {
        if (this.plane === "xy") {
          const factor = Math.cos((x * Math.PI) / 2) * Math.cos((y * Math.PI) / 2);
          z += factor * this.curve * 0.8;
        } else if (this.plane === "xz") {
          const factor = Math.cos((x * Math.PI) / 2) * Math.cos((z * Math.PI) / 2);
          y += factor * this.curve * 0.8;
        } else {
          const factor = Math.cos((y * Math.PI) / 2) * Math.cos((z * Math.PI) / 2);
          x += factor * this.curve * 0.8;
        }
      }

      posAttr.setXYZ(i, x, y, z);
    }

    posAttr.needsUpdate = true;
    mesh.geometry.computeVertexNormals();
    mesh.userData['deformed'] = true;
  }

  public dispose() {
    this.domElement.removeEventListener("pointerdown", this.boundOnPointerDown);
    window.removeEventListener("pointermove", this.boundOnPointerMove);
    window.removeEventListener("pointerup", this.boundOnPointerUp);
    window.removeEventListener("keydown", this.boundOnKeyDown);
    window.removeEventListener("keyup", this.boundOnKeyUp);

    for (const h of this.handleSpheres) {
      h.geometry.dispose();
      (h.material as THREE.Material).dispose();
    }
    this.group.clear();
  }
}
