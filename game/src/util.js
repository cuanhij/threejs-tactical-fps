// Small shared helpers: a seeded RNG so ?shot= captures are deterministic, clamps,
// and allocation-free segment-vs-AABB tests the bots and the line-of-sight checks use.
// No module here allocates in a hot loop: every function takes scratch objects or
// returns plain numbers.
export function mulberry32(initial) {
  let a = initial | 0;
  return function random() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function clamp(value, min, max) {
  return value < min ? min : value > max ? max : value;
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

// Slab test: does the segment p0->p1 touch the box (min,max)? Writes nothing.
export function segmentHitsBox(p0, p1, min, max) {
  let tmin = 0;
  let tmax = 1;
  for (let axis = 0; axis < 3; axis += 1) {
    const d = p1[axis] - p0[axis];
    if (Math.abs(d) < 1e-9) {
      if (p0[axis] < min[axis] || p0[axis] > max[axis]) return false;
    } else {
      let t0 = (min[axis] - p0[axis]) / d;
      let t1 = (max[axis] - p0[axis]) / d;
      if (t0 > t1) {
        const tmp = t0;
        t0 = t1;
        t1 = tmp;
      }
      if (t0 > tmin) tmin = t0;
      if (t1 < tmax) tmax = t1;
      if (tmin > tmax) return false;
    }
  }
  return true;
}

// Distance from a point to a segment, squared. Used for grenade and tracer checks.
export function pointSegmentDistSq(p, a, b) {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const abz = b.z - a.z;
  const lenSq = abx * abx + aby * aby + abz * abz;
  let t = 0;
  if (lenSq > 0) {
    t = ((p.x - a.x) * abx + (p.y - a.y) * aby + (p.z - a.z) * abz) / lenSq;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
  }
  const dx = p.x - (a.x + abx * t);
  const dy = p.y - (a.y + aby * t);
  const dz = p.z - (a.z + abz * t);
  return dx * dx + dy * dy + dz * dz;
}
