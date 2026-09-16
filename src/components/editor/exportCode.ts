import * as THREE from "three";
import { type Kind, isLight } from "./geometry";

interface ExportItem {
  id: string;
  name: string;
  kind: Kind;
  object: THREE.Object3D;
}

export function generateThreeCode(items: ExportItem[], bg: string): string {
  const lines: string[] = [];

  lines.push(`// ========================================================`);
  lines.push(`// Generated Three.js Scene - RenderCraft Modeler`);
  lines.push(`// Downloaded as scene.js`);
  lines.push(`// ========================================================`);
  lines.push(`import * as THREE from 'three';`);
  lines.push(`import { OrbitControls } from 'three/addons/controls/OrbitControls.js';\n`);

  lines.push(`// --- Initialize Scene, Camera & Renderer ---`);
  lines.push(`const scene = new THREE.Scene();`);
  lines.push(`scene.background = new THREE.Color('${bg}');\n`);

  lines.push(`const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 1000);`);
  lines.push(`camera.position.set(5, 4, 7);\n`);

  lines.push(`const renderer = new THREE.WebGLRenderer({ antialias: true });`);
  lines.push(`renderer.setSize(window.innerWidth, window.innerHeight);`);
  lines.push(`renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));`);
  lines.push(`renderer.shadowMap.enabled = true;`);
  lines.push(`document.body.style.margin = '0';`);
  lines.push(`document.body.appendChild(renderer.domElement);\n`);

  lines.push(`const controls = new OrbitControls(camera, renderer.domElement);`);
  lines.push(`controls.enableDamping = true;\n`);

  lines.push(`// Grid Helper`);
  lines.push(`const gridHelper = new THREE.GridHelper(40, 40, 0x4b5563, 0x272b31);`);
  lines.push(`scene.add(gridHelper);\n`);

  lines.push(`// --- Scene Objects ---`);

  items.forEach((item, index) => {
    const varName = `${item.name.replace(/[^a-zA-Z0-9_]/g, "_")}_${index}`;
    lines.push(`// [${item.kind}] ${item.name}`);

    const anyObj = item.object as unknown as { isLight?: boolean; isMesh?: boolean };

    if (isLight(item.kind) && anyObj.isLight) {
      const light = item.object as THREE.Light;
      const colorHex = `#${light.color?.getHexString?.() ?? "ffffff"}`;
      const intensity = light.intensity;

      if (item.kind === "ambientLight") {
        lines.push(`const ${varName} = new THREE.AmbientLight('${colorHex}', ${intensity});`);
      } else if (item.kind === "directionalLight") {
        lines.push(`const ${varName} = new THREE.DirectionalLight('${colorHex}', ${intensity});`);
        lines.push(`${varName}.position.set(${light.position.x.toFixed(3)}, ${light.position.y.toFixed(3)}, ${light.position.z.toFixed(3)});`);
        lines.push(`${varName}.castShadow = true;`);
      } else if (item.kind === "pointLight") {
        lines.push(`const ${varName} = new THREE.PointLight('${colorHex}', ${intensity}, 0, 2);`);
        lines.push(`${varName}.position.set(${light.position.x.toFixed(3)}, ${light.position.y.toFixed(3)}, ${light.position.z.toFixed(3)});`);
        lines.push(`${varName}.castShadow = true;`);
      } else if (item.kind === "spotLight") {
        lines.push(`const ${varName} = new THREE.SpotLight('${colorHex}', ${intensity}, 0, Math.PI / 6, 0.35);`);
        lines.push(`${varName}.position.set(${light.position.x.toFixed(3)}, ${light.position.y.toFixed(3)}, ${light.position.z.toFixed(3)});`);
        lines.push(`${varName}.castShadow = true;`);
      }
      lines.push(`scene.add(${varName});\n`);
    } else {
      let mesh = item.object as THREE.Mesh;
      if (!(mesh as unknown as { isMesh?: boolean }).isMesh) {
        let found: THREE.Mesh | null = null;
        item.object.traverse((c) => {
          if (!found && (c as THREE.Mesh).isMesh) found = c as THREE.Mesh;
        });
        if (!found) {
          lines.push(`// (skipped: "${item.name}" has no exportable mesh)\n`);
          return;
        }
        mesh = found;
      }
      const rawMat = mesh.material as THREE.Material | THREE.Material[] | undefined;
      const mat = (Array.isArray(rawMat) ? rawMat[0] : rawMat) as
        | THREE.MeshStandardMaterial
        | undefined;
      const colorHex = `#${mat?.color?.getHexString?.() ?? "cccccc"}`;

      // Geometry definition
      if (mesh.userData['deformed'] && mesh.geometry) {
        // Serialized customized buffer geometry
        const posAttr = mesh.geometry.getAttribute("position");
        const posArr = Array.from(posAttr.array).map((n) => Number(n.toFixed(3)));
        lines.push(`const ${varName}_geom = new THREE.BufferGeometry();`);
        lines.push(`const ${varName}_pos = new Float32Array(${JSON.stringify(posArr)});`);
        lines.push(`${varName}_geom.setAttribute('position', new THREE.BufferAttribute(${varName}_pos, 3));`);
        if (mesh.geometry.index) {
          const idxArr = Array.from(mesh.geometry.index.array);
          lines.push(`${varName}_geom.setIndex(${JSON.stringify(idxArr)});`);
        }
        lines.push(`${varName}_geom.computeVertexNormals();`);
      } else {
        switch (item.kind) {
          case "box":
            lines.push(`const ${varName}_geom = new THREE.BoxGeometry(1.5, 1.5, 1.5, 4, 4, 4);`);
            break;
          case "sphere":
            lines.push(`const ${varName}_geom = new THREE.SphereGeometry(1, 32, 24);`);
            break;
          case "cylinder":
            lines.push(`const ${varName}_geom = new THREE.CylinderGeometry(0.8, 0.8, 1.8, 32, 8);`);
            break;
          case "cone":
            lines.push(`const ${varName}_geom = new THREE.ConeGeometry(0.9, 1.8, 32, 8);`);
            break;
          case "torus":
            lines.push(`const ${varName}_geom = new THREE.TorusGeometry(1, 0.35, 24, 48);`);
            break;
          case "torusKnot":
            lines.push(`const ${varName}_geom = new THREE.TorusKnotGeometry(0.8, 0.25, 64, 16);`);
            break;
          case "plane":
            lines.push(`const ${varName}_geom = new THREE.PlaneGeometry(2, 2, 8, 8);`);
            break;
          case "icosahedron":
            lines.push(`const ${varName}_geom = new THREE.IcosahedronGeometry(1, 1);`);
            break;
          case "capsule":
            lines.push(`const ${varName}_geom = new THREE.CapsuleGeometry(0.6, 1, 16, 24);`);
            break;
          case "ring":
            lines.push(`const ${varName}_geom = new THREE.RingGeometry(0.5, 1.2, 32);`);
            break;
          case "dodecahedron":
            lines.push(`const ${varName}_geom = new THREE.DodecahedronGeometry(1, 0);`);
            break;
          case "tetrahedron":
            lines.push(`const ${varName}_geom = new THREE.TetrahedronGeometry(1.2, 0);`);
            break;
          default:
            lines.push(`const ${varName}_geom = new THREE.BoxGeometry(1, 1, 1);`);
        }
      }

      // Material definition
      lines.push(`const ${varName}_mat = new THREE.MeshStandardMaterial({`);
      lines.push(`  color: '${colorHex}',`);
      lines.push(`  metalness: ${(mat?.metalness ?? 0.05).toFixed(2)},`);
      lines.push(`  roughness: ${(mat?.roughness ?? 0.6).toFixed(2)},`);
      lines.push(`  wireframe: ${mat?.wireframe ?? false},`);
      lines.push(`  flatShading: ${mat?.flatShading ?? false},`);
      lines.push(`  side: THREE.DoubleSide`);
      lines.push(`});`);

      // Mesh & Transforms
      lines.push(`const ${varName} = new THREE.Mesh(${varName}_geom, ${varName}_mat);`);
      lines.push(`${varName}.position.set(${mesh.position.x.toFixed(3)}, ${mesh.position.y.toFixed(3)}, ${mesh.position.z.toFixed(3)});`);
      lines.push(`${varName}.rotation.set(${mesh.rotation.x.toFixed(3)}, ${mesh.rotation.y.toFixed(3)}, ${mesh.rotation.z.toFixed(3)});`);
      lines.push(`${varName}.scale.set(${mesh.scale.x.toFixed(3)}, ${mesh.scale.y.toFixed(3)}, ${mesh.scale.z.toFixed(3)});`);
      lines.push(`${varName}.castShadow = true;`);
      lines.push(`${varName}.receiveShadow = true;`);
      lines.push(`scene.add(${varName});\n`);
    }
  });

  lines.push(`// --- Resize Handler ---`);
  lines.push(`window.addEventListener('resize', () => {`);
  lines.push(`  camera.aspect = window.innerWidth / window.innerHeight;`);
  lines.push(`  camera.updateProjectionMatrix();`);
  lines.push(`  renderer.setSize(window.innerWidth, window.innerHeight);`);
  lines.push(`});\n`);

  lines.push(`// --- Render Loop ---`);
  lines.push(`function animate() {`);
  lines.push(`  requestAnimationFrame(animate);`);
  lines.push(`  controls.update();`);
  lines.push(`  renderer.render(scene, camera);`);
  lines.push(`}`);
  lines.push(`animate();`);

  return lines.join('\n');
}
