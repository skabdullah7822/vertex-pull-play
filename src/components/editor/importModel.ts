import * as THREE from "three";

export type ImportResult = {
  objects: THREE.Object3D[];
  code?: string;
  error?: string;
};

function extOf(name: string) {
  const i = name.lastIndexOf(".");
  return i < 0 ? "" : name.slice(i + 1).toLowerCase();
}

function frameObject(obj: THREE.Object3D) {
  // normalize huge/tiny imports to a sane size and sit on the ground
  const box = new THREE.Box3().setFromObject(obj);
  if (!box.isEmpty()) {
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);
    if (maxDim > 0) {
      const target = 3;
      if (maxDim > target * 2 || maxDim < target / 8) {
        const s = target / maxDim;
        obj.scale.multiplyScalar(s);
      }
    }
    const box2 = new THREE.Box3().setFromObject(obj);
    const center = box2.getCenter(new THREE.Vector3());
    obj.position.x -= center.x;
    obj.position.z -= center.z;
    obj.position.y -= box2.min.y;
  }
  obj.traverse((c) => {
    const m = c as THREE.Mesh;
    if (m.isMesh) {
      m.castShadow = true;
      m.receiveShadow = true;
    }
  });
  return obj;
}

/** Load any supported 3D file (or three.js source file) into scene objects. */
export async function importFile(file: File): Promise<ImportResult> {
  const ext = extOf(file.name);
  try {
    if (ext === "js" || ext === "ts" || ext === "jsx" || ext === "tsx" || ext === "txt") {
      return { objects: [], code: await file.text() };
    }

    if (ext === "json") {
      const text = await file.text();
      const loader = new THREE.ObjectLoader();
      const obj = loader.parse(JSON.parse(text));
      return { objects: [frameObject(obj)] };
    }

    if (ext === "glb" || ext === "gltf") {
      const { GLTFLoader } = await import("three/examples/jsm/loaders/GLTFLoader.js");
      const loader = new GLTFLoader();
      const buf = await file.arrayBuffer();
      const gltf = await loader.parseAsync(buf, "");
      const root = gltf.scene ?? new THREE.Group();
      root.name = root.name || file.name;
      return { objects: [frameObject(root)] };
    }

    if (ext === "obj") {
      const { OBJLoader } = await import("three/examples/jsm/loaders/OBJLoader.js");
      const obj = new OBJLoader().parse(await file.text());
      obj.name = obj.name || file.name;
      return { objects: [frameObject(obj)] };
    }

    if (ext === "fbx") {
      const { FBXLoader } = await import("three/examples/jsm/loaders/FBXLoader.js");
      const obj = new FBXLoader().parse(await file.arrayBuffer(), "");
      obj.name = obj.name || file.name;
      return { objects: [frameObject(obj)] };
    }

    if (ext === "stl") {
      const { STLLoader } = await import("three/examples/jsm/loaders/STLLoader.js");
      const geo = new STLLoader().parse(await file.arrayBuffer());
      geo.computeVertexNormals();
      const mesh = new THREE.Mesh(
        geo,
        new THREE.MeshStandardMaterial({ color: 0xbfc6d4, roughness: 0.6, metalness: 0.05 }),
      );
      mesh.name = file.name;
      return { objects: [frameObject(mesh)] };
    }

    if (ext === "ply") {
      const { PLYLoader } = await import("three/examples/jsm/loaders/PLYLoader.js");
      const geo = new PLYLoader().parse(await file.arrayBuffer());
      geo.computeVertexNormals();
      const mesh = new THREE.Mesh(
        geo,
        new THREE.MeshStandardMaterial({ color: 0xbfc6d4, roughness: 0.6, metalness: 0.05 }),
      );
      mesh.name = file.name;
      return { objects: [frameObject(mesh)] };
    }

    if (ext === "dae") {
      const { ColladaLoader } = await import("three/examples/jsm/loaders/ColladaLoader.js");
      const res = new ColladaLoader().parse(await file.text(), "");
      const root = res.scene as unknown as THREE.Object3D;
      root.name = root.name || file.name;
      return { objects: [frameObject(root)] };
    }

    return {
      objects: [],
      error: `"${ext || file.name}" file supported noy. GLB, GLTF, OBJ, FBX, STL, PLY, DAE, JSON ba .js/.ts three.js file din.`,
    };
  } catch (e) {
    return { objects: [], error: e instanceof Error ? e.message : String(e) };
  }
}

export const IMPORT_ACCEPT =
  ".glb,.gltf,.obj,.fbx,.stl,.ply,.dae,.json,.js,.ts,.jsx,.tsx,.txt";
