// The game itself: one state store, one fixed-step simulation, and every system
// wired through it. The render loop lives in main.js; this module owns what
// happens: shooting and hit detection, grenades, the bomb, rounds, money, the
// kill feed and the ?shot= captures. Nothing here allocates in a hot loop: the
// raycaster, the direction vectors and the grenade list are all reused.
import * as THREE from 'three';
import { WEAPONS, GRENADES } from './weapons.js';
import { createRounds, BUY_TIME, ROUND_TIME, BOMB_TIME, PLANT_TIME, DEFUSE_TIME, ECONOMY } from './rounds.js';
import { mulberry32, clamp } from './util.js';

const FIXED_STEP = 1 / 60;

export function createGame(deps) {
  const { scene, camera, world, player, weapon, bots, effects, audio, hud, input } = deps;
  const rounds = createRounds();
  const raycaster = new THREE.Raycaster();
  raycaster.far = 140;
  const dir = new THREE.Vector3();
  const muzzle = new THREE.Vector3();
  const hitPoint = new THREE.Vector3();
  const tmp = new THREE.Vector3();

  let random = mulberry32(1);
  let elapsed = 0;
  let frozen = false;
  let started = false;
  let matchShown = false;
  let stepCount = 0;

  const S = {
    money: ECONOMY.start,
    owned: ['pistol'],
    kills: 0,
    deaths: 0,
    bombCarrier: 'player', // 'player' | bot | null
    bombDrop: null,
    grenades: [],
    plantLeft: -1,
    defuseLeft: -1,
    zoomed: false,
    stepDistance: 0,
    beepAt: 0,
    spectate: null,
  };

  const bombMesh = new THREE.Group();
  const bombBody = new THREE.Mesh(
    new THREE.BoxGeometry(0.34, 0.22, 0.26),
    new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.5, metalness: 0.6 }),
  );
  const bombLight = new THREE.Mesh(
    new THREE.SphereGeometry(0.05, 8, 8),
    new THREE.MeshBasicMaterial({ color: 0xff2a2a }),
  );
  bombLight.position.set(0, 0.14, 0);
  bombMesh.add(bombBody, bombLight);
  bombMesh.visible = false;
  scene.add(bombMesh);

  function playerPos() {
    return player.state.position;
  }

  function enemiesOf(bot) {
    const list = [];
    if (bot.team === 'ashen' && player.state.alive) list.push({ isPlayer: true, alive: true });
    for (const other of bots.bots) {
      if (other.team !== bot.team && other.alive) list.push(other);
    }
    return list;
  }

  const botCtx = {
    enemiesOf,
    playerPos: () => ({ x: player.state.position.x, y: player.state.position.y, z: player.state.position.z }),
    playerSpeed: () => player.groundSpeed(),
    activeSmokes: () => effects.activeSmokes(),
    bombPlanted: () => rounds.state.bombPlanted,
    bombSite: () => {
      if (!rounds.state.bombSite) return null;
      return world.sites[rounds.state.bombSite];
    },
    onBotShot(bot, from, end, hit, head) {
      effects.tracer(from, end);
      const dist = Math.hypot(end.x - player.state.position.x, end.z - player.state.position.z);
      if (dist < 30) audio.shot('rifle');
      else audio.distantShot();
      if (hit) return;
      const target = bot.target;
      if (!target) return;
      if (target.isPlayer) {
        hurtPlayer(33, bot);
      } else {
        const killed = bots.damage(target, head ? 33 * 4 : 33, head);
        if (killed) onKill(bot.name, target.name, head, bot.team);
      }
    },
    onPlantProgress(bot, left) {
      hud.setPlant(`Planting the bomb — ${bot.name}`, 1 - left / PLANT_TIME);
      if (Math.ceil(left * 2) !== Math.ceil((left + FIXED_STEP) * 2)) audio.plantBeep(false);
    },
    onPlanted(bot) {
      hud.setPlant(null, null);
      plantBomb(world.sites[bot.site ?? 'A'], bot.name);
    },
    onDefuseProgress(bot, left) {
      hud.setPlant(`Defusing — ${bot.name}`, 1 - left / DEFUSE_TIME);
    },
    onDefused(bot) {
      hud.setPlant(null, null);
      endRound('ashen', `${bot.name} defused the bomb`);
    },
  };
  bots.setCtx(botCtx);

  function onKill(killer, victim, head, killerTeam) {
    hud.killfeed(killer, victim, head, killerTeam);
    if (killer === 'You') {
      S.money += ECONOMY.kill;
      S.kills += 1;
      audio.kill();
      hud.setMoney(S.money);
    }
  }

  function hurtPlayer(amount, shooter) {
    const died = player.damage(amount);
    audio.hurt();
    hud.damageVignette();
    hud.setHealth(player.state.health, player.state.armour);
    if (shooter) {
      const dx = shooter.position.x - player.state.position.x;
      const dz = shooter.position.z - player.state.position.z;
      const worldAngle = Math.atan2(dx, dz);
      const rel = worldAngle - player.state.yaw;
      hud.damageFrom((rel * 180) / Math.PI);
    }
    if (died) {
      S.deaths += 1;
      if (document.pointerLockElement) document.exitPointerLock();
      hud.banner('You were eliminated', 'Your squad fights on — spectating', 4000);
      if (S.bombCarrier === 'player') dropBomb();
      const mate = bots.bots.find((b) => b.team === 'ember' && b.alive);
      S.spectate = mate ?? null;
    }
  }

  function dropBomb() {
    S.bombCarrier = null;
    S.bombDrop = { x: player.state.position.x, z: player.state.position.z };
    const carrier = bots.bots.find((b) => b.team === 'ember' && b.alive);
    if (carrier) assignBomb(carrier);
  }

  function assignBomb(bot) {
    S.bombCarrier = bot;
    bot.hasBomb = true;
    const site = world.sites[bot.site ?? 'A'];
    bot.path = world.findPath(bot.position.x, bot.position.z, site.x, site.z);
    bot.pathIndex = 0;
    bot.state = 'advance';
  }

  function plantBomb(site, byName) {
    rounds.plant(site === world.sites.A ? 'A' : 'B');
    bombMesh.position.set(site.x, 0.12, site.z);
    bombMesh.visible = true;
    S.beepAt = BOMB_TIME;
    audio.plantBeep(true);
    hud.banner('Bomb planted', `${byName} planted at ${site.name} — hold the site`, 3200);
    hud.setBomb(`BOMB ${site === world.sites.A ? 'A' : 'B'} — ${BOMB_TIME}s`, 'planted');
    bots.hearShot(site.x, site.z, 'ember');
  }

  function endRound(winner, reason) {
    const result = rounds.endRound(winner, reason);
    if (!result) return;
    S.money += winner === 'ember' ? ECONOMY.roundWin : ECONOMY.roundLoss;
    hud.hideBuy();
    hud.setPlant(null, null);
    bombMesh.visible = false;
    if (winner === 'ember') audio.roundWin();
    else audio.roundLose();
    hud.setScore(rounds.state.scoreEmber, rounds.state.scoreAshen);
    hud.setMoney(S.money);
    hud.banner(
      winner === 'ember' ? 'Round won' : 'Round lost',
      `${reason} · ${rounds.state.scoreEmber} — ${rounds.state.scoreAshen}`,
      3800,
    );
    if (rounds.state.matchOver) {
      matchShown = true;
      hud.showOverlay(
        'match',
        rounds.state.matchWinner === 'ember' ? 'Match won — Ember takes Foundry' : 'Match lost — Ashen holds Foundry',
        `Final score ${rounds.state.scoreEmber} — ${rounds.state.scoreAshen}. ${S.kills} eliminations, ${S.deaths} deaths.`,
        'Play again',
      );
      if (document.pointerLockElement) document.exitPointerLock();
    }
  }

  function resetRound() {
    random = mulberry32(1 + rounds.state.round * 7919);
    player.reset(0, 23, 0);
    bots.assignRound(random);
    weapon.refillAmmo();
    S.bombCarrier = 'player';
    S.bombDrop = null;
    S.grenades.length = 0;
    S.plantLeft = -1;
    S.spectate = null;
    bombMesh.visible = false;
    hud.setHealth(100, player.state.armour);
    hud.setAmmo(weapon.state.mag, weapon.state.reserve, weapon.def().name);
    hud.setMoney(S.money);
    hud.setScore(rounds.state.scoreEmber, rounds.state.scoreAshen);
    hud.setBomb('BOMB — carry to A or B', 'carry');
  }

  function startBuyPhase() {
    rounds.startBuy();
    resetRound();
    hud.banner(`Round ${rounds.state.round}`, 'Buy phase — press B to open the shop', 3000);
  }

  function startFightPhase() {
    rounds.startFight();
    hud.hideBuy();
    hud.banner(`Round ${rounds.state.round}`, 'Plant the bomb at Furnace or Depot', 2600);
  }

  function shoot(spread) {
    if (!weapon.takeRound()) {
      audio.dryFire();
      weapon.reload();
      return false;
    }
    camera.getWorldDirection(dir);
    dir.x += (random() * 2 - 1) * spread;
    dir.y += (random() * 2 - 1) * spread;
    dir.z += (random() * 2 - 1) * spread;
    dir.normalize();
    camera.getWorldPosition(muzzle);
    muzzle.addScaledVector(dir, 0.5);
    muzzle.y -= 0.12;
    scene.updateMatrixWorld(true);
    raycaster.set(camera.position, dir);
    const targets = world.shootables.concat(bots.hitMeshes());
    const hit = raycaster.intersectObjects(targets, false)[0];
    const def = weapon.def();
    let endPoint = null;
    if (hit) {
      endPoint = hit.point;
      const bot = hit.object.userData.bot;
      if (bot) {
        const head = hit.object.userData.part === 'head';
        const dmg = def.damage * (head ? def.headMult : 1);
        const killed = bots.damage(bot, dmg, head);
        hud.hitMarker(killed, killed ? 220 : 90);
        audio.hit();
        if (killed) onKill('You', bot.name, head, 'ember');
      } else {
        effects.impact(hit.point, hit.face ? hit.face.normal : null);
      }
    } else {
      endPoint = tmp.copy(camera.position).addScaledVector(dir, def.range);
    }
    effects.tracer(muzzle, endPoint);
    audio.shot(weapon.state.kind);
    weapon.pullTrigger();
    player.recoil(0.008 + def.recoil * (0.7 + random() * 0.6), (random() * 2 - 1) * def.recoil * 0.4);
    bots.hearShot(player.state.position.x, player.state.position.z, 'ember');
    hud.setAmmo(weapon.state.mag, weapon.state.reserve, def.name);
    return true;
  }

  function throwGrenade() {
    const type = weapon.throwGrenade();
    if (!type) {
      audio.denied();
      return;
    }
    audio.grenadePin();
    camera.getWorldDirection(dir);
    const pos = camera.position.clone();
    const vel = dir.clone().multiplyScalar(15);
    vel.y += 3.5;
    S.grenades.push({ type, pos, vel, fuse: 1.6, alive: true });
    hud.setAmmo(weapon.state.mag, weapon.state.reserve, weapon.def().name);
  }

  function detonateGrenade(g) {
    const p = g.pos;
    if (g.type === 'frag') {
      effects.explosion(p);
      audio.explosion();
      for (const bot of bots.bots) {
        if (!bot.alive) continue;
        const d = Math.hypot(bot.position.x - p.x, bot.position.z - p.z);
        if (d > GRENADES.frag.radius) continue;
        if (world.losBlocked(p.x, p.y, p.z, bot.position.x, 1.2, bot.position.z)) continue;
        const dmg = Math.round(GRENADES.frag.damage * (1 - d / (GRENADES.frag.radius + 2)));
        const killed = bots.damage(bot, dmg, false);
        if (killed) onKill('You', bot.name, false, 'ember');
      }
      const pd = Math.hypot(player.state.position.x - p.x, player.state.position.z - p.z);
      if (pd < GRENADES.frag.radius && player.state.alive) {
        hurtPlayer(Math.round(GRENADES.frag.damage * 0.6 * (1 - pd / (GRENADES.frag.radius + 2))), null);
      }
    } else if (g.type === 'smoke') {
      effects.smoke(p.x, Math.max(1, p.y), p.z, GRENADES.smoke.radius, GRENADES.smoke.duration);
    } else {
      // Flash: anyone with a line of sight to it who is looking at it is blinded.
      bots.applyFlash(p.x, p.y, p.z, GRENADES.flash.duration);
      const dx = p.x - camera.position.x;
      const dy = p.y - camera.position.y;
      const dz = p.z - camera.position.z;
      const dist = Math.hypot(dx, dy, dz);
      camera.getWorldDirection(dir);
      const facing = (dx * dir.x + dy * dir.y + dz * dir.z) / Math.max(1, dist);
      if (facing > 0.2 && dist < GRENADES.flash.radius && !world.losBlocked(camera.position.x, camera.position.y, camera.position.z, p.x, p.y, p.z)) {
        hud.flash(clamp(1 - dist / GRENADES.flash.radius, 0.3, 1));
      }
      audio.shot('pistol');
    }
  }

  function stepGrenades(dt) {
    for (const g of S.grenades) {
      if (!g.alive) continue;
      g.vel.y -= 14 * dt;
      const px = g.pos.x;
      const py = g.pos.y;
      const pz = g.pos.z;
      g.pos.addScaledVector(g.vel, dt);
      // Bounce off walls: if the new spot overlaps a collider, step back and damp.
      let blocked = false;
      for (const box of world.colliders) {
        if (box.min.y > 3.5) continue;
        if (
          g.pos.x > box.min.x - 0.12 && g.pos.x < box.max.x + 0.12 &&
          g.pos.y > box.min.y - 0.12 && g.pos.y < box.max.y + 0.12 &&
          g.pos.z > box.min.z - 0.12 && g.pos.z < box.max.z + 0.12
        ) {
          blocked = true;
          break;
        }
      }
      if (blocked) {
        g.pos.set(px, py, pz);
        g.vel.multiplyScalar(-0.35);
        g.vel.y = Math.abs(g.vel.y) * 0.4;
      }
      // Cheap bounce: clamp into the map and damp the velocity.
      if (g.pos.x < -31.5) { g.pos.x = -31.5; g.vel.x = Math.abs(g.vel.x) * 0.4; }
      if (g.pos.x > 31.5) { g.pos.x = 31.5; g.vel.x = -Math.abs(g.vel.x) * 0.4; }
      if (g.pos.z < -27.5) { g.pos.z = -27.5; g.vel.z = Math.abs(g.vel.z) * 0.4; }
      if (g.pos.z > 27.5) { g.pos.z = 27.5; g.vel.z = -Math.abs(g.vel.z) * 0.4; }
      if (g.pos.y < 0.15) { g.pos.y = 0.15; g.vel.y = Math.abs(g.vel.y) * 0.4; g.vel.x *= 0.7; g.vel.z *= 0.7; }
      g.fuse -= dt;
      if (g.fuse <= 0) {
        g.alive = false;
        detonateGrenade(g);
      }
    }
    S.grenades = S.grenades.filter((g) => g.alive);
  }

  function buy(key) {
    if (rounds.state.phase !== 'buy') return;
    if (key.startsWith('grenade-')) {
      const type = key.slice(8);
      const def = GRENADES[type];
      if (S.money < def.price) {
        audio.denied();
        return;
      }
      S.money -= def.price;
      weapon.state.grenades[type] += 1;
      audio.buy();
    } else if (key === 'armour') {
      if (S.money < 650 || player.state.armour >= 100) {
        audio.denied();
        return;
      }
      S.money -= 650;
      player.state.armour = 100;
      audio.buy();
    } else {
      const def = WEAPONS[key];
      if (!def || S.money < def.price || S.owned.includes(key)) {
        audio.denied();
        return;
      }
      S.money -= def.price;
      S.owned.push(key);
      weapon.swapTo(key);
      audio.buy();
    }
    hud.setMoney(S.money);
    hud.setAmmo(weapon.state.mag, weapon.state.reserve, weapon.def().name);
    hud.setHealth(player.state.health, player.state.armour);
    hud.showBuy(rounds.buyItems(S.owned, weapon.state.grenades), S.money);
  }

  function step(dt) {
    elapsed += dt;
    stepCount += 1;
    const rs = rounds.state;

    if (rs.phase === 'buy') {
      rs.phaseLeft -= dt;
      if (rs.phaseLeft <= 0) startFightPhase();
    } else if (rs.phase === 'fight') {
      rs.phaseLeft -= dt;
      if (rs.bombPlanted) {
        rs.bombLeft -= dt;
        bombLight.material.color.setHex(Math.floor(elapsed * 4) % 2 === 0 ? 0xff2a2a : 0x550000);
        if (rs.bombLeft <= S.beepAt) {
          audio.plantBeep(rs.bombLeft < 5);
          S.beepAt = rs.bombLeft - Math.max(0.35, rs.bombLeft * 0.12);
        }
        hud.setBomb(`BOMB ${rs.bombSite} — ${Math.ceil(rs.bombLeft)}s`, 'planted');
        if (rs.bombLeft <= 0) {
          const site = world.sites[rs.bombSite];
          effects.explosion(new THREE.Vector3(site.x, 0.5, site.z));
          audio.explosion();
          endRound('ember', 'Bomb detonated');
        }
      } else if (rs.phaseLeft <= 0) {
        endRound('ashen', 'Time expired — the site held');
      }
    } else if (rs.phase === 'over') {
      rs.phaseLeft -= dt;
      if (rs.phaseLeft <= 0 && !rs.matchOver) {
        rounds.nextRound();
        startBuyPhase();
      }
    }

    // Player planting: hold E inside a site while carrying the bomb.
    if (rs.phase === 'fight' && !rs.bombPlanted && S.bombCarrier === 'player' && player.state.alive) {
      const site = world.siteAt(player.state.position.x, player.state.position.z);
      if (site && input.state.keys.has('KeyE')) {
        S.plantLeft = S.plantLeft < 0 ? PLANT_TIME : S.plantLeft - dt;
        hud.setPlant(`Planting the bomb — site ${site}`, 1 - S.plantLeft / PLANT_TIME);
        if (Math.ceil(S.plantLeft * 2) !== Math.ceil((S.plantLeft + dt) * 2)) audio.plantBeep(false);
        if (S.plantLeft <= 0) {
          S.plantLeft = -1;
          hud.setPlant(null, null);
          plantBomb(world.sites[site], 'You');
        }
      } else if (S.plantLeft >= 0) {
        S.plantLeft = -1;
        hud.setPlant(null, null);
      }
    }

    // Footsteps.
    const speed = player.groundSpeed();
    if (speed > 0.5 && player.state.onGround) {
      S.stepDistance += speed * dt;
      if (S.stepDistance > 2.4) {
        S.stepDistance = 0;
        audio.footstep(speed > 4);
      }
    }

    player.step(dt, input.state.keys);
    weapon.step(dt);
    bots.step(dt, elapsed, rs.phase === 'fight');
    effects.step(dt);
    stepGrenades(dt);

    // Elimination checks (fight phase only).
    if (rs.phase === 'fight') {
      const emberAlive = (player.state.alive ? 1 : 0) + bots.aliveCount('ember');
      const ashenAlive = bots.aliveCount('ashen');
      if (ashenAlive === 0) {
        endRound('ember', rs.bombPlanted ? 'Bomb planted — defenders eliminated' : 'Enemy team eliminated');
      } else if (emberAlive === 0 && !rs.bombPlanted) {
        endRound('ashen', 'Your team was eliminated');
      }
    }

    // HUD refresh.
    hud.setHealth(player.state.health, player.state.armour);
    hud.setTimer(rs.phase === 'buy' ? rs.phaseLeft : rs.phase === 'fight' ? rs.phaseLeft : 0);
    hud.setSpread(4 + weapon.spread(speed) * 900 + speed * 1.2);
    const def = weapon.def();
    if (def.zoom > 1 && input.state.zooming && player.state.alive) {
      if (!S.zoomed) {
        S.zoomed = true;
        camera.fov = 74 / def.zoom;
        camera.updateProjectionMatrix();
      }
    } else if (S.zoomed) {
      S.zoomed = false;
      camera.fov = 74;
      camera.updateProjectionMatrix();
    }
  }

  function syncCamera() {
    if (!player.state.alive && S.spectate && S.spectate.alive) {
      const b = S.spectate;
      camera.position.set(b.position.x, 1.55, b.position.z);
      camera.rotation.set(0, b.yaw, 0, 'YXZ');
      return;
    }
    const p = player.state;
    camera.position.set(p.position.x, p.position.y + p.eye, p.position.z);
    camera.rotation.set(p.pitch, p.yaw, 0, 'YXZ');
  }

  function settle(steps) {
    for (let i = 0; i < steps; i += 1) step(FIXED_STEP);
  }

  function aimAt(point) {
    const p = player.state;
    const dx = point.x - p.position.x;
    const dy = point.y - (p.position.y + p.eye);
    const dz = point.z - p.position.z;
    const len = Math.hypot(dx, dy, dz) || 1;
    p.yaw = Math.atan2(-dx, -dz);
    p.pitch = Math.asin(clamp(dy / len, -1, 1));
    syncCamera();
  }

  function runShot(name) {
    hud.hideOverlay();
    hud.hideBanner();
    if (name === 'start') {
      rounds.startBuy();
      resetRound();
      player.reset(0, 23, 0);
      settle(20);
      aimAt(new THREE.Vector3(0, 1.5, -10));
      S.money = 2400;
      hud.showBuy(rounds.buyItems(S.owned, weapon.state.grenades), S.money);
      hud.setMoney(2400);
    } else if (name === 'play') {
      rounds.startBuy();
      resetRound();
      rounds.startFight();
      rounds.state.phaseLeft = 47;
      rounds.state.scoreEmber = 3;
      rounds.state.scoreAshen = 2;
      S.money = 3200;
      hud.setScore(3, 2);
      hud.setMoney(3200);
      player.reset(0, 2, 0);
      // Stage two defenders in mid, visible from the player's position.
      const ashen = bots.bots.filter((b) => b.team === 'ashen');
      ashen[0].position.set(-1.5, 0, -8);
      ashen[0].yaw = Math.PI;
      ashen[0].state = 'hold';
      ashen[1].position.set(2.5, 0, -12);
      ashen[1].yaw = Math.PI;
      ashen[1].state = 'hold';
      settle(30);
      aimAt(new THREE.Vector3(-1.5, 1.4, -8));
      shoot(0);
      settle(2);
    } else {
      // end: a round just won by detonation, one defender down in view.
      rounds.startBuy();
      resetRound();
      rounds.state.scoreEmber = 7;
      rounds.state.scoreAshen = 3;
      hud.setScore(7, 3);
      player.reset(-14, -10, 0);
      const ashen = bots.bots.filter((b) => b.team === 'ashen');
      ashen[0].position.set(-18, 0, -16);
      ashen[0].alive = false;
      ashen[0].mesh.group.rotation.set(-Math.PI / 2, 0, 0);
      ashen[0].mesh.group.position.set(-18, 0.25, -16);
      settle(20);
      aimAt(new THREE.Vector3(-21, 1.2, -18));
      hud.banner('Round won', 'Bomb detonated · 7 — 3', 60000);
    }
    hud.setAmmo(weapon.state.mag, weapon.state.reserve, weapon.def().name);
    syncCamera();
  }

  return {
    rounds,
    state: S,
    step,
    syncCamera,
    shoot,
    throwGrenade,
    buy,
    startBuyPhase,
    startFightPhase,
    runShot,
    setFrozen(value) {
      frozen = value;
    },
    isFrozen() {
      return frozen;
    },
    markStarted() {
      started = true;
    },
    isStarted() {
      return started;
    },
    isMatchShown() {
      return matchShown;
    },
    resetMatch() {
      matchShown = false;
      rounds.state.scoreEmber = 0;
      rounds.state.scoreAshen = 0;
      rounds.state.round = 1;
      rounds.state.matchOver = false;
      rounds.state.matchWinner = null;
      S.money = ECONOMY.start;
      S.owned = ['pistol'];
      S.kills = 0;
      S.deaths = 0;
      weapon.swapTo('pistol');
      weapon.state.grenades = { frag: 0, smoke: 0, flash: 0 };
      player.state.armour = 0;
      startBuyPhase();
    },
  };
}
