// Bots: nine of them, four Ember teammates and five Ashen defenders. Each bot is
// a small state machine over a waypoint graph: advance along a route to its site,
// hold an angle, engage what it sees, investigate gunfire it hears, and plant or
// defuse the bomb when its side needs it. Vision is a real line-of-sight test
// against the world's colliders, and smoke puffs block it. Difficulty is reaction
// time and aim error, per bot.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { clamp, pointSegmentDistSq } from './util.js';

const RADIUS = 0.34;
const HEIGHT = 1.72;
const WALK_SPEED = 3.6;
const AIM_FOV = 0.25;

const EMBER_NAMES = ['Vex', 'Marlowe', 'Iris', 'Cato'];
const ASHEN_NAMES = ['Sable', 'Rook', 'Fen', 'Onyx', 'Bramble'];

function buildBotMesh(scene, team) {
  const colour = team === 'ember' ? PALETTE.accent : PALETTE.ashen;
  const bodyMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(colour), roughness: 0.65, metalness: 0.05 });
  const darkMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.hairline), roughness: 0.8 });
  const skinMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.ink), roughness: 0.6 });
  const group = new THREE.Group();
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.72, 0.3), bodyMat);
  torso.position.y = 1.05;
  torso.userData.part = 'torso';
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.28, 0.28), skinMat);
  head.position.y = 1.56;
  head.userData.part = 'head';
  const legL = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.62, 0.2), darkMat);
  legL.position.set(-0.14, 0.31, 0);
  const legR = legL.clone();
  legR.position.x = 0.14;
  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.09, 0.55), darkMat);
  gun.position.set(0.2, 1.15, -0.25);
  group.add(torso, head, legL, legR, gun);
  group.traverse((mesh) => {
    if (mesh.isMesh) {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
    }
  });
  scene.add(group);
  return { group, torso, head, legL, legR, gun };
}

export function createBots(scene, world, initialCtx) {
  const bots = [];
  const colliders = world.colliders;
  const probe = new THREE.Box3();
  let ctx = initialCtx;

  function overlaps(x, z) {
    probe.min.set(x - RADIUS, 0.04, z - RADIUS);
    probe.max.set(x + RADIUS, HEIGHT - 0.04, z + RADIUS);
    for (const collider of colliders) if (probe.intersectsBox(collider)) return true;
    return false;
  }

  function makeBot(team, name, spawn, skill) {
    const mesh = buildBotMesh(scene, team);
    const bot = {
      team,
      name,
      skill,
      mesh,
      position: new THREE.Vector3(spawn[0], 0, spawn[1]),
      yaw: team === 'ember' ? Math.PI : 0,
      health: 100,
      alive: true,
      state: 'advance',
      path: [],
      pathIndex: 0,
      holdAt: null,
      holdUntil: 0,
      target: null,
      reactLeft: 0,
      aimError: 0,
      burstLeft: 0,
      burstGap: 0,
      seeTimer: 0,
      investigate: null,
      plantLeft: 0,
      defuseLeft: 0,
      blindUntil: 0,
      walkPhase: 0,
      speed: WALK_SPEED,
      role: team === 'ember' ? 'attacker' : 'defender',
      site: null,
      hasBomb: false,
      spawn: [spawn[0], spawn[1]],
      stuckFor: 0,
      lastNodeDist: Infinity,
    };
    mesh.group.position.copy(bot.position);
    bots.push(bot);
    return bot;
  }

  function spawnAll(random) {
    for (const bot of bots) scene.remove(bot.mesh.group);
    bots.length = 0;
    const emberSpawns = [[0, 23], [-4, 24], [4, 24], [-7, 22], [7, 22]];
    const ashenSpawns = [[0, -24], [-4, -24], [4, -24], [-7, -23], [7, -23]];
    for (let i = 0; i < 4; i += 1) {
      makeBot('ember', EMBER_NAMES[i], emberSpawns[i], 0.6 + random() * 0.2);
    }
    for (let i = 0; i < 5; i += 1) {
      makeBot('ashen', ASHEN_NAMES[i], ashenSpawns[i], 0.55 + random() * 0.25);
    }
  }

  // A random spot inside a rectangle that a bot can actually stand on: the
  // centre is the fallback when every sample overlaps a collider.
  function freeSpot(cx, cz, rx, rz, random) {
    for (let i = 0; i < 10; i += 1) {
      const x = cx + (random() * 2 - 1) * rx;
      const z = cz + (random() * 2 - 1) * rz;
      if (!overlaps(x, z)) return [x, z];
    }
    return [cx, cz];
  }

  function assignRound(random) {
    for (const bot of bots) {
      bot.alive = true;
      bot.health = 100;
      bot.position.set(bot.spawn[0], 0, bot.spawn[1]);
      bot.yaw = bot.team === 'ember' ? Math.PI : 0;
      bot.state = 'advance';
      bot.path = [];
      bot.pathIndex = 0;
      bot.target = null;
      bot.investigate = null;
      bot.plantLeft = 0;
      bot.defuseLeft = 0;
      bot.blindUntil = 0;
      bot.hasBomb = false;
      bot.mesh.group.rotation.set(0, bot.yaw, 0);
      bot.mesh.group.position.copy(bot.position);
      bot.mesh.group.visible = true;
      if (bot.team === 'ember') {
        const roll = random();
        bot.site = roll < 0.45 ? 'A' : roll < 0.85 ? 'B' : null; // null: push mid, pick a site there
        const site = world.sites[bot.site ?? (random() < 0.5 ? 'A' : 'B')];
        const dest = bot.site
          ? freeSpot(site.x, site.z, 2, 2, random)
          : [0, 0];
        bot.path = world.findPath(bot.position.x, bot.position.z, dest[0], dest[1]);
        bot.pathIndex = 0;
      } else {
        const roll = random();
        if (roll < 0.4) bot.site = 'A';
        else if (roll < 0.8) bot.site = 'B';
        else bot.site = null; // mid roamer
        if (bot.site) {
          const site = world.sites[bot.site];
          bot.holdAt = freeSpot(site.x, site.z, 4, 3, random);
          bot.path = world.findPath(bot.position.x, bot.position.z, bot.holdAt[0], bot.holdAt[1]);
        } else {
          bot.holdAt = freeSpot(0, 1, 3, 3, random);
          bot.path = world.findPath(bot.position.x, bot.position.z, bot.holdAt[0], bot.holdAt[1]);
        }
        bot.pathIndex = 0;
        bot.state = 'advance';
      }
    }
  }

  function eyeOf(bot) {
    return { x: bot.position.x, y: 1.5, z: bot.position.z };
  }

  function inSmoke(ax, ay, az, bx, by, bz) {
    const a = { x: ax, y: ay, z: az };
    const b = { x: bx, y: by, z: bz };
    for (const s of ctx.activeSmokes()) {
      const c = { x: s.x, y: s.y, z: s.z };
      if (pointSegmentDistSq(c, a, b) < s.r * s.r) return true;
    }
    return false;
  }

  function canSee(bot, tx, ty, tz) {
    const eye = eyeOf(bot);
    const dx = tx - eye.x;
    const dz = tz - eye.z;
    const dist = Math.hypot(dx, dz);
    if (dist > 46) return false;
    if (dist > 1.2) {
      const facingX = -Math.sin(bot.yaw);
      const facingZ = -Math.cos(bot.yaw);
      if ((dx * facingX + dz * facingZ) / dist < AIM_FOV && dist > 6) return false;
    }
    if (world.losBlocked(eye.x, eye.y, eye.z, tx, ty, tz)) return false;
    if (inSmoke(eye.x, eye.y, eye.z, tx, ty, tz)) return false;
    return true;
  }

  function moveToward(bot, tx, tz, dt) {
    const dx = tx - bot.position.x;
    const dz = tz - bot.position.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.05) return true;
    const stepLen = bot.speed * dt;
    const nx = bot.position.x + (dx / dist) * stepLen;
    const nz = bot.position.z + (dz / dist) * stepLen;
    const targetYaw = Math.atan2(-(dx / dist), -(dz / dist));
    let dyaw = targetYaw - bot.yaw;
    while (dyaw > Math.PI) dyaw -= Math.PI * 2;
    while (dyaw < -Math.PI) dyaw += Math.PI * 2;
    bot.yaw += clamp(dyaw, -dt * 6, dt * 6);
    if (!overlaps(nx, bot.position.z)) bot.position.x = nx;
    if (!overlaps(bot.position.x, nz)) bot.position.z = nz;
    bot.walkPhase += dt * 9;
    return dist < 0.6;
  }

  function faceToward(bot, tx, tz, dt, rate = 5) {
    const dx = tx - bot.position.x;
    const dz = tz - bot.position.z;
    const targetYaw = Math.atan2(-dx, -dz);
    let dyaw = targetYaw - bot.yaw;
    while (dyaw > Math.PI) dyaw -= Math.PI * 2;
    while (dyaw < -Math.PI) dyaw += Math.PI * 2;
    bot.yaw += clamp(dyaw, -dt * rate, dt * rate);
  }

  function fireAt(bot, targetPos, targetSpeed, dt) {
    // Burst fire: 3-5 shots, then a gap. Hit chance falls with distance and
    // target speed, and rises as the bot keeps its aim on the target.
    if (bot.burstGap > 0) {
      bot.burstGap -= dt;
      return;
    }
    if (bot.burstLeft <= 0) {
      bot.burstLeft = 3 + Math.floor(Math.random() * 3);
      bot.burstGap = 0.12;
      return;
    }
    bot.burstLeft -= 1;
    bot.burstGap = 0.11;
    const eye = eyeOf(bot);
    const dist = Math.hypot(targetPos.x - eye.x, targetPos.z - eye.z);
    const base = 0.62 * bot.skill;
    const chance = clamp(base - dist * 0.008 - targetSpeed * 0.03, 0.05, 0.8);
    const hit = Math.random() < chance;
    const head = hit && Math.random() < 0.12;
    let end;
    if (hit) {
      end = { x: targetPos.x, y: targetPos.y, z: targetPos.z };
    } else {
      end = {
        x: targetPos.x + (Math.random() - 0.5) * 2.4,
        y: targetPos.y + (Math.random() - 0.5) * 1.2,
        z: targetPos.z + (Math.random() - 0.5) * 2.4,
      };
    }
    ctx.onBotShot(bot, { x: eye.x, y: eye.y - 0.1, z: eye.z }, end, hit, head);
  }

  function stepBot(bot, dt, now, canFight) {
    if (!bot.alive) return;
    const blinded = now < bot.blindUntil;
    // Vision sweep on a timer so nine bots do not all raycast every tick.
    // During the buy phase the bots walk their routes but do not fight.
    bot.seeTimer -= dt;
    if (bot.seeTimer <= 0) {
      bot.seeTimer = 0.15;
      bot.target = null;
      if (!blinded && canFight) {
        const enemies = ctx.enemiesOf(bot);
        let bestD = Infinity;
        for (const enemy of enemies) {
          if (!enemy.alive) continue;
          const pos = enemy.isPlayer ? ctx.playerPos() : enemy.position;
          const eyeY = enemy.isPlayer ? pos.y + 1.4 : 1.4;
          if (canSee(bot, pos.x, eyeY, pos.z)) {
            const d = Math.hypot(pos.x - bot.position.x, pos.z - bot.position.z);
            if (d < bestD) {
              bestD = d;
              bot.target = enemy;
            }
          }
        }
        if (bot.target && bot.reactLeft <= 0) bot.reactLeft = 0.75 - bot.skill * 0.4;
      }
    }
    if (bot.reactLeft > 0) bot.reactLeft -= dt;

    // Engaging: stand, aim, fire in bursts.
    if (canFight && bot.target && bot.target.alive && bot.reactLeft <= 0 && !blinded) {
      const enemy = bot.target;
      const pos = enemy.isPlayer ? ctx.playerPos() : enemy.position;
      const eyeY = enemy.isPlayer ? pos.y + 1.4 : 1.4;
      faceToward(bot, pos.x, pos.z, dt, 6);
      const speed = enemy.isPlayer ? ctx.playerSpeed() : bot.speed;
      fireAt(bot, { x: pos.x, y: eyeY, z: pos.z }, speed, dt);
      return;
    }

    // A plant or defuse in progress stops when the fighting stops.
    if (!canFight && (bot.state === 'plant' || bot.state === 'defuse')) {
      bot.state = 'advance';
      bot.plantLeft = 0;
      bot.defuseLeft = 0;
    }

    // Planting: the bomb carrier plants when its site is clear of enemies.
    if (canFight && bot.hasBomb && bot.state !== 'plant') {
      const site = world.siteAt(bot.position.x, bot.position.z);
      if (site && !bot.target) {
        bot.state = 'plant';
        bot.plantLeft = 3;
      }
    }
    if (bot.state === 'plant') {
      if (bot.target || blinded) {
        bot.state = 'advance';
        bot.plantLeft = 0;
        return;
      }
      bot.plantLeft -= dt;
      ctx.onPlantProgress(bot, Math.max(0, bot.plantLeft));
      if (bot.plantLeft <= 0) {
        bot.hasBomb = false;
        bot.state = 'hold';
        ctx.onPlanted(bot);
      }
      return;
    }

    // Defusing: a defender at the planted site defuses when it is clear.
    if (canFight && bot.team === 'ashen' && ctx.bombPlanted()) {
      const site = ctx.bombSite();
      if (site && bot.state !== 'defuse') {
        const dx = bot.position.x - site.x;
        const dz = bot.position.z - site.z;
        if (dx * dx + dz * dz < 25) {
          bot.state = 'defuse';
          bot.defuseLeft = 5;
        } else {
          bot.path = world.findPath(bot.position.x, bot.position.z, site.x, site.z);
          bot.pathIndex = 0;
          bot.state = 'advance';
        }
      }
    }
    if (bot.state === 'defuse') {
      if (bot.target || blinded) {
        bot.state = 'advance';
        bot.defuseLeft = 0;
        return;
      }
      bot.defuseLeft -= dt;
      ctx.onDefuseProgress(bot, Math.max(0, bot.defuseLeft));
      if (bot.defuseLeft <= 0) {
        bot.state = 'hold';
        ctx.onDefused(bot);
      }
      return;
    }

    // Investigate a sound: walk to it, then resume the route.
    if (bot.investigate && bot.state !== 'advance') {
      bot.path = world.findPath(bot.position.x, bot.position.z, bot.investigate[0], bot.investigate[1]);
      bot.pathIndex = 0;
      bot.state = 'advance';
      bot.investigate = null;
    }

    // Advance along the path; at the end, hold the angle. A bot that makes no
    // progress toward its node for a while skips that node instead of pushing
    // against a wall forever: the route still leads on.
    if (bot.state === 'advance') {
      if (bot.pathIndex < bot.path.length) {
        const node = bot.path[bot.pathIndex];
        const nodeDist = Math.hypot(node[0] - bot.position.x, node[1] - bot.position.z);
        if (nodeDist < bot.lastNodeDist - 0.05) {
          bot.lastNodeDist = nodeDist;
          bot.stuckFor = 0;
        } else {
          bot.stuckFor += dt;
          if (bot.stuckFor > 2.5) {
            bot.pathIndex += 1;
            bot.stuckFor = 0;
            bot.lastNodeDist = Infinity;
          }
        }
        if (bot.pathIndex < bot.path.length && moveToward(bot, bot.path[bot.pathIndex][0], bot.path[bot.pathIndex][1], dt)) {
          bot.pathIndex += 1;
          bot.lastNodeDist = Infinity;
          bot.stuckFor = 0;
        }
      } else {
        bot.state = 'hold';
        bot.holdUntil = now + 4 + Math.random() * 6;
        // Attackers who reached their site without the bomb hold; the carrier
        // plants on the next tick through the plant check above.
        if (bot.team === 'ashen' && bot.holdAt) faceToward(bot, bot.holdAt[0], bot.holdAt[1], dt, 2);
      }
      return;
    }

    // Hold: face the most likely approach and wait; then pick a new spot.
    if (bot.state === 'hold') {
      if (bot.team === 'ember' && bot.site) {
        const site = world.sites[bot.site];
        faceToward(bot, site.x, site.z + 8, dt, 1.5);
      } else if (bot.team === 'ashen') {
        // Defenders watch the entrances, which are to the south of both sites.
        faceToward(bot, bot.position.x, bot.position.z + 10, dt, 1.5);
      }
      if (now > bot.holdUntil) {
        bot.state = 'advance';
        if (bot.team === 'ashen' && bot.holdAt) {
          const spot = freeSpot(bot.holdAt[0], bot.holdAt[1], 2, 2, Math.random);
          bot.path = world.findPath(bot.position.x, bot.position.z, spot[0], spot[1]);
          bot.pathIndex = 0;
        } else if (bot.team === 'ember' && bot.site) {
          const site = world.sites[bot.site];
          const spot = freeSpot(site.x, site.z, 3, 3, Math.random);
          bot.path = world.findPath(bot.position.x, bot.position.z, spot[0], spot[1]);
          bot.pathIndex = 0;
        }
      }
    }
  }

  function syncMesh(bot) {
    const g = bot.mesh.group;
    g.position.set(bot.position.x, bot.position.y, bot.position.z);
    if (!bot.alive) return;
    g.rotation.y = bot.yaw;
    const moving = bot.state === 'advance';
    const swing = moving ? Math.sin(bot.walkPhase) * 0.35 : 0;
    bot.mesh.legL.rotation.x = swing;
    bot.mesh.legR.rotation.x = -swing;
  }

  function damage(bot, amount, head) {
    if (!bot.alive) return false;
    bot.health -= amount;
    if (bot.health <= 0) {
      bot.health = 0;
      bot.alive = false;
      bot.target = null;
      bot.mesh.group.rotation.set(-Math.PI / 2, bot.yaw, 0);
      bot.mesh.group.position.y = 0.25;
      return true;
    }
    // Being shot makes a bot turn toward the shooter and investigate.
    if (bot.state === 'hold' || bot.state === 'advance') {
      bot.state = 'advance';
    }
    return false;
  }

  return {
    bots,
    setCtx(next) {
      ctx = next;
    },
    spawnAll,
    assignRound,
    step(dt, now, canFight = true) {
      for (const bot of bots) {
        stepBot(bot, dt, now, canFight);
        syncMesh(bot);
      }
    },
    damage,
    hearShot(x, z, team) {
      for (const bot of bots) {
        if (!bot.alive || bot.team === team) continue;
        const dx = bot.position.x - x;
        const dz = bot.position.z - z;
        if (dx * dx + dz * dz < 900) {
          bot.investigate = [x, z];
          if (bot.state === 'hold') bot.state = 'advance';
        }
      }
    },
    applyFlash(x, y, z, duration) {
      for (const bot of bots) {
        if (!bot.alive) continue;
        const eye = eyeOf(bot);
        const dx = x - eye.x;
        const dy = y - eye.y;
        const dz = z - eye.z;
        const dist = Math.hypot(dx, dy, dz);
        if (dist > 16) continue;
        if (world.losBlocked(eye.x, eye.y, eye.z, x, y, z)) continue;
        const facingX = -Math.sin(bot.yaw);
        const facingZ = -Math.cos(bot.yaw);
        const facing = (dx * facingX + dz * facingZ) / Math.max(1, dist);
        if (facing > -0.2) bot.blindUntil = Math.max(bot.blindUntil, performance.now() / 1000 + duration * clamp(1 - dist / 16, 0.25, 1));
      }
    },
    aliveCount(team) {
      return bots.filter((b) => b.team === team && b.alive).length;
    },
    hitMeshes() {
      const meshes = [];
      for (const bot of bots) {
        if (!bot.alive) continue;
        bot.mesh.torso.userData.bot = bot;
        bot.mesh.head.userData.bot = bot;
        meshes.push(bot.mesh.torso, bot.mesh.head);
      }
      return meshes;
    },
  };
}
