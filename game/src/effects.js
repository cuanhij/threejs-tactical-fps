// Visual effects: tracers, impact sparks, smoke puffs and explosions. Everything
// is pooled: tracers and sparks are pre-allocated meshes reused in a ring, so a
// firefight makes no new objects. Smoke is a small set of transparent spheres
// that grow and fade; the same spheres block bot sight while they last.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

const MAX_TRACERS = 24;
const MAX_SPARKS = 10;

export function createEffects(scene) {
  const tracerMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0.85, depthWrite: false });
  const tracers = [];
  for (let i = 0; i < MAX_TRACERS; i += 1) {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 1, 5), tracerMat);
    mesh.visible = false;
    scene.add(mesh);
    tracers.push({ mesh, life: 0 });
  }
  let tracerNext = 0;

  const sparkGeo = new THREE.BufferGeometry();
  const sparkPos = new Float32Array(MAX_SPARKS * 3 * 8);
  sparkGeo.setAttribute('position', new THREE.BufferAttribute(sparkPos, 3));
  const sparks = new THREE.Points(sparkGeo, new THREE.PointsMaterial({ color: new THREE.Color(PALETTE.accent), size: 0.09, transparent: true, opacity: 0.95 }));
  sparks.visible = false;
  sparks.frustumCulled = false;
  scene.add(sparks);
  let sparkLife = 0;

  const smokeMat = new THREE.MeshBasicMaterial({ color: 0x9a938a, transparent: true, opacity: 0.55, depthWrite: false });
  const smokes = [];
  for (let i = 0; i < 6; i += 1) {
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 10), smokeMat.clone());
    mesh.visible = false;
    scene.add(mesh);
    smokes.push({ mesh, life: 0, duration: 0, x: 0, y: 0, z: 0, r: 0 });
  }

  const blastLight = new THREE.PointLight(new THREE.Color(PALETTE.accent), 0, 30, 1.6);
  scene.add(blastLight);
  let blastLife = 0;

  const up = new THREE.Vector3(0, 1, 0);
  const dir = new THREE.Vector3();
  const mid = new THREE.Vector3();

  function tracer(from, to) {
    const item = tracers[tracerNext];
    tracerNext = (tracerNext + 1) % MAX_TRACERS;
    dir.copy(to).sub(from);
    const len = dir.length();
    if (len < 0.1) return;
    mid.copy(from).add(to).multiplyScalar(0.5);
    item.mesh.position.copy(mid);
    item.mesh.scale.set(1, len, 1);
    item.mesh.quaternion.setFromUnitVectors(up, dir.normalize());
    item.mesh.visible = true;
    item.life = 0.07;
  }

  function impact(point, normal) {
    for (let i = 0; i < 8; i += 1) {
      sparkPos[i * 3] = point.x + (Math.random() - 0.5) * 0.3;
      sparkPos[i * 3 + 1] = point.y + (Math.random() - 0.5) * 0.3;
      sparkPos[i * 3 + 2] = point.z + (Math.random() - 0.5) * 0.3;
    }
    sparkGeo.attributes.position.needsUpdate = true;
    sparks.visible = true;
    sparkLife = 0.18;
    void normal;
  }

  function smoke(x, y, z, radius, duration) {
    for (const s of smokes) {
      if (s.life > 0) continue;
      s.life = duration;
      s.duration = duration;
      s.x = x;
      s.y = y;
      s.z = z;
      s.r = radius;
      s.mesh.position.set(x, y, z);
      s.mesh.scale.setScalar(0.4);
      s.mesh.visible = true;
      return s;
    }
    return null;
  }

  function explosion(point) {
    blastLight.position.copy(point);
    blastLight.position.y += 1;
    blastLight.intensity = 400;
    blastLife = 0.35;
    impact(point, null);
  }

  function step(dt) {
    for (const t of tracers) {
      if (t.life <= 0) continue;
      t.life -= dt;
      if (t.life <= 0) t.mesh.visible = false;
    }
    if (sparkLife > 0) {
      sparkLife -= dt;
      if (sparkLife <= 0) sparks.visible = false;
    }
    if (blastLife > 0) {
      blastLife -= dt;
      blastLight.intensity = Math.max(0, blastLife / 0.35) * 400;
    }
    for (const s of smokes) {
      if (s.life <= 0) continue;
      s.life -= dt;
      if (s.life <= 0) {
        s.mesh.visible = false;
        continue;
      }
      const grown = 1 - s.life / s.duration;
      s.mesh.scale.setScalar(0.4 + grown * s.r);
      s.mesh.material.opacity = 0.55 * Math.min(1, (s.life / s.duration) * 3);
    }
  }

  function activeSmokes() {
    return smokes.filter((s) => s.life > 0);
  }

  return { tracer, impact, smoke, explosion, step, activeSmokes };
}
