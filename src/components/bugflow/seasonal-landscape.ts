import * as T from "three";

/** A shallow scenic border leaves the working area and all hit targets intact. */
export function createSeasonalLandscape(scene: T.Scene, season: string) {
  const root = new T.Group();
  scene.add(root);
  const snowy = season === "winter" || season === "christmas";
  const autumn = season === "autumn";
  const geometries: T.BufferGeometry[] = [],
    materials: T.Material[] = [];
  function material(color: number, metalness = 0) {
    const m = new T.MeshStandardMaterial({ color, roughness: 0.65, metalness });
    materials.push(m);
    return m;
  }
  const rock = material(snowy ? 0x697f99 : autumn ? 0x8a5844 : 0x342c48);
  const cap = material(snowy ? 0xe5f2fa : autumn ? 0xb67e48 : 0x51435e);
  const ground = material(snowy ? 0xd6e7ee : autumn ? 0x634225 : 0x263b31);
  const grass = material(snowy ? 0x768c7a : autumn ? 0xa38448 : 0x53505f);
  const water = material(snowy ? 0x528ba5 : 0x397e83, 0.45);
  function add(g: T.BufferGeometry, m: T.Material, x: number, y: number, z: number) {
    geometries.push(g);
    const mesh = new T.Mesh(g, m);
    mesh.position.set(x, y, z);
    root.add(mesh);
    return mesh;
  }
  // Faceted peaks sit at the edge, behind the foreground trees.
  for (let i = 0; i < 4; i++) {
    const h = [72, 115, 91, 54][i]!;
    const peak = add(new T.ConeGeometry(40, h, 5), rock, 190 + i * 40, h / 2 - 5, -80);
    peak.rotation.y = i * 0.8;
    const tip = add(new T.ConeGeometry(14, h * 0.35, 5), cap, 190 + i * 40, h * 0.825 - 5, -79);
    tip.rotation.y = peak.rotation.y;
  }
  const bank = add(new T.SphereGeometry(1, 24, 12), ground, 190, -6, -20);
  bank.scale.set(235, 24, 25);
  // A winding ribbon of water, with independent moving glints.
  const path = new T.CatmullRomCurve3([
    new T.Vector3(355, 8, -5),
    new T.Vector3(270, 17, -5),
    new T.Vector3(235, 4, 0),
    new T.Vector3(160, 1, 0),
    new T.Vector3(110, -8, 0),
  ]);
  const riverShape = new T.Shape();
  const banks: T.Vector3[][] = [[], []];
  for (let i = 0; i <= 48; i++) {
    const p = path.getPoint(i / 48),
      tangent = path.getTangent(i / 48);
    const normal = new T.Vector3(-tangent.y, tangent.x, 0).normalize();
    const breadth = 2 + (i / 48) * 4;
    banks[0]!.push(p.clone().addScaledVector(normal, breadth));
    banks[1]!.push(p.clone().addScaledVector(normal, -breadth));
  }
  [...banks[0]!, ...banks[1]!.reverse()].forEach((p, i) => {
    if (!i) riverShape.moveTo(p.x, p.y);
    else riverShape.lineTo(p.x, p.y);
  });
  riverShape.closePath();
  add(new T.ShapeGeometry(riverShape), water, 0, 0, 3);
  const sparkle = material(0xc4e9ed, 0.2);
  const ripples = Array.from({ length: 9 }, () => {
    const m = add(new T.SphereGeometry(1, 6, 4), sparkle, 0, 0, 0);
    m.scale.set(4, 0.5, 0.5);
    return m;
  });
  const blades = Array.from({ length: 24 }, (_, i) => {
    const m = add(new T.ConeGeometry(0.8, 6 + (i % 5), 3), grass, 40 + i * 6, 9, 12);
    return m;
  });
  const pineFar = material(snowy ? 0x668b8c : autumn ? 0x906247 : 0x334c49);
  const pineNear = material(snowy ? 0x395f58 : autumn ? 0x785137 : 0x293e38);
  const distantTrees: { tree: T.Group; u: number; size: number }[] = [];
  const trunkMaterial = material(autumn ? 0x64432f : 0x39303e);
  const leafColors = [
    material(0xbc642f),
    material(0xd59b42),
    material(0x9c422c),
    material(0xe2b65f),
  ];
  const festiveBerry = material(0xb93a46, 0.25),
    festiveGold = material(0xe7ba65, 0.4);
  for (let i = 0; i < 38; i++) {
    const tree = new T.Group();
    root.add(tree);
    const size = 12 + ((i * 17) % 23);
    function piece(g: T.BufferGeometry, m: T.Material, x: number, y: number, z = 0) {
      geometries.push(g);
      const object = new T.Mesh(g, m);
      object.position.set(x, y, z);
      tree.add(object);
      return object;
    }
    piece(new T.CylinderGeometry(0.6, 1.2, size * 0.7, 5), trunkMaterial, 0, size * 0.35);
    if (snowy) {
      for (let tier = 0; tier < 4; tier++) {
        const radius = size * (0.26 - tier * 0.048);
        piece(
          new T.ConeGeometry(radius, size * 0.48, 8),
          i % 3 ? pineFar : pineNear,
          0,
          size * (0.3 + tier * 0.19),
        );
        piece(
          new T.ConeGeometry(radius * 0.85, size * 0.34, 8),
          cap,
          0,
          size * (0.38 + tier * 0.19),
        );
      }
      if (season === "christmas" && i % 3 === 0) {
        for (let ornament = 0; ornament < 4; ornament++) {
          piece(
            new T.SphereGeometry(1.1, 6, 5),
            ornament % 2 ? festiveGold : festiveBerry,
            (ornament % 2 ? -1 : 1) * size * 0.1,
            size * (0.35 + ornament * 0.12),
            size * 0.18,
          );
        }
      }
    } else {
      for (let branch = 0; branch < 5; branch++) {
        const side = branch % 2 ? -1 : 1,
          y = size * (0.35 + branch * 0.09);
        const limb = piece(
          new T.CylinderGeometry(0.3, 0.65, size * 0.28, 5),
          trunkMaterial,
          side * size * 0.09,
          y,
        );
        limb.rotation.z = -side * (0.65 + branch * 0.08);
        if (autumn) {
          const crown = piece(
            new T.IcosahedronGeometry(size * (0.19 + (branch % 2) * 0.04), 1),
            leafColors[(i + branch) % 4]!,
            side * size * 0.14,
            y + size * 0.1,
            (branch % 2) * 2,
          );
          crown.scale.y = 1.2;
          crown.rotation.set(i, branch, i * 0.4);
        }
      }
    }
    // Uneven clusters and two depth bands avoid a row of identical trees.
    distantTrees.push({ tree, u: (i + 0.7 * Math.sin(i * 4.7)) / 38, size });
  }
  const terrainLayers: T.Mesh[] = [];
  const terrainColors = snowy
    ? [0x8ba5b9, 0xb5cfda, 0xe4eff2]
    : autumn
      ? [0x66543d, 0x88603a, 0x543a28]
      : [0x40394e, 0x302d3c, 0x24232b];
  for (let layer = 0; layer < 3; layer++) {
    const outline = new T.Shape();
    outline.moveTo(0, -25);
    for (let i = 0; i <= 80; i++) {
      const u = i / 80;
      const edgeRise = Math.pow(Math.abs(u - 0.5) * 2, 3) * (14 - layer * 3);
      const y =
        7 +
        (2 - layer) * 5 +
        edgeRise +
        Math.sin(u * 15 + layer * 2) * 3 +
        Math.sin(u * 31 + layer) * 1.8;
      outline.lineTo(u * 1000, y);
    }
    outline.lineTo(1000, -25);
    outline.closePath();
    terrainLayers.push(
      add(
        new T.ExtrudeGeometry(outline, {
          depth: 3,
          bevelEnabled: true,
          bevelSegments: 2,
          steps: 1,
          bevelSize: 1,
          bevelThickness: 1,
        }),
        material(terrainColors[layer]!),
        0,
        0,
        -55 + layer * 14,
      ),
    );
  }
  const stones: T.Mesh[] = [];
  if (!snowy)
    for (let i = 0; i < 16; i++) {
      const stone = add(new T.DodecahedronGeometry(1, 0), rock, 0, 3, 5);
      stone.scale.set(3 + (i % 4), 2 + (i % 3), 3);
      stone.rotation.set(i * 0.3, i, 0.2);
      stones.push(stone);
    }
  const grassTufts: { blade: T.Mesh; u: number; offset: number; height: number }[] = [];
  for (let patch = 0; patch < 9; patch++)
    for (let blade = 0; blade < 5; blade++) {
      const h = 5 + ((patch * 3 + blade * 7) % 8);
      const m = add(new T.ConeGeometry(0.7, h, 3), grass, 0, 0, 22);
      grassTufts.push({ blade: m, u: (patch + 0.5) / 9, offset: (blade - 2) * 2, height: h });
    }
  // Tiny timber huts sit in the scenic border; translucent billboards form soft chimney plumes.
  const timber = material(autumn ? 0x7f432b : 0x63423a),
    roof = material(snowy ? 0xe0edf4 : 0x463137);
  const windowGlow = new T.MeshStandardMaterial({
    color: 0xffc66c,
    emissive: 0xff992e,
    emissiveIntensity: 1.4,
  });
  materials.push(windowGlow);
  const chimneys: T.Vector3[] = [];
  for (let i = 0; i < 2; i++) {
    const x = 215 + i * 75;
    add(new T.BoxGeometry(34, 27, 24), timber, x, 18, 15);
    const top = add(new T.ConeGeometry(29, 22, 4), roof, x, 41, 15);
    top.rotation.y = Math.PI / 4;
    add(new T.BoxGeometry(7, 16, 7), rock, x + 12, 49, 13);
    add(new T.BoxGeometry(7, 10, 1), windowGlow, x - 8, 20, 28);
    add(new T.BoxGeometry(8, 17, 1), timber, x + 6, 13, 28);
    chimneys.push(new T.Vector3(x + 12, 57, 13));
  }
  const candleFlames: T.Mesh[] = [];
  if (season === "halloween") {
    const stone = material(0x65616e),
      bone = material(0xc9bc9f),
      hollow = material(0x17131e),
      wax = material(0xd8c6a5);
    for (let i = 0; i < 3; i++) {
      const x = 55 + i * 43;
      const marker = add(new T.BoxGeometry(14, 22 + i * 3, 5), stone, x, 12 + i, 9);
      marker.rotation.z = (i - 1) * 0.12;
      const cap = add(new T.SphereGeometry(1, 10, 8), stone, x, 23 + i * 2, 9);
      cap.scale.set(7, 7, 2.5);
      const crack = add(new T.BoxGeometry(1, 11, 0.4), hollow, x - 1, 20, 12);
      crack.rotation.z = 0.35;
      add(new T.CylinderGeometry(2, 2.3, 8 + i * 2, 8), wax, x + 13, 5 + i, 18);
      const flame = add(new T.SphereGeometry(1, 8, 8), windowGlow, x + 13, 12 + i * 2, 18);
      flame.scale.set(1.4, 3.7, 1.4);
      candleFlames.push(flame);
    }
    const skull = add(new T.SphereGeometry(1, 12, 8), bone, 175, 10, 25);
    skull.scale.set(8, 8, 6);
    add(new T.BoxGeometry(9, 5, 6), bone, 175, 3, 27);
    for (const side of [-1, 1]) {
      const eye = add(new T.SphereGeometry(1, 8, 6), hollow, 175 + side * 3, 11, 30);
      eye.scale.set(2, 2.6, 1);
    }
  }
  const smokeCanvas = document.createElement("canvas");
  smokeCanvas.width = smokeCanvas.height = 96;
  const smokeContext = smokeCanvas.getContext("2d")!;
  // Overlapping soft lobes avoid the hard-edged stacked-circle appearance.
  for (let i = 0; i < 7; i++) {
    const x = 48 + Math.sin(i * 2.4) * 17,
      y = 48 + Math.cos(i * 1.7) * 15;
    const cloud = smokeContext.createRadialGradient(x, y, 0, x, y, 29);
    cloud.addColorStop(0, "rgba(220,225,232,.3)");
    cloud.addColorStop(0.5, "rgba(205,214,225,.12)");
    cloud.addColorStop(1, "rgba(205,214,225,0)");
    smokeContext.fillStyle = cloud;
    smokeContext.fillRect(0, 0, 96, 96);
  }
  const smokeTexture = new T.CanvasTexture(smokeCanvas);
  const plumes = Array.from({ length: 24 }, (_, i) => {
    const m = new T.SpriteMaterial({
      map: smokeTexture,
      transparent: true,
      depthWrite: false,
      opacity: 0,
      color: snowy ? 0xdce5ef : 0xc9c5c1,
    });
    materials.push(m);
    const puff = new T.Sprite(m);
    root.add(puff);
    return puff;
  });
  const mist =
    season === "halloween"
      ? Array.from({ length: 5 }, () => {
          const m = new T.SpriteMaterial({
            map: smokeTexture,
            color: 0x93899f,
            transparent: true,
            opacity: 0.13,
            depthWrite: false,
          });
          materials.push(m);
          const sprite = new T.Sprite(m);
          root.add(sprite);
          return sprite;
        })
      : [];
  return {
    update(width: number, time: number, wind: number) {
      root.position.x = width - 370;
      root.scale.setScalar(width < 760 ? 0.6 : 1);
      if (width < 760) root.position.x = width - 222;
      const localX = (x: number) => (x - root.position.x) / root.scale.x;
      distantTrees.forEach(({ tree, u, size }, i) => {
        tree.position.set(localX(width * u), 8 + (i % 3) * 3, i % 3 ? -50 : -23);
        tree.rotation.z = Math.sin(time * 0.7 + i) * Math.abs(wind) * 0.0005;
        tree.scale.setScalar((width < 760 ? 0.65 : 1) * (i % 3 ? 0.65 : 1));
      });
      terrainLayers.forEach((layer) => {
        layer.position.x = localX(0);
        layer.scale.x = width / 1000 / root.scale.x;
      });
      stones.forEach((stone, i) => {
        stone.position.x = localX((width * (i + 0.3 + 0.25 * Math.sin(i * 5))) / 16);
        stone.position.y = 4 + (i % 3);
      });
      grassTufts.forEach(({ blade, u, offset, height }, i) => {
        blade.position.set(localX(width * u) + offset, height / 2 + 2, 22);
        // Rotation about the base makes blades bend without sliding out of the ground.
        const lean =
          wind * 0.006 + Math.sin(time * 1.7 + i * 0.7) * Math.min(0.18, Math.abs(wind) * 0.008);
        blade.rotation.z = -lean;
        blade.position.x += (Math.sin(lean) * height) / 2;
        blade.position.y = (Math.cos(lean) * height) / 2 + 2;
      });
      mist.forEach((cloud, i) => {
        cloud.position.set(
          localX((width * (i + 0.5)) / 5 + Math.sin(time * 0.09 + i) * 28),
          16,
          32,
        );
        cloud.scale.set(width / 4 / root.scale.x, 38, 1);
      });
      candleFlames.forEach((flame, i) => {
        const flicker =
          wind === 0 ? 1 : 1 + Math.sin(time * 11 + i * 3) * 0.12 + Math.sin(time * 17 + i) * 0.06;
        flame.scale.set(1.4, 3.7 * flicker, 1.4);
        flame.rotation.z = -wind * 0.004;
      });
      plumes.forEach((puff, i) => {
        const age = (time * 0.12 + (i % 12) / 12) % 1;
        const origin = chimneys[Math.floor(i / 12)]!;
        const drift = wind * age * age * 0.7;
        puff.position.set(
          origin.x + drift + Math.sin(age * 7 + time * 0.35 + (i % 2)) * age * 8,
          origin.y + age * 78,
          origin.z + 5,
        );
        puff.scale.setScalar(10 + age * 43);
        puff.material.opacity = Math.sin(Math.PI * age) * 0.38;
        puff.material.rotation = age * 0.6 + Math.sin(time * 0.2 + i) * 0.15;
      });
      ripples.forEach((m, i) => {
        m.position.copy(path.getPoint((i / 9 + time * 0.025) % 1));
        m.position.z += 4;
      });
      blades.forEach((m, i) => {
        if (season === "christmas") {
          m.position.x = (width * (0.35 + (i / 24) * 0.43) - root.position.x) / root.scale.x;
          m.position.y = 3;
        }
        m.rotation.z =
          wind * 0.006 + Math.sin(time * 2 + i) * Math.min(0.15, Math.abs(wind) * 0.01);
      });
    },
    dispose() {
      smokeTexture.dispose();
      scene.remove(root);
      geometries.forEach((g) => g.dispose());
      materials.forEach((m) => m.dispose());
    },
  };
}
