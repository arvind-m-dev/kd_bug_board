import * as T from 'three';
import { moonPhase } from '@/lib/moon-phase';

/** Small edge decorations share the scene's inert canvas and motion settings. */
export function createSeasonalSky(scene: T.Scene, season: string) {
  const root = new T.Group(); scene.add(root);
  const materials: T.Material[] = [], geometries: T.BufferGeometry[] = [];
  const glowCanvas = document.createElement('canvas'); glowCanvas.width = glowCanvas.height = 64;
  const context = glowCanvas.getContext('2d')!;
  const glow = context.createRadialGradient(32, 32, 0, 32, 32, 32);
  glow.addColorStop(0, '#fff'); glow.addColorStop(.12, '#fff9'); glow.addColorStop(.4, '#fff3'); glow.addColorStop(1, '#fff0');
  context.fillStyle = glow; context.fillRect(0, 0, 64, 64);
  const glowTexture = new T.CanvasTexture(glowCanvas);
  function halo(color: number, opacity: number) {
    const material = new T.SpriteMaterial({ map: glowTexture, color, opacity, transparent: true, depthWrite: false }); materials.push(material);
    const sprite = new T.Sprite(material); root.add(sprite); return sprite;
  }
  const stars = Array.from({ length: 18 }, (_, i) => halo(0xffcf55, .65));
  const moonCanvas = document.createElement('canvas'); moonCanvas.width = moonCanvas.height = 128;
  const moonContext = moonCanvas.getContext('2d')!;
  const moonTexture = new T.CanvasTexture(moonCanvas);
  const moonMaterial = new T.SpriteMaterial({ map: moonTexture, transparent: true, depthWrite: false }); materials.push(moonMaterial);
  const moon = new T.Sprite(moonMaterial); root.add(moon); moon.scale.set(46, 46, 1);
  const moonHalo = halo(0xffe9ba, .2); moonHalo.scale.set(86, 86, 1);
  let checkedHour = -1;
  function updateMoon() {
    const hour = Math.floor(Date.now() / 3600000); if (checkedHour === hour) return; checkedHour = hour;
    const phase = moonPhase(new Date()), angle = phase * Math.PI * 2;
    const pixels = moonContext.createImageData(128, 128);
    for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) {
      const nx = (x - 63.5) / 61, ny = (y - 63.5) / 61, r2 = nx * nx + ny * ny;
      if (r2 > 1) continue;
      const z = Math.sqrt(1 - r2);
      const lit = Math.max(0, nx * Math.sin(angle) - z * Math.cos(angle));
      const texture = .93 + Math.sin(x * .28) * Math.sin(y * .19) * .045 + Math.cos(x * .47 + y * .33) * .025;
      const brightness = (.085 + .915 * Math.sqrt(lit)) * texture;
      const index = (y * 128 + x) * 4;
      pixels.data[index] = 255 * brightness; pixels.data[index + 1] = 240 * brightness; pixels.data[index + 2] = 211 * brightness;
      pixels.data[index + 3] = Math.min(1, (1 - Math.sqrt(r2)) * 61) * 255;
    }
    moonContext.putImageData(pixels, 0, 0); moonTexture.needsUpdate = true;
    moonHalo.material.opacity = .06 + (1 - Math.cos(angle)) * .09;
  }
  const lightColors = [0xff626c, 0xffd45c, 0x5cddb0, 0x68baff, 0xc28aff, 0xff95d3].map(color => new T.Color(color));
  const bulbs = season === 'christmas' ? Array.from({ length: 44 }, (_, i) => halo(lightColors[i % lightColors.length]!.getHex(), .9)) : [];
  const wireGeometry = new T.BufferGeometry(); geometries.push(wireGeometry);
  const positions = new Float32Array(65 * 3); wireGeometry.setAttribute('position', new T.BufferAttribute(positions, 3));
  const wireMaterial = new T.LineBasicMaterial({ color: 0x6c7056, transparent: true, opacity: .45 }); materials.push(wireMaterial);
  const wire = new T.Line(wireGeometry, wireMaterial); wire.frustumCulled = false; wire.visible = bulbs.length > 0; root.add(wire);
  let lastWidth = 0, lastHeight = 0, lastHeader = 0, lastLeft = 0;
  return {
    update(width: number, height: number, header: number, left: number, time: number, moving: boolean) {
      updateMoon();
      moon.visible = moonHalo.visible = width > 760;
      moon.position.set(width - 42, height - header - 48, 14); moonHalo.position.copy(moon.position).z = 13;
      stars.forEach((star, i) => {
        star.position.set(i % 2 ? width - 9 : Math.max(9, left + 9), height - header - 105 - (i / 18) * Math.max(0, height - header - 150), 12);
        const twinkle = moving ? .8 + Math.sin(time * .7 + i * 2) * .2 : 1;
        star.scale.setScalar((i % 3 === 0 ? 15 : 9) * twinkle); star.material.opacity = .65 * twinkle;
      });
      const lightY = (u: number) => height - header - 3 - Math.pow(Math.sin(u * Math.PI * 6), 2) * 5;
      if (width !== lastWidth || height !== lastHeight || header !== lastHeader || left !== lastLeft) {
        lastWidth = width; lastHeight = height; lastHeader = header; lastLeft = left;
        for (let i = 0; i < 65; i++) { positions[i * 3] = left + (width - left) * i / 64; positions[i * 3 + 1] = lightY(i / 64); positions[i * 3 + 2] = 15; }
        wireGeometry.attributes['position']!.needsUpdate = true;
      }
      bulbs.forEach((bulb, i) => {
        const u = (i + .5) / bulbs.length;
        bulb.position.set(left + (width - left) * u, lightY(u) - 1.5, 16);
        // Slow colour fades and independent breathing glows, never flashing.
        const cycle = moving ? time / 9 + i : i;
        const index = Math.floor(cycle) % lightColors.length;
        const blend = cycle - Math.floor(cycle);
        bulb.material.color.copy(lightColors[index]!).lerp(lightColors[(index + 1) % lightColors.length]!, blend * blend * (3 - 2 * blend));
        const breathe = moving ? 1 + Math.sin(time * .8 + i * .9) * .12 : 1;
        bulb.scale.set(15 * breathe, 19 * breathe, 1); bulb.material.opacity = .85 * breathe;
      });
    },
    dispose() { scene.remove(root); glowTexture.dispose(); moonTexture.dispose(); materials.forEach(m => m.dispose()); geometries.forEach(g => g.dispose()); }
  };
}
