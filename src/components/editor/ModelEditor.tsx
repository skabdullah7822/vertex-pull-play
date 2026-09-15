import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { TransformControls } from "three/addons/controls/TransformControls.js";
import {
  Box,
  Circle,
  Cone,
  Cylinder,
  Donut,
  Sun,
  Lightbulb,
  Flashlight,
  Sparkles,
  Move3d,
  Rotate3d,
  Scaling,
  Trash2,
  Copy,
  Download,
  Grid3x3,
  Square,
  Hexagon,
  Pill,
  Triangle,
  Code2,
  Spline,
  RotateCcw,
  Frame,
  PenTool,
  Magnet,
  Shield,
  ShieldOff,
  Focus,
  GripVertical,
  MapPin,
  Target,
  PanelRight,
  Sliders,
  Layers,
  Palette,
  Compass,
  Undo2,
  Redo2,
  Scissors,
  Ruler,
  Eraser,
  Combine,
  CheckSquare,
  SquareDashed,
  Save,
  FilePlus2,
  Footprints,
  Play,
  Terminal,
} from "lucide-react";
import {
  GEOMETRY_SPECS,
  createGeometry,
  isLight,
  labelFor,
  type Kind,
  type MeshKind,
} from "./geometry";
import { generateThreeCode } from "./exportCode";
import { BoxHandles, type HandleMode, type HandlePlane } from "./handles";
import ColorPicker from "./ColorPicker";
import { SnapGuides, hitsSolid } from "./snapping";
import { VertexEditor } from "./vertexEdit";
import { CutTool, sliceGeometry, carveGeometry, type CutStatus } from "./cutTool";
import { HistoryStack, captureSnapshot, restoreSnapshot, type Snapshot } from "./history";
import { saveProject, loadProject, clearProject } from "./projectStore";
import { WalkController } from "./walkMode";
import { runUserCode, kindOf, SAMPLE_CODE } from "./runCode";

type Item = { id: string; name: string; kind: Kind };
type Mode = "translate" | "rotate" | "scale" | "place";

const BG = "#14161a";

function placeObjectAt(obj: THREE.Object3D, targetPoint: THREE.Vector3) {
  if (obj instanceof THREE.Mesh && obj.geometry) {
    obj.geometry.computeBoundingBox();
    const bb = obj.geometry.boundingBox;
    if (bb) {
      const bottomRel = bb.min.y * obj.scale.y;
      obj.position.set(targetPoint.x, targetPoint.y - bottomRel, targetPoint.z);
      obj.updateMatrixWorld(true);
      return;
    }
  }
  const isLightObj = isLight(obj.userData?.['kind'] || "");
  if (isLightObj) {
    obj.position.set(targetPoint.x, targetPoint.y + 1.8, targetPoint.z);
    obj.updateMatrixWorld(true);
    return;
  }
  obj.position.copy(targetPoint);
  obj.updateMatrixWorld(true);
}

const MESH_ICONS: Partial<Record<MeshKind, typeof Box>> = {
  box: Box,
  sphere: Circle,
  cylinder: Cylinder,
  cone: Cone,
  torus: Donut,
  torusKnot: Sparkles,
  plane: Square,
  icosahedron: Hexagon,
  capsule: Pill,
  ring: Circle,
  dodecahedron: Hexagon,
  tetrahedron: Triangle,
};

const LIGHT_ICONS = {
  directionalLight: Sun,
  pointLight: Lightbulb,
  spotLight: Flashlight,
  ambientLight: Sparkles,
} as const;

let counter = 0;
const nextId = () => `obj_${++counter}_${Math.random().toString(36).slice(2, 6)}`;

export default function ModelEditor() {
  const mountRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const transformRef = useRef<TransformControls | null>(null);
  const objectsRef = useRef<Map<string, THREE.Object3D>>(new Map());
  const gridRef = useRef<THREE.GridHelper | null>(null);
  const selectedRef = useRef<string | null>(null);
  const handlesRef = useRef<BoxHandles | null>(null);
  const vertexRef = useRef<VertexEditor | null>(null);
  const vertexModeRef = useRef(false);
  const cutRef = useRef<CutTool | null>(null);
  const cutModeRef = useRef(false);
  const historyRef = useRef<HistoryStack>(new HistoryStack());
  const commitRef = useRef<(() => void) | null>(null);
  const pendingCommit = useRef(false);
  const historyReady = useRef(false);
  const orbitRef = useRef<OrbitControls | null>(null);
  const quadModeRef = useRef(false);
  const snapOnRef = useRef(true);
  const quadPtsRef = useRef<THREE.Vector3[]>([]);
  const addQuadRef = useRef<((pts: THREE.Vector3[]) => void) | null>(null);
  const cancelQuadRef = useRef<(() => void) | null>(null);
  const dropIndicatorRef = useRef<THREE.Group | null>(null);
  const computeDropPositionRef = useRef<
    ((clientX: number, clientY: number, excludeId?: string | null) => { point: THREE.Vector3; normal: THREE.Vector3 } | null) | null
  >(null);

  const [items, setItems] = useState<Item[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("translate");
  const modeRef = useRef<Mode>(mode);
  modeRef.current = mode;
  const [showGrid, setShowGrid] = useState(true);
  const [, forceTick] = useState(0);
  const tick = useCallback(() => forceTick((t) => t + 1), []);
  const [codeOpen, setCodeOpen] = useState(false);
  const [pointsOn, setPointsOn] = useState(false);
  const [handlePlane, setHandlePlane] = useState<HandlePlane>("xy");
  const [handleMode, setHandleMode] = useState<HandleMode>("linked");
  const [curve, setCurve] = useState(0);
  const [quadMode, setQuadMode] = useState(false);
  const [quadCount, setQuadCount] = useState(0);
  const [snapOn, setSnapOn] = useState(true);
  const [vertexMode, setVertexMode] = useState(false);
  const [vertexCount, setVertexCount] = useState(0);
  const [vertexRadius, setVertexRadius] = useState(0.9);
  const [vertexStrength, setVertexStrength] = useState(1);
  const [cutMode, setCutMode] = useState(false);
  const [cutStatus, setCutStatus] = useState<CutStatus>({ count: 0, aligned: [], planar: false });
  const [cutError, setCutError] = useState<string | null>(null);
  const [joinIds, setJoinIds] = useState<string[]>([]);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [histVersion, setHistVersion] = useState(0);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [walkMode, setWalkMode] = useState(false);
  const [scriptOpen, setScriptOpen] = useState(false);
  const [script, setScript] = useState(SAMPLE_CODE);
  const [scriptError, setScriptError] = useState<string | null>(null);
  const [scriptLog, setScriptLog] = useState<string[]>([]);
  const walkRef = useRef<WalkController | null>(null);
  const walkModeRef = useRef(false);
  const [menu, setMenu] = useState<{ x: number; y: number; id: string | null } | null>(null);

  const [draggedPayload, setDraggedPayload] = useState<{
    type: "move" | "create";
    id?: string;
    kind?: Kind;
    name?: string;
  } | null>(null);
  const [dropTarget, setDropTarget] = useState<{ x: number; y: number; z: number } | null>(null);
  const [outlinerDragOverIdx, setOutlinerDragOverIdx] = useState<number | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [panelTab, setPanelTab] = useState<"properties" | "scene">("properties");
  const [bgColor, setBgColor] = useState(BG);
  const [isCtrlPressed, setIsCtrlPressed] = useState(false);
  const isCtrlPressedRef = useRef(false);

  selectedRef.current = selected;
  quadModeRef.current = quadMode;
  snapOnRef.current = snapOn;
  vertexModeRef.current = vertexMode;
  cutModeRef.current = cutMode;
  walkModeRef.current = walkMode;
  const itemsRef = useRef<Item[]>(items);
  itemsRef.current = items;

  /* ---------------- three.js bootstrap ---------------- */
  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(bgColor);
    sceneRef.current = scene;

    // Populate or restore objects into the scene
    const savedProject = objectsRef.current.size === 0 ? loadProject() : null;
    if (savedProject && savedProject.snapshot.items.length) {
      const list = restoreSnapshot(savedProject.snapshot, scene, objectsRef.current);
      setItems(list);
      setSelected(
        savedProject.snapshot.selected && objectsRef.current.has(savedProject.snapshot.selected)
          ? savedProject.snapshot.selected
          : null,
      );
      if (savedProject.bg) {
        setBgColor(savedProject.bg);
        scene.background = new THREE.Color(savedProject.bg);
      }
      setSavedAt(savedProject.savedAt);
    } else if (objectsRef.current.size === 0) {
      const boxMesh = new THREE.Mesh(
        createGeometry("box"),
        new THREE.MeshStandardMaterial({
          color: 0xb9bec7,
          metalness: 0.1,
          roughness: 0.55,
          side: THREE.DoubleSide,
        }),
      );
      boxMesh.castShadow = true;
      boxMesh.receiveShadow = true;
      boxMesh.position.y = 0.75;
      boxMesh.userData['kind'] = "box";

      const dirLight = new THREE.DirectionalLight(0xffffff, 2.2);
      dirLight.position.set(3, 4, 2);
      dirLight.castShadow = true;
      dirLight.userData['kind'] = "directionalLight";

      const ambLight = new THREE.AmbientLight(0xffffff, 0.4);
      ambLight.userData['kind'] = "ambientLight";

      const boxId = nextId();
      const dirId = nextId();
      const ambId = nextId();

      objectsRef.current.set(boxId, boxMesh);
      objectsRef.current.set(dirId, dirLight);
      objectsRef.current.set(ambId, ambLight);

      scene.add(boxMesh);
      scene.add(dirLight);
      scene.add(ambLight);

      setItems([
        { id: boxId, name: "Cube", kind: "box" },
        { id: dirId, name: "Directional Light", kind: "directionalLight" },
        { id: ambId, name: "Ambient Light", kind: "ambientLight" },
      ]);
      setSelected(boxId);
    } else {
      for (const obj of objectsRef.current.values()) {
        scene.add(obj);
      }
    }

    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 2000);
    camera.position.set(5, 4, 7);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.domElement.style.display = "block";
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    mount.appendChild(renderer.domElement);

    const grid = new THREE.GridHelper(40, 40, 0x4b5563, 0x272b31);
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.55;
    scene.add(grid);
    gridRef.current = grid;

    const orbit = new OrbitControls(camera, renderer.domElement);
    orbit.enableDamping = true;
    orbit.target.set(0, 0.5, 0);
    orbitRef.current = orbit;

    const walker = new WalkController(
      renderer.domElement,
      () =>
        [...objectsRef.current.values()].filter(
          (o) => (o as THREE.Mesh).isMesh && o.userData['solid'] === true && o.visible,
        ),
      () => setWalkMode(false),
    );
    walkRef.current = walker;
    const walkClock = new THREE.Clock();

    const snap = new SnapGuides();
    scene.add(snap.group);

    const transform = new TransformControls(camera, renderer.domElement);
    const safePos = new THREE.Vector3();
    const scaleInitialPos = new THREE.Vector3();
    const scaleInitialScale = new THREE.Vector3();
    const scaleInitialQuat = new THREE.Quaternion();
    const localMin = new THREE.Vector3(-0.5, -0.5, -0.5);
    let isScaling = false;

    const applyScalePosition = (obj: THREE.Object3D) => {
      const ctrl = isCtrlPressedRef.current;
      if (ctrl) {
        // Center scale: both sides expand symmetrically
        obj.position.copy(scaleInitialPos);
      } else {
        // Single-side scale: opposite side remains stationary
        const axis = (transform.axis || "").toUpperCase();
        const isUniform = axis === "XYZ" || axis === "E";
        const hasX = isUniform || axis.includes("X");
        const hasY = isUniform || axis.includes("Y");
        const hasZ = isUniform || axis.includes("Z");

        const shiftLocal = new THREE.Vector3(
          hasX ? localMin.x * (scaleInitialScale.x - obj.scale.x) : 0,
          hasY ? localMin.y * (scaleInitialScale.y - obj.scale.y) : 0,
          hasZ ? localMin.z * (scaleInitialScale.z - obj.scale.z) : 0,
        );
        const shiftWorld = shiftLocal.applyQuaternion(scaleInitialQuat);
        obj.position.copy(scaleInitialPos).add(shiftWorld);
      }
    };

    transform.addEventListener("dragging-changed", (e) => {
      orbit.enabled = !e.value;
      const obj = transform.object as THREE.Object3D | undefined;
      if (e.value && obj) {
        safePos.copy(obj.position);
        if (transform.getMode() === "scale") {
          isScaling = true;
          scaleInitialPos.copy(obj.position);
          scaleInitialScale.copy(obj.scale);
          scaleInitialQuat.copy(obj.quaternion);

          if ((obj as THREE.Mesh).isMesh && (obj as THREE.Mesh).geometry) {
            const mesh = obj as THREE.Mesh;
            if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
            if (mesh.geometry.boundingBox) {
              localMin.copy(mesh.geometry.boundingBox.min);
            } else {
              localMin.set(-0.5, -0.5, -0.5);
            }
          } else {
            localMin.set(-0.5, -0.5, -0.5);
          }
        }
      }
      if (!e.value) {
        isScaling = false;
        snap.clear();
        tick();
        commitRef.current?.();
      }
    });
    transform.addEventListener("objectChange", () => {
      const obj = transform.object as THREE.Object3D | undefined;
      if (obj) {
        if (transform.getMode() === "scale" && isScaling) {
          obj.scale.x = Math.max(0.001, obj.scale.x);
          obj.scale.y = Math.max(0.001, obj.scale.y);
          obj.scale.z = Math.max(0.001, obj.scale.z);
          applyScalePosition(obj);
        }

        const others = [...objectsRef.current.values()].filter(
          (o) => o !== obj && (o as THREE.Mesh).isMesh,
        );
        if (snapOnRef.current && transform.getMode() === "translate") {
          snap.apply(obj, others);
        } else {
          snap.clear();
        }
        const solids = others.filter((o) => o.userData['solid'] === true);
        if (hitsSolid(obj, solids)) obj.position.copy(safePos);
        else safePos.copy(obj.position);
      }
      tick();
    });
    scene.add(transform.getHelper());
    transformRef.current = transform;

    const handles = new BoxHandles(camera, renderer.domElement, tick, (d) => {
      orbit.enabled = !d;
      transform.enabled = !d;
      if (!d) commitRef.current?.();
    });
    scene.add(handles.group);
    handlesRef.current = handles;

    const vertexEditor = new VertexEditor(
      camera,
      renderer.domElement,
      tick,
      (d) => {
        orbit.enabled = !d;
        transform.enabled = !d;
        if (!d) commitRef.current?.();
      },
      setVertexCount,
    );
    scene.add(vertexEditor.group);
    vertexRef.current = vertexEditor;

    const cutTool = new CutTool(
      camera,
      renderer.domElement,
      tick,
      (d) => {
        orbit.enabled = !d;
        transform.enabled = !d;
      },
      setCutStatus,
    );
    scene.add(cutTool.group);
    cutRef.current = cutTool;

    // viewport helper lights so the scene is never pitch black
    const hemi = new THREE.HemisphereLight(0xbfd4ff, 0x20242b, 0.55);
    scene.add(hemi);

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let down = { x: 0, y: 0 };

    // quad tool scratch space
    const quadGroup = new THREE.Group();
    scene.add(quadGroup);
    const markerGeom = new THREE.SphereGeometry(0.09, 18, 12);
    const markerMat = new THREE.MeshBasicMaterial({ color: 0x38bdf8, depthTest: false });
    const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    cancelQuadRef.current = () => {
      quadPtsRef.current = [];
      quadGroup.clear();
      setQuadCount(0);
    };

    // 3D placement target indicator
    const dropIndicator = new THREE.Group();
    dropIndicator.visible = false;

    const ringGeom = new THREE.RingGeometry(0.4, 0.5, 32);
    ringGeom.rotateX(-Math.PI / 2);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.9,
      depthTest: false,
    });
    const ringMesh = new THREE.Mesh(ringGeom, ringMat);
    ringMesh.renderOrder = 9999;
    dropIndicator.add(ringMesh);

    const discGeom = new THREE.CircleGeometry(0.18, 32);
    discGeom.rotateX(-Math.PI / 2);
    const discMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.25,
      depthTest: false,
    });
    const discMesh = new THREE.Mesh(discGeom, discMat);
    discMesh.renderOrder = 9999;
    dropIndicator.add(discMesh);

    const crossGeom = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-0.75, 0, 0),
      new THREE.Vector3(0.75, 0, 0),
      new THREE.Vector3(0, 0, -0.75),
      new THREE.Vector3(0, 0, 0.75),
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0, 1.2, 0),
    ]);
    const crossMat = new THREE.LineBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.85,
      depthTest: false,
    });
    const crossLines = new THREE.LineSegments(crossGeom, crossMat);
    crossLines.renderOrder = 9999;
    dropIndicator.add(crossLines);

    scene.add(dropIndicator);
    dropIndicatorRef.current = dropIndicator;

    const computeDropPosition = (clientX: number, clientY: number, excludeId?: string | null) => {
      const rect = renderer.domElement.getBoundingClientRect();
      if (
        clientX < rect.left ||
        clientX > rect.right ||
        clientY < rect.top ||
        clientY > rect.bottom
      ) {
        return null;
      }
      pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);

      const targets: THREE.Object3D[] = [];
      objectsRef.current.forEach((o, id) => {
        if (id !== excludeId) targets.push(o);
      });

      const hits = raycaster.intersectObjects(targets, true);
      let targetPoint: THREE.Vector3;
      let normal = new THREE.Vector3(0, 1, 0);

      if (hits.length > 0) {
        targetPoint = hits[0]!.point.clone();
        if (hits[0]!.face) {
          normal = hits[0]!.face.normal.clone().transformDirection(hits[0]!.object.matrixWorld);
        }
      } else {
        const hitGround = new THREE.Vector3();
        if (raycaster.ray.intersectPlane(groundPlane, hitGround)) {
          targetPoint = hitGround;
        } else {
          return null;
        }
      }

      if (snapOnRef.current) {
        const snapGrid = 0.5;
        targetPoint.x = Math.round(targetPoint.x / snapGrid) * snapGrid;
        targetPoint.z = Math.round(targetPoint.z / snapGrid) * snapGrid;
        if (Math.abs(targetPoint.y) < 0.05) {
          targetPoint.y = 0;
        } else {
          targetPoint.y = Math.round(targetPoint.y / snapGrid) * snapGrid;
        }
      }

      return { point: targetPoint, normal };
    };
    computeDropPositionRef.current = computeDropPosition;

    const setPointerFrom = (e: { clientX: number; clientY: number }) => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      return rect;
    };
    const pickId = () => {
      const targets = [...objectsRef.current.entries()];
      const hits = raycaster.intersectObjects(
        targets.map(([, o]) => o),
        true,
      );
      if (!hits.length) return { id: null as string | null, hits };
      let obj: THREE.Object3D | null = hits[0]!.object;
      while (obj && !targets.some(([, o]) => o === obj)) obj = obj.parent;
      const entry = targets.find(([, o]) => o === obj);
      return { id: entry ? entry[0] : null, hits };
    };

    const onDown = (e: PointerEvent) => {
      down = { x: e.clientX, y: e.clientY };
    };
    const onUp = (e: PointerEvent) => {
      if (e.button !== 0 || walkModeRef.current) return;
      if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4) return;
      if (transform.dragging || handles.dragging || vertexEditor.dragging) return;
      setPointerFrom(e);
      const { id, hits } = pickId();

      if (vertexModeRef.current) {
        const selId = selectedRef.current;
        const selObject = selId ? objectsRef.current.get(selId) : null;
        if (selObject) {
          const meshHits = raycaster.intersectObject(selObject, true);
          if (meshHits.length) {
            vertexEditor.addPointAtWorld(meshHits[0]!.point.clone());
            return;
          }
        }
        if (id && id !== selId) {
          setSelected(id);
          return;
        }
        return;
      }

      if (cutModeRef.current) {
        let point: THREE.Vector3 | null = hits.length ? hits[0]!.point.clone() : null;
        if (!point) {
          const p = new THREE.Vector3();
          point = raycaster.ray.intersectPlane(groundPlane, p) ? p.clone() : null;
        }
        if (!point) return;
        if (!selectedRef.current && id) setSelected(id);
        cutTool.addPoint(point);
        setCutError(null);
        return;
      }


      if (modeRef.current === "place" && selectedRef.current) {
        const target = computeDropPosition(e.clientX, e.clientY, selectedRef.current);
        const obj = objectsRef.current.get(selectedRef.current);
        if (target && obj) {
          placeObjectAt(obj, target.point);
          tick();
        }
        return;
      }

      if (quadModeRef.current) {
        let point: THREE.Vector3 | null = hits.length ? hits[0]!.point.clone() : null;
        if (!point) {
          const p = new THREE.Vector3();
          point = raycaster.ray.intersectPlane(groundPlane, p) ? p.clone() : null;
        }
        if (!point) return;
        const marker = new THREE.Mesh(markerGeom, markerMat);
        marker.renderOrder = 999;
        marker.position.copy(point);
        quadGroup.add(marker);
        quadPtsRef.current.push(point);
        setQuadCount(quadPtsRef.current.length);
        if (quadPtsRef.current.length === 4) {
          const pts = quadPtsRef.current.slice();
          quadPtsRef.current = [];
          quadGroup.clear();
          setQuadCount(0);
          setQuadMode(false);
          addQuadRef.current?.(pts);
        }
        return;
      }

      setSelected(id);
    };

    const onMove = (e: PointerEvent) => {
      const ctrl = e.ctrlKey || e.metaKey;
      if (ctrl !== isCtrlPressedRef.current) {
        isCtrlPressedRef.current = ctrl;
        setIsCtrlPressed(ctrl);
        if (isScaling && transform.object) {
          applyScalePosition(transform.object);
          tick();
        }
      }

      if (modeRef.current === "place" && selectedRef.current) {
        const target = computeDropPosition(e.clientX, e.clientY, selectedRef.current);
        if (target && dropIndicator) {
          dropIndicator.position.copy(target.point);
          dropIndicator.visible = true;
        } else if (dropIndicator) {
          dropIndicator.visible = false;
        }
      }
    };

    const onContext = (e: MouseEvent) => {
      e.preventDefault();
      const rect = setPointerFrom(e);
      const { id } = pickId();
      if (id) setSelected(id);
      setMenu({ x: e.clientX - rect.left, y: e.clientY - rect.top, id });
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.key === "Control" || e.key === "Meta") {
        if (!isCtrlPressedRef.current) {
          isCtrlPressedRef.current = true;
          setIsCtrlPressed(true);
          if (isScaling && transform.object) {
            applyScalePosition(transform.object);
            tick();
          }
        }
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (!e.ctrlKey && !e.metaKey && e.key !== "Control" && e.key !== "Meta") {
        if (isCtrlPressedRef.current) {
          isCtrlPressedRef.current = false;
          setIsCtrlPressed(false);
          if (isScaling && transform.object) {
            applyScalePosition(transform.object);
            tick();
          }
        }
      }
    };

    const onBlur = () => {
      if (isCtrlPressedRef.current) {
        isCtrlPressedRef.current = false;
        setIsCtrlPressed(false);
        if (isScaling && transform.object) {
          applyScalePosition(transform.object);
          tick();
        }
      }
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);

    renderer.domElement.addEventListener("pointerdown", onDown);
    renderer.domElement.addEventListener("pointerup", onUp);
    renderer.domElement.addEventListener("pointermove", onMove);
    renderer.domElement.addEventListener("contextmenu", onContext);

    const resize = () => {
      const w = mount.clientWidth;
      const h = mount.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h, true);
      renderer.domElement.style.width = "100%";
      renderer.domElement.style.height = "100%";
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      walker.setAspect(w / h);
    };
    const ro = new ResizeObserver(resize);
    ro.observe(mount);
    resize();

    renderer.setAnimationLoop(() => {
      const dt = walkClock.getDelta();
      if (walker.enabled) {
        walker.update(dt);
        renderer.render(scene, walker.camera);
        return;
      }
      orbit.update();
      handles.update();
      vertexEditor.update();
      cutTool.update();
      renderer.render(scene, camera);
    });

    return () => {
      renderer.setAnimationLoop(null);
      ro.disconnect();
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      renderer.domElement.removeEventListener("pointerdown", onDown);
      renderer.domElement.removeEventListener("pointerup", onUp);
      renderer.domElement.removeEventListener("pointermove", onMove);
      renderer.domElement.removeEventListener("contextmenu", onContext);
      cancelQuadRef.current = null;
      ringGeom.dispose();
      ringMat.dispose();
      discGeom.dispose();
      discMat.dispose();
      crossGeom.dispose();
      crossMat.dispose();
      scene.remove(dropIndicator);
      dropIndicatorRef.current = null;
      computeDropPositionRef.current = null;
      markerGeom.dispose();
      markerMat.dispose();
      snap.dispose();
      handles.dispose();
      vertexEditor.dispose();
      cutTool.dispose();
      cutRef.current = null;
      vertexRef.current = null;
      transform.detach();
      transform.dispose();
      walker.exit();
      walker.dispose();
      walkRef.current = null;
      orbit.dispose();
      renderer.dispose();
      if (mount.contains(renderer.domElement)) {
        mount.removeChild(renderer.domElement);
      }
    };
  }, [tick]);

  /* ---------------- selection + gizmo sync ---------------- */
  useEffect(() => {
    const t = transformRef.current;
    if (!t) return;
    if (mode === "place" || vertexMode || cutMode || walkMode) {
      t.detach();
      return;
    }
    const obj = selected ? objectsRef.current.get(selected) : null;
    if (obj) t.attach(obj);
    else t.detach();
    t.setMode(mode);
  }, [selected, items, mode, vertexMode, cutMode, walkMode]);

  /* ---------------- walk mode ---------------- */
  useEffect(() => {
    const w = walkRef.current;
    const cam = cameraRef.current;
    const orb = orbitRef.current;
    if (!w || !cam || !orb) return;
    if (walkMode) {
      w.setAspect(cam.aspect);
      w.enter(cam.position.clone(), orb.target.clone());
      orb.enabled = false;
    } else {
      w.exit();
      orb.enabled = true;
    }
  }, [walkMode]);

  useEffect(() => {
    if (mode !== "place" && dropIndicatorRef.current) {
      dropIndicatorRef.current.visible = false;
    }
  }, [mode]);

  useEffect(() => {
    if (gridRef.current) gridRef.current.visible = showGrid;
  }, [showGrid]);

  /* ---------------- point cage sync ---------------- */
  useEffect(() => {
    const h = handlesRef.current;
    if (!h) return;
    const obj = pointsOn && selected ? (objectsRef.current.get(selected) ?? null) : null;
    h.attach(obj);
    h.setMode(handleMode);
    h.setVisible(pointsOn);
    if (obj) {
      const st = h.getState();
      setHandlePlane(st.plane);
      setCurve(st.curve);
    }
  }, [selected, pointsOn, items]);

  useEffect(() => {
    handlesRef.current?.setMode(handleMode);
  }, [handleMode]);

  /* ---------------- vertex sculpting sync ---------------- */
  useEffect(() => {
    const v = vertexRef.current;
    if (!v) return;
    const obj = selected ? (objectsRef.current.get(selected) ?? null) : null;
    v.attach(vertexMode ? obj : null);
    v.setEnabled(vertexMode);
    tick();
  }, [selected, vertexMode, items, tick]);

  useEffect(() => {
    vertexRef.current?.setRadius(vertexRadius);
  }, [vertexRadius]);

  useEffect(() => {
    vertexRef.current?.setStrength(vertexStrength);
  }, [vertexStrength]);

  useEffect(() => {
    if (pointsOn) handlesRef.current?.setPlane(handlePlane);
  }, [handlePlane]);

  useEffect(() => {
    if (pointsOn) handlesRef.current?.setCurve(curve);
  }, [curve]);

  /* ---------------- object operations ---------------- */
  const addObject = useCallback((kind: Kind, source?: THREE.Object3D, initialPos?: THREE.Vector3) => {
    const scene = sceneRef.current;
    if (!scene) return null;
    let obj: THREE.Object3D;

    if (isLight(kind)) {
      if (kind === "ambientLight") obj = new THREE.AmbientLight(0xffffff, 0.4);
      else if (kind === "directionalLight") obj = new THREE.DirectionalLight(0xffffff, 2.2);
      else if (kind === "pointLight") obj = new THREE.PointLight(0xffe6b0, 12, 0, 2);
      else obj = new THREE.SpotLight(0xffffff, 25, 0, Math.PI / 6, 0.35);
      obj.position.set(3, 4, 2);
      if (kind !== "ambientLight") (obj as THREE.Light).castShadow = true;
    } else {
      const mesh = new THREE.Mesh(
        createGeometry(kind),
        new THREE.MeshStandardMaterial({
          color: 0xb9bec7,
          metalness: 0.1,
          roughness: 0.55,
          side: THREE.DoubleSide,
        }),
      );
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.position.y = 0.75;
      obj = mesh;
    }
    obj.userData['kind'] = kind;

    if (source) {
      obj.position.copy(source.position);
      obj.rotation.copy(source.rotation);
      obj.scale.copy(source.scale);
      obj.position.x += 1;
      const sm = (source as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
      const om = (obj as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
      if (sm && om) {
        om.color.copy(sm.color);
        om.metalness = sm.metalness;
        om.roughness = sm.roughness;
        om.wireframe = sm.wireframe;
        om.flatShading = sm.flatShading;
        om.needsUpdate = true;
      }
    } else if (initialPos) {
      placeObjectAt(obj, initialPos);
    }

    const id = nextId();
    objectsRef.current.set(id, obj);
    scene.add(obj);
    setItems((prev) => {
      const same = prev.filter((p) => p.kind === kind).length;
      return [...prev, { id, name: `${labelFor(kind)}${same ? `.${same}` : ""}`, kind }];
    });
    setSelected(id);
    return id;
  }, []);

  const focusObject = useCallback((id: string) => {
    const obj = objectsRef.current.get(id);
    const orbit = orbitRef.current;
    const cam = cameraRef.current;
    if (!obj || !orbit || !cam) return;
    const target = obj.getWorldPosition(new THREE.Vector3());
    const dir = cam.position.clone().sub(orbit.target).normalize();
    orbit.target.copy(target);
    cam.position.copy(target).addScaledVector(dir, 6);
    setSelected(id);
  }, []);

  const removeSelected = useCallback(() => {
    const id = selectedRef.current;
    if (!id) return;
    const obj = objectsRef.current.get(id);
    if (obj) {
      transformRef.current?.detach();
      sceneRef.current?.remove(obj);
      const mesh = obj as THREE.Mesh;
      mesh.geometry?.dispose?.();
      (mesh.material as THREE.Material | undefined)?.dispose?.();
      objectsRef.current.delete(id);
    }
    setItems((prev) => prev.filter((p) => p.id !== id));
    setSelected(null);
  }, []);

  const duplicateSelected = useCallback(() => {
    const id = selectedRef.current;
    if (!id) return;
    const item = items.find((i) => i.id === id);
    const obj = objectsRef.current.get(id);
    if (item && obj) addObject(item.kind, obj);
  }, [items, addObject]);

  /* ---------------- quad from 4 clicked points ---------------- */
  const addQuadFromPoints = useCallback((pts: THREE.Vector3[]) => {
    const scene = sceneRef.current;
    if (!scene) return;
    const centroid = new THREE.Vector3();
    pts.forEach((p) => centroid.add(p));
    centroid.multiplyScalar(1 / pts.length);

    const arr = new Float32Array(12);
    pts.forEach((p, i) => {
      const l = p.clone().sub(centroid);
      arr[i * 3] = l.x;
      arr[i * 3 + 1] = l.y;
      arr[i * 3 + 2] = l.z;
    });
    const geom = new THREE.BufferGeometry();
    geom.setAttribute("position", new THREE.BufferAttribute(arr, 3));
    geom.setIndex([0, 1, 2, 0, 2, 3]);
    geom.computeVertexNormals();

    const mesh = new THREE.Mesh(
      geom,
      new THREE.MeshStandardMaterial({
        color: 0x8ab4ff,
        metalness: 0.05,
        roughness: 0.6,
        side: THREE.DoubleSide,
      }),
    );
    mesh.position.copy(centroid);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData['deformed'] = true;

    const id = nextId();
    objectsRef.current.set(id, mesh);
    scene.add(mesh);
    setItems((prev) => {
      const same = prev.filter((p) => p.name.startsWith("Quad")).length;
      return [...prev, { id, name: `Quad${same ? `.${same}` : ""}`, kind: "plane" as Kind }];
    });
    setSelected(id);
  }, []);
  addQuadRef.current = addQuadFromPoints;

  /* ---------------- undo / redo ---------------- */
  const commit = useCallback(() => {
    historyRef.current.commit(
      captureSnapshot(itemsRef.current, objectsRef.current, selectedRef.current),
    );
    setHistVersion((v) => v + 1);
  }, []);
  commitRef.current = commit;

  const suppressCommit = useRef(false);
  const itemsKey = items.map((i) => `${i.id}:${i.name}`).join("|");

  useEffect(() => {
    if (!historyReady.current) {
      if (!itemsRef.current.length) return;
      historyRef.current.reset(
        captureSnapshot(itemsRef.current, objectsRef.current, selectedRef.current),
      );
      historyReady.current = true;
      setHistVersion((v) => v + 1);
      return;
    }
    if (suppressCommit.current) {
      suppressCommit.current = false;
      return;
    }
    commit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemsKey]);

  const applyHistory = useCallback(
    (snap: Snapshot | null) => {
      const scene = sceneRef.current;
      if (!scene || !snap) return;
      suppressCommit.current = true;
      transformRef.current?.detach();
      handlesRef.current?.attach(null);
      vertexRef.current?.attach(null);
      cutRef.current?.clear();
      const list = restoreSnapshot(snap, scene, objectsRef.current);
      setItems(list);
      setSelected(snap.selected && objectsRef.current.has(snap.selected) ? snap.selected : null);
      setHistVersion((v) => v + 1);
      tick();
    },
    [tick],
  );

  const undo = useCallback(() => {
    applyHistory(historyRef.current.undo());
  }, [applyHistory]);

  const redo = useCallback(() => {
    applyHistory(historyRef.current.redo());
  }, [applyHistory]);

  const canUndo = historyRef.current.canUndo;
  const canRedo = historyRef.current.canRedo;
  void histVersion;

  /* ---------------- local autosave ---------------- */
  useEffect(() => {
    if (!historyReady.current) return;
    const t = window.setTimeout(() => {
      const at = saveProject(
        captureSnapshot(itemsRef.current, objectsRef.current, selectedRef.current),
        bgColor,
      );
      if (at) setSavedAt(at);
    }, 600);
    return () => window.clearTimeout(t);
  }, [histVersion, bgColor]);

  const newScene = useCallback(() => {
    clearProject();
    setSavedAt(null);
    if (typeof window !== "undefined") window.location.reload();
  }, []);

  /* ---------------- cut tool ---------------- */
  const applyCut = useCallback(() => {
    const tool = cutRef.current;
    const scene = sceneRef.current;
    if (!tool || !scene) return;
    const plane = tool.getPlane();
    const id = selectedRef.current;
    const obj = id ? objectsRef.current.get(id) : null;
    const mesh = obj as THREE.Mesh | null;
    if (!plane) {
      setCutError("Place at least 3 points to define the cut area.");
      return;
    }
    if (!mesh || !mesh.isMesh || !mesh.geometry) {
      setCutError("Select the object you want to cut first.");
      return;
    }

    mesh.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(mesh.matrixWorld).invert();
    const normalLocal = plane.normal
      .clone()
      .applyMatrix3(new THREE.Matrix3().getNormalMatrix(inv))
      .normalize();
    const pointLocal = plane.coplanarPoint(new THREE.Vector3()).applyMatrix4(inv);
    const localPlane = new THREE.Plane().setFromNormalAndCoplanarPoint(normalLocal, pointLocal);

    const res = sliceGeometry(mesh.geometry, localPlane);
    if (!res) {
      setCutError("The cut plane does not pass through the object.");
      return;
    }

    const item = itemsRef.current.find((i) => i.id === id) ?? null;
    const srcMat = mesh.material as THREE.Material;
    const build = (arr: Float32Array) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(arr, 3));
      g.computeVertexNormals();
      g.computeBoundingBox();
      g.computeBoundingSphere();
      g.userData["custom"] = true;
      g.userData["vertexEditOwned"] = true;
      const m = new THREE.Mesh(g, srcMat.clone());
      m.position.copy(mesh.position);
      m.rotation.copy(mesh.rotation);
      m.scale.copy(mesh.scale);
      m.castShadow = true;
      m.receiveShadow = true;
      m.userData["kind"] = item?.kind ?? "plane";
      m.userData["deformed"] = true;
      return m;
    };

    const mA = build(res.a);
    const mB = build(res.b);

    transformRef.current?.detach();
    handlesRef.current?.attach(null);
    vertexRef.current?.attach(null);
    scene.remove(mesh);
    mesh.geometry.dispose();
    if (id) objectsRef.current.delete(id);

    const idA = nextId();
    const idB = nextId();
    objectsRef.current.set(idA, mA);
    objectsRef.current.set(idB, mB);
    scene.add(mA);
    scene.add(mB);

    setItems((prev) =>
      prev.flatMap((p) =>
        p.id === id
          ? [
              { id: idA, name: `${p.name} A`, kind: p.kind },
              { id: idB, name: `${p.name} B`, kind: p.kind },
            ]
          : [p],
      ),
    );
    setSelected(idA);
    tool.clear();
    setCutMode(false);
    setCutError(null);
    tick();
  }, [tick]);

  /* remove everything inside the point cage (punch the area out) */
  const removeInside = useCallback(() => {
    const tool = cutRef.current;
    if (!tool) return;
    const plane = tool.getPlane();
    const pts = tool.getPoints();
    const id = selectedRef.current;
    const obj = id ? objectsRef.current.get(id) : null;
    const mesh = obj as THREE.Mesh | null;
    if (!plane || pts.length < 3) {
      setCutError("Place at least 3 points around the area you want to remove.");
      return;
    }
    if (!mesh || !mesh.isMesh || !mesh.geometry) {
      setCutError("Select the object you want to cut first.");
      return;
    }

    mesh.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(mesh.matrixWorld).invert();
    const normalLocal = plane.normal
      .clone()
      .applyMatrix3(new THREE.Matrix3().getNormalMatrix(inv))
      .normalize();
    const polyLocal = pts.map((p) => p.clone().applyMatrix4(inv));

    const arr = carveGeometry(mesh.geometry, polyLocal, normalLocal);
    if (!arr) {
      setCutError("That area does not cover any part of the object.");
      return;
    }

    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(arr, 3));
    g.computeVertexNormals();
    g.computeBoundingBox();
    g.computeBoundingSphere();
    g.userData["custom"] = true;
    g.userData["vertexEditOwned"] = true;

    vertexRef.current?.attach(null);
    const old = mesh.geometry;
    mesh.geometry = g;
    old.dispose();
    mesh.userData["deformed"] = true;

    tool.clear();
    setCutMode(false);
    setCutError(null);
    setItems((prev) => [...prev]);
    tick();
  }, [tick]);

  /* ---------------- join objects into one ---------------- */
  const toggleJoinId = useCallback((id: string) => {
    setJoinError(null);
    setJoinIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }, []);

  const joinObjects = useCallback(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    const ids = Array.from(new Set(joinIds));
    const meshes = ids
      .map((id) => ({ id, obj: objectsRef.current.get(id) }))
      .filter((e): e is { id: string; obj: THREE.Mesh } => {
        const m = e.obj as THREE.Mesh | undefined;
        return !!m && (m as THREE.Mesh).isMesh === true && !!m.geometry;
      });
    if (meshes.length < 2) {
      setJoinError("Pick at least 2 meshes in the outliner to join.");
      return;
    }

    const center = new THREE.Vector3();
    for (const { obj } of meshes) {
      obj.updateMatrixWorld(true);
      center.add(obj.getWorldPosition(new THREE.Vector3()));
    }
    center.multiplyScalar(1 / meshes.length);

    const positions: number[] = [];
    const toLocal = new THREE.Matrix4().makeTranslation(-center.x, -center.y, -center.z);
    for (const { obj } of meshes) {
      const src = obj.geometry.index ? obj.geometry.toNonIndexed() : obj.geometry;
      const pos = src.getAttribute("position") as THREE.BufferAttribute | undefined;
      if (pos) {
        const m = new THREE.Matrix4().multiplyMatrices(toLocal, obj.matrixWorld);
        const p = new THREE.Vector3();
        for (let i = 0; i < pos.count; i++) {
          p.set(pos.getX(i), pos.getY(i), pos.getZ(i)).applyMatrix4(m);
          positions.push(p.x, p.y, p.z);
        }
      }
      if (src !== obj.geometry) src.dispose();
    }
    if (!positions.length) {
      setJoinError("These objects have no geometry to join.");
      return;
    }

    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(positions), 3));
    g.computeVertexNormals();
    g.computeBoundingBox();
    g.computeBoundingSphere();
    g.userData["custom"] = true;
    g.userData["vertexEditOwned"] = true;

    const first = meshes[0]!.obj;
    const baseMat = first.material as THREE.Material;
    const merged = new THREE.Mesh(g, baseMat.clone());
    merged.position.copy(center);
    merged.castShadow = true;
    merged.receiveShadow = true;
    merged.userData["kind"] = first.userData["kind"] ?? "plane";
    merged.userData["deformed"] = true;

    transformRef.current?.detach();
    handlesRef.current?.attach(null);
    vertexRef.current?.attach(null);

    const idSet = new Set(meshes.map((m) => m.id));
    for (const { id, obj } of meshes) {
      scene.remove(obj);
      obj.geometry.dispose();
      objectsRef.current.delete(id);
    }

    const newId = nextId();
    objectsRef.current.set(newId, merged);
    scene.add(merged);

    const firstItem = itemsRef.current.find((i) => idSet.has(i.id));
    setItems((prev) => {
      const out: Item[] = [];
      let placed = false;
      for (const p of prev) {
        if (idSet.has(p.id)) {
          if (!placed) {
            out.push({
              id: newId,
              name: `${firstItem?.name ?? "Mesh"} (joined)`,
              kind: (firstItem?.kind ?? "plane") as Kind,
            });
            placed = true;
          }
          continue;
        }
        out.push(p);
      }
      return out;
    });
    setSelected(newId);
    setJoinIds([]);
    setJoinError(null);
    tick();
  }, [joinIds, tick]);


  useEffect(() => {
    const c = cutRef.current;
    if (!c) return;
    c.setEnabled(cutMode);
    if (!cutMode) {
      c.clear();
      setCutError(null);
    }
  }, [cutMode]);

  useEffect(() => {
    setJoinIds((prev) => {
      const next = prev.filter((id) => items.some((i) => i.id === id));
      return next.length === prev.length ? prev : next;
    });
  }, [items]);

  /* ---------------- right click menu actions ---------------- */
  const menuActions = useMemo(() => {
    const id = menu?.id ?? null;
    const obj = id ? (objectsRef.current.get(id) ?? null) : null;
    const solid = obj?.userData['solid'] === true;
    const list: {
      key: string;
      label?: string;
      icon?: ReactNode;
      run?: () => void;
      disabled?: boolean;
      sep?: boolean;
    }[] = [
      {
        key: "move",
        label: "Move (G)",
        icon: <Move3d className="size-3.5" />,
        disabled: !obj,
        run: () => setMode("translate"),
      },
      {
        key: "rotate",
        label: "Rotate (R)",
        icon: <Rotate3d className="size-3.5" />,
        disabled: !obj,
        run: () => setMode("rotate"),
      },
      {
        key: "scale",
        label: "Scale (S)",
        icon: <Scaling className="size-3.5" />,
        disabled: !obj,
        run: () => setMode("scale"),
      },
      { key: "s1", sep: true },
      {
        key: "points",
        label: pointsOn ? "Hide 4 points" : "Show 4 points",
        icon: <Frame className="size-3.5" />,
        disabled: !obj,
        run: () => setPointsOn((v) => !v),
      },
      {
        key: "solid",
        label: solid ? "Make passable" : "Make solid",
        icon: solid ? <ShieldOff className="size-3.5" /> : <Shield className="size-3.5" />,
        disabled: !obj,
        run: () => {
          if (obj) obj.userData['solid'] = !solid;
          tick();
        },
      },
      {
        key: "place",
        label: "Place on surface (P)",
        icon: <MapPin className="size-3.5" />,
        disabled: !obj,
        run: () => setMode("place"),
      },
      {
        key: "focus",
        label: "Focus view",
        icon: <Focus className="size-3.5" />,
        disabled: !obj,
        run: () => {
          const orbit = orbitRef.current;
          const cam = cameraRef.current;
          if (!obj || !orbit || !cam) return;
          const target = obj.getWorldPosition(new THREE.Vector3());
          const dir = cam.position.clone().sub(orbit.target).normalize();
          orbit.target.copy(target);
          cam.position.copy(target).addScaledVector(dir, 6);
        },
      },
      { key: "s2", sep: true },
      {
        key: "dup",
        label: "Duplicate",
        icon: <Copy className="size-3.5" />,
        disabled: !obj,
        run: duplicateSelected,
      },
      {
        key: "del",
        label: "Delete",
        icon: <Trash2 className="size-3.5" />,
        disabled: !obj,
        run: removeSelected,
      },
      { key: "s3", sep: true },
      {
        key: "quad",
        label: "Quad from 4 points",
        icon: <PenTool className="size-3.5" />,
        run: () => {
          cancelQuadRef.current?.();
          setQuadMode(true);
        },
      },
      {
        key: "grid",
        label: showGrid ? "Hide grid" : "Show grid",
        icon: <Grid3x3 className="size-3.5" />,
        run: () => setShowGrid((v) => !v),
      },
    ];
    return list;
  }, [menu, pointsOn, showGrid, duplicateSelected, removeSelected, tick]);

  /* ---------------- keyboard shortcuts ---------------- */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target && /input|textarea|select/i.test(target.tagName)) return;
      const k = e.key.toLowerCase();
      if (walkModeRef.current) {
        if (k === "escape" || k === "f") setWalkMode(false);
        return;
      }
      if (e.ctrlKey || e.metaKey) {
        if (k === "z" && e.shiftKey) {
          e.preventDefault();
          redo();
        } else if (k === "z") {
          e.preventDefault();
          undo();
        } else if (k === "y") {
          e.preventDefault();
          redo();
        } else if (k === "j") {
          e.preventDefault();
          joinObjects();
        }
        return;
      }
      if (k === "f") setWalkMode(true);
      else if (k === "c") setCutMode((v) => !v);
      else if (k === "g") setMode("translate");
      else if (k === "r") setMode("rotate");
      else if (k === "s") setMode("scale");
      else if (k === "p") setMode("place");
      else if (k === "v") setVertexMode((v) => !v);
      else if (k === "x" || k === "delete") removeSelected();
      else if (k === "d" && e.shiftKey) {
        e.preventDefault();
        duplicateSelected();
      } else if (k === "escape") {
        if (modeRef.current === "place") setMode("translate");
        setVertexMode(false);
        cancelQuadRef.current?.();
        setQuadMode(false);
        setCutMode(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [removeSelected, duplicateSelected, undo, redo, joinObjects]);

  const setCameraPreset = (preset: "iso" | "top" | "front" | "side") => {
    const cam = cameraRef.current;
    const orb = orbitRef.current;
    if (!cam || !orb) return;
    if (preset === "top") {
      cam.position.set(0, 10, 0.001);
    } else if (preset === "front") {
      cam.position.set(0, 1.5, 9);
    } else if (preset === "side") {
      cam.position.set(9, 1.5, 0);
    } else {
      cam.position.set(5, 4, 7);
    }
    orb.target.set(0, 0.5, 0);
    orb.update();
    tick();
  };

  /* ---------------- code -> model ---------------- */
  const runScript = useCallback(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    const res = runUserCode(script);
    setScriptLog(res.logs);
    if (res.error) {
      setScriptError(res.error);
      return;
    }
    if (!res.objects.length) {
      setScriptError("Nothing was added. Use scene.add(mesh) in your code.");
      return;
    }
    setScriptError(null);
    const created: Item[] = [];
    for (const obj of res.objects) {
      const kind = kindOf(obj);
      obj.userData['kind'] = kind;
      obj.userData['deformed'] = true;
      const mesh = obj as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        if (obj.userData['solid'] === undefined) obj.userData['solid'] = true;
      }
      const id = nextId();
      objectsRef.current.set(id, obj);
      scene.add(obj);
      created.push({ id, name: obj.name || `${labelFor(kind)} (code)`, kind });
    }
    setItems((prev) => [...prev, ...created]);
    setSelected(created[0]!.id);
    tick();
  }, [script, tick]);

  /* ---------------- code export ---------------- */
  const code = useMemo(() => {
    const list = items
      .map((i) => ({ ...i, object: objectsRef.current.get(i.id)! }))
      .filter((i) => i.object);
    return generateThreeCode(list, BG);
  }, [items, codeOpen, selected, forceTick]);

  const download = () => {
    const blob = new Blob([code], { type: "text/javascript" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "scene.js";
    a.click();
    URL.revokeObjectURL(url);
  };

  const selItem = items.find((i) => i.id === selected) ?? null;
  const selObj = selected ? (objectsRef.current.get(selected) ?? null) : null;

  return (
    <div className="flex h-screen w-full flex-col overflow-hidden bg-background text-foreground select-none">
      {/* top bar */}
      <header className="flex items-center gap-3 border-b border-border bg-card px-4 py-2">
        <div className="flex items-center gap-2">
          <div className="flex size-6 items-center justify-center rounded bg-primary text-primary-foreground font-bold text-xs">
            3D
          </div>
          <span className="text-sm font-semibold tracking-tight">RenderCraft Modeler</span>
        </div>
        <span className="hidden text-xs text-muted-foreground sm:inline">
          G move · R rotate · S scale · C cut · Ctrl+J join · Ctrl+Z undo · Ctrl+Shift+Z redo · X
          delete
        </span>
        <div className="ml-auto flex items-center gap-2">
          <span className="hidden text-[11px] text-muted-foreground md:inline">
            {savedAt
              ? `Saved ${new Date(savedAt).toLocaleTimeString()}`
              : "Not saved yet"}
          </span>
          <button
            onClick={() => {
              const at = saveProject(
                captureSnapshot(itemsRef.current, objectsRef.current, selectedRef.current),
                bgColor,
              );
              if (at) setSavedAt(at);
            }}
            title="Save project to this browser"
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-secondary px-2.5 py-1.5 text-xs font-medium cursor-pointer transition-colors hover:bg-accent hover:text-foreground"
          >
            <Save className="size-3.5" /> Save
          </button>
          <button
            onClick={newScene}
            title="Clear the saved project and start fresh"
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-secondary px-2.5 py-1.5 text-xs font-medium cursor-pointer transition-colors hover:bg-accent hover:text-foreground"
          >
            <FilePlus2 className="size-3.5" /> New scene
          </button>
          <div className="flex items-center gap-1">
            <button
              onClick={undo}
              disabled={!canUndo}
              title="Undo (Ctrl+Z)"
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-secondary px-2.5 py-1.5 text-xs font-medium cursor-pointer transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Undo2 className="size-3.5" /> Undo
            </button>
            <button
              onClick={redo}
              disabled={!canRedo}
              title="Redo (Ctrl+Shift+Z)"
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-secondary px-2.5 py-1.5 text-xs font-medium cursor-pointer transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Redo2 className="size-3.5" /> Redo
            </button>
          </div>
          <button
            onClick={() => setSidebarOpen((v) => !v)}
            title="Toggle Inspector & Properties Panel"
            className={`inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium cursor-pointer transition-colors ${
              sidebarOpen
                ? "bg-secondary text-foreground hover:bg-accent"
                : "bg-secondary/60 text-muted-foreground hover:bg-accent hover:text-foreground"
            }`}
          >
            <PanelRight className="size-3.5 text-primary" /> {sidebarOpen ? "Hide Panel" : "Show Panel"}
          </button>
          <button
            onClick={() => setWalkMode((v) => !v)}
            className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium cursor-pointer transition-colors ${
              walkMode
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-secondary hover:bg-accent hover:text-foreground"
            }`}
          >
            <Footprints className="size-3.5" /> {walkMode ? "Walking (Esc)" : "Walk (F)"}
          </button>
          <button
            onClick={() => {
              setScriptOpen((v) => !v);
              setCodeOpen(false);
            }}
            className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium cursor-pointer transition-colors ${
              scriptOpen
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-secondary hover:bg-accent hover:text-foreground"
            }`}
          >
            <Terminal className="size-3.5" /> Code → Model
          </button>
          <button
            onClick={() => {
              setCodeOpen((v) => !v);
              setScriptOpen(false);
            }}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-secondary px-2.5 py-1.5 text-xs font-medium cursor-pointer transition-colors hover:bg-accent hover:text-foreground"
          >
            <Code2 className="size-3.5" /> {codeOpen ? "Hide Code" : "View Three.js Code"}
          </button>
          <button
            onClick={download}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground cursor-pointer transition-colors hover:bg-primary/90 shadow-sm"
          >
            <Download className="size-3.5" /> Download scene.js
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 w-full overflow-hidden">
        {/* left toolshelf */}
        <aside className="w-44 shrink-0 overflow-y-auto border-r border-border bg-card p-2">
          <p className="px-1 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Add Mesh
          </p>
          <div className="grid grid-cols-3 gap-1">
            {(Object.keys(GEOMETRY_SPECS) as MeshKind[]).map((k) => {
              const Icon = MESH_ICONS[k] ?? Box;
              return (
                <button
                  key={k}
                  draggable
                  onDragStart={(e) => {
                    const data = { type: "create" as const, kind: k, name: GEOMETRY_SPECS[k].label };
                    e.dataTransfer.setData("application/json", JSON.stringify(data));
                    e.dataTransfer.effectAllowed = "copy";
                    setDraggedPayload(data);
                  }}
                  onDragEnd={() => {
                    setDraggedPayload(null);
                    setDropTarget(null);
                    if (dropIndicatorRef.current && modeRef.current !== "place") {
                      dropIndicatorRef.current.visible = false;
                    }
                  }}
                  title={`${GEOMETRY_SPECS[k].label} (Click to add or drag into scene)`}
                  onClick={() => addObject(k)}
                  className="flex aspect-square items-center justify-center rounded-md border border-border bg-secondary text-muted-foreground cursor-grab active:cursor-grabbing transition-colors hover:bg-accent hover:text-foreground hover:border-primary/50"
                >
                  <Icon className="size-4" />
                </button>
              );
            })}
          </div>

          <p className="px-1 pb-1 pt-4 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Add Light
          </p>
          <div className="grid grid-cols-2 gap-1">
            {(Object.keys(LIGHT_ICONS) as (keyof typeof LIGHT_ICONS)[]).map((k) => {
              const Icon = LIGHT_ICONS[k];
              return (
                <button
                  key={k}
                  draggable
                  onDragStart={(e) => {
                    const data = { type: "create" as const, kind: k, name: labelFor(k) };
                    e.dataTransfer.setData("application/json", JSON.stringify(data));
                    e.dataTransfer.effectAllowed = "copy";
                    setDraggedPayload(data);
                  }}
                  onDragEnd={() => {
                    setDraggedPayload(null);
                    setDropTarget(null);
                    if (dropIndicatorRef.current && modeRef.current !== "place") {
                      dropIndicatorRef.current.visible = false;
                    }
                  }}
                  title={`${labelFor(k)} (Click to add or drag into scene)`}
                  onClick={() => addObject(k)}
                  className="flex items-center gap-1.5 rounded-md border border-border bg-secondary px-2 py-1.5 text-[11px] text-muted-foreground cursor-grab active:cursor-grabbing transition-colors hover:bg-accent hover:text-foreground hover:border-primary/50"
                >
                  <Icon className="size-3.5 shrink-0" />
                  <span className="truncate">{labelFor(k).split(" ")[0]}</span>
                </button>
              );
            })}
          </div>

          <p className="px-1 pb-1 pt-4 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Transform
          </p>
          <div className="grid grid-cols-4 gap-1">
            {(
              [
                ["translate", Move3d, "Move (G)"],
                ["rotate", Rotate3d, "Rotate (R)"],
                ["scale", Scaling, "Scale (S)"],
                ["place", MapPin, "Place on surface (P)"],
              ] as const
            ).map(([m, Icon, tip]) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                title={tip}
                className={`flex aspect-square items-center justify-center rounded-md border cursor-pointer transition-colors ${
                  mode === m
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-secondary text-muted-foreground hover:bg-accent hover:text-foreground"
                }`}
              >
                <Icon className="size-4" />
              </button>
            ))}
          </div>

          <p className="px-1 pb-1 pt-4 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Point Cage
          </p>
          <div className="space-y-1">
            <button
              onClick={() => setPointsOn((v) => !v)}
              className={`flex w-full items-center gap-2 rounded-md border px-2 py-1.5 text-[11px] cursor-pointer transition-colors ${
                pointsOn
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-secondary text-muted-foreground hover:bg-accent hover:text-foreground"
              }`}
            >
              <Frame className="size-3.5" /> {pointsOn ? "Points on" : "4 points"}
            </button>

            {pointsOn && (
              <>
                <div className="grid grid-cols-3 gap-1">
                  {(["xy", "xz", "zy"] as HandlePlane[]).map((p) => (
                    <button
                      key={p}
                      onClick={() => setHandlePlane(p)}
                      className={`rounded-md border py-1 text-[10px] uppercase cursor-pointer transition-colors ${
                        handlePlane === p
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-border bg-secondary text-muted-foreground hover:bg-accent"
                      }`}
                    >
                      {p}
                    </button>
                  ))}
                </div>
                <div className="grid grid-cols-2 gap-1">
                  {(
                    [
                      ["linked", "Anchor"],
                      ["free", "Free"],
                    ] as [HandleMode, string][]
                  ).map(([m, lbl]) => (
                    <button
                      key={m}
                      onClick={() => setHandleMode(m)}
                      className={`rounded-md border py-1 text-[10px] cursor-pointer transition-colors ${
                        handleMode === m
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-border bg-secondary text-muted-foreground hover:bg-accent"
                      }`}
                    >
                      {lbl}
                    </button>
                  ))}
                </div>
                <p className="px-0.5 text-[9px] text-muted-foreground">
                  Hold Ctrl while dragging in anchor mode to scale symmetrically.
                </p>
                <label className="block px-0.5 pt-1 text-[10px] text-muted-foreground">
                  <span className="flex items-center justify-between">
                    <span className="inline-flex items-center gap-1">
                      <Spline className="size-3" /> Curve
                    </span>
                    <span className="font-mono">{curve.toFixed(2)}</span>
                  </span>
                  <input
                    type="range"
                    min={-1}
                    max={1}
                    step={0.01}
                    value={curve}
                    onChange={(e) => setCurve(parseFloat(e.target.value))}
                    className="mt-1 w-full accent-primary cursor-pointer"
                  />
                </label>
                <button
                  onClick={() => {
                    handlesRef.current?.reset();
                    setCurve(0);
                  }}
                  className="flex w-full items-center gap-2 rounded-md border border-border bg-secondary px-2 py-1.5 text-[11px] text-muted-foreground cursor-pointer transition-colors hover:bg-accent hover:text-foreground"
                >
                  <RotateCcw className="size-3.5" /> Reset shape
                </button>
              </>
            )}
          </div>

          <p className="px-1 pb-1 pt-4 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Vertex Sculpt
          </p>
          <div className="space-y-1">
            <button
              onClick={() => setVertexMode((v) => !v)}
              title="Click on the selected object to drop points, then drag them (V)"
              className={`flex w-full items-center gap-2 rounded-md border px-2 py-1.5 text-[11px] cursor-pointer transition-colors ${
                vertexMode
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-secondary text-muted-foreground hover:bg-accent hover:text-foreground"
              }`}
            >
              <Target className="size-3.5" /> {vertexMode ? `Sculpting (${vertexCount})` : "Vertex drag"}
            </button>

            {vertexMode && (
              <>
                <label className="block px-0.5 pt-1 text-[10px] text-muted-foreground">
                  <span className="flex items-center justify-between">
                    <span className="inline-flex items-center gap-1">
                      <Compass className="size-3" /> Falloff
                    </span>
                    <span className="font-mono">{vertexRadius.toFixed(2)}</span>
                  </span>
                  <input
                    type="range"
                    min={0.05}
                    max={3}
                    step={0.05}
                    value={vertexRadius}
                    onChange={(e) => setVertexRadius(parseFloat(e.target.value))}
                    className="mt-1 w-full accent-primary cursor-pointer"
                  />
                </label>
                <label className="block px-0.5 text-[10px] text-muted-foreground">
                  <span className="flex items-center justify-between">
                    <span className="inline-flex items-center gap-1">
                      <GripVertical className="size-3" /> Strength
                    </span>
                    <span className="font-mono">{vertexStrength.toFixed(2)}</span>
                  </span>
                  <input
                    type="range"
                    min={0.1}
                    max={2}
                    step={0.05}
                    value={vertexStrength}
                    onChange={(e) => setVertexStrength(parseFloat(e.target.value))}
                    className="mt-1 w-full accent-primary cursor-pointer"
                  />
                </label>
                <button
                  onClick={() => vertexRef.current?.removeLastPoint()}
                  className="flex w-full items-center gap-2 rounded-md border border-border bg-secondary px-2 py-1.5 text-[11px] text-muted-foreground cursor-pointer transition-colors hover:bg-accent hover:text-foreground"
                >
                  <RotateCcw className="size-3.5" /> Undo last point
                </button>
                <button
                  onClick={() => vertexRef.current?.clearPoints()}
                  className="flex w-full items-center gap-2 rounded-md border border-border bg-secondary px-2 py-1.5 text-[11px] text-muted-foreground cursor-pointer transition-colors hover:bg-accent hover:text-foreground"
                >
                  <Trash2 className="size-3.5" /> Clear points
                </button>
                <button
                  onClick={() => vertexRef.current?.resetShape()}
                  className="flex w-full items-center gap-2 rounded-md border border-border bg-secondary px-2 py-1.5 text-[11px] text-muted-foreground cursor-pointer transition-colors hover:bg-accent hover:text-foreground"
                >
                  <RotateCcw className="size-3.5" /> Reset mesh shape
                </button>
                <p className="px-0.5 text-[9px] text-muted-foreground">
                  Click the selected mesh to drop a point, then drag the point to pull the surface.
                </p>
              </>
            )}
          </div>

          <p className="px-1 pb-1 pt-4 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Tools
          </p>
          <div className="space-y-1">
            <button
              onClick={() => {
                setQuadMode((v) => !v);
                cancelQuadRef.current?.();
              }}
              className={`flex w-full items-center gap-2 rounded-md border px-2 py-1.5 text-[11px] cursor-pointer transition-colors ${
                quadMode
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-secondary text-muted-foreground hover:bg-accent hover:text-foreground"
              }`}
            >
              <PenTool className="size-3.5" /> {quadMode ? "Placing points..." : "Quad from 4 pts"}
            </button>
            <button
              onClick={() => setSnapOn((v) => !v)}
              className={`flex w-full items-center gap-2 rounded-md border px-2 py-1.5 text-[11px] cursor-pointer transition-colors ${
                snapOn
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-secondary text-muted-foreground hover:bg-accent hover:text-foreground"
              }`}
            >
              <Magnet className="size-3.5" /> {snapOn ? "Snap on" : "Snap off"}
            </button>
            <button
              onClick={() => setCutMode((v) => !v)}
              className={`flex w-full items-center gap-2 rounded-md border px-2 py-1.5 text-[11px] cursor-pointer transition-colors ${
                cutMode
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-secondary text-muted-foreground hover:bg-accent hover:text-foreground"
              }`}
            >
              <Scissors className="size-3.5" /> {cutMode ? "Cutting..." : "Cut tool (C)"}
            </button>
            {cutMode && (
              <div className="space-y-1 rounded-md border border-primary/40 bg-secondary/50 p-2">
                <p className="text-[10px] text-muted-foreground">
                  Click 4 or more points around the area. The region fills with colour, points can
                  be dragged, and guides show when they line up.
                </p>
                <div className="flex flex-wrap gap-1">
                  {cutStatus.aligned.slice(0, 4).map((a) => (
                    <span
                      key={a}
                      className="rounded bg-primary/20 px-1.5 py-0.5 text-[9px] text-primary"
                    >
                      {a}
                    </span>
                  ))}
                </div>
                <button
                  onClick={() => cutRef.current?.flatten()}
                  className="flex w-full items-center gap-2 rounded-md border border-border bg-secondary px-2 py-1.5 text-[11px] text-muted-foreground cursor-pointer transition-colors hover:bg-accent hover:text-foreground"
                >
                  <Ruler className="size-3.5" /> Make area perfectly flat
                </button>
                <button
                  onClick={() => cutRef.current?.removeLast()}
                  className="flex w-full items-center gap-2 rounded-md border border-border bg-secondary px-2 py-1.5 text-[11px] text-muted-foreground cursor-pointer transition-colors hover:bg-accent hover:text-foreground"
                >
                  <RotateCcw className="size-3.5" /> Remove last point
                </button>
                <button
                  onClick={() => {
                    cutRef.current?.clear();
                    setCutError(null);
                  }}
                  className="flex w-full items-center gap-2 rounded-md border border-border bg-secondary px-2 py-1.5 text-[11px] text-muted-foreground cursor-pointer transition-colors hover:bg-accent hover:text-foreground"
                >
                  <Trash2 className="size-3.5" /> Clear points
                </button>
                <button
                  onClick={applyCut}
                  disabled={cutStatus.count < 3}
                  className="flex w-full items-center gap-2 rounded-md bg-primary px-2 py-1.5 text-[11px] font-semibold text-primary-foreground cursor-pointer transition-colors hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Scissors className="size-3.5" /> Apply cut
                </button>
                <button
                  onClick={removeInside}
                  disabled={cutStatus.count < 3}
                  className="flex w-full items-center gap-2 rounded-md bg-destructive px-2 py-1.5 text-[11px] font-semibold text-destructive-foreground cursor-pointer transition-colors hover:bg-destructive/90 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Eraser className="size-3.5" /> Remove inside area
                </button>
                {cutError && <p className="text-[10px] text-destructive">{cutError}</p>}
              </div>
            )}

            <div className="mt-2 space-y-1 rounded-md border border-border bg-secondary/40 p-2">
              <p className="text-[10px] font-semibold text-foreground flex items-center gap-1.5">
                <Combine className="size-3.5" /> Join meshes
              </p>
              <p className="text-[10px] text-muted-foreground">
                Ctrl+click objects in the outliner to tick them, then join them into one mesh.
              </p>
              <p className="text-[10px] text-primary">{joinIds.length} object(s) picked</p>
              <button
                onClick={joinObjects}
                disabled={joinIds.length < 2}
                className="flex w-full items-center gap-2 rounded-md bg-primary px-2 py-1.5 text-[11px] font-semibold text-primary-foreground cursor-pointer transition-colors hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Combine className="size-3.5" /> Join into one (Ctrl+J)
              </button>
              {joinIds.length > 0 && (
                <button
                  onClick={() => {
                    setJoinIds([]);
                    setJoinError(null);
                  }}
                  className="flex w-full items-center gap-2 rounded-md border border-border bg-secondary px-2 py-1.5 text-[11px] text-muted-foreground cursor-pointer transition-colors hover:bg-accent hover:text-foreground"
                >
                  <SquareDashed className="size-3.5" /> Clear picks
                </button>
              )}
              {joinError && <p className="text-[10px] text-destructive">{joinError}</p>}
            </div>
          </div>


          <div className="mt-4 space-y-1">
            <button
              onClick={duplicateSelected}
              className="flex w-full items-center gap-2 rounded-md border border-border bg-secondary px-2 py-1.5 text-[11px] text-muted-foreground cursor-pointer transition-colors hover:bg-accent hover:text-foreground"
            >
              <Copy className="size-3.5" /> Duplicate
            </button>
            <button
              onClick={removeSelected}
              className="flex w-full items-center gap-2 rounded-md border border-border bg-secondary px-2 py-1.5 text-[11px] text-muted-foreground cursor-pointer transition-colors hover:bg-destructive hover:text-destructive-foreground"
            >
              <Trash2 className="size-3.5" /> Delete
            </button>
            <button
              onClick={() => setShowGrid((v) => !v)}
              className="flex w-full items-center gap-2 rounded-md border border-border bg-secondary px-2 py-1.5 text-[11px] text-muted-foreground cursor-pointer transition-colors hover:bg-accent hover:text-foreground"
            >
              <Grid3x3 className="size-3.5" /> {showGrid ? "Hide grid" : "Show grid"}
            </button>
          </div>
        </aside>

        {/* viewport */}
        <main
          className="relative min-w-0 flex-1 select-none overflow-hidden h-full"
          onDragOver={(e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = "copy";
            if (!computeDropPositionRef.current) return;
            const target = computeDropPositionRef.current(
              e.clientX,
              e.clientY,
              draggedPayload?.type === "move" ? draggedPayload.id : null,
            );
            if (target && dropIndicatorRef.current) {
              dropIndicatorRef.current.position.copy(target.point);
              dropIndicatorRef.current.visible = true;
              setDropTarget({
                x: Math.round(target.point.x * 100) / 100,
                y: Math.round(target.point.y * 100) / 100,
                z: Math.round(target.point.z * 100) / 100,
              });
            } else if (dropIndicatorRef.current) {
              dropIndicatorRef.current.visible = false;
              setDropTarget(null);
            }
          }}
          onDragLeave={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node)) {
              if (dropIndicatorRef.current && modeRef.current !== "place") {
                dropIndicatorRef.current.visible = false;
              }
              setDropTarget(null);
            }
          }}
          onDrop={(e) => {
            e.preventDefault();
            let payload = draggedPayload;
            if (!payload) {
              try {
                const raw = e.dataTransfer.getData("application/json");
                if (raw) payload = JSON.parse(raw);
              } catch {
                // ignore
              }
            }
            if (!payload || !computeDropPositionRef.current) return;

            const target = computeDropPositionRef.current(
              e.clientX,
              e.clientY,
              payload.type === "move" ? payload.id : null,
            );

            if (target) {
              if (payload.type === "move" && payload.id) {
                const obj = objectsRef.current.get(payload.id);
                if (obj) {
                  placeObjectAt(obj, target.point);
                  tick();
                  setSelected(payload.id);
                }
              } else if (payload.type === "create" && payload.kind) {
                addObject(payload.kind, undefined, target.point);
                tick();
              }
            }

            setDraggedPayload(null);
            setDropTarget(null);
            if (dropIndicatorRef.current && modeRef.current !== "place") {
              dropIndicatorRef.current.visible = false;
            }
          }}
        >
          <div ref={mountRef} className="absolute inset-0 overflow-hidden cursor-grab active:cursor-grabbing" />

          {/* Drag or Place floating status indicator */}
          {(draggedPayload || mode === "place") && (
            <div className="pointer-events-none absolute top-3 left-1/2 -translate-x-1/2 z-20 flex items-center gap-2.5 rounded-full border border-primary/40 bg-card/95 px-4 py-2 text-xs font-medium text-foreground shadow-xl backdrop-blur">
              <div className="flex size-2 rounded-full bg-sky-400 animate-pulse" />
              {draggedPayload ? (
                <span>
                  Drop <strong className="text-primary">{draggedPayload.name}</strong> on any surface or ground
                </span>
              ) : (
                <span>
                  <strong>Place Mode:</strong> Click any surface/ground to place selected object
                </span>
              )}
              {dropTarget && (
                <span className="font-mono text-[10px] text-muted-foreground bg-secondary px-1.5 py-0.5 rounded border border-border">
                  X: {dropTarget.x} Y: {dropTarget.y} Z: {dropTarget.z}
                </span>
              )}
              {mode === "place" && (
                <button
                  type="button"
                  onClick={() => setMode("translate")}
                  className="pointer-events-auto ml-1 rounded bg-secondary px-2 py-0.5 text-[10px] text-muted-foreground hover:bg-accent hover:text-foreground cursor-pointer border border-border"
                >
                  Done (Esc)
                </button>
              )}
            </div>
          )}

          {/* Scale mode guidance overlay */}
          {mode === "scale" && (
            <div className="pointer-events-none absolute top-3 left-1/2 -translate-x-1/2 z-20 flex items-center gap-2 rounded-full border border-border bg-card/95 px-3.5 py-1.5 text-xs font-medium text-foreground shadow-lg backdrop-blur">
              <div
                className={`size-2 rounded-full transition-colors ${
                  isCtrlPressed ? "bg-emerald-400 animate-pulse" : "bg-primary"
                }`}
              />
              {isCtrlPressed ? (
                <span className="flex items-center gap-1.5">
                  <strong className="text-emerald-400">2-Sides Scale:</strong>
                  <span>Both sides expanding symmetrically from center (Ctrl active)</span>
                </span>
              ) : (
                <span className="flex items-center gap-1.5">
                  <strong className="text-primary">1-Side Scale:</strong>
                  <span>Dragging 1 side only (opposite anchored).</span>
                  <span className="text-muted-foreground font-normal">
                    Hold <kbd className="rounded bg-secondary px-1.5 py-0.5 text-[10px] font-mono border border-border text-foreground font-semibold">Ctrl</kbd> for both sides
                  </span>
                </span>
              )}
            </div>
          )}

          {vertexMode && (
            <div className="pointer-events-none absolute left-1/2 bottom-4 z-10 -translate-x-1/2 rounded-md border border-primary/40 bg-card/90 px-3 py-1.5 text-[11px] text-foreground backdrop-blur">
              <strong className="text-primary">Vertex drag:</strong> click the selected object to add a
              point ({vertexCount}) · drag a point to reshape · Esc to exit
            </div>
          )}

          {quadMode && (
            <div className="pointer-events-none absolute left-1/2 top-3 z-10 -translate-x-1/2 rounded-md border border-border bg-card/90 px-3 py-1.5 text-[11px] text-muted-foreground backdrop-blur">
              Click 4 points in the viewport to build a quad ({quadCount}/4)
            </div>
          )}

          {cutMode && (
            <div className="pointer-events-none absolute left-1/2 bottom-4 z-10 -translate-x-1/2 rounded-md border border-primary/40 bg-card/90 px-3 py-1.5 text-[11px] text-foreground backdrop-blur">
              <strong className="text-primary">Cut:</strong> {cutStatus.count} point
              {cutStatus.count === 1 ? "" : "s"} placed · drag them to align
              {cutStatus.aligned.length > 0 && (
                <span className="text-primary"> · {cutStatus.aligned[0]}</span>
              )}
              {cutStatus.count >= 3 && (
                <span className={cutStatus.planar ? "text-green-400" : "text-amber-400"}>
                  {" "}
                  · {cutStatus.planar ? "area is flat" : "area is not flat"}
                </span>
              )}
            </div>
          )}

          {menu && (
            <>
              <div className="absolute inset-0 z-20" onPointerDown={() => setMenu(null)} />
              <div
                className="absolute z-30 w-48 overflow-hidden rounded-md border border-border bg-card py-1 shadow-xl"
                style={{ left: menu.x, top: menu.y }}
              >
                {menuActions.map((a) =>
                  a.sep ? (
                    <div key={a.key} className="my-1 border-t border-border" />
                  ) : (
                    <button
                      key={a.key}
                      disabled={a.disabled}
                      onClick={() => {
                        a.run?.();
                        setMenu(null);
                      }}
                      className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11px] text-muted-foreground cursor-pointer transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {a.icon}
                      {a.label}
                    </button>
                  ),
                )}
              </div>
            </>
          )}
          {codeOpen && (
            <div className="absolute inset-y-0 right-0 z-10 w-[min(560px,60%)] overflow-auto border-l border-border bg-card/95 p-4 backdrop-blur shadow-2xl">
              <div className="flex items-center justify-between pb-3 mb-3 border-b border-border">
                <span className="text-xs font-semibold flex items-center gap-1.5">
                  <Code2 className="size-4 text-primary" /> Generated Three.js Code
                </span>
                <button
                  onClick={download}
                  className="inline-flex items-center gap-1 rounded bg-primary px-2 py-1 text-[11px] font-medium text-primary-foreground cursor-pointer hover:bg-primary/90"
                >
                  <Download className="size-3" /> Download .js
                </button>
              </div>
              <pre className="whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-muted-foreground selection:bg-primary/30">
                {code}
              </pre>
            </div>
          )}
          {scriptOpen && (
            <div className="absolute inset-y-0 right-0 z-10 flex w-[min(560px,60%)] flex-col border-l border-border bg-card/95 p-4 backdrop-blur shadow-2xl">
              <div className="flex items-center justify-between pb-3 mb-3 border-b border-border">
                <span className="text-xs font-semibold flex items-center gap-1.5">
                  <Terminal className="size-4 text-primary" /> Code → Model
                </span>
                <button
                  onClick={runScript}
                  className="inline-flex items-center gap-1 rounded bg-primary px-2 py-1 text-[11px] font-medium text-primary-foreground cursor-pointer hover:bg-primary/90"
                >
                  <Play className="size-3" /> Run code
                </button>
              </div>
              <p className="pb-2 text-[10px] text-muted-foreground">
                Write plain Three.js. <code>THREE</code> and <code>scene</code> are ready — every
                object you add to <code>scene</code> shows up in the list on the right.
              </p>
              <textarea
                value={script}
                onChange={(e) => setScript(e.target.value)}
                spellCheck={false}
                className="min-h-0 flex-1 w-full resize-none rounded-md border border-border bg-background p-3 font-mono text-[11px] leading-relaxed text-foreground outline-none focus:border-primary"
              />
              {scriptError && (
                <p className="pt-2 text-[11px] text-destructive break-words">{scriptError}</p>
              )}
              {scriptLog.length > 0 && (
                <pre className="mt-2 max-h-24 overflow-auto rounded bg-secondary/50 p-2 font-mono text-[10px] text-muted-foreground">
                  {scriptLog.join("\n")}
                </pre>
              )}
            </div>
          )}
          {walkMode && (
            <div className="pointer-events-none absolute inset-0 z-10">
              <div className="absolute left-1/2 top-1/2 size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/80" />
              <div className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-md bg-black/60 px-3 py-1.5 text-[11px] text-white">
                WASD walk · Shift run · Space jump · mouse look · Esc to leave — only objects marked
                solid block you
              </div>
            </div>
          )}
        </main>

        {/* right panels */}
        <aside
          className={`flex flex-col border-l border-border bg-card relative z-20 shrink-0 transition-[width,opacity] duration-150 shadow-md ${
            sidebarOpen ? "w-80" : "hidden"
          }`}
        >
          {/* Outliner section */}
          <div className="max-h-64 overflow-y-auto border-b border-border p-2.5">
            <div className="flex items-center justify-between px-1 pb-1.5">
              <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                <Layers className="size-3.5 text-primary" />
                <span>Outliner ({items.length})</span>
              </div>
              <span className="text-[9px] text-muted-foreground/80 font-mono">Drag to reorder/place</span>
            </div>

            {items.length === 0 ? (
              <div className="rounded border border-dashed border-border p-3 text-center">
                <p className="text-xs text-muted-foreground">Scene is empty</p>
                <button
                  type="button"
                  onClick={() => addObject("box")}
                  className="mt-2 inline-flex items-center gap-1 rounded bg-secondary px-2.5 py-1 text-[11px] text-primary hover:bg-accent cursor-pointer border border-border"
                >
                  <Box className="size-3" /> Add Cube
                </button>
              </div>
            ) : (
              <div className="space-y-1">
                {items.map((i, idx) => {
                  const isSel = selected === i.id;
                  const isOver = outlinerDragOverIdx === idx;
                  return (
                    <div
                      key={i.id}
                      draggable
                      onDragStart={(e) => {
                        const data = { type: "move" as const, id: i.id, name: i.name };
                        e.dataTransfer.setData("application/json", JSON.stringify(data));
                        e.dataTransfer.effectAllowed = "all";
                        setDraggedPayload(data);
                        setSelected(i.id);
                      }}
                      onDragEnd={() => {
                        setDraggedPayload(null);
                        setOutlinerDragOverIdx(null);
                        setDropTarget(null);
                        if (dropIndicatorRef.current && modeRef.current !== "place") {
                          dropIndicatorRef.current.visible = false;
                        }
                      }}
                      onDragOver={(e) => {
                        if (draggedPayload?.type === "move" && draggedPayload.id !== i.id) {
                          e.preventDefault();
                          e.stopPropagation();
                          setOutlinerDragOverIdx(idx);
                        }
                      }}
                      onDragLeave={() => {
                        if (outlinerDragOverIdx === idx) {
                          setOutlinerDragOverIdx(null);
                        }
                      }}
                      onDrop={(e) => {
                        if (draggedPayload?.type === "move" && draggedPayload.id && draggedPayload.id !== i.id) {
                          e.preventDefault();
                          e.stopPropagation();
                          const fromIdx = items.findIndex((it) => it.id === draggedPayload.id);
                          if (fromIdx !== -1) {
                            const updated = [...items];
                            const [moved] = updated.splice(fromIdx, 1);
                            if (moved) {
                              updated.splice(idx, 0, moved);
                              setItems(updated);
                            }
                          }
                          setOutlinerDragOverIdx(null);
                        }
                      }}
                      onClick={(e) => {
                        if (e.ctrlKey || e.metaKey || e.shiftKey) {
                          e.preventDefault();
                          toggleJoinId(i.id);
                          return;
                        }
                        setSelected(i.id);
                        setPanelTab("properties");
                      }}
                      className={`group flex items-center justify-between rounded px-2.5 py-1.5 text-xs transition-all cursor-grab active:cursor-grabbing border ${
                        isOver
                          ? "border-primary bg-primary/20 scale-[1.01]"
                          : joinIds.includes(i.id)
                          ? "border-amber-400/70 bg-amber-400/15 text-amber-300"
                          : isSel
                          ? "border-primary/50 bg-primary/15 text-primary font-semibold shadow-xs"
                          : "border-transparent text-muted-foreground hover:bg-accent hover:text-foreground"
                      }`}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        {joinIds.includes(i.id) ? (
                          <CheckSquare className="size-3.5 shrink-0 text-amber-300" />
                        ) : (
                          <GripVertical
                            className={`size-3.5 shrink-0 opacity-40 group-hover:opacity-100 transition-opacity ${
                              isSel ? "text-primary" : "text-muted-foreground"
                            }`}
                          />
                        )}
                        <span className="truncate">{i.name}</span>
                      </div>

                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          title="Place object on surface (P)"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelected(i.id);
                            setMode("place");
                          }}
                          className={`rounded p-1 transition-colors ${
                            mode === "place" && isSel
                              ? "bg-primary text-primary-foreground font-bold"
                              : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                          }`}
                        >
                          <MapPin className="size-3" />
                        </button>
                        <button
                          type="button"
                          title="Focus camera view"
                          onClick={(e) => {
                            e.stopPropagation();
                            focusObject(i.id);
                          }}
                          className="rounded p-1 text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors"
                        >
                          <Focus className="size-3" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Tab buttons for Object Properties and Scene Settings */}
          <div className="flex border-b border-border bg-secondary/40 p-1">
            <button
              type="button"
              onClick={() => setPanelTab("properties")}
              className={`flex-1 flex items-center justify-center gap-1.5 rounded py-1.5 text-[11px] font-medium transition-colors cursor-pointer ${
                panelTab === "properties"
                  ? "bg-card text-primary shadow-xs border border-border/70 font-semibold"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Sliders className="size-3.5" />
              <span>Properties</span>
              {selItem && (
                <span className="ml-1 size-1.5 rounded-full bg-primary" />
              )}
            </button>
            <button
              type="button"
              onClick={() => setPanelTab("scene")}
              className={`flex-1 flex items-center justify-center gap-1.5 rounded py-1.5 text-[11px] font-medium transition-colors cursor-pointer ${
                panelTab === "scene"
                  ? "bg-card text-primary shadow-xs border border-border/70 font-semibold"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Palette className="size-3.5" />
              <span>Scene & View</span>
            </button>
          </div>

          {/* Properties or Scene Panel content */}
          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            {panelTab === "properties" ? (
              !selItem || !selObj ? (
                <div className="space-y-4">
                  <div className="rounded-md border border-border/80 bg-secondary/30 p-3 text-center">
                    <p className="text-xs font-medium text-foreground">No Object Selected</p>
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      Click any model in the viewport or choose from the list below:
                    </p>
                    {items.length > 0 && (
                      <div className="mt-2.5 flex flex-wrap gap-1.5 justify-center">
                        {items.map((it) => (
                          <button
                            key={it.id}
                            type="button"
                            onClick={() => setSelected(it.id)}
                            className="rounded-md border border-border bg-card px-2.5 py-1 text-xs text-foreground hover:border-primary hover:text-primary transition-colors cursor-pointer"
                          >
                            {it.name}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Quick fallback scene controls so the panel is never empty */}
                  <div className="space-y-3 border-t border-border pt-3">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Camera View Presets
                    </p>
                    <div className="grid grid-cols-2 gap-1.5">
                      <button
                        type="button"
                        onClick={() => setCameraPreset("iso")}
                        className="rounded border border-border bg-secondary/60 px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground cursor-pointer"
                      >
                        Isometric 3D
                      </button>
                      <button
                        type="button"
                        onClick={() => setCameraPreset("top")}
                        className="rounded border border-border bg-secondary/60 px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground cursor-pointer"
                      >
                        Top View
                      </button>
                      <button
                        type="button"
                        onClick={() => setCameraPreset("front")}
                        className="rounded border border-border bg-secondary/60 px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground cursor-pointer"
                      >
                        Front View
                      </button>
                      <button
                        type="button"
                        onClick={() => setCameraPreset("side")}
                        className="rounded border border-border bg-secondary/60 px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground cursor-pointer"
                      >
                        Right Side
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  {/* Object header with quick actions */}
                  <div className="flex items-center justify-between border-b border-border pb-2">
                    <div className="text-xs font-bold text-foreground truncate max-w-[140px]">
                      {selItem.name}
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        title="Place on surface (P)"
                        onClick={() => setMode("place")}
                        className={`rounded px-1.5 py-0.5 text-[10px] font-medium border border-border cursor-pointer transition-colors ${
                          mode === "place"
                            ? "bg-primary text-primary-foreground font-bold"
                            : "bg-secondary text-muted-foreground hover:text-foreground hover:bg-accent"
                        }`}
                      >
                        Place
                      </button>
                      <button
                        type="button"
                        title="Focus view"
                        onClick={() => focusObject(selItem.id)}
                        className="rounded p-1 text-muted-foreground hover:text-foreground hover:bg-secondary border border-border cursor-pointer transition-colors"
                      >
                        <Focus className="size-3" />
                      </button>
                      <button
                        type="button"
                        title="Duplicate (Shift+D)"
                        onClick={duplicateSelected}
                        className="rounded p-1 text-muted-foreground hover:text-foreground hover:bg-secondary border border-border cursor-pointer transition-colors"
                      >
                        <Copy className="size-3" />
                      </button>
                      <button
                        type="button"
                        title="Delete (X)"
                        onClick={removeSelected}
                        className="rounded p-1 text-destructive hover:bg-destructive/15 border border-border cursor-pointer transition-colors"
                      >
                        <Trash2 className="size-3" />
                      </button>
                    </div>
                  </div>

                  <ObjectProperties key={selItem.id} item={selItem} object={selObj} isCtrlPressed={isCtrlPressed} onChange={tick} />
                </div>
              )
            ) : (
              /* Scene & Environment Settings Tab */
              <div className="space-y-4">
                <div className="space-y-2">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Environment & Backdrop
                  </p>
                  <ColorPicker
                    label="Background color"
                    value={bgColor}
                    onChange={(hex) => {
                      setBgColor(hex);
                      if (sceneRef.current) {
                        sceneRef.current.background = new THREE.Color(hex);
                      }
                    }}
                  />
                </div>

                <div className="space-y-2 border-t border-border pt-3">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Camera Presets
                  </p>
                  <div className="grid grid-cols-2 gap-1.5">
                    <button
                      type="button"
                      onClick={() => setCameraPreset("iso")}
                      className="rounded border border-border bg-secondary/60 px-2.5 py-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground cursor-pointer text-left flex items-center gap-1.5"
                    >
                      <Compass className="size-3 text-primary" /> Isometric 3D
                    </button>
                    <button
                      type="button"
                      onClick={() => setCameraPreset("top")}
                      className="rounded border border-border bg-secondary/60 px-2.5 py-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground cursor-pointer text-left flex items-center gap-1.5"
                    >
                      <Frame className="size-3 text-primary" /> Top View
                    </button>
                    <button
                      type="button"
                      onClick={() => setCameraPreset("front")}
                      className="rounded border border-border bg-secondary/60 px-2.5 py-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground cursor-pointer text-left flex items-center gap-1.5"
                    >
                      <Square className="size-3 text-primary" /> Front View
                    </button>
                    <button
                      type="button"
                      onClick={() => setCameraPreset("side")}
                      className="rounded border border-border bg-secondary/60 px-2.5 py-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground cursor-pointer text-left flex items-center gap-1.5"
                    >
                      <RotateCcw className="size-3 text-primary" /> Right Side
                    </button>
                  </div>
                </div>

                <div className="space-y-2 border-t border-border pt-3">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Scene Helpers & Overlays
                  </p>
                  <ToggleRow
                    label="Ground Grid"
                    value={showGrid}
                    onChange={(v) => setShowGrid(v)}
                  />
                  <ToggleRow
                    label="Magnetic Snapping"
                    value={snapOn}
                    onChange={(v) => setSnapOn(v)}
                  />
                  <ToggleRow
                    label="Point Cage Deformer"
                    value={pointsOn}
                    onChange={(v) => setPointsOn(v)}
                  />
                </div>

                <div className="space-y-2 border-t border-border pt-3">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Scene Statistics
                  </p>
                  <div className="rounded border border-border bg-secondary/30 p-2 text-xs space-y-1 text-muted-foreground">
                    <div className="flex justify-between">
                      <span>Total Entities:</span>
                      <span className="font-mono text-foreground">{items.length}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Meshes:</span>
                      <span className="font-mono text-foreground">
                        {items.filter((it) => !isLight(it.kind)).length}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span>Light Sources:</span>
                      <span className="font-mono text-foreground">
                        {items.filter((it) => isLight(it.kind)).length}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

interface ObjectPropertiesProps {
  key?: string;
  item: Item;
  object: THREE.Object3D;
  isCtrlPressed: boolean;
  onChange: () => void;
}

function ScaleRow({
  object,
  isCtrlPressed,
  onChange,
}: {
  object: THREE.Object3D;
  isCtrlPressed: boolean;
  onChange: () => void;
}) {
  const [scaleBothSides, setScaleBothSides] = useState(false);
  const axes = ["x", "y", "z"] as const;
  const isBoth = scaleBothSides || isCtrlPressed;

  const handleScaleChange = (axis: "x" | "y" | "z", newVal: number) => {
    if (Number.isNaN(newVal) || newVal <= 0) return;
    const oldScale = object.scale[axis];
    object.scale[axis] = newVal;

    if (!isBoth && (object as THREE.Mesh).isMesh && (object as THREE.Mesh).geometry) {
      const mesh = object as THREE.Mesh;
      if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
      const bb = mesh.geometry.boundingBox;
      if (bb) {
        const delta = oldScale - newVal;
        const shiftLocal = new THREE.Vector3();
        shiftLocal[axis] = bb.min[axis] * delta;
        const shiftWorld = shiftLocal.applyQuaternion(object.quaternion);
        object.position.add(shiftWorld);
      }
    }
    onChange();
  };

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Scale
        </p>
        <button
          type="button"
          onClick={() => setScaleBothSides((v) => !v)}
          title="Toggle 1-side vs 2-sides scale (Hold Ctrl while dragging or click to toggle)"
          className={`px-1.5 py-0.5 rounded text-[9px] font-medium border cursor-pointer transition-colors ${
            isBoth
              ? "bg-primary/20 text-primary border-primary/40 font-bold"
              : "bg-secondary text-muted-foreground border-border hover:text-foreground"
          }`}
        >
          {isBoth ? "2 Sides (Ctrl active)" : "1 Side (Default)"}
        </button>
      </div>
      <div className="grid grid-cols-3 gap-1">
        {axes.map((a) => (
          <div key={a} className="flex items-center rounded border border-border bg-secondary px-1">
            <span className="pr-1 text-[10px] uppercase text-muted-foreground">{a}</span>
            <input
              type="number"
              step={0.05}
              min={0.01}
              value={Number(object.scale[a].toFixed(3))}
              onChange={(e) => {
                const n = parseFloat(e.target.value);
                handleScaleChange(a, n);
              }}
              className="w-full bg-transparent py-1 text-[11px] outline-none text-foreground font-mono"
            />
          </div>
        ))}
      </div>
    </div>
  );
}

function ObjectProperties({
  item,
  object,
  isCtrlPressed,
  onChange,
}: ObjectPropertiesProps) {
  const light = isLight(item.kind) ? (object as THREE.Light) : null;
  const mat = !light ? ((object as THREE.Mesh).material as THREE.MeshStandardMaterial) : null;

  return (
    <div className="space-y-4">
      {!light && (
        <ToggleRow
          label="Solid (blocks others)"
          value={object.userData['solid'] === true}
          onChange={(v) => {
            object.userData['solid'] = v;
            onChange();
          }}
        />
      )}

      {item.kind !== "ambientLight" && (
        <Vec3Row label="Location" v={object.position} step={0.1} onChange={onChange} />
      )}
      {!light && (
        <>
          <Vec3Row label="Rotation" v={object.rotation} step={0.05} onChange={onChange} />
          <ScaleRow object={object} isCtrlPressed={isCtrlPressed} onChange={onChange} />
        </>
      )}

      {mat && (
        <div className="space-y-2 border-t border-border pt-3">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Material
          </p>
          <ColorPicker
            label="Base color"
            value={`#${mat.color.getHexString()}`}
            onChange={(hex) => {
              mat.color.set(hex);
              onChange();
            }}
          />
          <SliderRow
            label="Metallic"
            value={mat.metalness}
            onChange={(v) => {
              mat.metalness = v;
              onChange();
            }}
          />
          <SliderRow
            label="Roughness"
            value={mat.roughness}
            onChange={(v) => {
              mat.roughness = v;
              onChange();
            }}
          />
          <ToggleRow
            label="Wireframe"
            value={mat.wireframe}
            onChange={(v) => {
              mat.wireframe = v;
              onChange();
            }}
          />
          <ToggleRow
            label="Flat shading"
            value={mat.flatShading}
            onChange={(v) => {
              mat.flatShading = v;
              mat.needsUpdate = true;
              onChange();
            }}
          />
        </div>
      )}

      {light && (
        <div className="space-y-2 border-t border-border pt-3">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Light
          </p>
          <ColorPicker
            label="Light color"
            value={`#${light.color.getHexString()}`}
            onChange={(hex) => {
              light.color.set(hex);
              onChange();
            }}
          />
          <SliderRow
            label="Power"
            max={item.kind === "pointLight" || item.kind === "spotLight" ? 60 : 10}
            value={light.intensity}
            onChange={(v) => {
              light.intensity = v;
              onChange();
            }}
          />
        </div>
      )}
    </div>
  );
}

function Vec3Row({
  label,
  v,
  step,
  onChange,
}: {
  label: string;
  v: THREE.Vector3 | THREE.Euler;
  step: number;
  onChange: () => void;
}) {
  const axes = ["x", "y", "z"] as const;
  return (
    <div className="space-y-1">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <div className="grid grid-cols-3 gap-1">
        {axes.map((a) => (
          <div key={a} className="flex items-center rounded border border-border bg-secondary px-1">
            <span className="pr-1 text-[10px] uppercase text-muted-foreground">{a}</span>
            <input
              type="number"
              step={step}
              value={Number(v[a].toFixed(3))}
              onChange={(e) => {
                const n = parseFloat(e.target.value);
                if (!Number.isNaN(n)) {
                  v[a] = n;
                  onChange();
                }
              }}
              className="w-full bg-transparent py-1 text-[11px] outline-none text-foreground font-mono"
            />
          </div>
        ))}
      </div>
    </div>
  );
}

function SliderRow({
  label,
  value,
  onChange,
  max = 1,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  max?: number;
}) {
  return (
    <label className="block text-xs text-muted-foreground">
      <span className="flex justify-between">
        {label}
        <span className="font-mono text-[10px] text-foreground">{value.toFixed(2)}</span>
      </span>
      <input
        type="range"
        min={0}
        max={max}
        step={max / 100}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="mt-1 w-full accent-primary cursor-pointer"
      />
    </label>
  );
}

function ToggleRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center justify-between text-xs text-muted-foreground cursor-pointer">
      {label}
      <input
        type="checkbox"
        checked={value}
        onChange={(e) => onChange(e.target.checked)}
        className="size-3.5 accent-primary cursor-pointer"
      />
    </label>
  );
}
