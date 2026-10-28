import * as T from "three";
import { DEFAULT_SCENE, seededRandom, type Scene } from "@/lib/appearance";
import { sceneQualityLimits, type SceneQuality } from "./scene-quality";

/** A quiet, reusable background world. It never reads page content or participates in hit testing. */
export function createMinimalGeometryScene(
  host: HTMLElement,
  lively: boolean,
  knobs: Scene = DEFAULT_SCENE,
  quality: SceneQuality = "auto",
) {
  const limits = sceneQualityLimits(quality);
  const renderer = new T.WebGLRenderer({
    alpha: true,
    antialias: true,
    powerPreference: "low-power",
  });
  renderer.setClearColor(0x000000, 0);
  renderer.setPixelRatio(limits.pixelRatio);
  renderer.outputColorSpace = T.SRGBColorSpace;
  host.append(renderer.domElement);

  const scene = new T.Scene();
  const camera = new T.PerspectiveCamera(42, 1, 0.1, 100);
  camera.position.set(0, 0, 18);
  scene.add(new T.HemisphereLight(0xe8fbff, 0x31264b, 2.2));
  const key = new T.DirectionalLight(0xffffff, 3.5);
  key.position.set(-4, 7, 9);
  scene.add(key);

  const forms = new T.Group();
  scene.add(forms);
  const geometries: T.BufferGeometry[] = [
    new T.IcosahedronGeometry(1, 1),
    new T.TorusGeometry(0.78, 0.22, 12, 28),
    new T.OctahedronGeometry(1, 0),
    new T.SphereGeometry(0.85, 18, 12),
  ];
  const materials: T.MeshPhysicalMaterial[] = [
    new T.MeshPhysicalMaterial({ color: 0x62d5c0, roughness: 0.18, metalness: 0.58 }),
    new T.MeshPhysicalMaterial({ color: 0x8b75e8, roughness: 0.22, metalness: 0.45 }),
    new T.MeshPhysicalMaterial({
      color: 0xd7eff2,
      roughness: 0.08,
      metalness: 0.1,
      transmission: 0.48,
      transparent: true,
      opacity: 0.72,
    }),
  ];
  const random = seededRandom(knobs.seed);
  const count = Math.max(3, Math.round(8 * knobs.amount));
  const meshes: T.Mesh[] = [];
  for (let i = 0; i < count; i += 1) {
    const mesh = new T.Mesh(geometries[i % geometries.length], materials[i % materials.length]);
    const side = i % 2 === 0 ? -1 : 1;
    mesh.position.set(side * (4.2 + random() * 4.2), (random() - 0.5) * 9, -2 - random() * 8);
    const scale = 0.45 + random() * 1.05;
    mesh.scale.setScalar(scale);
    mesh.rotation.set(random() * Math.PI, random() * Math.PI, random() * Math.PI);
    mesh.userData["phase"] = random() * Math.PI * 2;
    mesh.userData["spin"] = 0.18 + random() * 0.35;
    forms.add(mesh);
    meshes.push(mesh);
  }

  const resize = () => {
    const width = Math.max(1, innerWidth);
    const height = Math.max(1, innerHeight);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  };
  resize();
  addEventListener("resize", resize, { passive: true });

  const clock = new T.Clock();
  let frame = 0;
  let lastFrame = 0;
  const render = (now = 0) => {
    frame = requestAnimationFrame(render);
    if (document.hidden || now - lastFrame < (lively ? limits.activeFrameMs : limits.calmFrameMs))
      return;
    lastFrame = now;
    const time = clock.getElapsedTime() * knobs.speed;
    for (const mesh of meshes) {
      const phase = mesh.userData["phase"] as number;
      const spin = mesh.userData["spin"] as number;
      mesh.position.y += Math.sin(time * 0.45 + phase) * (lively ? 0.0018 : 0.0007);
      mesh.rotation.x += spin * (lively ? 0.003 : 0.0012) * knobs.speed;
      mesh.rotation.y += spin * (lively ? 0.004 : 0.0015) * knobs.speed;
    }
    renderer.render(scene, camera);
  };
  render();

  return () => {
    cancelAnimationFrame(frame);
    removeEventListener("resize", resize);
    geometries.forEach((geometry) => geometry.dispose());
    materials.forEach((material) => material.dispose());
    renderer.dispose();
    renderer.domElement.remove();
  };
}
