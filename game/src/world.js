// The map: Foundry District, an original dusk-industrial plant. Two bombsites
// (Furnace / A, north-west; Depot / B, north-east), a mid lane, west and east long
// corridors, and spawn yards for the two teams. Every box is a collider for
// movement and a surface a bullet stops on. Plain geometry only, no models and
// no textures loaded from disk: the ground and the site letters are canvas
// textures generated here at runtime.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { segmentHitsBox } from './util.js';

const SITES = {
  A: { name: 'Furnace', x: -22, z: -18, r: 6.5 },
  B: { name: 'Depot', x: 22, z: -18, r: 6.5 },
};

export const SPAWNS = {
  ember: [
    [0, 23], [-4, 24], [4, 24], [-7, 22], [7, 22],
  ],
  ashen: [
    [0, -24], [-4, -24], [4, -24], [-7, -23], [7, -23],
  ],
};

// Waypoint graph the bots walk. Nodes are (x, z); edges are [a, b] index pairs.
const WAYPOINTS = [
  [0, 23], [-7, 23], [7, 23], [0, 16], [0, 8], [0, 0], [0, -6],
  [-20, 8], [-27, 0], [-27, -14], [-21, -18], [-16, -16],
  [20, 8], [27, 0], [27, -16], [21, -18], [16, -16],
  [0, -24], [-10, -10], [10, -10], [-14, 4], [14, 4],
  [-12, -20], [12, -20], [-27, 18], [27, 18],
];
const EDGES = [
  [0, 1], [0, 2], [0, 3], [1, 3], [2, 3], [1, 7], [2, 12], [1, 24], [2, 25],
  [3, 4], [4, 5], [5, 6], [4, 20], [4, 21], [7, 20], [12, 21], [7, 8], [12, 13],
  [8, 9], [13, 14], [9, 10], [14, 15], [10, 11], [15, 16], [9, 22], [14, 23],
  [11, 18], [16, 19], [18, 6], [19, 6], [6, 17],
  [17, 22], [17, 23], [8, 24], [13, 25], [20, 18], [21, 19],
  [10, 22], [11, 10], [16, 15], [23, 16],
];

function groundTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#26211a';
  ctx.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 9000; i += 1) {
    const v = Math.random();
    ctx.fillStyle = v < 0.5 ? 'rgba(0,0,0,0.25)' : 'rgba(255,240,210,0.05)';
    ctx.fillRect(Math.random() * 512, Math.random() * 512, 2, 2);
  }
  ctx.strokeStyle = 'rgba(255,122,26,0.10)';
  ctx.lineWidth = 2;
  for (let i = 0; i <= 8; i += 1) {
    ctx.beginPath();
    ctx.moveTo(i * 64, 0);
    ctx.lineTo(i * 64, 512);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, i * 64);
    ctx.lineTo(512, i * 64);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(8, 7);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function letterTexture(letter, colour) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, 256, 256);
  ctx.strokeStyle = colour;
  ctx.lineWidth = 10;
  ctx.strokeRect(14, 14, 228, 228);
  ctx.fillStyle = colour;
  ctx.font = 'bold 150px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(letter, 128, 136);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function createWorld(scene) {
  const group = new THREE.Group();
  scene.add(group);
  const colliders = [];
  const shootables = [];

  const mat = {};
  for (const name of Object.keys(PALETTE)) {
    mat[name] = new THREE.MeshStandardMaterial({
      color: new THREE.Color(PALETTE[name]),
      roughness: name === 'accent' || name === 'ink' ? 0.55 : 0.92,
      metalness: 0.04,
    });
  }
  const rust = new THREE.MeshStandardMaterial({ color: 0x8a4a22, roughness: 0.85, metalness: 0.25 });
  const steel = new THREE.MeshStandardMaterial({ color: 0x4a5258, roughness: 0.45, metalness: 0.7 });
  const containerBlue = new THREE.MeshStandardMaterial({ color: 0x2e5d7a, roughness: 0.7, metalness: 0.3 });
  const containerGreen = new THREE.MeshStandardMaterial({ color: 0x4a6b3a, roughness: 0.7, metalness: 0.3 });

  function box(w, h, d, x, y, z, material, collide = true) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    if (collide) {
      colliders.push(new THREE.Box3().setFromObject(mesh));
      shootables.push(mesh);
    }
    return mesh;
  }

  function cylinder(rTop, rBottom, h, x, y, z, material) {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBottom, h, 18), material);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    colliders.push(new THREE.Box3().setFromObject(mesh));
    shootables.push(mesh);
    return mesh;
  }

  // Ground, with a generated asphalt texture.
  const ground = new THREE.Mesh(
    new THREE.BoxGeometry(66, 0.4, 58),
    new THREE.MeshStandardMaterial({ map: groundTexture(), roughness: 0.95, metalness: 0.02 }),
  );
  ground.position.set(0, -0.2, 0);
  ground.receiveShadow = true;
  group.add(ground);
  colliders.push(new THREE.Box3().setFromObject(ground));
  shootables.push(ground);

  // Perimeter walls, 5 m high.
  box(66, 5, 0.6, 0, 2.5, -28.3, mat.surface);
  box(66, 5, 0.6, 0, 2.5, 28.3, mat.surface);
  box(0.6, 5, 58, -32.3, 2.5, 0, mat.surface);
  box(0.6, 5, 58, 32.3, 2.5, 0, mat.surface);

  // Mid doors: two walls across the mid lane with a 2 m gap in the middle.
  box(3, 3.6, 0.5, -2.5, 1.8, 4, mat.hairline);
  box(3, 3.6, 0.5, 2.5, 1.8, 4, mat.hairline);
  box(2.5, 3.6, 0.5, -2.75, 1.8, -8, mat.hairline);
  box(2.5, 3.6, 0.5, 2.75, 1.8, -8, mat.hairline);
  // Mid cover crates, kept off the centre line so bots can walk the lane.
  box(1.2, 1.2, 1.2, -2.2, 0.6, 12, mat.hairline);
  box(1.2, 1.2, 1.2, 2.4, 0.6, 0, mat.hairline);
  box(2.2, 1.1, 1.2, 2.6, 0.55, -2, mat.hairline);

  // Site divider wall (z = -12) with an entrance gap to each site, plus a gap at
  // each outer end so the long lanes feed into the sites.
  box(9, 4, 0.5, -20.5, 2, -12, mat.surface);
  box(4, 4, 0.5, -10, 2, -12, mat.surface);
  box(4, 4, 0.5, 10, 2, -12, mat.surface);
  box(9, 4, 0.5, 20.5, 2, -12, mat.surface);

  // Long-lane walls (x = -22 and x = 22) with a south gap and a north gap each.
  box(0.5, 4, 12, -22, 2, 14, mat.surface);
  box(0.5, 4, 10, -22, 2, -1, mat.surface);
  box(0.5, 4, 12, 22, 2, 14, mat.surface);
  box(0.5, 4, 10, 22, 2, -1, mat.surface);

  // West and east mid blocks.
  box(1.4, 2.6, 1.4, -14, 1.3, 8, mat.hairline);
  box(1.4, 2.6, 1.4, 14, 1.3, 8, mat.hairline);
  box(3.4, 1.1, 1.2, -8, 0.55, 18, mat.hairline);
  box(3.4, 1.1, 1.2, 8, 0.55, 18, mat.hairline);

  // Site A / Furnace: a big furnace cylinder, chimney, crates and pipes.
  cylinder(2.6, 3.0, 5.5, -26, 2.75, -20, rust);
  box(1.6, 7.5, 1.6, -27.5, 3.75, -23, steel);
  box(2.4, 1.2, 1.2, -18, 0.6, -22, mat.hairline);
  box(1.2, 1.2, 1.2, -19.5, 0.6, -14.5, mat.hairline);
  box(1.2, 2.4, 1.2, -14, 1.2, -21.5, mat.hairline);
  box(4.4, 0.9, 1.4, -24, 0.45, -13.5, mat.hairline);

  // Site B / Depot: stacked containers and a tank.
  box(6, 2.6, 2.6, 26, 1.3, -21, containerBlue);
  box(6, 2.6, 2.6, 26, 3.9, -21, containerGreen);
  box(2.6, 2.6, 6, 17.5, 1.3, -20, containerGreen);
  cylinder(1.8, 1.8, 3.2, 20, 1.6, -23, steel);
  box(1.2, 1.2, 1.2, 24.5, 0.6, -14.5, mat.hairline);
  box(2.4, 1.1, 1.2, 19, 0.55, -14, mat.hairline);

  // CT yard cover and a central pillar at the CT crossroads.
  box(1.4, 3.0, 1.4, 0, 1.5, -16, mat.hairline);
  box(2.2, 1.1, 1.2, -8, 0.55, -21, mat.hairline);
  box(2.2, 1.1, 1.2, 8, 0.55, -21, mat.hairline);

  // Site letters painted on the ground, and a banner above each site.
  for (const key of ['A', 'B']) {
    const site = SITES[key];
    const colour = key === 'A' ? PALETTE.accent : PALETTE.ashen;
    const decal = new THREE.Mesh(
      new THREE.PlaneGeometry(5, 5),
      new THREE.MeshBasicMaterial({ map: letterTexture(key, colour), transparent: true, opacity: 0.85, depthWrite: false }),
    );
    decal.rotation.x = -Math.PI / 2;
    decal.position.set(site.x, 0.02, site.z);
    group.add(decal);
    const banner = new THREE.Mesh(
      new THREE.PlaneGeometry(3.2, 1.1),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(colour), transparent: true, opacity: 0.9 }),
    );
    banner.position.set(site.x, 4.6, site.z + 3.5);
    group.add(banner);
  }

  // Skyline silhouettes outside the walls, so the horizon is not a flat colour.
  const skylineMat = new THREE.MeshBasicMaterial({ color: 0x0e0b09, fog: false });
  for (let i = 0; i < 14; i += 1) {
    const w = 6 + ((i * 37) % 9);
    const h = 8 + ((i * 53) % 14);
    const angle = (i / 14) * Math.PI * 2;
    const r = 52 + ((i * 11) % 10);
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, w), skylineMat);
    mesh.position.set(Math.cos(angle) * r, h / 2 - 0.5, Math.sin(angle) * r);
    group.add(mesh);
  }
  // A low dusk sun disc on the horizon.
  const sun = new THREE.Mesh(
    new THREE.CircleGeometry(5, 32),
    new THREE.MeshBasicMaterial({ color: 0xff8c2e, fog: false, transparent: true, opacity: 0.9 }),
  );
  sun.position.set(-46, 9, -30);
  sun.lookAt(0, 4, 0);
  group.add(sun);

  // Light: a low warm sun with shadows, a cool hemisphere, and warm lamps over
  // the sites and mid so the lanes read at a glance.
  scene.add(new THREE.HemisphereLight(new THREE.Color(0x8a7a66), new THREE.Color(0x1a1410), 0.9));
  const key = new THREE.DirectionalLight(new THREE.Color(0xffb066), 2.4);
  key.position.set(-24, 26, 18);
  key.target.position.set(0, 0, -6);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = -40;
  key.shadow.camera.right = 40;
  key.shadow.camera.top = 40;
  key.shadow.camera.bottom = -40;
  key.shadow.camera.far = 90;
  key.shadow.bias = -0.0005;
  scene.add(key, key.target);
  const fill = new THREE.DirectionalLight(new THREE.Color(0x6fa8c9), 0.5);
  fill.position.set(20, 16, 24);
  scene.add(fill);
  for (const [x, z, colour] of [[-22, -18, 0xff7a1a], [22, -18, 0x6fa8c9], [0, 8, 0xffc27a]]) {
    const lamp = new THREE.PointLight(new THREE.Color(colour), 22, 20, 1.8);
    lamp.position.set(x, 4.5, z);
    scene.add(lamp);
  }

  // Waypoint graph with BFS paths.
  const adjacency = WAYPOINTS.map(() => []);
  for (const [a, b] of EDGES) {
    adjacency[a].push(b);
    adjacency[b].push(a);
  }
  function nearestNode(x, z) {
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < WAYPOINTS.length; i += 1) {
      const dx = WAYPOINTS[i][0] - x;
      const dz = WAYPOINTS[i][1] - z;
      const d = dx * dx + dz * dz;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  }
  function findPath(fromX, fromZ, toX, toZ) {
    const start = nearestNode(fromX, fromZ);
    const goal = nearestNode(toX, toZ);
    if (start === goal) return [[toX, toZ]];
    const prev = new Array(WAYPOINTS.length).fill(-1);
    const queue = [start];
    prev[start] = start;
    while (queue.length > 0) {
      const cur = queue.shift();
      if (cur === goal) break;
      for (const next of adjacency[cur]) {
        if (prev[next] === -1) {
          prev[next] = cur;
          queue.push(next);
        }
      }
    }
    if (prev[goal] === -1) return [[toX, toZ]];
    const path = [];
    let node = goal;
    while (node !== start) {
      path.unshift(WAYPOINTS[node]);
      node = prev[node];
    }
    path.push([toX, toZ]);
    return path;
  }

  // Line of sight: true when no collider sits between the two points.
  const p0 = [0, 0, 0];
  const p1 = [0, 0, 0];
  function losBlocked(ax, ay, az, bx, by, bz) {
    p0[0] = ax;
    p0[1] = ay;
    p0[2] = az;
    p1[0] = bx;
    p1[1] = by;
    p1[2] = bz;
    for (const box3 of colliders) {
      if (box3.min.y > 3.4) continue; // tall walls still block; floor never does
      if (segmentHitsBox(p0, p1, [box3.min.x, box3.min.y, box3.min.z], [box3.max.x, box3.max.y, box3.max.z])) return true;
    }
    return false;
  }

  function siteAt(x, z) {
    for (const key of ['A', 'B']) {
      const site = SITES[key];
      const dx = x - site.x;
      const dz = z - site.z;
      if (dx * dx + dz * dz < site.r * site.r) return key;
    }
    return null;
  }

  return {
    colliders,
    shootables,
    group,
    sites: SITES,
    waypoints: WAYPOINTS,
    findPath,
    losBlocked,
    siteAt,
  };
}
