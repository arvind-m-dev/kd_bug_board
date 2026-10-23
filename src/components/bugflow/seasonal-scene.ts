import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { perimeterPoint, stepSnow, type LandingEdge, type SnowBody } from '@/lib/seasonal-physics';
import { DEFAULT_SCENE, seededRandom, type Scene } from '@/lib/appearance';

/**
 * Small real 3D dioramas in screen space, lit from above and the left.
 * `knobs` are the Theme Studio scene settings: how many bats, bugs, spiders, webs and pumpkins, bug size, snow/leaf amount, tempo,
 * and how random the behaviour is. Every chance in the scene comes from a generator seeded by the knobs, so the same theme behaves the same everywhere.
 */
export function createSeasonalScene(host: HTMLElement, season: string, lively: boolean, knobs: Scene = DEFAULT_SCENE) {
  const renderer = new T.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'low-power' });
  renderer.setClearColor(0x000000, 0);
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
  renderer.outputColorSpace = T.SRGBColorSpace;
  host.style.display = '';
  host.append(renderer.domElement);
  const scene = new T.Scene();
  const camera = new T.OrthographicCamera(0, innerWidth, innerHeight, 0, .1, 3000);
  camera.position.z = 1000;
  const ambient = new T.HemisphereLight(0xe5f4ff, 0x3b213d, 2.3);
  const key = new T.DirectionalLight(0xffe6c3, 3.2); key.position.set(-200, 600, 500);
  const rim = new T.DirectionalLight(0x92bfff, 2); rim.position.set(500, 150, -50);
  scene.add(ambient, key, rim);
  const materials = new Set<T.Material>();
  const geometries = new Set<T.BufferGeometry>();
  const mat = (color: number, roughness = .65, metalness = 0) => {
    const m = new T.MeshStandardMaterial({ color, roughness, metalness }); materials.add(m); return m;
  };
  const pine = [mat(0x164d36), mat(0x246e48), mat(0x347c51)];
  const bark = mat(0x6a3927), gold = mat(0xf4ba4b, .28, .65), snow = mat(0xe9f5ff, .8);
  const red = mat(0xb91f39, .35), black = mat(0x181626, .45), white = mat(0xfff4dd);
  const brown = mat(0x865131), tan = mat(0xd7a673), violet = mat(0x422d58, .5);
  const shell = [mat(0x8e572a, .25, .45), mat(0x21564e, .25, .5), mat(0x743447, .3, .35)];
  const sphere = new T.SphereGeometry(1, 12, 8), cone = new T.ConeGeometry(1, 1, 12), cylinder = new T.CylinderGeometry(1, 1, 1, 8), box = new T.BoxGeometry(1, 1, 1);
  [sphere, cone, cylinder, box].forEach(g => geometries.add(g));
  const mesh = (parent: T.Object3D, geometry: T.BufferGeometry, material: T.Material, p: number[], scale: number[]) => {
    const m = new T.Mesh(geometry, material); m.position.set(p[0]!, p[1]!, p[2] ?? 0); m.scale.set(scale[0]!, scale[1]!, scale[2] ?? 1); parent.add(m); return m;
  };
  const ball = (p: T.Object3D, m: T.Material, x: number, y: number, z: number, sx: number, sy = sx, sz = sx) => mesh(p, sphere, m, [x, y, z], [sx, sy, sz]);
  const rod = (p: T.Object3D, m: T.Material, a: number[], b: number[], radius: number) => {
    const from = new T.Vector3(...a as [number, number, number]), to = new T.Vector3(...b as [number, number, number]);
    const v = to.clone().sub(from);
    const r = mesh(p, cylinder, m, from.clone().add(to).multiplyScalar(.5).toArray(), [radius, v.length(), radius]);
    r.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), v.normalize()); return r;
  };
  const shape = new T.Shape();
  for (let i = 0; i < 10; i++) { const a = Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? 4 : 9; if (!i) shape.moveTo(Math.cos(a) * r, Math.sin(a) * r); else shape.lineTo(Math.cos(a) * r, Math.sin(a) * r); }
  shape.closePath();
  const starGeometry = new T.ExtrudeGeometry(shape, { depth: 3, bevelEnabled: true, bevelSegments: 1, steps: 1, bevelSize: .7, bevelThickness: .7 }); geometries.add(starGeometry);
  const shadowCanvas = document.createElement('canvas'); shadowCanvas.width = shadowCanvas.height = 64;
  const shadowContext = shadowCanvas.getContext('2d')!;
  const gradient = shadowContext.createRadialGradient(32, 32, 2, 32, 32, 32); gradient.addColorStop(0, 'rgba(0,0,0,.5)'); gradient.addColorStop(1, 'rgba(0,0,0,0)'); shadowContext.fillStyle = gradient; shadowContext.fillRect(0, 0, 64, 64);
  const shadowTexture = new T.CanvasTexture(shadowCanvas);
  const shadowMaterial = new T.MeshBasicMaterial({ map: shadowTexture, transparent: true, depthWrite: false }); materials.add(shadowMaterial);
  const shadowPlane = new T.PlaneGeometry(1, 1); geometries.add(shadowPlane);
  const stars: T.Mesh[] = [];
  const treeLights: T.Mesh[] = [];
  const groves: T.Group[] = [];
  function evergreen(height: number, festive: boolean) {
    const tree = new T.Group();
    mesh(tree, cylinder, bark, [0, 15, 0], [6, 30, 6]);
    for (let i = 0; i < 7; i++) {
      const y = 30 + i * 15, radius = 43 - i * 5.3;
      mesh(tree, cone, pine[i % 3]!, [0, y + 15, 0], [radius, 43, radius * .72]);
      // Offset small branch tips and snow caps create real overlapping volume.
      for (let j = 0; j < 5; j++) {
        const a = j * Math.PI * 2 / 5 + i * .6;
        const branch = mesh(tree, cone, pine[(i + 1) % 3]!, [Math.cos(a) * radius * .6, y + 2, Math.sin(a) * radius * .5], [radius * .36, 23, radius * .25]);
        branch.rotation.z = -Math.cos(a) * .3;
      }
      mesh(tree, cone, snow, [0, y + 23, 0], [radius * .71, 27, radius * .5]);
      if (festive) for (let j = 0; j < 3; j++) {
        const a = j * 2.1 + i * 1.7;
        const bulb = ball(tree, j % 2 ? gold : red, Math.cos(a) * radius * .78, y + 3, Math.sin(a) * radius * .65 + 6, 3.1);
        treeLights.push(bulb);
      }
    }
    if (festive) { const star = mesh(tree, starGeometry, gold, [0, 150, 0], [1.15, 1.15, 1.15]); stars.push(star); }
    tree.scale.setScalar(height / 160); tree.rotation.y = -.25;
    return tree;
  }
  function autumnTree() {
    const tree = new T.Group();
    rod(tree, bark, [0, 0, 0], [3, 85, 0], 7);
    const leaves = [mat(0xc94e20), mat(0xe69527), mat(0xc53026), mat(0xf5b844)];
    for (let i = 0; i < 9; i++) {
      const a = i * 2.4, x = Math.sin(a) * 36, y = 70 + (i % 3) * 23, z = Math.cos(a) * 18;
      rod(tree, bark, [0, 45, 0], [x, y, z], 2.8);
      ball(tree, leaves[i % 4]!, x, y + 12, z, 24, 26, 18);
      for (let j = 0; j < 3; j++) ball(tree, leaves[(i + j) % 4]!, x + Math.sin(j * 2) * 17, y + 20 + j * 3, z + 12, 12, 11, 9);
    }
    return tree;
  }
  if (['winter', 'christmas', 'autumn'].includes(season)) {
    const grove = new T.Group();
    if (season === 'autumn') { grove.add(autumnTree()); }
    else {
      const small = evergreen(115, season === 'christmas'); small.position.set(-58, 0, -30);
      const large = evergreen(190, season === 'christmas'); large.position.set(0, 0, 10);
      grove.add(small, large);
      if (season === 'christmas') for (let i = 0; i < 3; i++) {
        const gift = new T.Group(); gift.position.set(-45 + i * 32, 10, 28); gift.rotation.y = .35;
        mesh(gift, box, i % 2 ? pine[1]! : red, [0, 0, 0], [22, 20 + i * 3, 20]);
        mesh(gift, box, gold, [0, 0, 10.2], [3, 21 + i * 3, .8]);
        mesh(gift, box, gold, [0, 10 + i * 1.5, 0], [23, 1.5, 3]); grove.add(gift);
      }
    }
    mesh(grove, shadowPlane, shadowMaterial, [-10, 4, -60], [150, 22, 1]);
    scene.add(grove); groves.push(grove);
  }
  // A gnarled side tree is the bats' actual home, with branch-tip roosts in local space.
  const hauntedTree = new T.Group();
  // Points that lie on the branches drawn below, so up to twelve bats each get their own perch.
  const roosts = [[-86, 226, 7], [-46, 170, 12], [-107, 235, 6], [-89, 198, 8], [-66, 179, 10], [-79, 165, 9], [-47, 252, 8], [-53, 283, 6], [21, 258, 8], [30, 237, 9], [-24, 289, 10], [-40, 232, 9]].map(([x, y, z]) => new T.Vector3(x!, y!, z!));
  if (season === 'halloween') {
    const wood = mat(0x674439, .86);
    const branch = (points: number[][], radius: number) => {
      const curve = new T.CatmullRomCurve3(points.map(p => new T.Vector3(p[0]!, p[1]!, p[2] ?? 0)));
      const g = new T.TubeGeometry(curve, 20, radius, 7, false);
      const positions = g.getAttribute('position');
      for (let ring = 0; ring <= 20; ring++) {
        const center = curve.getPointAt(ring / 20), taper = 1 - ring / 20 * .88;
        for (let side = 0; side <= 7; side++) {
          const index = ring * 8 + side;
          positions.setXYZ(index, center.x + (positions.getX(index) - center.x) * taper, center.y + (positions.getY(index) - center.y) * taper, center.z + (positions.getZ(index) - center.z) * taper);
        }
      }
      g.computeVertexNormals(); geometries.add(g); mesh(hauntedTree, g, wood, [0, 0, 0], [1, 1, 1]);
    };
    branch([[0, 0], [-8, 65], [3, 122], [-14, 181], [-6, 257], [-24, 289]], 12);
    branch([[-4, 116], [-39, 154], [-55, 205], [-86, 226], [-107, 235]], 7);
    branch([[-42, 168], [-69, 175], [-89, 198]], 3.5);
    branch([[-55, 205], [-40, 232], [-47, 252]], 3);
    branch([[-12, 180], [22, 202], [30, 237], [21, 258]], 5);
    branch([[-9, 83], [-35, 107], [-46, 170], [-66, 179]], 6);
    branch([[-42, 142], [-70, 149], [-79, 165]], 2.5);
    branch([[-8, 245], [-38, 260], [-53, 283]], 3);
    for (const side of [-1, 1]) branch([[0, 12], [side * 19, 5], [side * 37, 1]], 6);
    mesh(hauntedTree, shadowPlane, shadowMaterial, [-10, 3, -40], [110, 20, 1]);
    scene.add(hauntedTree);
  }
  const ghosts: T.Group[] = [], webs: T.Group[] = [], pumpkinFaces: T.MeshStandardMaterial[] = [];
  if (season === 'halloween') {
    const orange = mat(0xc65b16, .48), stem = mat(0x455b30);
    const ribbed = new T.SphereGeometry(1, 40, 24);
    const vertices = ribbed.getAttribute('position');
    for (let i = 0; i < vertices.count; i++) {
      const angle = Math.atan2(vertices.getZ(i), vertices.getX(i));
      const rib = 1 + Math.cos(angle * 10) * .075;
      vertices.setXYZ(i, vertices.getX(i) * rib, vertices.getY(i) * .83, vertices.getZ(i) * rib);
    }
    ribbed.computeVertexNormals(); geometries.add(ribbed);
    for (let i = 0; i < knobs.pumpkins; i++) {
      const pumpkin = new T.Group(), radius = [23, 16, 12, 19, 10][i]!;
      pumpkin.position.set(-48 - i * 27, radius * .82, 25 + i * 7); pumpkin.rotation.y = -.18 + i * .15;
      mesh(pumpkin, ribbed, orange, [0, 0, 0], [radius, radius, radius]);
      rod(pumpkin, stem, [0, radius * .8, 0], [3, radius * 1.15, 0], 2.3);
      const glow = new T.MeshStandardMaterial({ color: 0xffcb53, emissive: 0xff8a12, emissiveIntensity: 1.8, roughness: .8 }); materials.add(glow); pumpkinFaces.push(glow);
      const eyeShape = new T.Shape(); eyeShape.moveTo(-.2, -.12); eyeShape.lineTo(.2, -.12); eyeShape.lineTo(0, .2); eyeShape.closePath();
      const eye = new T.ShapeGeometry(eyeShape); geometries.add(eye);
      for (const side of [-1, 1]) {
        mesh(pumpkin, eye, black, [side * radius * .3, radius * .15, radius * .97], [radius, radius, 1]);
        mesh(pumpkin, eye, glow, [side * radius * .3, radius * .15, radius * .98], [radius * .75, radius * .75, 1]);
      }
      const smileShape = new T.Shape(); smileShape.moveTo(-.55, -.15); smileShape.quadraticCurveTo(0, -.36, .55, -.15); smileShape.quadraticCurveTo(0, -.75, -.55, -.15);
      const smile = new T.ShapeGeometry(smileShape); geometries.add(smile);
      mesh(pumpkin, smile, glow, [0, -radius * .02, radius * .98], [radius, radius, 1]);
      for (const x of [-.25, .13]) mesh(pumpkin, box, orange, [x * radius, -radius * .28, radius], [radius * .12, radius * .18, 1]);
      hauntedTree.add(pumpkin);
    }
    const silk = new T.MeshStandardMaterial({ color: 0xc4c1d7, transparent: true, opacity: .5, roughness: .35, metalness: .25 }); materials.add(silk);
    for (let w = 0; w < knobs.webs; w++) {
      const web = new T.Group(), threads: T.BufferGeometry[] = [];
      const radius = [145, 85, 110][w]!;
      const point = (r: number, a: number) => new T.Vector3(Math.cos(a) * r, Math.sin(a) * r, 0);
      for (let ray = 0; ray <= 8; ray++) {
        const end = point(radius, Math.PI + ray / 8 * Math.PI / 2);
        threads.push(new T.TubeGeometry(new T.LineCurve3(new T.Vector3(), end), 1, .3, 4, false));
      }
      for (let ring = 1; ring <= 6; ring++) for (let ray = 0; ray < 8; ray++) {
        const a = Math.PI + ray / 8 * Math.PI / 2, b = a + Math.PI / 16, r = radius * ring / 6;
        const curve = new T.QuadraticBezierCurve3(point(r, a), point(r * .87, (a + b) / 2), point(r, b));
        threads.push(new T.TubeGeometry(curve, 5, .23, 4, false));
      }
      const g = mergeGeometries(threads); threads.forEach(t => t.dispose()); geometries.add(g);
      mesh(web, g, silk, [0, 0, 0], [1, 1, 1]); scene.add(web); webs.push(web);
    }
    const cloth = new T.MeshStandardMaterial({ color: 0xdbe5f0, roughness: .9, transparent: true, opacity: .82, side: T.DoubleSide }); materials.add(cloth);
    const profile = [[16, 0], [17, 7], [16, 18], [14, 29], [9, 38], [0, 42]].map(([x, y]) => new T.Vector2(x!, y!));
    const clothGeometry = new T.LatheGeometry(profile, 32);
    const positions = clothGeometry.getAttribute('position');
    for (let i = 0; i < positions.count; i++) {
      const a = Math.atan2(positions.getZ(i), positions.getX(i)), y = positions.getY(i);
      const pleat = 1 + Math.sin(a * 8) * .06 * (1 - y / 42);
      positions.setXYZ(i, positions.getX(i) * pleat, y + Math.sin(a * 5) * 3 * Math.max(0, 1 - y / 12), positions.getZ(i) * pleat);
    }
    clothGeometry.computeVertexNormals(); geometries.add(clothGeometry);
    for (let i = 0; i < 2; i++) {
      const ghost = new T.Group(); mesh(ghost, clothGeometry, cloth, [0, 0, 0], [1, 1, 1]);
      ball(ghost, black, -5, 28, 12.6, 2.5, 3.6, 1.4); ball(ghost, black, 5, 28, 12.6, 2.5, 3.6, 1.4); ball(ghost, black, 0, 19, 16, 2.2, 4, 1);
      ghost.scale.setScalar(i ? .8 : 1.1); scene.add(ghost); ghosts.push(ghost);
    }
  }
  // Seeded: Shuffle in the Theme Studio picks a new seed. Randomness 0 keeps every wait and choice at its middle value; 1 is fully random.
  const rand = seededRandom(knobs.seed * 31 + 7);
  const chance = () => rand();
  const random = (min: number, max: number) => min + (max - min) * (0.5 * (1 - knobs.randomness) + rand() * knobs.randomness);
  type Creature = { root: T.Group; limbs: T.Group[]; wings?: T.Group[]; kind: 'bug' | 'spider' | 'bat'; n: number; thread?: T.Mesh; angle: number; motion?: { phase: 'rest' | 'flight' | 'return' | 'crawl'; until: number; retarget: number; surface: number; distance: number; direction: number; velocity: T.Vector3; target: T.Vector3; homeKind: number; seed: number } };
  const creatures: Creature[] = [];
  function bug(index: number, spider = false): Creature {
    const root = new T.Group(), limbs: T.Group[] = [], wings: T.Group[] = [];
    const skin = spider ? black : shell[index % 3]!;
    mesh(root, shadowPlane, shadowMaterial, [3, -4, -5], [42, 42, 1]);
    ball(root, skin, 0, -3, 4, spider ? 8 : 8, spider ? 10 : 12, 6);
    ball(root, spider ? violet : black, 0, 9, 4, 5.5, 6, 5);
    if (!spider) {
      const membrane = new T.MeshStandardMaterial({ color: 0xe7cfa0, transparent: true, opacity: .65, roughness: .3, side: T.DoubleSide }); materials.add(membrane);
      for (const side of [-1, 1]) {
        const wing = new T.Group(); wing.position.set(side * 2, 5, 10);
        const cover = ball(wing, skin, side * 7, -5, 0, 6, 12, 1); cover.rotation.z = side * -.45;
        const film = ball(wing, membrane, side * 12, -7, -1, 7, 15, .3); film.rotation.z = side * -.65;
        wing.visible = false; root.add(wing); wings.push(wing);
      }
      rod(root, gold, [0, -13, 9.3], [0, 6, 9.3], .35);
      rod(root, black, [-3, 13, 4], [-7, 22, 4], .65); rod(root, black, [3, 13, 4], [7, 22, 4], .65);
    }
    for (let side = -1; side <= 1; side += 2) for (let j = 0; j < (spider ? 4 : 3); j++) {
      const leg = new T.Group(); leg.position.set(side * 5, 6 - j * 5, 3);
      rod(leg, skin, [0, 0, 0], [side * (spider ? 10 : 7), 7 - j * 4, 4], .85);
      rod(leg, skin, [side * (spider ? 10 : 7), 7 - j * 4, 4], [side * (spider ? 16 : 11), 3 - j * 4, -3], .6);
      root.add(leg); limbs.push(leg);
    }
    ball(root, red, -2, 11, 8.2, .8); ball(root, red, 2, 11, 8.2, .8);
    // Sizes vary around the Bug size slider; Randomness widens the spread (0 = all alike).
    root.scale.setScalar(knobs.bugSize * (spider ? random(.8, 1.2) : random(.65, 1.4)));
    scene.add(root); return { root, limbs, wings, kind: spider ? 'spider' : 'bug', n: index, angle: 0 };
  }
  function bat(n: number): Creature {
    const root = new T.Group(), limbs: T.Group[] = [];
    ball(root, black, 0, 0, 3, 7, 14, 6); ball(root, black, 0, 14, 4, 8, 7, 6);
    for (const side of [-1, 1]) {
      mesh(root, cone, violet, [side * 5, 24, 4], [4, 12, 3]);
      ball(root, gold, side * 3, 15, 9.5, 1.1);
      rod(root, black, [side * 3, -10, 3], [side * 4, -20, 3], 1);
      const wing = new T.Group(); wing.position.set(side * 5, 6, 3);
      const s = new T.Shape(); s.moveTo(0, 0); s.quadraticCurveTo(side * 16, 21, side * 37, 15); s.quadraticCurveTo(side * 27, 9, side * 29, -5); s.quadraticCurveTo(side * 18, 1, side * 16, -15); s.quadraticCurveTo(side * 8, -7, 0, -14); s.closePath();
      const g = new T.ExtrudeGeometry(s, { depth: .7, bevelEnabled: false }); geometries.add(g);
      mesh(wing, g, violet, [0, 0, 0], [1, 1, 1]);
      for (const [x, y] of [[37, 15], [29, -5], [16, -15]]) rod(wing, black, [0, 0, 1], [side * x!, y!, 1], .65);
      root.add(wing); limbs.push(wing);
    }
    scene.add(root); return { root, limbs, kind: 'bat', n, angle: 0 };
  }
  if (season === 'halloween') {
    for (let i = 0; i < knobs.bugs; i++) creatures.push(bug(i));
    for (let i = 0; i < knobs.spiders; i++) {
      const spider = bug(i, true);
      const threadMaterial = new T.MeshBasicMaterial({ color: 0xc9c3de, transparent: true, opacity: .48 }); materials.add(threadMaterial);
      spider.thread = mesh(scene, cylinder, threadMaterial, [0, 0, 0], [.4, 100, .4]); creatures.push(spider);
    }
    for (let i = 0; i < knobs.bats; i++) creatures.push(bat(i));
  }
  creatures.forEach((c, i) => { c.motion = { phase: c.kind === 'bug' ? 'crawl' : 'rest', until: c.kind === 'bat' && c.n % 2 ? random(.2, 2) : random(5, 13) + c.n, retarget: 0, surface: i, distance: random(0, 500), direction: chance() < .5 ? -1 : 1, velocity: new T.Vector3(), target: new T.Vector3(), homeKind: -1, seed: random(0, 100) }; });
  const sleigh = new T.Group(), santaWave = new T.Group(), deerLegs: T.Group[] = [], deerHeads: T.Group[] = [];
  if (season === 'christmas') {
    const santa = new T.Group(); santa.position.set(-90, 0, 0);
    // Curled gold runners, a deep red sleigh, Santa's coat, beard, hat and waving glove.
    for (const z of [-11, 11]) {
      const curve = new T.CatmullRomCurve3([new T.Vector3(-34, -17, z), new T.Vector3(12, -17, z), new T.Vector3(27, -12, z), new T.Vector3(28, -4, z)]);
      const g = new T.TubeGeometry(curve, 16, 1.4, 6, false); geometries.add(g); mesh(santa, g, gold, [0, 0, 0], [1, 1, 1]);
    }
    mesh(santa, box, red, [-3, -1, 0], [54, 16, 26]); mesh(santa, box, red, [-27, 13, 0], [6, 34, 26]);
    ball(santa, red, 0, 17, 0, 12, 17, 10); ball(santa, tan, 3, 39, 2, 8);
    ball(santa, white, 7, 34, 7, 7, 9, 5); ball(santa, tan, 9, 39, 10, 2.3);
    mesh(santa, cone, red, [1, 53, 2], [8, 20, 8]).rotation.z = .25;
    ball(santa, white, -2, 63, 2, 3); ball(santa, white, 2, 46, 2, 8, 2.3, 8);
    santaWave.position.set(5, 24, 0); rod(santaWave, red, [0, 0, 0], [13, 6, 2], 4); ball(santaWave, white, 15, 8, 2, 4); santa.add(santaWave);
    ball(santa, brown, -20, 26, -3, 12, 15, 11);
    sleigh.add(santa);
    for (let i = 0; i < 3; i++) {
      const deer = new T.Group(); deer.position.set(-18 + i * 50, 4 + i * 6, 0);
      ball(deer, brown, 0, 0, 0, 17, 8, 7); ball(deer, tan, 9, -1, 4, 7, 5, 3);
      const head = new T.Group(); head.position.set(12, 9, 0); head.rotation.z = -.35;
      ball(head, brown, 0, 5, 0, 5, 12, 5); ball(head, brown, 5, 16, 0, 9, 5, 5);
      ball(head, i === 2 ? red : black, 13, 16, 1, 2.7); ball(head, black, 5, 19, 4.5, 1);
      for (const z of [-3, 3]) { rod(head, tan, [0, 19, z], [-3, 34, z], 1); rod(head, tan, [-2, 28, z], [-8, 32, z], .8); rod(head, tan, [-2, 30, z], [3, 35, z], .8); }
      deer.add(head); deerHeads.push(head);
      for (let j = 0; j < 4; j++) {
        const leg = new T.Group(); leg.position.set(j < 2 ? -10 : 10, -4, j % 2 ? 5 : -5);
        rod(leg, brown, [0, 0, 0], [-3, -10, 0], 1.8); rod(leg, brown, [-3, -10, 0], [1, -20, 0], 1.3); ball(leg, black, 2, -20, 0, 2, 2, 2);
        deer.add(leg); deerLegs.push(leg);
      }
      rod(deer, red, [-4, 7, 7], [9, -4, 7], 1); sleigh.add(deer);
    }
    rod(sleigh, gold, [-70, 15, 10], [95, 12, 10], .45);
    sleigh.rotation.y = -.22; sleigh.scale.setScalar(.85); scene.add(sleigh);
  }
  // Six-armed snow crystals share one geometry and one instanced draw call.
  const flakeParts: T.BufferGeometry[] = [];
  for (let i = 0; i < 6; i++) {
    const a = i * Math.PI / 3;
    const arm = new T.BoxGeometry(.17, 2, .15); arm.translate(0, 1, 0); arm.rotateZ(a); flakeParts.push(arm);
    for (const side of [-1, 1]) { const twig = new T.BoxGeometry(.13, .85, .13); twig.rotateZ(side * .7); twig.translate(side * .25, 1.25, 0); twig.rotateZ(a); flakeParts.push(twig); }
  }
  const flakeGeometry = mergeGeometries(flakeParts); flakeParts.forEach(g => g.dispose()); geometries.add(flakeGeometry);
  const isSnow = season === 'winter' || season === 'christmas';
  const isAutumn = season === 'autumn';
  const leafShape = new T.Shape();
  leafShape.moveTo(0, -1.6); leafShape.bezierCurveTo(-1.9, -.9, -1.6, 1, 0, 2); leafShape.bezierCurveTo(1.5, 1, 1.9, -.9, 0, -1.6);
  const leafGeometry = new T.ExtrudeGeometry(leafShape, { depth: .14, bevelEnabled: true, bevelSegments: 1, steps: 1, bevelSize: .12, bevelThickness: .1 }); geometries.add(leafGeometry);
  const count = lively ? Math.round((isSnow ? (innerWidth < 760 ? 28 : 64) : isAutumn ? 22 : 0) * knobs.amount) : 0;
  const flakes = new T.InstancedMesh(isAutumn ? leafGeometry : flakeGeometry, isAutumn ? mat(0xffffff, .5) : snow, count);
  if (isAutumn) for (let i = 0; i < count; i++) flakes.setColorAt(i, new T.Color([0xd96724, 0xe5a332, 0xaf3a22, 0xf3ba57][i % 4]!)); flakes.instanceMatrix.setUsage(T.DynamicDrawUsage); flakes.frustumCulled = false; scene.add(flakes);
  const bodies: SnowBody[] = Array.from({ length: count }, (_, i) => ({ x: (i * 179.3) % innerWidth, y: (i * 67.4) % innerHeight, vx: 8, vy: 15 + i % 20, radius: isAutumn ? 6 + i % 4 : 2 + i % 3, bounces: 0, ignoreUntil: 0 }));
  const dummy = new T.Object3D();
  let width = innerWidth, height = innerHeight, edges: LandingEdge[] = [], rects: DOMRect[] = [];
  let sidebarRight = 236, headerBottom = 65;
  let measured = -Infinity, time = 0, last = 0, frame = 0, disposed = false, contextLost = false;
  let dirty = true, paintedKey = '', lastPaint = 0;
  let pointer = { x: -1000, y: -1000 };
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const resize = () => {
    width = innerWidth; height = innerHeight; camera.right = width; camera.top = height; camera.updateProjectionMatrix(); renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5)); renderer.setSize(width, height); measured = -Infinity; dirty = true;
  };
  const invalidate = () => { measured = -Infinity; dirty = true; };
  const move = (e: PointerEvent) => { pointer = { x: e.clientX, y: e.clientY }; dirty = true; };
  const down = (event: PointerEvent) => {
    // React to a click through the canvas without intercepting the real control underneath it.
    for (const c of creatures) {
      if (!c.root.visible || c.kind === 'spider') continue;
      if (Math.hypot(event.clientX - c.root.position.x, event.clientY - (height - c.root.position.y)) > 55) continue;
      host.dataset['lastStartle'] = `${c.kind}:${Math.round(time * 1000)}`;
      const m = c.motion!; m.phase = 'flight'; m.until = time + random(6, 11); m.retarget = time + 4;
      m.target.set(c.root.position.x < width / 2 ? -110 : width + 110, Math.max(80, c.root.position.y + random(80, 220)), 55);
      m.velocity.set(c.root.position.x < width / 2 ? -180 : 180, 90, 0);
    }
  };
  const measure = () => {
    const sidebar = document.querySelector('.bf-sidebar')?.getBoundingClientRect();
    sidebarRight = sidebar && sidebar.right > 0 ? sidebar.right : 0;
    headerBottom = document.querySelector('.bf-topbar')?.getBoundingClientRect().bottom ?? 65;
    rects = [...document.querySelectorAll('.bf-table-wrap'), ...document.querySelectorAll('.bf-style, .bf-font, .bf-status-card, .bf-stat, .bf-summary-card, .bf-portal-card, .bf-panel')].map(e => e.getBoundingClientRect()).filter(r => r.width > 80 && r.height > 40 && r.top > headerBottom && r.top < height - 30 && r.right > 0 && r.left < width).slice(0, 24);
    edges = rects.map(r => ({ left: Math.max(0, r.left), right: Math.min(width, r.right), top: r.top }));
    // Visible row dividers provide lower ledges after a flake tumbles off the table rim.
    for (const row of [...document.querySelectorAll('.bf-table tbody tr')].slice(0, 14)) {
      const r = row.getBoundingClientRect(); const clip = row.closest('.bf-table-wrap')?.getBoundingClientRect();
      if (clip && r.bottom > Math.max(clip.top, headerBottom) && r.bottom < Math.min(clip.bottom, height)) edges.push({ left: Math.max(clip.left, r.left), right: Math.min(clip.right, r.right), top: r.bottom });
    }
  };
  function fly(c: Creature, dt: number, speed: number) {
    const m = c.motion!;
    const desired = m.target.clone().sub(c.root.position);
    const distance = desired.length(); desired.normalize().multiplyScalar(Math.min(speed, distance * 2.5));
    const away = new T.Vector3(c.root.position.x - pointer.x, c.root.position.y - (height - pointer.y), 0);
    const near = away.length();
    if (near < 130 && near > .01) desired.add(away.normalize().multiplyScalar((1 - near / 130) * 240));
    desired.y += Math.sin(time * 3 + m.seed) * 12;
    m.velocity.lerp(desired, 1 - Math.exp(-dt * 3.5));
    c.root.position.addScaledVector(m.velocity, dt);
    const heading = Math.atan2(-m.velocity.x, m.velocity.y);
    const turn = Math.atan2(Math.sin(heading - c.angle), Math.cos(heading - c.angle));
    c.angle += turn * Math.min(1, dt * 7); c.root.rotation.z = c.angle;
    c.root.rotation.y = Math.sin(time * 2 + m.seed) * .18;
    return distance;
  }
  function crawlerPoint(c: Creature) {
    const m = c.motion!, r = rects[m.surface % Math.max(1, rects.length)];
    if (!r) return null;
    return perimeterPoint({ left: r.left + 6, top: Math.max(headerBottom + 10, r.top + 6), width: r.width - 12, height: Math.min(height - 20, r.bottom) - Math.max(headerBottom + 10, r.top + 6) }, m.distance);
  }
  function chooseLanding(c: Creature) {
    const m = c.motion!;
    m.surface = (m.surface + 1 + Math.floor(chance() * Math.max(1, rects.length - 1))) % Math.max(1, rects.length);
    m.distance = random(0, 700); m.direction = chance() < .5 ? -1 : 1;
    const point = crawlerPoint(c);
    m.target.set(point?.x ?? width / 2, height - (point?.y ?? height / 2), 25);
    m.retarget = time + 8;
  }
  function draw(now: number) {
    if (disposed || contextLost) return;
    frame = requestAnimationFrame(draw);
    if (document.hidden) { last = now; return; }
    if (now - last < (lively && !reduced.matches ? 32 : 100)) return;
    const dt = Math.min((now - (last || now)) / 1000, .05) * knobs.speed; last = now;
    const moving = lively && !reduced.matches;
    if (moving) time += dt;
    if (now - measured > 650) { measure(); measured = now; }
    const busy = !!document.getSelection()?.toString() || !!document.querySelector('[role="dialog"], [role="alertdialog"], [role="listbox"]');
    host.style.opacity = busy ? '0' : '1';
    if (busy) { dirty = true; return; }
    if (!moving) {
      // Nothing animates: repaint only after a resize, scroll, pointer move or layout change.
      const key = `${width}x${height}:${Math.round(headerBottom)}:${Math.round(sidebarRight)}`;
      if (!dirty && key === paintedKey && now - lastPaint < 5000) return;
      dirty = false; paintedKey = key; lastPaint = now;
    }
    groves.forEach((g, i) => {
      g.position.set(width - 55, 0, 0); g.scale.setScalar(width < 760 ? .55 : 1);
      g.rotation.z = moving ? Math.sin(time * .8 + i) * .018 : 0;
      g.visible = true;
      if (moving) g.rotation.z += Math.max(0, 1 - Math.hypot(pointer.x - (width - 55), pointer.y - (height - 90)) / 160) * .025;
    });
    stars.forEach((s, i) => { s.rotation.y = moving ? Math.sin(time * .8 + i) * .45 : .2; });
    treeLights.forEach((s, i) => s.scale.setScalar(3.1 * (moving ? 1 + Math.sin(time * 1.4 + i * 2) * .1 : 1)));
    hauntedTree.position.set(width - 34, 0, 0);
    hauntedTree.scale.setScalar(width < 760 ? .62 : 1);
    hauntedTree.rotation.z = moving ? Math.sin(time * .65) * .012 : 0;
    hauntedTree.visible = true;
    if (moving) hauntedTree.rotation.z += Math.max(0, 1 - Math.hypot(pointer.x - (width - 64), pointer.y - (height - 160)) / 180) * .025;
    hauntedTree.updateMatrixWorld(true);
    webs.forEach((web, i) => {
      // Each web hangs from a corner with its rays opening into the page: top-right as built, top-left mirrored (quarter turn), bottom-left turned over.
      if (i === 1) { web.position.set(sidebarRight + 6, height - headerBottom - 6, 18); web.rotation.z = Math.PI / 2; }
      else if (i === 2) { web.position.set(sidebarRight + 8, 0, 18); web.rotation.z = Math.PI; }
      else web.position.set(width, height - headerBottom, 18);
      web.rotation.y = Math.sin(time * .7 + i) * .05;
    });
    ghosts.forEach((ghost, i) => {
      const x = i ? sidebarRight + 34 + Math.sin(time * .3) * 20 : width - 85 + Math.sin(time * .4) * 22;
      const y = height * (i ? .32 : .6) + Math.sin(time * .8 + i * 2) * 24;
      const near = Math.max(0, 1 - Math.hypot(pointer.x - x, pointer.y - (height - y)) / 140);
      ghost.position.set(x + (i ? 1 : -1) * near * 45, y + near * 15, 35);
      ghost.rotation.set(Math.sin(time * .7) * .06, Math.sin(time * .4 + i) * .3, Math.sin(time * 1.3 + i) * .08);
      ghost.scale.y = (i ? .8 : 1.1) * (1 + Math.sin(time * 1.4 + i) * .06);
    });
    pumpkinFaces.forEach((m, i) => { m.emissiveIntensity = moving ? 1.5 + Math.sin(time * 4 + i) * .25 + Math.sin(time * 11) * .1 : 1.5; });
    creatures.forEach((c, i) => {
      const compact = width < 760;
      c.root.visible = !compact || c.n === 0;
      if (c.kind === 'bug') {
        const m = c.motion!;
        if (!moving) {
          // Still scenes: beetles rest in a row at the foot of the tree and pumpkins instead of sitting on card borders over text.
          const sz = knobs.bugSize; c.root.position.set(width - 70 * sz - c.n * 28 * sz, 12 * sz, 20); c.root.rotation.set(0, 0, Math.PI / 2 + (c.n % 2 ? .25 : -.2));
          c.wings?.forEach(w => { w.visible = false; });
          return;
        }
        if (m.phase === 'crawl') {
          const point = crawlerPoint(c);
          if (!point) { c.root.visible = false; return; }
          c.root.position.set(point.x, height - point.y, 20); c.root.rotation.y = 0;
          const near = Math.hypot(pointer.x - point.x, pointer.y - point.y);
          m.distance += moving ? dt * (22 + i * 5 + Math.max(0, 120 - near) * .9) * m.direction : 0;
          const heading = point.angle + (m.direction < 0 ? Math.PI : 0);
          c.angle += Math.atan2(Math.sin(heading - c.angle), Math.cos(heading - c.angle)) * Math.min(1, dt * 9); c.root.rotation.z = c.angle;
          if (moving && (time > m.until || near < 55)) { m.phase = 'flight'; chooseLanding(c); m.until = time + 8; }
        } else if (moving) {
          if (time > m.retarget) chooseLanding(c);
          if (fly(c, dt, 125) < 16) { m.phase = 'crawl'; m.until = time + random(7, 18); m.velocity.set(0, 0, 0); }
        }
        c.wings?.forEach((wing, j) => { wing.visible = m.phase !== 'crawl' && moving; wing.rotation.y = (j ? -1 : 1) * (.4 + Math.sin(time * 55) * .65); });
      } else if (c.kind === 'spider') {
        const j = c.n; const x = [width - 35, sidebarRight + 22, sidebarRight + (width - sidebarRight) * .5, sidebarRight + (width - sidebarRight) * .72][j % 4]!;
        const drop = 48 + (moving ? (Math.sin(time * .35 + j * 2) + 1) * 48 : j * 28);
        c.root.position.set(x + Math.sin(time * 1.2 + j) * 7, height - headerBottom - drop, 24);
        c.root.rotation.z = Math.sin(time * 1.2 + j) * .08;
        if (!moving && j >= 2) c.root.visible = false; // spiders three and four hang mid-page, so they only appear while moving
        const sway = c.root.position.x - x;
        c.thread!.position.set(x + sway / 2, height - headerBottom - drop / 2, 23); c.thread!.scale.y = Math.hypot(drop, sway); c.thread!.rotation.z = Math.atan2(sway, drop); c.thread!.visible = c.root.visible;
      } else {
        const j = c.n, m = c.motion!;
        const scale = (width < 760 ? .46 : .65) + (m.seed % 30) / 100;
        // Bats only ever rest on the haunted tree, so a resting bat never covers card or table text; flights cross the page briefly.
        const perch = hauntedTree.localToWorld(roosts[j % roosts.length]!.clone());
        const home = perch.clone().add(new T.Vector3(0, -20 * scale, 7));
        c.root.visible = j < Math.min(knobs.bats, compact ? 3 : width < 1200 ? 7 : 12);
        c.root.scale.setScalar(scale);
        if (m.phase === 'rest' || !moving) {
          c.root.position.copy(home); c.root.rotation.z = Math.PI + Math.sin(time * .9 + j) * .045; c.root.rotation.y = 0; c.angle = Math.PI;
          const near = Math.hypot(pointer.x - home.x, pointer.y - (height - home.y));
          c.limbs.forEach((wing, k) => { wing.rotation.y = (k ? -1 : 1) * (1.35 - Math.max(0, 1 - near / 180) * .4); wing.rotation.z = 0; });
          if (moving && (time > m.until || near < 100)) { m.phase = 'flight'; m.until = time + random(10, 20); m.retarget = 0; }
        } else {
          if (m.phase === 'flight' && time > m.until) m.phase = 'return';
          if (m.phase === 'return') m.target.copy(home);
          else if (time > m.retarget || c.root.position.distanceTo(m.target) < 40) {
            // Independent waypoints sometimes leave the viewport, then lead the bat back to a new roost.
            const outside = chance() < .35;
            const anywhere = (min: number, max: number) => min + (max - min) * chance();
            m.target.set(outside ? (chance() < .5 ? -100 : width + 100) : anywhere(sidebarRight + 40, Math.max(sidebarRight + 50, width - 50)), anywhere(90, Math.max(100, height - 90)), anywhere(30, 75));
            m.retarget = time + random(3, 6);
          }
          const distance = fly(c, dt, (m.phase === 'return' ? 80 : 110) + m.seed * .8);
          if (m.phase === 'return' && distance < 13) { m.phase = 'rest'; m.until = time + random(6, 18); m.velocity.set(0, 0, 0); }
          c.limbs.forEach((wing, k) => { wing.rotation.y = (k ? -1 : 1) * Math.sin(time * (18 + j) + j) * .95; wing.rotation.z = 0; });
        }
        host.dataset[`bat${j}`] = m.phase === 'rest' ? 'hanging' : m.phase;
      }
      if (c.kind !== 'bat') c.limbs.forEach((leg, j) => { leg.rotation.z = moving ? Math.sin(time * (c.kind === 'bug' ? 20 : 5) + j * Math.PI) * .16 : 0; });
    });
    if (season === 'christmas') {
      const cycle = time % 38;
      sleigh.visible = moving && cycle < 18;
      sleigh.position.set(-150 + cycle / 18 * (width + 350), height - Math.max(110, headerBottom + 50) + Math.sin(time * 1.5) * 9, 70);
      sleigh.rotation.z = Math.sin(time * .8) * .025;
      deerLegs.forEach((l, i) => { l.rotation.z = Math.sin(time * 8 + Math.floor(i / 4) * .8 + i % 2 * Math.PI) * .65; });
      santaWave.rotation.z = Math.sin(time * 4) * .3;
      deerHeads.forEach((h, i) => { h.rotation.z = -.35 + Math.sin(time * 8 + i) * .08; });
    }
    flakes.visible = moving;
    if (moving) bodies.forEach((b, i) => {
      const hit = stepSnow(b, dt, time, edges, 10 + Math.sin(time * .65) * 24);
      if (hit) host.dataset['lastBounce'] = String(Math.round(time * 1000));
      if (b.y > height + 15 || b.x > width + 30 || b.x < -30) { b.x = (i * 173 + time * 31) % width; b.y = -12; b.vy = 10; b.bounces = 0; }
      dummy.position.set(b.x, height - b.y, 40 + i % 5); dummy.rotation.set(time * .4 + i, time * .65 + i, time * .3); dummy.scale.setScalar(b.radius / 2); dummy.updateMatrix(); flakes.setMatrixAt(i, dummy.matrix);
    });
    flakes.instanceMatrix.needsUpdate = true;
    renderer.render(scene, camera);
  }
  resize();
  window.addEventListener('resize', resize); window.addEventListener('scroll', invalidate, true);
  window.addEventListener('pointermove', move, { passive: true }); window.addEventListener('pointerdown', down, { passive: true });
  // Losing the GPU context shows the CSS scenery and pauses the loop; three.js rebuilds its state on restore and we resume.
  const lost = (e: Event) => { e.preventDefault(); contextLost = true; cancelAnimationFrame(frame); host.dataset['ready'] = ''; host.style.display = 'none'; };
  const restored = () => { if (disposed) return; contextLost = false; host.style.display = ''; host.dataset['ready'] = 'true'; measured = -Infinity; dirty = true; last = 0; frame = requestAnimationFrame(draw); };
  renderer.domElement.addEventListener('webglcontextlost', lost);
  renderer.domElement.addEventListener('webglcontextrestored', restored);
  frame = requestAnimationFrame(draw);
  return () => {
    disposed = true; cancelAnimationFrame(frame);
    window.removeEventListener('resize', resize); window.removeEventListener('scroll', invalidate, true); window.removeEventListener('pointermove', move); window.removeEventListener('pointerdown', down);
    renderer.domElement.removeEventListener('webglcontextlost', lost); renderer.domElement.removeEventListener('webglcontextrestored', restored);
    shadowTexture.dispose(); geometries.forEach(g => g.dispose()); materials.forEach(m => m.dispose()); flakes.dispose(); renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove();
  };
}
