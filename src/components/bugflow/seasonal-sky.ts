import * as T from "three";
import { moonPhase } from "@/lib/moon-phase";

/** Small edge decorations share the scene's inert canvas and motion settings. */
export function createSeasonalSky(scene: T.Scene, season: string) {
  const root = new T.Group();
  scene.add(root);
  const materials: T.Material[] = [],
    geometries: T.BufferGeometry[] = [];
  const glowCanvas = document.createElement("canvas");
  glowCanvas.width = glowCanvas.height = 64;
  const context = glowCanvas.getContext("2d")!;
  const glow = context.createRadialGradient(32, 32, 0, 32, 32, 32);
  glow.addColorStop(0, "#fff");
  glow.addColorStop(0.12, "#fff9");
  glow.addColorStop(0.4, "#fff3");
  glow.addColorStop(1, "#fff0");
  context.fillStyle = glow;
  context.fillRect(0, 0, 64, 64);
  const glowTexture = new T.CanvasTexture(glowCanvas);
  function halo(color: number, opacity: number) {
    const material = new T.SpriteMaterial({
      map: glowTexture,
      color,
      opacity,
      transparent: true,
      depthWrite: false,
    });
    materials.push(material);
    const sprite = new T.Sprite(material);
    root.add(sprite);
    return sprite;
  }
  const stars = Array.from({ length: 18 }, (_, i) => halo(0xffcf55, 0.65));
  // The moon: a painted near-side albedo map (maria, craters, Tycho's rays) lit by today's phase.
  // A full moon is evenly bright with a wide bloom; crescents keep a faint blue earthshine on the dark side.
  const MOON = 192;
  const moonCanvas = document.createElement("canvas");
  moonCanvas.width = moonCanvas.height = MOON;
  const moonContext = moonCanvas.getContext("2d")!;
  const moonTexture = new T.CanvasTexture(moonCanvas);
  moonTexture.colorSpace = T.SRGBColorSpace;
  const moonMaterial = new T.SpriteMaterial({
    map: moonTexture,
    transparent: true,
    depthWrite: false,
  });
  materials.push(moonMaterial);
  const moon = new T.Sprite(moonMaterial);
  root.add(moon);
  const moonHalo = halo(0xffe9ba, 0.2);
  const moonBloom = halo(0xfff6e0, 0);
  const surface = moonSurface(MOON);
  let checkedHour = -1;
  function updateMoon() {
    const hour = Math.floor(Date.now() / 3600000);
    if (checkedHour === hour) return;
    checkedHour = hour;
    const angle = moonPhase(new Date()) * Math.PI * 2;
    const sunX = Math.sin(angle),
      sunZ = -Math.cos(angle);
    // Illuminated fraction: 0 at new moon, 1 at full.
    const k = (1 - Math.cos(angle)) / 2;
    const half = (MOON - 1) / 2,
      radius = half - 2;
    const pixels = moonContext.createImageData(MOON, MOON);
    for (let y = 0; y < MOON; y++)
      for (let x = 0; x < MOON; x++) {
        const nx = (x - half) / radius,
          ny = (y - half) / radius,
          r2 = nx * nx + ny * ny;
        if (r2 > 1) continue;
        const i = y * MOON + x;
        const z = Math.sqrt(1 - r2);
        // Smooth sphere light, then the cratered surface's own normal so relief casts shadows near the terminator.
        const sphere = nx * sunX + z * sunZ;
        const gx = surface.gx[i]!,
          gy = surface.gy[i]!;
        const len = Math.hypot(nx - gx, ny - gy, z);
        const bumped = ((nx - gx) * sunX + z * sunZ) / len;
        const day = smooth(-0.02, 0.035, bumped) * smooth(-0.06, 0.01, sphere);
        // Relief is strongest near the terminator and fades to the flat, shadowless look of a full moon.
        const ratio = Math.min(1.6, Math.max(0, bumped) / Math.max(0.06, sphere));
        const relief = ratio + (1 - ratio) * Math.min(1, Math.max(0, sphere) * 1.4) ** 2;
        // Rays from young craters stand out most at full moon.
        const a = Math.min(1, surface.albedo[i]! + surface.rays[i]! * (0.35 + 0.65 * k));
        const lit = Math.min(1, a * relief * (0.94 + 0.08 * k));
        const earthshine = a * 0.022 * (1 - k);
        const warm = 1 - k;
        const index = i * 4;
        pixels.data[index] = (lit * (246 + 4 * k) * day + earthshine * 190 * (1 - day)) | 0;
        pixels.data[index + 1] = (lit * (240 - 4 * warm) * day + earthshine * 205 * (1 - day)) | 0;
        pixels.data[index + 2] = (lit * (228 - 16 * warm) * day + earthshine * 240 * (1 - day)) | 0;
        pixels.data[index + 3] = Math.min(1, (1 - Math.sqrt(r2)) * radius) * 255;
      }
    moonContext.putImageData(pixels, 0, 0);
    moonTexture.needsUpdate = true;
    moon.scale.set(60 + 4 * k, 60 + 4 * k, 1);
    moonHalo.scale.set(104 + 22 * k, 104 + 22 * k, 1);
    moonHalo.material.opacity = 0.05 + 0.3 * k ** 1.5;
    // Bloom appears only close to full moon.
    moonBloom.scale.set(190, 190, 1);
    moonBloom.material.opacity = 0.24 * k ** 6;
  }
  const lightColors = [0xff626c, 0xffd45c, 0x5cddb0, 0x68baff, 0xc28aff, 0xff95d3].map(
    (color) => new T.Color(color),
  );
  const bulbs =
    season === "christmas"
      ? Array.from({ length: 44 }, (_, i) =>
          halo(lightColors[i % lightColors.length]!.getHex(), 0.9),
        )
      : [];
  const wireGeometry = new T.BufferGeometry();
  geometries.push(wireGeometry);
  const positions = new Float32Array(65 * 3);
  wireGeometry.setAttribute("position", new T.BufferAttribute(positions, 3));
  const wireMaterial = new T.LineBasicMaterial({
    color: 0x6c7056,
    transparent: true,
    opacity: 0.45,
  });
  materials.push(wireMaterial);
  const wire = new T.Line(wireGeometry, wireMaterial);
  wire.frustumCulled = false;
  wire.visible = bulbs.length > 0;
  root.add(wire);
  let lastWidth = 0,
    lastHeight = 0,
    lastHeader = 0,
    lastLeft = 0;
  return {
    update(
      width: number,
      height: number,
      header: number,
      left: number,
      time: number,
      moving: boolean,
    ) {
      updateMoon();
      moon.visible = moonHalo.visible = moonBloom.visible = width > 760;
      moon.position.set(width - 50, height - header - 56, 14);
      moonHalo.position.copy(moon.position).z = 13;
      moonBloom.position.copy(moon.position).z = 12;
      stars.forEach((star, i) => {
        star.position.set(
          i % 2 ? width - 9 : Math.max(9, left + 9),
          height - header - 105 - (i / 18) * Math.max(0, height - header - 150),
          12,
        );
        const twinkle = moving ? 0.8 + Math.sin(time * 0.7 + i * 2) * 0.2 : 1;
        star.scale.setScalar((i % 3 === 0 ? 15 : 9) * twinkle);
        star.material.opacity = 0.65 * twinkle;
      });
      const lightY = (u: number) =>
        height - header - 3 - Math.pow(Math.sin(u * Math.PI * 6), 2) * 5;
      if (
        width !== lastWidth ||
        height !== lastHeight ||
        header !== lastHeader ||
        left !== lastLeft
      ) {
        lastWidth = width;
        lastHeight = height;
        lastHeader = header;
        lastLeft = left;
        for (let i = 0; i < 65; i++) {
          positions[i * 3] = left + ((width - left) * i) / 64;
          positions[i * 3 + 1] = lightY(i / 64);
          positions[i * 3 + 2] = 15;
        }
        wireGeometry.attributes["position"]!.needsUpdate = true;
      }
      bulbs.forEach((bulb, i) => {
        const u = (i + 0.5) / bulbs.length;
        bulb.position.set(left + (width - left) * u, lightY(u) - 1.5, 16);
        // Slow colour fades and independent breathing glows, never flashing.
        const cycle = moving ? time / 9 + i : i;
        const index = Math.floor(cycle) % lightColors.length;
        const blend = cycle - Math.floor(cycle);
        bulb.material.color
          .copy(lightColors[index]!)
          .lerp(lightColors[(index + 1) % lightColors.length]!, blend * blend * (3 - 2 * blend));
        const breathe = moving ? 1 + Math.sin(time * 0.8 + i * 0.9) * 0.12 : 1;
        bulb.scale.set(15 * breathe, 19 * breathe, 1);
        bulb.material.opacity = 0.85 * breathe;
      });
    },
    dispose() {
      scene.remove(root);
      glowTexture.dispose();
      moonTexture.dispose();
      materials.forEach((m) => m.dispose());
      geometries.forEach((g) => g.dispose());
    },
  };
}

function smooth(edge0: number, edge1: number, value: number) {
  const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * Decorative near-side surface (north up), computed once: albedo with irregular dark maria and mottled highlands,
 * a height field of bowl craters with raised rims (as x/y slopes for lighting), and bright ray systems.
 */
function moonSurface(size: number) {
  const hash = (x: number, y: number) => {
    const h = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
    return h - Math.floor(h);
  };
  const noise = (x: number, y: number) => {
    const ix = Math.floor(x),
      iy = Math.floor(y),
      fx = x - ix,
      fy = y - iy;
    const ux = fx * fx * (3 - 2 * fx),
      uy = fy * fy * (3 - 2 * fy);
    const top = hash(ix, iy) * (1 - ux) + hash(ix + 1, iy) * ux;
    const bottom = hash(ix, iy + 1) * (1 - ux) + hash(ix + 1, iy + 1) * ux;
    return top * (1 - uy) + bottom * uy;
  };
  const fbm = (x: number, y: number) => {
    let sum = 0,
      amp = 0.5,
      f = 1;
    for (let o = 0; o < 5; o++, amp *= 0.5, f *= 2.03)
      sum += amp * noise(x * f + o * 17.3, y * f - o * 9.1);
    return sum / 0.97;
  };
  // [x, y, radiusX, radiusY, depth] in disc units; y grows downward.
  const maria: [number, number, number, number, number][] = [
    [-0.33, -0.42, 0.34, 0.28, 1],
    [0.12, -0.37, 0.19, 0.17, 1],
    [0.28, -0.1, 0.26, 0.21, 0.95],
    [0.68, -0.3, 0.12, 0.1, 1],
    [0.56, 0.14, 0.13, 0.22, 0.8],
    [0.38, 0.33, 0.1, 0.1, 0.75],
    [-0.62, -0.02, 0.3, 0.55, 0.85],
    [-0.3, 0.2, 0.22, 0.2, 0.6],
    [-0.17, 0.39, 0.22, 0.15, 0.75],
    [-0.5, 0.45, 0.1, 0.1, 0.85],
    [-0.02, -0.7, 0.44, 0.07, 0.5],
    [0.0, -0.15, 0.12, 0.09, 0.7],
  ];
  const n = size * size,
    half = (size - 1) / 2,
    radius = half - 2;
  const albedo = new Float32Array(n),
    height = new Float32Array(n),
    rays = new Float32Array(n),
    mare = new Float32Array(n);
  const disc = (x: number, y: number) => [(x - half) / radius, (y - half) / radius] as const;
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const [nx, ny] = disc(x, y);
      if (nx * nx + ny * ny > 1.02) continue;
      const i = y * size + x;
      // Two scales of warp give the seas ragged, merging coastlines instead of oval outlines.
      const warp = (fbm(nx * 2.6, ny * 2.6) - 0.5) * 1.3 + (fbm(nx * 9, ny * 9) - 0.5) * 0.7;
      let dark = 0;
      for (const [cx, cy, rx, ry, depth] of maria) {
        const t = ((nx - cx) / rx) ** 2 + ((ny - cy) / ry) ** 2 + warp;
        if (t < 1.3) dark += depth * smooth(0, 0.7, 1.3 - t);
      }
      dark = (1 - Math.exp(-dark * 2.2)) * (0.8 + fbm(nx * 4 - 3, ny * 4) * 0.35);
      dark = Math.min(1, dark);
      mare[i] = dark;
      const grain = fbm(nx * 14, ny * 14);
      const highlands = 0.84 + (grain - 0.5) * 0.28 + (noise(nx * 60, ny * 60) - 0.5) * 0.06;
      const seas = 0.5 + (fbm(nx * 5 + 4, ny * 5) - 0.5) * 0.22;
      albedo[i] = highlands * (1 - dark) + seas * dark;
      height[i] = (fbm(nx * 8, ny * 8) - 0.5) * 0.012 * (1 - dark * 0.7);
    }
  // [x, y, radius, ray strength]: Tycho, Copernicus, Kepler, Aristarchus, Plato, Langrenus, Theophilus.
  const craters: [number, number, number, number][] = [
    [-0.12, 0.73, 0.05, 1],
    [-0.3, -0.1, 0.05, 0.5],
    [-0.55, -0.08, 0.03, 0.5],
    [-0.72, -0.32, 0.025, 0.4],
    [-0.13, -0.73, 0.04, 0],
    [0.83, 0.16, 0.05, 0],
    [0.44, 0.22, 0.045, 0],
  ];
  let seed = 11;
  const next = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 260; i++) {
    const t = next() * Math.PI * 2,
      d = Math.sqrt(next()) * 0.98,
      cx = Math.cos(t) * d,
      cy = Math.sin(t) * d;
    const [px, py] = [Math.round(cx * radius + half), Math.round(cy * radius + half)];
    // Maria are young and smooth: far fewer craters there.
    if ((mare[py * size + px] ?? 0) > 0.5 && next() < 0.85) continue;
    const r = 0.005 + next() ** 4 * 0.05;
    craters.push([cx, cy, r, r < 0.012 && next() < 0.12 ? 0.15 : 0]);
  }
  for (const [cx, cy, r, ray] of craters) {
    const reach = r * 2.2;
    const x0 = Math.max(0, Math.floor((cx - reach) * radius + half)),
      x1 = Math.min(size - 1, Math.ceil((cx + reach) * radius + half)),
      y0 = Math.max(0, Math.floor((cy - reach) * radius + half)),
      y1 = Math.min(size - 1, Math.ceil((cy + reach) * radius + half));
    const depth = r * 0.22;
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const [nx, ny] = disc(x, y);
        const d = Math.hypot(nx - cx, ny - cy) / r;
        if (d > 2.2) continue;
        const i = y * size + x;
        // Bowl, raised rim, then ejecta fading out; big craters get a central peak.
        let h = d < 1 ? -depth * (1 - d * d) : 0;
        h += depth * 0.4 * Math.exp(-(((d - 1) / 0.16) ** 2));
        if (r > 0.035) h += depth * 0.35 * Math.exp(-((d / 0.18) ** 2));
        height[i] = height[i]! + h;
        // Fresh craters: bright floors and halos.
        if (ray > 0) albedo[i] = Math.min(1, albedo[i]! + ray * 0.18 * Math.exp(-((d / 1.3) ** 2)));
      }
    if (ray >= 0.4) {
      // Each ray crater throws thin streaks at its own random angles, narrowing and fading with distance.
      const angles = Array.from({ length: 16 }, () => next() * Math.PI * 2);
      const lengths = angles.map(() => 0.12 + next() * 0.5 * ray);
      for (let y = 0; y < size; y++)
        for (let x = 0; x < size; x++) {
          const [nx, ny] = disc(x, y);
          const tx = nx - cx,
            ty = ny - cy,
            td = Math.hypot(tx, ty);
          if (td < r * 1.3 || nx * nx + ny * ny > 1) continue;
          const theta = Math.atan2(ty, tx);
          let streak = 0;
          angles.forEach((angle, j) => {
            const off = Math.atan2(Math.sin(theta - angle), Math.cos(theta - angle)) * td;
            const width = 0.014 + td * 0.06;
            streak += Math.exp(-((off / width) ** 2)) * Math.exp(-td / lengths[j]!);
          });
          const at = y * size + x;
          rays[at] = rays[at]! + Math.min(1, streak) * 0.11 * ray * (0.5 + noise(nx * 25, ny * 25));
        }
    }
  }
  const gx = new Float32Array(n),
    gy = new Float32Array(n);
  const scale = radius / 2;
  for (let y = 1; y < size - 1; y++)
    for (let x = 1; x < size - 1; x++) {
      const i = y * size + x;
      gx[i] = (height[i + 1]! - height[i - 1]!) * scale;
      gy[i] = (height[i + size]! - height[i - size]!) * scale;
    }
  return { albedo, rays, gx, gy };
}
