// Water on the GPU: waves displace the vertices, normals come from the analytic derivatives,
// the color runs from clear shallows to deep sea by the distance to the shore, and foam lines
// pulse around the island. The same wave table drives waveHeight on the CPU (boats, wakes).

import * as THREE from 'three/webgpu';
import type { Node } from 'three/webgpu';
import {
  abs,
  clamp,
  color,
  length,
  max,
  cos,
  float,
  mix,
  mx_noise_float,
  normalize,
  positionLocal,
  sin,
  smoothstep,
  texture,
  transformNormalToView,
  uniform,
  vec2,
  vec3,
} from 'three/tsl';
import type { MapData } from '../core/types.ts';
import { T } from '../core/types.ts';
import { WATER } from './palette.ts';

export { WATER_COLOR } from './palette.ts';

/** Wave components: height = sum a * sin(x kx + z kz + t w + p). Shared by CPU and GPU. */
export const WAVES = [
  { kx: 0.33, kz: 0, w: 0.8, a: 0.11, p: 0 },
  { kx: 0, kz: 0.45, w: -1.0, a: 0.07, p: 1.3 },
  { kx: 0.7, kz: 0.7, w: 1.5, a: 0.035, p: 0 },
] as const;

/** Distance from the shore (m) that maps to 1 in the shore texture. */
const SHORE_RANGE = 14;
const TEXELS_PER_CELL = 4;

let amplitude = 1;

export function setWaveAmplitude(a: number): void {
  amplitude = a;
}

/** Wave height at point (x, z) at time t [s]. */
export function waveHeight(x: number, z: number, t: number): number {
  let h = 0;
  for (const w of WAVES) h += w.a * Math.sin(x * w.kx + z * w.kz + t * w.w + w.p);
  return amplitude * h;
}

/** Unit surface normal at point (x, z) at time t [s]: analytic derivatives, no face math. */
export function waveNormal(x: number, z: number, t: number): [number, number, number] {
  let dx = 0;
  let dz = 0;
  for (const w of WAVES) {
    const c = w.a * Math.cos(x * w.kx + z * w.kz + t * w.w + w.p);
    dx += c * w.kx;
    dz += c * w.kz;
  }
  dx *= amplitude;
  dz *= amplitude;
  const l = Math.sqrt(dx * dx + 1 + dz * dz);
  return [-dx / l, 1 / l, -dz / l];
}

/**
 * Distance to the nearest land cell in meters, per texel (TEXELS_PER_CELL per cell), as 0..1 of
 * SHORE_RANGE. Two-pass chamfer distance: exact enough for a gradient, cheap, and pure.
 */
export function shoreDistance(map: MapData): { data: Float32Array; w: number; h: number } {
  const w = map.w * TEXELS_PER_CELL;
  const h = map.h * TEXELS_PER_CELL;
  const step = map.cell / TEXELS_PER_CELL;
  const d = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = map.terrain[Math.floor(y / TEXELS_PER_CELL) * map.w + Math.floor(x / TEXELS_PER_CELL)];
      d[y * w + x] = c === T.DEEP || c === T.SHALLOW ? 1e9 : 0;
    }
  }
  const a = step;
  const b = step * Math.SQRT2;
  const relax = (i: number, j: number, k: number) => {
    if (d[j] + k < d[i]) d[i] = d[j] + k;
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (x > 0) relax(i, i - 1, a);
      if (y > 0) relax(i, i - w, a);
      if (x > 0 && y > 0) relax(i, i - w - 1, b);
      if (x < w - 1 && y > 0) relax(i, i - w + 1, b);
    }
  }
  for (let y = h - 1; y >= 0; y--) {
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x;
      if (x < w - 1) relax(i, i + 1, a);
      if (y < h - 1) relax(i, i + w, a);
      if (x < w - 1 && y < h - 1) relax(i, i + w + 1, b);
      if (x > 0 && y < h - 1) relax(i, i + w - 1, b);
    }
  }
  for (let i = 0; i < d.length; i++) d[i] = Math.min(1, d[i] / SHORE_RANGE);
  return { data: d, w, h };
}

export class Water {
  readonly mesh: THREE.Mesh;
  private readonly uTime = uniform(0);
  private readonly uAmp = uniform(1);
  private readonly uOrigin = uniform(new THREE.Vector2(-30, -24));
  private readonly uSize = uniform(new THREE.Vector2(60, 48));
  private shoreTex: THREE.DataTexture;

  /** `segments` per side: the longest wave is 6 m, so even 100 segments (2.6 m) keep the swell smooth. */
  constructor(segments = 200) {
    const geo = new THREE.PlaneGeometry(260, 260, segments, segments);
    geo.rotateX(-Math.PI / 2);
    this.shoreTex = this.makeShoreTexture(new Float32Array([1]), 1, 1);
    const mat = new THREE.MeshPhongNodeMaterial({ transparent: true, shininess: 220, specular: new THREE.Color(WATER.specular) });
    const x = positionLocal.x;
    const z = positionLocal.z;
    const t = this.uTime;
    let hgt: Node<'float'> = float(0);
    let dx: Node<'float'> = float(0);
    let dz: Node<'float'> = float(0);
    for (const w of WAVES) {
      const ph = x.mul(w.kx).add(z.mul(w.kz)).add(t.mul(w.w)).add(w.p);
      hgt = hgt.add(sin(ph).mul(w.a));
      const c = cos(ph).mul(w.a);
      dx = dx.add(c.mul(w.kx));
      dz = dz.add(c.mul(w.kz));
    }
    mat.positionNode = vec3(x, hgt.mul(this.uAmp), z);
    mat.normalNode = transformNormalToView(normalize(vec3(dx.mul(this.uAmp).negate(), 1, dz.mul(this.uAmp).negate())));

    // distance from the shore: 0 on the waterline, 1 far out (clamped outside the map)
    const suv = vec2(x, z).sub(this.uOrigin).div(this.uSize);
    this.shoreNode = texture(this.shoreTex, suv);
    // beyond the map the texture clamps, so add the distance past its edge
    const past = length(max(abs(suv.sub(0.5)).sub(0.5), 0).mul(this.uSize)).div(SHORE_RANGE);
    const dist = clamp((this.shoreNode as unknown as Node<'vec4'>).r.add(past), 0, 1);
    const n = mx_noise_float(vec3(x.mul(0.3), z.mul(0.3), t.mul(0.12)));
    const deepCol = mix(color(WATER.mid), color(WATER.deep), smoothstep(0.25, 1, dist));
    const col = mix(color(WATER.shallow), deepCol, smoothstep(0.0, 0.3, dist.add(n.mul(0.04))));
    // waterline foam plus slow rings breaking toward the island
    // a wide waterline band broken up by noise, plus a thin second ring that breathes with the swell
    const broken = smoothstep(-0.3, 0.25, mx_noise_float(vec3(x.mul(0.9), z.mul(0.9), t.mul(0.18))));
    const edge = float(1)
      .sub(smoothstep(0.0, n.mul(0.015).add(0.06), dist))
      .mul(mix(float(0.55), float(1), broken));
    const ring2 = float(1)
      .sub(smoothstep(0.0, 0.012, abs(dist.sub(0.115).add(sin(t.mul(0.8)).mul(0.012)))))
      .mul(broken)
      .mul(0.8);
    const ring = smoothstep(0.82, 1, sin(dist.mul(70).sub(t.mul(1.3)).add(n.mul(2.5))))
      .mul(float(1).sub(smoothstep(0.03, 0.2, dist)))
      .mul(smoothstep(-0.25, 0.35, n));
    const foam = clamp(edge.add(ring2).add(ring.mul(0.7)), 0, 1);
    mat.colorNode = mix(col, color(WATER.foam), foam);
    // clear in the shallows so the sandy floor and its caustics show through, opaque far out
    mat.opacityNode = clamp(mix(float(0.22), float(0.93), smoothstep(0.0, 0.36, dist)).add(foam), 0, 1);
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.receiveShadow = true;
    this.mesh.renderOrder = 1;
    this.mesh.frustumCulled = false;
  }

  private readonly shoreNode: ReturnType<typeof texture>;

  private makeShoreTexture(data: Float32Array, w: number, h: number): THREE.DataTexture {
    // 8-bit is filterable everywhere (float32 filtering is an optional WebGPU feature)
    const bytes = new Uint8Array(data.length);
    for (let i = 0; i < data.length; i++) bytes[i] = Math.round(data[i] * 255);
    const tex = new THREE.DataTexture(bytes, w, h, THREE.RedFormat, THREE.UnsignedByteType);
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearFilter;
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.needsUpdate = true;
    return tex;
  }

  /** Bakes the shore distance of a new map into the water. */
  setMap(map: MapData): void {
    const sd = shoreDistance(map);
    const old = this.shoreTex;
    this.shoreTex = this.makeShoreTexture(sd.data, sd.w, sd.h);
    this.shoreNode.value = this.shoreTex;
    old.dispose();
    this.uOrigin.value.set((-map.w * map.cell) / 2, (-map.h * map.cell) / 2);
    this.uSize.value.set(map.w * map.cell, map.h * map.cell);
  }

  update(t: number): void {
    this.uTime.value = t;
    this.uAmp.value = amplitude;
  }
}
