// Weapons: one defs table, one view-model builder, one state machine per gun.
// Names, numbers and roles are original. Damage is per torso hit; headshots deal
// four times, legs are not modelled. Spread grows with movement and with each
// shot in a burst, and recoil kicks the aim up — stopping to aim pays.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

export const WEAPONS = {
  pistol: {
    name: 'P9 Sidearm', price: 0, damage: 26, headMult: 4, rate: 0.16,
    mag: 12, reserve: 48, reload: 1.4, spreadStill: 0.004, spreadMove: 0.03,
    recoil: 0.011, auto: false, range: 60, zoom: 1,
  },
  rifle: {
    name: 'Harrier AR', price: 2700, damage: 33, headMult: 4, rate: 0.1,
    mag: 30, reserve: 90, reload: 2.1, spreadStill: 0.0022, spreadMove: 0.028,
    recoil: 0.014, auto: true, range: 80, zoom: 1,
  },
  smg: {
    name: 'Wasp SMG', price: 1500, damage: 22, headMult: 4, rate: 0.066,
    mag: 32, reserve: 96, reload: 1.7, spreadStill: 0.006, spreadMove: 0.036,
    recoil: 0.008, auto: true, range: 50, zoom: 1,
  },
  sniper: {
    name: 'Longbow DMR', price: 4750, damage: 88, headMult: 4, rate: 0.95,
    mag: 5, reserve: 15, reload: 2.8, spreadStill: 0.0006, spreadMove: 0.09,
    recoil: 0.05, auto: false, range: 120, zoom: 2.2,
  },
};

export const GRENADES = {
  frag: { name: 'Spark Frag', price: 300, radius: 6, damage: 95 },
  smoke: { name: 'Haze Smoke', price: 300, radius: 4.5, duration: 12 },
  flash: { name: 'Strobe Flash', price: 200, radius: 14, duration: 2.2 },
};

const GRENADE_ORDER = ['frag', 'smoke', 'flash'];

function buildViewModel(kind, camera) {
  const dark = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.hairline), roughness: 0.7, metalness: 0.2 });
  const metal = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.ink), roughness: 0.45, metalness: 0.4 });
  const accent = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.accent), roughness: 0.5, metalness: 0.3 });
  const model = new THREE.Group();
  function part(w, h, d, x, y, z, material) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
    mesh.position.set(x, y, z);
    model.add(mesh);
    return mesh;
  }
  if (kind === 'pistol') {
    part(0.05, 0.09, 0.22, 0, 0, -0.1, metal);
    part(0.045, 0.12, 0.05, 0, -0.08, 0.02, dark);
    part(0.052, 0.02, 0.06, 0, 0.055, -0.18, accent);
  } else if (kind === 'sniper') {
    part(0.07, 0.09, 0.5, 0, 0, -0.12, metal);
    part(0.04, 0.04, 0.55, 0, 0.02, -0.45, dark);
    part(0.06, 0.06, 0.16, 0, 0.07, -0.1, dark); // scope
    part(0.05, 0.05, 0.03, 0, 0.07, -0.2, accent);
    part(0.06, 0.07, 0.2, 0, -0.02, 0.28, dark);
  } else if (kind === 'smg') {
    part(0.08, 0.09, 0.34, 0, 0, -0.08, metal);
    part(0.04, 0.04, 0.3, 0, 0.02, -0.32, dark);
    part(0.04, 0.14, 0.05, 0, -0.09, -0.05, dark);
    part(0.05, 0.05, 0.1, 0, 0.07, -0.12, accent);
  } else {
    part(0.09, 0.1, 0.42, 0, 0, -0.1, metal);
    part(0.045, 0.045, 0.4, 0, 0.025, -0.42, dark);
    part(0.075, 0.08, 0.22, 0, -0.02, 0.28, dark);
    part(0.06, 0.03, 0.12, 0, 0.06, -0.2, accent);
  }
  model.position.set(0.24, -0.2, -0.42);
  camera.add(model);
  const flash = new THREE.Mesh(
    new THREE.PlaneGeometry(0.26, 0.26),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }),
  );
  flash.position.set(0.24, -0.17, -0.95);
  flash.visible = false;
  camera.add(flash);
  const flashLight = new THREE.PointLight(new THREE.Color(PALETTE.accent), 0, 5);
  flashLight.position.set(0.24, -0.16, -0.6);
  camera.add(flashLight);
  return { model, flash, flashLight };
}

export function createWeapon(camera) {
  let kind = 'pistol';
  let view = buildViewModel(kind, camera);
  const state = {
    kind, mag: WEAPONS.pistol.mag, reserve: WEAPONS.pistol.reserve,
    cooldown: 0, reloadLeft: 0, reloadTotal: 0, flash: 0, kick: 0,
    burst: 0, grenades: { frag: 0, smoke: 0, flash: 0 }, grenadeSlot: 0,
  };

  function swapTo(next) {
    if (next === kind) return;
    camera.remove(view.model, view.flash, view.flashLight);
    kind = next;
    view = buildViewModel(kind, camera);
    const def = WEAPONS[kind];
    state.kind = kind;
    state.mag = def.mag;
    state.reserve = def.reserve;
    state.cooldown = 0;
    state.reloadLeft = 0;
    state.burst = 0;
  }

  function step(dt) {
    state.cooldown = Math.max(0, state.cooldown - dt);
    state.flash = Math.max(0, state.flash - dt);
    state.burst = Math.max(0, state.burst - dt * 2.4);
    state.kick += (0 - state.kick) * Math.min(1, dt * 14);
    view.model.position.z = -0.42 + state.kick;
    view.model.rotation.x = state.kick * 2.2;
    view.flash.visible = state.flash > 0;
    view.flash.rotation.z = state.flash * 30;
    view.flashLight.intensity = state.flash > 0 ? 18 : 0;
    if (state.reloadLeft > 0) {
      state.reloadLeft = Math.max(0, state.reloadLeft - dt);
      const def = WEAPONS[kind];
      view.model.rotation.x = -0.55 * Math.sin(Math.PI * (1 - state.reloadLeft / state.reloadTotal));
      if (state.reloadLeft === 0) {
        const need = def.mag - state.mag;
        const take = Math.min(need, state.reserve);
        state.mag += take;
        state.reserve -= take;
      }
    }
  }

  return {
    state,
    def() {
      return WEAPONS[kind];
    },
    step,
    swapTo,
    ready() {
      return state.mag > 0 && state.cooldown === 0 && state.reloadLeft === 0;
    },
    pullTrigger() {
      const def = WEAPONS[kind];
      state.cooldown = def.rate;
      state.flash = 0.06;
      state.kick = 0.02 + def.recoil * 2.4;
      state.burst = Math.min(1, state.burst + 0.22);
    },
    takeRound() {
      if (state.mag <= 0) return false;
      state.mag -= 1;
      return true;
    },
    reload() {
      const def = WEAPONS[kind];
      if (state.reloadLeft > 0 || state.mag === def.mag || state.reserve === 0) return false;
      state.reloadLeft = def.reload;
      state.reloadTotal = def.reload;
      return true;
    },
    spread(speed) {
      const def = WEAPONS[kind];
      const move = Math.min(1, speed / 5.2);
      return def.spreadStill + move * def.spreadMove + state.burst * 0.012;
    },
    refillAmmo() {
      const def = WEAPONS[kind];
      state.mag = def.mag;
      state.reserve = def.reserve;
      state.cooldown = 0;
      state.reloadLeft = 0;
      state.flash = 0;
      state.kick = 0;
      state.burst = 0;
    },
    currentGrenade() {
      return GRENADE_ORDER[state.grenadeSlot];
    },
    cycleGrenade() {
      for (let i = 0; i < 3; i += 1) {
        state.grenadeSlot = (state.grenadeSlot + 1) % 3;
        if (state.grenades[GRENADE_ORDER[state.grenadeSlot]] > 0) return GRENADE_ORDER[state.grenadeSlot];
      }
      return null;
    },
    throwGrenade() {
      const type = GRENADE_ORDER[state.grenadeSlot];
      if (state.grenades[type] <= 0) return null;
      state.grenades[type] -= 1;
      return type;
    },
  };
}
