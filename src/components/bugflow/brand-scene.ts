import * as T from 'three';

/** A small shared brand sculpture, with a vector fallback managed by the caller. */
export function createBrandScene(host: HTMLElement, motion: string) {
  const renderer = new T.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'low-power' });
  renderer.setSize(32, 32); renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer.setClearColor(0, 0);
  const scene = new T.Scene(), camera = new T.OrthographicCamera(-29, 29, 29, -29, .1, 300);
  camera.position.z = 100;
  scene.add(new T.HemisphereLight(0xeaffff, 0x102427, 2.5));
  const light = new T.DirectionalLight(0xffffff, 4); light.position.set(-30, 40, 60); scene.add(light);
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
  const context = canvas.getContext('2d')!;
  context.fillStyle = getComputedStyle(host).getPropertyValue('--primary').trim() || '#33c4a2'; context.fillRect(0, 0, 1, 1);
  const rgb = context.getImageData(0, 0, 1, 1).data;
  const color = new T.Color().setRGB(rgb[0]! / 255, rgb[1]! / 255, rgb[2]! / 255, T.SRGBColorSpace);
  const shell = new T.MeshStandardMaterial({ color, metalness: .35, roughness: .26 });
  const dark = new T.MeshStandardMaterial({ color: 0x142629, roughness: .45 });
  const glint = new T.MeshStandardMaterial({ color: 0xffecc0, metalness: .4, roughness: .25 });
  const sphere = new T.SphereGeometry(1, 20, 12), cylinder = new T.CylinderGeometry(1, 1, 1, 8);
  const model = new T.Group(); model.rotation.x = -.15; model.rotation.y = -.3; scene.add(model);
  const ball = (material: T.Material, x: number, y: number, z: number, sx: number, sy: number, sz: number) => { const m = new T.Mesh(sphere, material); m.position.set(x, y, z); m.scale.set(sx, sy, sz); model.add(m); };
  const line = (a: number[], b: number[], radius: number) => { const from = new T.Vector3(...a as [number, number, number]), to = new T.Vector3(...b as [number, number, number]); const m = new T.Mesh(cylinder, dark); m.position.copy(from).add(to).multiplyScalar(.5); const d = to.sub(from); m.scale.set(radius, d.length(), radius); m.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), d.normalize()); model.add(m); return m; };
  ball(dark, 0, -3, 0, 10, 14, 7);
  ball(shell, -4.5, -3, 4, 5.3, 13, 5); ball(shell, 4.5, -3, 4, 5.3, 13, 5);
  ball(dark, 0, 12, 1, 6.5, 6, 5); ball(glint, -2.8, 14, 5.5, 1, 1, .7); ball(glint, 2.8, 14, 5.5, 1, 1, .7);
  const legs: T.Mesh[] = [];
  for (const side of [-1, 1]) {
    for (let i = 0; i < 3; i++) { legs.push(line([side * 7, 6 - i * 7, 0], [side * 17, 10 - i * 11, -1], 1.1)); line([side * 17, 10 - i * 11, -1], [side * 21, 6 - i * 11, 0], .85); }
    line([side * 3, 16, 1], [side * 8, 23, 1], .9);
  }
  host.append(renderer.domElement);
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  let frame = 0, last = 0, pitch = -.15, yaw = -.3, settled = false;
  const move = (e: PointerEvent) => { const r = host.getBoundingClientRect(); const x = e.clientX - r.left - r.width / 2, y = e.clientY - r.top - r.height / 2; if (Math.hypot(x, y) < 140) { yaw = Math.max(-.7, Math.min(.7, x / 120)); pitch = Math.max(-.5, Math.min(.5, y / 160)); } else { yaw = -.3; pitch = -.15; } };
  const draw = (now: number) => {
    frame = requestAnimationFrame(draw);
    if (document.hidden || now - last < 45) return; last = now;
    const moving = motion !== 'off' && !reduced.matches;
    if (!moving && Math.abs(-.3 - model.rotation.y) < 1e-4 && Math.abs(-.15 - model.rotation.x) < 1e-4) { if (settled) return; settled = true; } else settled = false;
    model.rotation.y += ((moving ? yaw + Math.sin(now / 1900) * .08 : -.3) - model.rotation.y) * .12;
    model.rotation.x += ((moving ? pitch : -.15) - model.rotation.x) * .12;
    legs.forEach((leg, i) => { leg.position.z = moving && motion === 'lively' ? Math.sin(now / 120 + i * Math.PI) * .6 : 0; });
    renderer.render(scene, camera);
  };
  window.addEventListener('pointermove', move, { passive: true }); frame = requestAnimationFrame(draw);
  return () => { cancelAnimationFrame(frame); window.removeEventListener('pointermove', move); sphere.dispose(); cylinder.dispose(); shell.dispose(); dark.dispose(); glint.dispose(); renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove(); };
}
