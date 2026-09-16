// A escultura do NogglesRail em 3D, renderizada por three.js num canvas WebGL
// próprio e desenhada no canvas 2D do filme a cada frame (drawImage). O modelo
// é o mesmo do gnars.com/nogglesrails (public/models/NogRail-colors.glb,
// copiado para /projects/gnars/films/nograil.glb): NogRail_1 é a armação,
// NogRail_2 a lente branca, NogRail_3 a lente preta. A rotação é função do
// tempo, então a exportação e o scrubber batem com a prévia.

import type { Scene3D, Scene3DView } from "./types";

export async function loadRail3D(url: string, opts: { frameColor: string }): Promise<Scene3D> {
  const THREE = await import("three");
  const { GLTFLoader } = await import("three/examples/jsm/loaders/GLTFLoader.js");
  const { RoomEnvironment } = await import("three/examples/jsm/environments/RoomEnvironment.js");

  const canvas = document.createElement("canvas");
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(1);
  renderer.setClearColor(0x000000, 0);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

  scene.add(new THREE.AmbientLight(0xffffff, 0.6));
  const key = new THREE.DirectionalLight(0xffffff, 2.5);
  key.position.set(5, 5, 5);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xffffff, 1.5);
  fill.position.set(-5, 3, 2);
  scene.add(fill);
  const spot = new THREE.SpotLight(0xffffff, 3, 0, 0.4, 0.5);
  spot.position.set(0, 8, 3);
  scene.add(spot);
  const rim = new THREE.PointLight(new THREE.Color(opts.frameColor), 1.2);
  rim.position.set(-2, 2, 4);
  scene.add(rim);

  const gltf = await new GLTFLoader().loadAsync(url);
  const model = gltf.scene;
  const box = new THREE.Box3().setFromObject(model);
  const center = box.getCenter(new THREE.Vector3());
  model.position.sub(center);
  const radius = box.getBoundingSphere(new THREE.Sphere()).radius;
  model.traverse((child) => {
    const mesh = child as import("three").Mesh;
    if (!mesh.isMesh) return;
    if (mesh.name === "NogRail_2") mesh.material = new THREE.MeshStandardMaterial({ color: new THREE.Color("#ffffff"), roughness: 0.3 });
    else if (mesh.name === "NogRail_3") mesh.material = new THREE.MeshStandardMaterial({ color: new THREE.Color("#1a1a1a"), roughness: 0.3 });
    else
      mesh.material = new THREE.MeshPhysicalMaterial({
        color: new THREE.Color(opts.frameColor),
        metalness: 0.85,
        roughness: 0.1,
        clearcoat: 1,
        clearcoatRoughness: 0.05,
        reflectivity: 1,
        emissive: new THREE.Color(opts.frameColor),
        emissiveIntensity: 0.05,
        envMapIntensity: 2,
      });
  });
  const group = new THREE.Group();
  group.add(model);
  scene.add(group);

  const camera = new THREE.PerspectiveCamera(38, 1, radius * 0.05, radius * 20);
  const distance = (radius / Math.sin((camera.fov * Math.PI) / 360)) * 1.05;
  camera.position.set(0, radius * 0.25, distance);
  camera.lookAt(0, 0, 0);

  let width = 0;
  let height = 0;
  return {
    kind: "3d",
    frame(t: number, w: number, h: number, view: Scene3DView = {}) {
      const dw = Math.max(2, Math.round(w));
      const dh = Math.max(2, Math.round(h));
      if (dw !== width || dh !== height) {
        width = dw;
        height = dh;
        renderer.setSize(dw, dh, false);
        camera.aspect = dw / dh;
        camera.updateProjectionMatrix();
      }
      const zoom = view.zoom ?? 1;
      camera.position.set(0, radius * 0.25 * zoom, distance * zoom);
      camera.lookAt(0, 0, 0);
      group.rotation.set(-0.15 + (view.pitch ?? 0), -0.3 + t * (view.spin ?? 0.35) + (view.yaw ?? 0), 0);
      renderer.render(scene, camera);
      return canvas;
    },
    dispose() {
      renderer.dispose();
      pmrem.dispose();
    },
  };
}
