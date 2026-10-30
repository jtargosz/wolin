// Plant and rock geometry: soft-lit crowns instead of faceted blocks. Builders return plain
// BufferGeometry (no scene, no textures) so budgets and attributes are unit-tested.
//
// How the soft look is made: every crown is many small smooth lumps; their normals are blended toward
// the direction away from the crown center, so the whole tree lights like one rounded volume.
// A baked brightness (gray vertex color) darkens the underside and the inside, lights the top. The
// instance color supplies the hue, so one geometry serves every tone.

import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { rand } from '../core/rng.ts';
import { vnoise } from './noise.ts';

/** Triangle budgets per plant (checked by the tests; the island holds about a hundred plants). */
export const TRIANGLE_BUDGET = { pine: 600, broad: 1800, bush: 400, boulder: 120 } as const;

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));
const smooth = (a: number, b: number, x: number): number => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

export function triangleCount(g: THREE.BufferGeometry): number {
  return (g.index ? g.index.count : g.getAttribute('position').count) / 3;
}

/** Bakes a gray brightness into the vertex colors. */
function shade(g: THREE.BufferGeometry, brightness: (p: THREE.Vector3) => number): THREE.BufferGeometry {
  const pos = g.getAttribute('position');
  const col = new Float32Array(pos.count * 3);
  const p = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i);
    const b = brightness(p);
    col[i * 3] = b;
    col[i * 3 + 1] = b;
    col[i * 3 + 2] = b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

/** Blends each normal a fraction `k` toward the direction away from `center`. */
function softNormals(g: THREE.BufferGeometry, center: THREE.Vector3, k: number): void {
  const pos = g.getAttribute('position');
  const nor = g.getAttribute('normal');
  const p = new THREE.Vector3();
  const n = new THREE.Vector3();
  const d = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i);
    n.fromBufferAttribute(nor, i);
    d.copy(p).sub(center).normalize();
    n.multiplyScalar(1 - k).addScaledVector(d, k).normalize();
    nor.setXYZ(i, n.x, n.y, n.z);
  }
}

/** A noisy smooth ball (non-indexed, so coincident vertices must get identical offsets: noise of position only). */
function lump(cx: number, cy: number, cz: number, r: number, detail: number, salt: number, amp: number): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(r, detail);
  const a = g.getAttribute('position');
  for (let i = 0; i < a.count; i++) {
    const x = a.getX(i);
    const y = a.getY(i);
    const z = a.getZ(i);
    const k = 1 + (vnoise(x * 2.4 + salt * 7.3, y * 2.4 + z * 2.4, 11 + salt) - 0.5) * amp;
    a.setXYZ(i, x * k, y * k * 0.92, z * k);
  }
  return g.translate(cx, cy, cz);
}

/** Trunk with a root flare; one color from the material. */
export function buildTrunkGeometry(): THREE.BufferGeometry {
  const pts = [
    new THREE.Vector2(0.27, 0),
    new THREE.Vector2(0.2, 0.14),
    new THREE.Vector2(0.14, 0.5),
    new THREE.Vector2(0.115, 1.0),
    new THREE.Vector2(0.09, 1.8),
  ];
  const g = new THREE.LatheGeometry(pts, 8);
  const a = g.getAttribute('position');
  for (let i = 0; i < a.count; i++) {
    const k = 1 + (vnoise(a.getX(i) * 6, a.getY(i) * 3 + a.getZ(i) * 6, 5) - 0.5) * 0.18;
    a.setXYZ(i, a.getX(i) * k, a.getY(i), a.getZ(i) * k);
  }
  return g;
}

/** Six drooping skirts of needles, widest at the bottom, with ragged hems. 360 triangles. */
export function buildPineGeometry(): THREE.BufferGeometry {
  const tiers: THREE.BufferGeometry[] = [];
  const TIERS = 6;
  for (let i = 0; i < TIERS; i++) {
    const radius = 1.25 - i * 0.19;
    const height = 1.0 - i * 0.04;
    const yBase = 0.8 + i * 0.46;
    const g = new THREE.ConeGeometry(radius, height, 20, 2, true);
    const a = g.getAttribute('position');
    for (let v = 0; v < a.count; v++) {
      const x = a.getX(v);
      const y = a.getY(v);
      const z = a.getZ(v);
      const edge = 1 - (y / height + 0.5); // 1 at the hem, 0 at the tip
      const ang = Math.atan2(x, z);
      const jag = 1 + edge * (0.14 * Math.sin(ang * 7 + i * 1.7) + 0.2 * (vnoise(x * 2.3 + i * 5, z * 2.3, 41) - 0.5));
      const droop = edge * edge * 0.2 * (0.5 + 0.5 * Math.sin(ang * 5 + i));
      a.setXYZ(v, x * jag, y - droop + yBase + height / 2, z * jag);
    }
    g.rotateY(i * 0.8);
    softNormals(g, new THREE.Vector3(0, yBase + height * 0.3, 0), 0.4);
    const lift = 0.72 + 0.28 * (i / (TIERS - 1));
    shade(g, (p) => lift * (0.7 + 0.3 * clamp01((p.y - yBase + 0.1) / height)));
    tiers.push(g);
  }
  return mergeGeometries(tiers)!;
}

/**
 * A broadleaf crown: eight smooth lumps (`crown`) plus crossed leaf cards on its outline (`cards`, drawn
 * with an alpha-tested leaf texture so the silhouette breaks up softly). Same local frame for both.
 */
export function buildBroadGeometry(): { crown: THREE.BufferGeometry; cards: THREE.BufferGeometry } {
  const C = new THREE.Vector3(0, 2.35, 0);
  const defs: [number, number, number, number][] = [
    [0, 0.1, 0, 1.0],
    [0.7, -0.1, 0.3, 0.75],
    [-0.65, 0, -0.35, 0.8],
    [0.1, 0.7, -0.1, 0.7],
    [-0.3, -0.2, 0.7, 0.65],
    [0.45, 0.35, -0.6, 0.6],
    [-0.75, 0.4, 0.35, 0.55],
    [0.3, -0.25, -0.7, 0.55],
  ];
  const up = (y: number) => smooth(C.y - 1.0, C.y + 1.4, y);
  const lumps = defs.map(([x, y, z, r], idx) => {
    const g = lump(C.x + x, C.y + y, C.z + z, r, 2, idx, 0.34);
    softNormals(g, new THREE.Vector3(C.x + x, C.y + y, C.z + z), 0.35);
    softNormals(g, C, 0.5);
    return shade(g, (p) => (0.56 + 0.44 * up(p.y)) * (0.78 + 0.22 * clamp01(p.distanceTo(C) / 1.7)));
  });
  const crown = mergeGeometries(lumps)!;

  const rng = { rng: 20250 };
  const zero = new THREE.Vector3();
  const upVec = new THREE.Vector3(0, 1, 0);
  const m = new THREE.Matrix4();
  const quads: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 34; i++) {
    const zc = rand(rng) * 2 - 1;
    const ang = rand(rng) * Math.PI * 2;
    const ring = Math.sqrt(1 - zc * zc);
    const dir = new THREE.Vector3(Math.cos(ang) * ring, zc, Math.sin(ang) * ring);
    const size = 0.75 + rand(rng) * 0.35;
    const roll = rand(rng) * Math.PI;
    const tone = 0.85 + rand(rng) * 0.15;
    if (dir.y < -0.45) continue; // nothing hangs under the crown
    const g = new THREE.PlaneGeometry(size, size);
    g.rotateZ(roll);
    m.lookAt(dir, zero, upVec); // +z of the plane now points along dir
    g.applyMatrix4(m);
    g.translate(C.x + dir.x * 1.5, C.y + 0.25 + dir.y * 1.05, C.z + dir.z * 1.45);
    softNormals(g, C, 0.5);
    quads.push(shade(g, (p) => (0.7 + 0.3 * up(p.y)) * tone));
  }
  return { crown, cards: mergeGeometries(quads)! };
}

/** A low shrub: four overlapping smooth blobs. About 320 triangles. */
export function buildBushGeometry(): THREE.BufferGeometry {
  const C = new THREE.Vector3(0, 0.3, 0);
  const defs: [number, number, number, number][] = [
    [0, 0.28, 0, 0.5],
    [0.38, 0.22, 0.15, 0.36],
    [-0.34, 0.2, -0.12, 0.38],
    [0.05, 0.2, -0.38, 0.34],
  ];
  const blobs = defs.map(([x, y, z, r], idx) => {
    const g = lump(x, y, z, r, 1, 20 + idx, 0.3);
    softNormals(g, new THREE.Vector3(x, y, z), 0.3);
    softNormals(g, C, 0.5);
    return shade(g, (p) => 0.55 + 0.45 * smooth(0, 0.8, p.y));
  });
  return mergeGeometries(blobs)!;
}

/** A boulder: a rounded stone, slightly angular (face normals blended with the radial ones). 80 triangles, there are over a hundred of them. */
export function buildBoulderGeometry(): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(1, 1);
  const a = g.getAttribute('position');
  for (let i = 0; i < a.count; i++) {
    const x = a.getX(i);
    const y = a.getY(i);
    const z = a.getZ(i);
    const k = 0.8 + vnoise(x * 1.7 + 3, y * 1.7 + z * 1.7, 21) * 0.4;
    a.setXYZ(i, x * k, y * k * 0.9, z * k);
  }
  g.computeVertexNormals(); // non-indexed: flat face normals
  softNormals(g, new THREE.Vector3(0, 0, 0), 0.6);
  return shade(g, (p) => 0.62 + 0.38 * smooth(-0.8, 0.9, p.y));
}
