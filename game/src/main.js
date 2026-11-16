// Boot and the one loop: a fixed 60 Hz simulation feeding a render at the display's
// rate. ?shot=start|play|end with &seed=N sets up a deterministic frame for a
// capture, renders it twice, then freezes it and sets window.__shotReady.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { mulberry32 } from './util.js';
import { createWorld, SPAWNS } from './world.js';
import { createInput } from './input.js';
import { createPlayer } from './player.js';
import { createWeapon, WEAPONS } from './weapons.js';
import { createAudio } from './audio.js';
import { createEffects } from './effects.js';
import { createBots } from './bots.js';
import { createHud } from './hud.js';
import { createGame } from './game.js';

const FIXED_STEP = 1 / 60;
const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seed = Number.parseInt(params.get('seed') ?? '1', 10) || 1;

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(PALETTE.canvas);
scene.fog = new THREE.Fog(new THREE.Color(PALETTE.canvas), 24, 70);
const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.05, 200);
scene.add(camera);

const world = createWorld(scene);
const audio = createAudio();
const effects = createEffects(scene);
const hud = createHud();
const player = createPlayer(world.colliders, SPAWNS.ember[0]);
const weapon = createWeapon(camera);
const bots = createBots(scene, world, null);
const input = createInput(renderer.domElement, onLockChange, onKey);
const game = createGame({ scene, camera, world, player, weapon, bots, effects, audio, hud, input });

let frozen = false;
let started = false;
let accumulator = 0;
let lastTime = performance.now();

bots.spawnAll(mulberry32(seed));
game.startBuyPhase();

hud.onPlay(() => {
  if (shot) return;
  audio.unlock();
  if (game.isMatchShown()) {
    game.resetMatch();
    hud.hideOverlay();
    input.requestLock();
    return;
  }
  input.requestLock();
});

hud.onBuy((key) => game.buy(key));

function onKey(code, down) {
  if (!down) return;
  if (code === 'KeyB') {
    if (game.rounds.state.phase === 'buy') {
      const menu = document.getElementById('buy-menu');
      if (menu.hidden) hud.showBuy(game.rounds.buyItems(game.state.owned, weapon.state.grenades), game.state.money);
      else hud.hideBuy();
    }
    return;
  }
  if (code === 'KeyG') {
    if (game.rounds.state.phase === 'fight' && player.state.alive) game.throwGrenade();
    return;
  }
  if (code === 'KeyQ') {
    const next = weapon.cycleGrenade();
    if (next) hud.setAmmo(weapon.state.mag, weapon.state.reserve, `${weapon.def().name} · ${next}`);
    return;
  }
  if (code === 'Digit1') weapon.swapTo('pistol');
  if (code === 'Digit2' && game.state.owned.includes('rifle')) weapon.swapTo('rifle');
  if (code === 'Digit3' && game.state.owned.includes('smg')) weapon.swapTo('smg');
  if (code === 'Digit4' && game.state.owned.includes('sniper')) weapon.swapTo('sniper');
}

function onLockChange(locked) {
  if (shot) return;
  if (locked) {
    started = true;
    game.markStarted();
    hud.hideOverlay();
  } else if (!game.isMatchShown()) {
    hud.showOverlay(
      'paused',
      started ? 'Paused' : 'Emberline',
      started
        ? 'Paused. Click to resume.'
        : 'Round-based tactical FPS on Foundry District. Plant the bomb at Furnace or Depot, or eliminate the Ashen squad. Click to play.',
      started ? 'Click to resume' : 'Click to play',
    );
  }
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;
  if (!frozen) {
    const look = input.takeLook();
    const sensitivity = game.state.zoomed ? 0.0011 : 0.0022;
    player.look(look.x, look.y, sensitivity);
    if (input.state.firing && weapon.ready() && player.state.alive) {
      game.shoot(weapon.spread(player.groundSpeed()));
    }
    if (input.state.keys.has('KeyR')) weapon.reload();
    accumulator += dt;
    let steps = 0;
    while (accumulator >= FIXED_STEP && steps < 5) {
      game.step(FIXED_STEP);
      accumulator -= FIXED_STEP;
      steps += 1;
    }
    if (accumulator > FIXED_STEP * 5) accumulator = 0;
    game.syncCamera();
  }
  renderer.render(scene, camera);
}

function paintTwiceThenReady() {
  let painted = 0;
  function paint() {
    requestAnimationFrame(paint);
    game.syncCamera();
    renderer.render(scene, camera);
    painted += 1;
    if (painted === 2) {
      window.__shotReady = true;
      frozen = true;
    }
  }
  requestAnimationFrame(paint);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

game.syncCamera();
if (shot) {
  game.runShot(shot);
  paintTwiceThenReady();
} else {
  hud.showOverlay(
    'start',
    'Emberline',
    'Round-based tactical FPS on Foundry District. Plant the bomb at Furnace or Depot, or eliminate the Ashen squad. Click to play.',
    'Click to play',
  );
  requestAnimationFrame(frame);
}
