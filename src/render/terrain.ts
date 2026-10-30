// Terraced island from the logical map: flat terraces with steep rock cliffs between them,
// ramps as earthen slopes, organic outlines (domain-warped cell blend), stratified rock, a
// darker grass lip on the cliff edge. Props: palisade, pines and broadleaf trees, bushes,
// wind-blown grass tufts, boulders, log cabins with thatched roofs, the lighthouse fire.

import * as THREE from 'three/webgpu';
import type { Node } from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  abs,
  cameraPosition,
  float,
  instancedBufferAttribute,
  length,
  mx_noise_float,
  normalWorld,
  positionGeometry,
  positionLocal,
  positionWorld,
  sin,
  smoothstep as tslSmoothstep,
  uniform,
  vec2,
  vec3,
} from 'three/tsl';
import { codeAtCell, levelAtCell } from '../core/map.ts';
import { hashSeed, rand } from '../core/rng.ts';
import type { BuildingKey, GameEvent, GameState, MapData } from '../core/types.ts';
import { T } from '../core/types.ts';
import { buildingDamageStage, smooth } from './anim.ts';
import { vnoise } from './noise.ts';
import { BUILDINGS, GROUND, HUT_ROOF, HUT_WALLS, LIGHT, PALETTE } from './palette.ts';
import { buildBoulderGeometry, buildBroadGeometry, buildBushGeometry, buildPineGeometry, buildTrunkGeometry } from './trees.ts';

const SUB = 8; // render vertices per cell edge

/** Height of one terrace step (m), the beach above the sea, the sea floor. */
export const LEVEL_H = 2.6;
const BEACH_H = 0.22;
const SHALLOW_H = -0.55;
const DEEP_H = -1.9;
/** Half width of a cliff transition, as a fraction of a cell (smaller = steeper). */
const CLIFF_EDGE = 0.13;

/** Lift of the lighthouse deck above the ground (soldiers stand on the tower platform). */
export const TOWER_DECK_LIFT = 4.5;

export { PALETTE } from './palette.ts';

type Rng = { rng: number };

const smoothstep = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Meadow patchiness 0..1: tufts grow in soft patches with bare ground in between. */
export function grassDensity(x: number, z: number, seed: number): number {
  const n = vnoise(x / 4, z / 4, seed + 31) * 0.75 + vnoise(x / 1.7, z / 1.7, seed + 32) * 0.25;
  return smoothstep(0.52, 0.74, n);
}

/** Moss weight 0..1: flat ground right above a drop (the cliff lip) turns dark green. */
export function mossWeight(slope: number, drop: number): number {
  return slope < 0.8 ? smoothstep(0.8, 1.8, drop) : 0;
}

/** Cell bounds of the palisade; grass inside reads as a trampled plaza. */
export function palisadeBounds(map: MapData): { minX: number; maxX: number; minY: number; maxY: number } {
  const b = { minX: map.w, maxX: -1, minY: map.h, maxY: -1 };
  for (let cy = 0; cy < map.h; cy++) {
    for (let cx = 0; cx < map.w; cx++) {
      const c = codeAtCell(map, cx, cy);
      if (c !== T.WALL && c !== T.GATE) continue;
      b.minX = Math.min(b.minX, cx);
      b.maxX = Math.max(b.maxX, cx);
      b.minY = Math.min(b.minY, cy);
      b.maxY = Math.max(b.maxY, cy);
    }
  }
  return b;
}

/** The stone path (render only): from each gate south over the ramp and a few cells onto the meadow. */
export function pathCellSet(map: MapData): Set<number> {
  const out = new Set<number>();
  for (let cy = 0; cy < map.h; cy++) {
    for (let cx = 0; cx < map.w; cx++) {
      if (codeAtCell(map, cx, cy) !== T.GATE) continue;
      let seenRamp = false;
      let after = 0;
      for (let y = cy + 1; y < map.h && y < cy + 14; y++) {
        const code = codeAtCell(map, cx, y);
        if (code !== T.GRASS) break;
        const lv = levelAtCell(map, cx, y);
        if (lv !== Math.floor(lv)) seenRamp = true;
        else if (seenRamp && ++after > 3) break;
        out.add(y * map.w + cx);
      }
    }
  }
  return out;
}

/** Whether a cell may carry grass tufts: open meadow or plateau, not the plaza, a ramp, the path or a beach. */
export function grassCellAllowed(
  map: MapData,
  cx: number,
  cy: number,
  plaza: { minX: number; maxX: number; minY: number; maxY: number },
  path: Set<number>,
): boolean {
  if (codeAtCell(map, cx, cy) !== T.GRASS) return false;
  const lv = levelAtCell(map, cx, cy);
  if (lv !== Math.floor(lv)) return false;
  if (cx > plaza.minX && cx < plaza.maxX && cy > plaza.minY && cy < plaza.maxY) return false;
  return !path.has(cy * map.w + cx);
}

/** Center height of every cell: terraces by level, ramps graded along their slope. */
export function cellHeights(map: MapData): Float32Array {
  const out = new Float32Array(map.w * map.h);
  for (let cy = 0; cy < map.h; cy++) {
    for (let cx = 0; cx < map.w; cx++) {
      const code = codeAtCell(map, cx, cy);
      const lv = levelAtCell(map, cx, cy);
      let h: number;
      if (code === T.DEEP) h = DEEP_H;
      else if (code === T.SHALLOW) h = SHALLOW_H;
      else if (lv !== Math.floor(lv)) h = BEACH_H + (Math.floor(lv) + rampFraction(map, cx, cy, lv)) * LEVEL_H;
      else h = BEACH_H + lv * LEVEL_H;
      out[cy * map.w + cx] = h;
    }
  }
  return out;
}

/** How far up its ramp a ramp cell sits (0 at the lower terrace, 1 at the upper). */
function rampFraction(map: MapData, cx: number, cy: number, lv: number): number {
  const k = Math.floor(lv);
  for (const [dx, dy] of [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ]) {
    let a = 1;
    while (a < 8 && levelAtCell(map, cx + dx * a, cy + dy * a) === lv) a++;
    if (levelAtCell(map, cx + dx * a, cy + dy * a) !== k + 1) continue;
    let b = 1;
    while (b < 8 && levelAtCell(map, cx - dx * b, cy - dy * b) === lv) b++;
    if (levelAtCell(map, cx - dx * b, cy - dy * b) !== k) continue;
    return b / (a + b);
  }
  return 0.5;
}

function cliffT(t: number, cliff: boolean): number {
  return cliff ? smoothstep(0.5 - CLIFF_EDGE, 0.5 + CLIFF_EDGE, t) : t;
}

/** Thatch: warm straw with vertical streaks. */
function thatchTexture(): THREE.CanvasTexture {
  const S = 128;
  const c = document.createElement('canvas');
  c.width = S;
  c.height = S;
  const g = c.getContext('2d')!;
  g.fillStyle = '#e8e0cc';
  g.fillRect(0, 0, S, S);
  const r = { rng: hashSeed('thatch') };
  for (let i = 0; i < 420; i++) {
    const x = rand(r) * S;
    const y = rand(r) * S;
    const v = 170 + Math.floor(rand(r) * 85);
    g.strokeStyle = `rgba(${v},${v - 10},${v - 40},0.55)`;
    g.lineWidth = 1 + rand(r) * 1.5;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + (rand(r) - 0.5) * 3, y + 10 + rand(r) * 18);
    g.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  return tex;
}

/** Adds a constant vertex color (with a little jitter) so merged parts keep their own tones. */
function tint(g: THREE.BufferGeometry, color: THREE.Color, jitter: number, r: Rng): THREE.BufferGeometry {
  const n = g.getAttribute('position').count;
  const col = new Float32Array(n * 3);
  const k = 1 + (rand(r) - 0.5) * jitter;
  for (let i = 0; i < n; i++) {
    col[i * 3] = color.r * k;
    col[i * 3 + 1] = color.g * k;
    col[i * 3 + 2] = color.b * k;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

/** Log cabin walls: alternating courses of round logs with crossed corners, filled behind. */
function logWalls(w: number, d: number, h: number, wood: THREE.Color, r: Rng): THREE.BufferGeometry {
  const rad = 0.11;
  const parts: THREE.BufferGeometry[] = [];
  const courses = Math.max(3, Math.round(h / (rad * 2)));
  for (let i = 0; i < courses; i++) {
    const alongX = i % 2 === 0;
    const y = rad + i * rad * 2;
    for (const side of [-1, 1]) {
      const len = (alongX ? w : d) + 0.34;
      const g = new THREE.CylinderGeometry(rad, rad, len, 7, 1);
      g.rotateZ(Math.PI / 2);
      if (!alongX) g.rotateY(Math.PI / 2);
      g.translate(alongX ? 0 : (side * w) / 2, y, alongX ? (side * d) / 2 : 0);
      parts.push(tint(g, wood, 0.22, r));
    }
  }
  const fill = new THREE.BoxGeometry(w - 0.06, courses * rad * 2, d - 0.06);
  fill.translate(0, (courses * rad * 2) / 2, 0);
  parts.push(tint(fill, wood.clone().multiplyScalar(0.7), 0, r));
  return mergeGeometries(parts)!;
}

/** Thick thatched gable roof with an overhang, ridge along z. Height of the walls is the origin. */
function thatchRoof(w: number, d: number, rise: number, over: number): THREE.BufferGeometry {
  const half = w / 2 + over;
  const len = Math.hypot(half, rise + over * 0.6);
  const ang = Math.atan2(rise + over * 0.6, half);
  const parts: THREE.BufferGeometry[] = [];
  for (const side of [-1, 1]) {
    const slab = new THREE.BoxGeometry(len, 0.3, d + over * 2, 3, 1, 2);
    slab.rotateZ(-side * ang);
    slab.translate((side * half) / 2, rise / 2 - over * 0.3, 0);
    parts.push(slab);
  }
  const ridge = new THREE.CylinderGeometry(0.2, 0.2, d + over * 2 + 0.1, 8);
  ridge.rotateX(Math.PI / 2);
  ridge.translate(0, rise + 0.05, 0);
  parts.push(ridge);
  return mergeGeometries(parts.map((p) => p.toNonIndexed()))!;
}

/** Gable triangles closing the roof ends. */
function gables(w: number, d: number, rise: number): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(-w / 2, 0);
  shape.lineTo(w / 2, 0);
  shape.lineTo(0, rise);
  shape.closePath();
  const a = new THREE.ExtrudeGeometry(shape, { depth: 0.08, bevelEnabled: false });
  const b = a.clone();
  a.translate(0, 0, d / 2 - 0.08);
  b.translate(0, 0, -d / 2);
  return mergeGeometries([a, b])!;
}

/** Seconds a building shakes after a blow, and seconds its collapse takes. */
export const JOLT_TIME = 0.25;
export const COLLAPSE_TIME = 1.2;

interface BuildingMesh {
  group: THREE.Group;
  roof: THREE.Object3D[];
  body: THREE.Mesh[];
  baseColors: THREE.Color[];
  lastHp: number;
  /** Rest position of the group (the shake moves it around this). */
  base: THREE.Vector3;
  /** Height of the highest point above the group origin (health bar and flames). */
  top: number;
  /** Rest pose of the roof pieces (the collapse moves them). */
  roofRest: { y: number; rx: number; rz: number }[];
  cracks: THREE.Object3D[];
  fire: THREE.Mesh[];
  bar: THREE.Group;
  barFill: THREE.Mesh;
  /** Seconds of shaking left. */
  jolt: number;
  /** Seconds into the collapse, -1 while standing. */
  collapse: number;
}

interface Sway {
  x: number;
  z: number;
  y: number;
  s: number;
  sy: number;
  yaw: number;
  phase: number;
  /** Tint of this plant, picked once so the crown and its leaf cards agree. */
  col?: THREE.Color;
}

/**
 * Leaf cluster for the alpha-tested leaf cards: a dozen small leaves, white to light gray (the instance
 * color gives the hue), transparent between them.
 */
function leafTexture(): THREE.CanvasTexture {
  const S = 64;
  const c = document.createElement('canvas');
  c.width = S;
  c.height = S;
  const g = c.getContext('2d')!;
  g.clearRect(0, 0, S, S);
  const rng = { rng: 77 };
  for (let i = 0; i < 16; i++) {
    const a = rand(rng) * Math.PI * 2;
    const d = rand(rng) * S * 0.3;
    const x = S / 2 + Math.cos(a) * d;
    const y = S / 2 + Math.sin(a) * d;
    const tone = Math.round(205 + rand(rng) * 50);
    g.save();
    g.translate(x, y);
    g.rotate(rand(rng) * Math.PI);
    g.fillStyle = `rgb(${tone},${tone},${tone})`;
    g.beginPath();
    g.ellipse(0, 0, 5 + rand(rng) * 4, 2.6 + rand(rng) * 1.6, 0, 0, Math.PI * 2);
    g.fill();
    g.restore();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class Terrain {
  readonly group = new THREE.Group();
  readonly ground: THREE.Mesh;
  private readonly heights: Float32Array;
  private readonly vw: number;
  private readonly vh: number;
  private readonly x0: number;
  private readonly z0: number;
  private readonly step: number;
  private readonly buildings: BuildingMesh[] = [];
  private readonly towerRects: { minX: number; maxX: number; minZ: number; maxZ: number }[] = [];
  private readonly sways: { mesh: THREE.InstancedMesh; spots: Sway[] }[] = [];
  private readonly flames: THREE.Mesh[] = [];

  /** Trees and bushes in the scene (debug line). */
  get plantCount(): number {
    let n = 0;
    for (const spots of new Set(this.sways.map((s) => s.spots))) n += spots.length; // the leaf cards share the crown's spots
    return n;
  }
  private readonly uWind = uniform(0);
  private readonly uWindAmp = uniform(1);
  private readonly thatch = thatchTexture();
  private readonly seedN: number;
  /** Simulation seconds, for shaking and flames. */
  private clock = 0;
  private readonly plaza: { minX: number; maxX: number; minY: number; maxY: number };
  private readonly path: Set<number>;
  private groundCol: Float32Array = new Float32Array(0);
  private readonly tmpM = new THREE.Matrix4();
  private readonly tmpQ = new THREE.Quaternion();
  private readonly tmpEuler = new THREE.Euler();
  private readonly tmpV = new THREE.Vector3();
  private readonly tmpS = new THREE.Vector3();

  /** Render vertices per cell edge (the quality profile sets it). */
  private readonly sub: number;
  /** Bushes cast shadows (the quality profile). */
  private readonly smallShadows: boolean;

  constructor(
    private readonly map: MapData,
    seed: string,
    sub = SUB,
    smallShadows = true,
  ) {
    this.sub = sub;
    this.smallShadows = smallShadows;
    this.seedN = hashSeed('terrain-' + seed);
    for (const b of map.buildings) {
      if (b.key === 'lighthouse') this.towerRects.push({ minX: b.min.x, maxX: b.max.x, minZ: b.min.y, maxZ: b.max.y });
    }
    this.vw = map.w * this.sub + 1;
    this.vh = map.h * this.sub + 1;
    this.step = map.cell / this.sub;
    this.x0 = (-map.w * map.cell) / 2;
    this.z0 = (-map.h * map.cell) / 2;
    this.plaza = palisadeBounds(map);
    this.path = pathCellSet(map);
    const cellIdx = new Int32Array(this.vw * this.vh);
    this.heights = this.buildHeights(cellIdx);
    this.ground = this.buildGround(cellIdx);
    this.group.add(this.ground);

    const floor = new THREE.Mesh(new THREE.PlaneGeometry(500, 500), new THREE.MeshLambertMaterial({ color: GROUND.seabed }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = DEEP_H - 0.02;
    this.group.add(floor);

    this.buildPalisade({ rng: hashSeed('terrain-wall-' + seed) });
    this.buildTrees({ rng: hashSeed('terrain-trees-' + seed) });
    this.buildGrass({ rng: hashSeed('terrain-grass-' + seed) });
    this.buildRocks({ rng: hashSeed('terrain-rocks-' + seed) });
    this.buildRuin({ rng: hashSeed('terrain-ruin-' + seed) });
    this.buildBuildings({ rng: hashSeed('terrain-houses-' + seed) });
  }

  /** Vertex heights: domain-warped blend of cell heights, steep across cliffs, linear elsewhere. */
  private buildHeights(cellIdx: Int32Array): Float32Array {
    const map = this.map;
    const ch = cellHeights(map);
    const lv = (i: number) => map.level[i];
    const cliff = (a: number, b: number) => Math.abs(lv(a) - lv(b)) > 0.5;
    const s = this.seedN;
    const raw = new Float32Array(this.vw * this.vh);
    for (let j = 0; j < this.vh; j++) {
      for (let i = 0; i < this.vw; i++) {
        const x = this.x0 + i * this.step;
        const z = this.z0 + j * this.step;
        // organic outlines: warp the lookup, so straight cell edges wander and corners round off
        const wx = (vnoise(x / 3.4, z / 3.4, s) - 0.5) * 0.95 + (vnoise(x / 1.2, z / 1.2, s + 1) - 0.5) * 0.35;
        const wz = (vnoise(x / 3.4, z / 3.4, s + 2) - 0.5) * 0.95 + (vnoise(x / 1.2, z / 1.2, s + 3) - 0.5) * 0.35;
        const fx = Math.min(map.w - 1.001, Math.max(0, i / this.sub - 0.5 + wx));
        const fz = Math.min(map.h - 1.001, Math.max(0, j / this.sub - 0.5 + wz));
        const ix = Math.min(map.w - 2, Math.floor(fx));
        const iz = Math.min(map.h - 2, Math.floor(fz));
        const tx = fx - ix;
        const tz = fz - iz;
        const a = iz * map.w + ix;
        const b = a + 1;
        const c = a + map.w;
        const d = c + 1;
        const top = ch[a] + (ch[b] - ch[a]) * cliffT(tx, cliff(a, b));
        const bot = ch[c] + (ch[d] - ch[c]) * cliffT(tx, cliff(c, d));
        const vt = cliffT(tz, cliff(a, c) || cliff(b, d));
        let h = top + (bot - top) * vt;
        // ledges and lumps: a little noise, stronger on the rock
        h += (vnoise(x / 1.6, z / 1.6, s + 4) - 0.5) * 0.16;
        raw[j * this.vw + i] = h;
        cellIdx[j * this.vw + i] = Math.round(fz) * map.w + Math.round(fx);
      }
    }
    // one soft pass: rounds the cliff lip and foot without flattening the faces
    const out = new Float32Array(raw.length);
    for (let j = 0; j < this.vh; j++) {
      for (let i = 0; i < this.vw; i++) {
        let sum = 0;
        let wsum = 0;
        for (let dj = -1; dj <= 1; dj++) {
          for (let di = -1; di <= 1; di++) {
            const ii = Math.min(this.vw - 1, Math.max(0, i + di));
            const jj = Math.min(this.vh - 1, Math.max(0, j + dj));
            const w = (di === 0 ? 2 : 1) * (dj === 0 ? 2 : 1);
            sum += raw[jj * this.vw + ii] * w;
            wsum += w;
          }
        }
        out[j * this.vw + i] = sum / wsum;
      }
    }
    return out;
  }

  /** Ground height without the tower platform (used to place static meshes). */
  baseHeightAt(x: number, z: number): number {
    const fx = THREE.MathUtils.clamp((x - this.x0) / this.step, 0, this.vw - 1.001);
    const fz = THREE.MathUtils.clamp((z - this.z0) / this.step, 0, this.vh - 1.001);
    const i = Math.floor(fx);
    const j = Math.floor(fz);
    const u = fx - i;
    const w = fz - j;
    const h = this.heights;
    const a = h[j * this.vw + i];
    const b = h[j * this.vw + i + 1];
    const c = h[(j + 1) * this.vw + i];
    const d = h[(j + 1) * this.vw + i + 1];
    return (a * (1 - u) + b * u) * (1 - w) + (c * (1 - u) + d * u) * w;
  }

  /** Terrain height at a world point; inside the lighthouse footprint it is the deck level. */
  heightAt(x: number, z: number): number {
    const base = this.baseHeightAt(x, z);
    for (const r of this.towerRects) {
      if (x >= r.minX && x <= r.maxX && z >= r.minZ && z <= r.maxZ) return base + TOWER_DECK_LIFT;
    }
    return base;
  }

  /** Flat height of a cell's terrace (props sit on this, not on a noisy vertex). */
  private cellTop(cx: number, cy: number): number {
    const c = this.cellCenter(cx, cy);
    return this.baseHeightAt(c.x, c.z);
  }

  private cellCenter(cx: number, cy: number): { x: number; z: number } {
    return { x: this.x0 + (cx + 0.5) * this.map.cell, z: this.z0 + (cy + 0.5) * this.map.cell };
  }

  private buildGround(cellIdx: Int32Array): THREE.Mesh {
    const map = this.map;
    const n = this.vw * this.vh;
    const pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    const { minX: pMinX, maxX: pMaxX, minY: pMinY, maxY: pMaxY } = this.plaza;
    const meadow = GROUND.meadow.map((c) => new THREE.Color(c));
    const C = {
      seabed: new THREE.Color(GROUND.seabed),
      wet: new THREE.Color(GROUND.sandWet),
      sand: new THREE.Color(GROUND.sand),
      lip: new THREE.Color(GROUND.lip),
      plaza: new THREE.Color(GROUND.plaza),
      ramp: new THREE.Color(GROUND.ramp),
      forest: new THREE.Color(GROUND.forestFloor),
      lush: new THREE.Color(GROUND.meadowLush),
      rockDark: new THREE.Color(GROUND.rockDark),
      moss: new THREE.Color(GROUND.moss),
      path: new THREE.Color(GROUND.path),
    };
    const rocks = GROUND.rock.map((c) => new THREE.Color(c));
    const surf = new THREE.Color();
    const rock = new THREE.Color();
    const s = this.seedN;
    const H = this.heights;
    const at = (i: number, j: number) => H[Math.min(this.vh - 1, Math.max(0, j)) * this.vw + Math.min(this.vw - 1, Math.max(0, i))];
    for (let j = 0; j < this.vh; j++) {
      for (let i = 0; i < this.vw; i++) {
        const v = j * this.vw + i;
        const x = this.x0 + i * this.step;
        const z = this.z0 + j * this.step;
        const h = H[v];
        pos[v * 3] = x;
        pos[v * 3 + 1] = h;
        pos[v * 3 + 2] = z;
        const gx = (at(i + 1, j) - at(i - 1, j)) / (2 * this.step);
        const gz = (at(i, j + 1) - at(i, j - 1)) / (2 * this.step);
        const slope = Math.sqrt(gx * gx + gz * gz);
        const ci = cellIdx[v];
        const code = map.terrain[ci];
        const lvl = map.level[ci];
        const cx = ci % map.w;
        const cy = (ci - cx) / map.w;
        // surface by cell
        if (code === T.DEEP || code === T.SHALLOW) {
          surf.copy(C.wet).lerp(C.seabed, smoothstep(0.1, 1.6, BEACH_H - h));
        } else if (code === T.BEACH) {
          surf.copy(C.sand).lerp(C.wet, smoothstep(BEACH_H + 0.12, BEACH_H - 0.2, h));
        } else if (lvl !== Math.floor(lvl)) {
          surf.copy(C.ramp);
        } else if (code === T.CLIFF) {
          // rock outcrops and islets: bare stone with a thin grass fringe up top
          surf.copy(rocks[(cx + cy * 3) % 4]).lerp(C.lip, 0.12);
        } else if (code === T.FOREST) {
          surf.copy(C.forest);
        } else if (cx > pMinX && cx < pMaxX && cy > pMinY && cy < pMaxY) {
          surf.copy(C.plaza).multiplyScalar(0.94 + vnoise(x / 1.5, z / 1.5, s + 9) * 0.12);
        } else {
          // meadow: large soft patches blending four tones, lusher low down
          const m = vnoise(x / 6, z / 6, s + 5) * 3;
          const k = Math.floor(m);
          surf.copy(meadow[k]).lerp(meadow[Math.min(3, k + 1)], m - k);
          surf.lerp(C.lush, (1 - smoothstep(BEACH_H + LEVEL_H - 0.5, BEACH_H + LEVEL_H * 2, h)) * 0.25);
        }
        // stone path from the gate south: worn flagstones with uneven edges
        if (this.path.has(ci)) {
          const wear = 0.78 + vnoise(x * 2.6, z * 2.6, s + 12) * 0.22;
          surf.lerp(C.path, 0.82).multiplyScalar(wear);
        }
        // moss and a darker grass lip right on the cliff edge
        if (code !== T.BEACH && code !== T.DEEP && code !== T.SHALLOW) {
          const r = 3;
          const drop = h - Math.min(at(i + r, j), at(i - r, j), at(i, j + r), at(i, j - r));
          surf.lerp(C.lip, mossWeight(slope, drop) * 0.45).lerp(C.moss, mossWeight(slope, drop) * 0.35 * vnoise(x * 1.8, z * 1.8, s + 13));
        }
        // stratified rock on steep faces
        const band = Math.floor(h * 1.7 + vnoise(x / 2.2, z / 2.2, s + 6) * 1.6);
        rock.copy(rocks[((band % 4) + 4) % 4]).multiplyScalar(0.86 + vnoise(x * 1.3, z * 1.3, s + 7) * 0.22);
        rock.lerp(C.rockDark, smoothstep(0.5, -1.2, h) * 0.6);
        surf.lerp(rock, smoothstep(0.85, 1.7, slope));
        col[v * 3] = surf.r;
        col[v * 3 + 1] = surf.g;
        col[v * 3 + 2] = surf.b;
      }
    }
    const index = new Uint32Array((this.vw - 1) * (this.vh - 1) * 6);
    let q = 0;
    for (let j = 0; j < this.vh - 1; j++) {
      for (let i = 0; i < this.vw - 1; i++) {
        const a = j * this.vw + i;
        const b = a + 1;
        const c = a + this.vw;
        const d = c + 1;
        // split along the flatter diagonal: no saw teeth along cliff tops
        if (Math.abs(H[a] - H[d]) < Math.abs(H[b] - H[c])) {
          index.set([a, c, d, a, d, b], q);
        } else {
          index.set([a, c, b, b, c, d], q);
        }
        q += 6;
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setIndex(new THREE.BufferAttribute(index, 1));
    geo.computeVertexNormals();
    this.groundCol = col;
    const mesh = new THREE.Mesh(geo, this.groundMaterial());
    mesh.receiveShadow = true;
    mesh.castShadow = true;
    return mesh;
  }

  /**
   * Ground shading on top of the vertex colors (multiplied): rock strata and cracks on steep
   * faces, pale mineral streaks just above the waterline, and animated caustics on the sea floor.
   */
  private groundMaterial(): THREE.MeshLambertNodeMaterial {
    const mat = new THREE.MeshLambertNodeMaterial({ vertexColors: true });
    const p = positionWorld;
    const t = this.uWind;
    const steep = tslSmoothstep(0.3, 0.7, float(1).sub(normalWorld.y));
    // strata: wavy horizontal courses
    const warp = mx_noise_float(vec3(p.x.mul(0.5), p.y.mul(0.2), p.z.mul(0.5)));
    const strata = sin(p.y.mul(7).add(warp.mul(2.5))).mul(0.1).mul(steep);
    // cracks: thin dark veins from a high frequency noise
    const cr = mx_noise_float(vec3(p.x.mul(2.4), p.y.mul(0.9), p.z.mul(2.4)));
    const crack = float(1).sub(tslSmoothstep(0.0, 0.07, abs(cr))).mul(0.32).mul(steep);
    // streaks: vertical pale stains in a band just above the sea (noise barely varies with height)
    const band = tslSmoothstep(0.1, 0.8, p.y).mul(float(1).sub(tslSmoothstep(1.6, 2.8, p.y)));
    const sn = mx_noise_float(vec3(p.x.mul(3.3), 0, p.z.mul(3.3)));
    const streak = band.mul(steep).mul(tslSmoothstep(0.1, 0.55, sn)).mul(0.5);
    const rockMod = float(1).add(strata).sub(crack).add(streak);
    // caustics: bright net lines on the shallow floor, fading with depth
    const under = float(1).sub(tslSmoothstep(-0.05, 0.2, p.y)).mul(tslSmoothstep(-1.9, -0.4, p.y));
    const n1 = mx_noise_float(vec3(p.x.mul(0.9).add(t.mul(0.2)), p.z.mul(0.9), t.mul(0.35)));
    const n2 = mx_noise_float(vec3(p.x.mul(1.3).sub(t.mul(0.15)), p.z.mul(1.3).add(5), t.mul(0.3)));
    const line = float(1).sub(tslSmoothstep(0.0, 0.14, abs(n1.add(n2))));
    const caustic = line.mul(under).mul(float(1).sub(steep)).mul(0.55);
    mat.colorNode = vec3(rockMod.add(caustic.mul(0.9)), rockMod.add(caustic.mul(0.85)), rockMod.add(caustic.mul(0.6)));
    return mat;
  }

  private buildPalisade(r: Rng): void {
    const isWall = (cx: number, cy: number) => {
      const c = codeAtCell(this.map, cx, cy);
      return c === T.WALL || c === T.GATE;
    };
    const posts: { x: number; y: number; z: number }[] = [];
    const gates: { x: number; y: number; z: number }[] = [];
    for (let cy = 0; cy < this.map.h; cy++) {
      for (let cx = 0; cx < this.map.w; cx++) {
        const code = codeAtCell(this.map, cx, cy);
        const c = this.cellCenter(cx, cy);
        const y = this.cellTop(cx, cy);
        if (code === T.GATE) gates.push({ x: c.x, y, z: c.z });
        if (code !== T.WALL) continue;
        const horiz = isWall(cx - 1, cy) || isWall(cx + 1, cy);
        const vert = isWall(cx, cy - 1) || isWall(cx, cy + 1);
        const n = 5;
        for (let k = 0; k < n; k++) {
          const o = (k + 0.5) / n - 0.5;
          if (horiz || !vert) posts.push({ x: c.x + o * this.map.cell, y, z: c.z });
          if (vert) posts.push({ x: c.x, y, z: c.z + o * this.map.cell });
        }
      }
    }
    const logGeo = new THREE.CylinderGeometry(0.15, 0.17, 1, 8);
    logGeo.translate(0, 0.5, 0);
    const tipGeo = new THREE.ConeGeometry(0.15, 0.42, 8).translate(0, 0.21, 0);
    const wood = new THREE.MeshLambertMaterial({ color: '#ffffff' });
    const logs = new THREE.InstancedMesh(logGeo, wood, posts.length);
    const tips = new THREE.InstancedMesh(tipGeo, wood, posts.length);
    const base = new THREE.Color(PALETTE.wood);
    const col = new THREE.Color();
    posts.forEach((p, i) => {
      const hgt = 2.0 + rand(r) * 0.5;
      this.tmpEuler.set((rand(r) - 0.5) * 0.08, rand(r) * 6, (rand(r) - 0.5) * 0.08);
      this.tmpQ.setFromEuler(this.tmpEuler);
      this.tmpM.compose(this.tmpV.set(p.x, p.y - 0.25, p.z), this.tmpQ, this.tmpS.set(1, hgt, 1));
      logs.setMatrixAt(i, this.tmpM);
      this.tmpM.compose(this.tmpV.set(0, hgt, 0).applyQuaternion(this.tmpQ).add(new THREE.Vector3(p.x, p.y - 0.25, p.z)), this.tmpQ, this.tmpS.set(1, 1, 1));
      tips.setMatrixAt(i, this.tmpM);
      col.copy(base).multiplyScalar(0.8 + rand(r) * 0.35);
      logs.setColorAt(i, col);
      tips.setColorAt(i, col);
    });
    for (const m of [logs, tips]) {
      m.castShadow = true;
      m.receiveShadow = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
      this.group.add(m);
    }

    if (gates.length > 0) {
      const minX = Math.min(...gates.map((g) => g.x)) - this.map.cell / 2;
      const maxX = Math.max(...gates.map((g) => g.x)) + this.map.cell / 2;
      const z = gates[0].z;
      const y = gates[0].y;
      const dark = new THREE.MeshLambertMaterial({ color: PALETTE.woodDark });
      const thatchMat = new THREE.MeshLambertMaterial({ color: HUT_ROOF, map: this.thatch });
      for (const x of [minX - 0.3, maxX + 0.3]) {
        // gate towers: four posts, a deck, a small thatched roof
        const tower = new THREE.Group();
        for (const [px, pz] of [
          [-0.45, -0.45],
          [0.45, -0.45],
          [-0.45, 0.45],
          [0.45, 0.45],
        ]) {
          const post = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.13, 3.6, 7), dark);
          post.position.set(px, 1.8, pz);
          post.castShadow = true;
          tower.add(post);
        }
        const deck = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.16, 1.3), dark);
        deck.position.y = 2.6;
        const roof = new THREE.Mesh(thatchRoof(1.1, 1.1, 0.8, 0.2), thatchMat);
        roof.position.y = 3.6;
        roof.castShadow = true;
        tower.add(deck, roof);
        tower.position.set(x, y - 0.2, z);
        this.group.add(tower);
      }
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, maxX - minX + 1.2, 8).rotateZ(Math.PI / 2), dark);
      beam.position.set((minX + maxX) / 2, y + 2.55, z);
      beam.castShadow = true;
      this.group.add(beam);
    }
  }

  private buildTrees(r: Rng): void {
    const pines: Sway[] = [];
    const broad: Sway[] = [];
    const bushes: Sway[] = [];
    const cell = this.map.cell;
    for (let cy = 0; cy < this.map.h; cy++) {
      for (let cx = 0; cx < this.map.w; cx++) {
        const code = codeAtCell(this.map, cx, cy);
        const c = this.cellCenter(cx, cy);
        if (code === T.FOREST) {
          const n = 1 + (rand(r) < 0.6 ? 1 : 0) + (rand(r) < 0.25 ? 1 : 0);
          for (let k = 0; k < n; k++) {
            const x = c.x + (rand(r) - 0.5) * cell * 0.95;
            const z = c.z + (rand(r) - 0.5) * cell * 0.95;
            const spot = { x, z, y: this.baseHeightAt(x, z), s: 0.75 + rand(r) * 0.6, sy: 0.9 + rand(r) * 0.6, yaw: rand(r) * 6.28, phase: x * 1.7 + z * 2.3 };
            (rand(r) < 0.72 ? pines : broad).push(spot);
          }
        } else if (code === T.GRASS && levelAtCell(this.map, cx, cy) % 1 === 0) {
          // bushes at the forest edge and along the cliff feet
          let nearWood = false;
          for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (codeAtCell(this.map, cx + dx, cy + dy) === T.FOREST) nearWood = true;
          if (nearWood ? rand(r) < 0.5 : rand(r) < 0.04) {
            const x = c.x + (rand(r) - 0.5) * cell * 0.8;
            const z = c.z + (rand(r) - 0.5) * cell * 0.8;
            bushes.push({ x, z, y: this.baseHeightAt(x, z), s: 0.45 + rand(r) * 0.35, sy: 0.7 + rand(r) * 0.3, yaw: rand(r) * 6.28, phase: x + z });
          }
        }
      }
    }
    const all = [...pines, ...broad];
    const trunk = new THREE.InstancedMesh(buildTrunkGeometry(), new THREE.MeshLambertMaterial({ color: PALETTE.trunk }), Math.max(1, all.length));
    all.forEach((p, i) => {
      this.tmpQ.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, p.yaw);
      this.tmpM.compose(this.tmpV.set(p.x, p.y - 0.1, p.z), this.tmpQ, this.tmpS.set(p.s, p.s * p.sy, p.s));
      trunk.setMatrixAt(i, this.tmpM);
    });
    trunk.count = all.length;
    trunk.castShadow = true;
    this.group.add(trunk);

    const broad3 = buildBroadGeometry();
    this.addSway(buildPineGeometry(), pines, PALETTE.pine, r);
    this.addSway(broad3.crown, broad, PALETTE.leaf, r);
    // leaf cards soften the crown outline; they do not cast shadows (the crown does)
    this.addSway(broad3.cards, broad, PALETTE.leaf, r, { cast: false, leaf: leafTexture() });
    this.addSway(buildBushGeometry(), bushes, [PALETTE.bush, ...PALETTE.leaf], r, { cast: this.smallShadows });
  }

  /**
   * One instanced mesh of plants: baked brightness in the vertex colors, a hue per plant in the instance color.
   * `leaf` makes an alpha-tested, double-sided card material (the plant hue is shared with the crown).
   */
  private addSway(geo: THREE.BufferGeometry, spots: Sway[], tones: readonly string[], r: Rng, opts: { cast?: boolean; leaf?: THREE.Texture } = {}): void {
    if (spots.length === 0) return;
    const mat = opts.leaf
      ? new THREE.MeshLambertMaterial({ color: '#ffffff', vertexColors: true, map: opts.leaf, alphaTest: 0.5, side: THREE.DoubleSide })
      : new THREE.MeshLambertMaterial({ color: '#ffffff', vertexColors: true });
    const mesh = new THREE.InstancedMesh(geo, mat, spots.length);
    const col = new THREE.Color();
    spots.forEach((p, i) => {
      this.tmpQ.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, p.yaw);
      this.tmpM.compose(this.tmpV.set(p.x, p.y - 0.1, p.z), this.tmpQ, this.tmpS.set(p.s, p.s * p.sy, p.s));
      mesh.setMatrixAt(i, this.tmpM);
      p.col ??= new THREE.Color(tones[Math.floor(rand(r) * tones.length)]).multiplyScalar(0.88 + rand(r) * 0.24);
      col.copy(p.col);
      if (opts.leaf) col.multiplyScalar(1.1);
      mesh.setColorAt(i, col);
    });
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.castShadow = opts.cast ?? true;
    mesh.receiveShadow = true;
    this.group.add(mesh);
    this.sways.push({ mesh, spots });
  }

  /** Grass tufts on the open meadow; the wind bends them on the GPU. */
  private buildGrass(r: Rng): void {
    const spots: { x: number; y: number; z: number; s: number; col: THREE.Color }[] = [];
    const cell = this.map.cell;
    const ground = (x: number, z: number, out: THREE.Color): THREE.Color => {
      const i = Math.min(this.vw - 1, Math.max(0, Math.round((x - this.x0) / this.step)));
      const j = Math.min(this.vh - 1, Math.max(0, Math.round((z - this.z0) / this.step)));
      const o = (j * this.vw + i) * 3;
      return out.setRGB(this.groundCol[o], this.groundCol[o + 1], this.groundCol[o + 2]);
    };
    for (let cy = 0; cy < this.map.h; cy++) {
      for (let cx = 0; cx < this.map.w; cx++) {
        if (!grassCellAllowed(this.map, cx, cy, this.plaza, this.path)) continue;
        const lv = levelAtCell(this.map, cx, cy);
        const c = this.cellCenter(cx, cy);
        // sparse candidates, thinned by the patch mask: soft clumps with bare ground between them
        const candidates = lv >= 2 ? 2 : 3;
        for (let k = 0; k < candidates; k++) {
          const x = c.x + (rand(r) - 0.5) * cell;
          const z = c.z + (rand(r) - 0.5) * cell;
          const keep = rand(r) < grassDensity(x, z, this.seedN);
          const s = (lv >= 2 ? 0.4 : 0.5) + rand(r) * 0.45;
          if (!keep) continue;
          const y = this.baseHeightAt(x, z);
          // keep off slopes and the cliff lip: the ground must be level around the tuft
          const lip = Math.max(y - this.baseHeightAt(x + 0.9, z), y - this.baseHeightAt(x - 0.9, z), y - this.baseHeightAt(x, z + 0.9), y - this.baseHeightAt(x, z - 0.9));
          if (Math.abs(this.baseHeightAt(x + 0.3, z) - y) + Math.abs(this.baseHeightAt(x, z + 0.3) - y) > 0.2 || lip > 0.45) continue;
          // the tuft takes the local ground color, a touch lighter and yellower
          const col = ground(x, z, new THREE.Color());
          col.setRGB(col.r * 1.12, col.g * 1.06, col.b * 0.9);
          spots.push({ x, y, z, s, col });
        }
      }
    }
    if (spots.length === 0) return;
    // a soft clump: seven short, wide blades fanned out from the base
    const blades: THREE.BufferGeometry[] = [];
    for (let b = 0; b < 7; b++) {
      const a = (b / 7) * Math.PI * 2 + b * 0.4;
      const g = new THREE.ConeGeometry(0.07, 0.28 + (b % 3) * 0.06, 4, 1).translate(0, 0.16, 0);
      g.rotateZ(0.3 * Math.cos(a));
      g.rotateX(0.3 * Math.sin(a));
      g.translate(Math.cos(a) * 0.07, 0, Math.sin(a) * 0.07);
      blades.push(g);
    }
    const geo = mergeGeometries(blades)!;
    // base close to the ground tone, tips a little lighter: no dark spikes
    const pa = geo.getAttribute('position') as THREE.BufferAttribute;
    const vc = new Float32Array(pa.count * 3);
    for (let i = 0; i < pa.count; i++) {
      const k = 0.9 + Math.min(1, pa.getY(i) / 0.4) * 0.15;
      vc[i * 3] = k;
      vc[i * 3 + 1] = k;
      vc[i * 3 + 2] = k * 0.96;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(vc, 3));
    const mat = new THREE.MeshLambertNodeMaterial({ vertexColors: true });
    // One wind for the whole meadow: a slow wave travels across the island (phase follows the
    // tuft's world position, not its index), every tuft leans the same way along world x/z.
    // Tufts are not yawed, so local axes equal world axes.
    const phase = instancedBufferAttribute(
      new THREE.InstancedBufferAttribute(new Float32Array(spots.map((p) => p.x * 0.11 + p.z * 0.07)), 1),
    ) as unknown as Node<'float'>;
    const gust = sin(this.uWind.mul(0.9).sub(phase)).mul(0.6).add(sin(this.uWind.mul(1.7).sub(phase.mul(1.9))).mul(0.4));
    // Careful: three applies the instance matrix BEFORE positionNode, so positionLocal is already in
    // world space here. The lean must scale with the blade height from the raw geometry
    // (positionGeometry), otherwise tufts on the upper terraces swing by meters.
    const sway = gust.mul(positionGeometry.y).mul(0.08).mul(this.uWindAmp);
    // far tufts shrink to their base: the distant meadow stays calm instead of shimmering
    const origin = instancedBufferAttribute(
      new THREE.InstancedBufferAttribute(new Float32Array(spots.flatMap((p) => [p.x, p.y - 0.03, p.z])), 3),
    ) as unknown as Node<'vec3'>;
    const far = tslSmoothstep(105, 140, length(vec2(origin.x.sub(cameraPosition.x), origin.z.sub(cameraPosition.z))));
    const grown = origin.add(positionLocal.sub(origin).mul(float(1).sub(far)));
    mat.positionNode = grown.add(vec3(sway, 0, sway.mul(0.4)));
    const mesh = new THREE.InstancedMesh(geo, mat, spots.length);
    spots.forEach((p, i) => {
      this.tmpM.compose(this.tmpV.set(p.x, p.y - 0.03, p.z), this.tmpQ.identity(), this.tmpS.set(p.s, p.s, p.s));
      mesh.setMatrixAt(i, this.tmpM);
      mesh.setColorAt(i, p.col.multiplyScalar(0.94 + rand(r) * 0.12));
    });
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.receiveShadow = true;
    this.group.add(mesh);
  }

  /** A fallen ruin on the meadow: a broken wall and scattered blocks (decoration only). */
  private buildRuin(r: Rng): void {
    const map = this.map;
    const free = (cx: number, cy: number) => {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const lv = levelAtCell(map, cx + dx, cy + dy);
          if (codeAtCell(map, cx + dx, cy + dy) !== T.GRASS || lv !== 1 || this.path.has((cy + dy) * map.w + cx + dx)) return false;
        }
      }
      return true;
    };
    const cands: number[] = [];
    for (let cy = 1; cy < map.h - 1; cy++) for (let cx = 1; cx < map.w - 1; cx++) if (free(cx, cy)) cands.push(cy * map.w + cx);
    if (cands.length === 0) return;
    const pick = cands[Math.floor(rand(r) * cands.length)];
    const c = this.cellCenter(pick % map.w, Math.floor(pick / map.w));
    const blocks: { x: number; z: number; sx: number; sy: number; sz: number; yaw: number; tilt: number }[] = [];
    // a short broken wall: three courses of dwindling length
    for (let row = 0; row < 3; row++) {
      for (let k = 0; k < 4 - row; k++) {
        blocks.push({ x: c.x - 0.8 + k * 0.55 + row * 0.22, z: c.z, sx: 0.5, sy: 0.3, sz: 0.34, yaw: (rand(r) - 0.5) * 0.12, tilt: row * 0.3 });
      }
    }
    for (let k = 0; k < 5; k++) {
      const a = rand(r) * 6.28;
      blocks.push({ x: c.x + Math.cos(a) * (0.7 + rand(r) * 0.5), z: c.z + 0.6 + Math.sin(a) * 0.4, sx: 0.28 + rand(r) * 0.2, sy: 0.2, sz: 0.28 + rand(r) * 0.2, yaw: rand(r) * 6.28, tilt: 0.1 });
    }
    const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial({ color: '#ffffff' }), blocks.length);
    const col = new THREE.Color();
    blocks.forEach((b, i) => {
      const y = this.baseHeightAt(b.x, b.z);
      this.tmpEuler.set((rand(r) - 0.5) * 0.15, b.yaw, (rand(r) - 0.5) * 0.15);
      this.tmpQ.setFromEuler(this.tmpEuler);
      this.tmpM.compose(this.tmpV.set(b.x, y + b.sy / 2 + b.tilt * 0.6, b.z), this.tmpQ, this.tmpS.set(b.sx, b.sy, b.sz));
      mesh.setMatrixAt(i, this.tmpM);
      col.set(PALETTE.stone[i % PALETTE.stone.length]).multiplyScalar(0.8 + rand(r) * 0.3);
      mesh.setColorAt(i, col);
    });
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.group.add(mesh);
  }

  /** Boulders on rock outcrops, scree at the cliff feet, stones in the surf. */
  private buildRocks(r: Rng): void {
    const spots: { x: number; y: number; z: number; s: number; sy: number; yaw: number }[] = [];
    const map = this.map;
    for (let cy = 0; cy < map.h; cy++) {
      for (let cx = 0; cx < map.w; cx++) {
        const code = codeAtCell(map, cx, cy);
        const lv = levelAtCell(map, cx, cy);
        const c = this.cellCenter(cx, cy);
        if (code === T.CLIFF) {
          for (let k = 0; k < 3; k++) {
            const x = c.x + (rand(r) - 0.5) * 1.1;
            const z = c.z + (rand(r) - 0.5) * 1.1;
            spots.push({ x, y: this.baseHeightAt(x, z), z, s: 0.45 + rand(r) * 0.5, sy: 0.6 + rand(r) * 0.5, yaw: rand(r) * 6.28 });
          }
          continue;
        }
        if (code === T.DEEP || code === T.WALL || code === T.HUT || code === T.BUILDING) continue;
        for (const [dx, dy] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ]) {
          // the neighbor towers above: drop some scree at the foot of the cliff
          if (levelAtCell(map, cx + dx, cy + dy) - lv < 1 || codeAtCell(map, cx + dx, cy + dy) === T.DEEP) continue;
          if (rand(r) > (code === T.SHALLOW ? 0.3 : 0.4)) continue;
          const x = c.x + dx * map.cell * 0.28 + (rand(r) - 0.5) * 0.8 * (dy !== 0 ? 1 : 0.3);
          const z = c.z + dy * map.cell * 0.28 + (rand(r) - 0.5) * 0.8 * (dx !== 0 ? 1 : 0.3);
          spots.push({ x, y: this.baseHeightAt(x, z), z, s: 0.25 + rand(r) * 0.45, sy: 0.6 + rand(r) * 0.6, yaw: rand(r) * 6.28 });
        }
      }
    }
    if (spots.length === 0) return;
    const mesh = new THREE.InstancedMesh(buildBoulderGeometry(), new THREE.MeshLambertMaterial({ color: '#ffffff', vertexColors: true }), spots.length);
    const col = new THREE.Color();
    spots.forEach((p, i) => {
      this.tmpEuler.set((rand(r) - 0.5) * 0.6, p.yaw, (rand(r) - 0.5) * 0.6);
      this.tmpQ.setFromEuler(this.tmpEuler);
      this.tmpM.compose(this.tmpV.set(p.x, p.y + p.s * p.sy * 0.3, p.z), this.tmpQ, this.tmpS.set(p.s, p.s * p.sy, p.s * (0.8 + rand(r) * 0.4)));
      mesh.setMatrixAt(i, this.tmpM);
      col.set(PALETTE.stone[Math.floor(rand(r) * PALETTE.stone.length)]).multiplyScalar(0.85 + rand(r) * 0.25);
      mesh.setColorAt(i, col);
    });
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.group.add(mesh);
  }

  /** Trees, bushes and grass move with the wind; still under reduced motion. */
  updateTrees(time: number, reduced: boolean): void {
    this.uWind.value = time;
    this.uWindAmp.value = reduced ? 0 : 1;
    const a = reduced ? 0 : 1;
    for (const { mesh, spots } of this.sways) {
      for (let i = 0; i < spots.length; i++) {
        const p = spots[i];
        // the same slow wave as the grass: neighbors lean together instead of fidgeting
        const w = Math.sin(time * 0.9 - (p.x * 0.11 + p.z * 0.07));
        this.tmpEuler.set(0.012 * a * w, p.yaw, 0.016 * a * w);
        this.tmpQ.setFromEuler(this.tmpEuler);
        this.tmpM.compose(this.tmpV.set(p.x, p.y - 0.1, p.z), this.tmpQ, this.tmpS.set(p.s, p.s * p.sy, p.s));
        mesh.setMatrixAt(i, this.tmpM);
      }
      mesh.instanceMatrix.needsUpdate = true;
    }
    for (let i = 0; i < this.flames.length; i++) {
      const f = this.flames[i];
      const k = 1 + 0.18 * Math.sin(time * 9 + i * 2.1) + 0.1 * Math.sin(time * 15.3 + i);
      f.scale.set(1, reduced ? 1 : k, 1);
    }
  }

  private buildBuildings(r: Rng): void {
    const roofMatFor = (color: string) => new THREE.MeshLambertMaterial({ color, map: this.thatch });
    for (const def of this.map.buildings) {
      const g = new THREE.Group();
      const cx = (def.min.x + def.max.x) / 2;
      const cz = (def.min.y + def.max.y) / 2;
      const w = def.max.x - def.min.x;
      const d = def.max.y - def.min.y;
      // sit on the terrace level at the building's corner cells, not on the noisy center
      g.position.set(cx, this.baseHeightAt(def.min.x + 0.4, def.min.y + 0.4) - 0.05, cz);
      const wood = new THREE.Color(BUILDINGS[def.key].wall);
      const wallMat = new THREE.MeshLambertMaterial({ vertexColors: true });
      const darkMat = new THREE.MeshLambertMaterial({ color: PALETTE.woodDark });
      const roofMat = roofMatFor(BUILDINGS[def.key].roof);
      const barFill = new THREE.Mesh(
        new THREE.PlaneGeometry(2.3, 0.14).translate(1.15, 0, 0),
        new THREE.MeshBasicMaterial({ color: '#6fbf5a', depthTest: false, depthWrite: false, fog: false }),
      );
      const bm: BuildingMesh = {
        group: g,
        roof: [],
        body: [],
        baseColors: [],
        lastHp: -1,
        base: g.position.clone(),
        top: 4,
        roofRest: [],
        cracks: [],
        fire: [],
        bar: new THREE.Group(),
        barFill,
        jolt: 0,
        collapse: -1,
      };
      let fireSpots: [number, number, number][] = [];
      const key: BuildingKey = def.key;
      const add = (m: THREE.Mesh, body: boolean) => {
        m.castShadow = true;
        m.receiveShadow = true;
        g.add(m);
        if (body) bm.body.push(m);
        else bm.roof.push(m);
      };
      if (key === 'lighthouse') {
        const legH = TOWER_DECK_LIFT;
        for (const [px, pz] of [
          [-1, -1],
          [1, -1],
          [-1, 1],
          [1, 1],
        ]) {
          const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.18, legH + 0.3, 7), darkMat);
          leg.position.set(px * 1.0, legH / 2, pz * 1.0);
          leg.rotation.set(pz * 0.06, 0, -px * 0.06);
          add(leg, true);
        }
        // cross braces on every side
        for (let k = 0; k < 4; k++) {
          const brace = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.9, 5), darkMat);
          const ang = (k * Math.PI) / 2;
          brace.position.set(Math.sin(ang) * 1.05, legH * 0.45, Math.cos(ang) * 1.05);
          brace.rotation.set(0, ang, 0.9);
          add(brace, true);
        }
        const deck = new THREE.Mesh(new THREE.BoxGeometry(2.8, 0.22, 2.8), new THREE.MeshLambertMaterial({ color: PALETTE.wood }));
        deck.position.y = legH - 0.1;
        add(deck, true);
        // railing
        for (let k = 0; k < 4; k++) {
          const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.8, 5).rotateZ(Math.PI / 2), darkMat);
          rail.position.set(0, legH + 0.55, 1.35);
          rail.position.applyAxisAngle(THREE.Object3D.DEFAULT_UP, (k * Math.PI) / 2);
          rail.rotation.y = (k * Math.PI) / 2;
          add(rail, true);
        }
        const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.35, 0.45, 10), new THREE.MeshLambertMaterial({ color: LIGHT.bowl }));
        bowl.position.y = legH + 0.25;
        add(bowl, false);
        const fireMat = new THREE.MeshBasicMaterial({ color: LIGHT.ember });
        const glowMat = new THREE.MeshBasicMaterial({ color: LIGHT.emberGlow, transparent: true, opacity: 0.8 });
        for (let k = 0; k < 3; k++) {
          const flame = new THREE.Mesh(new THREE.ConeGeometry(0.28 - k * 0.06, 0.9 + k * 0.25, 6).translate(0, 0.45 + k * 0.12, 0), k === 0 ? fireMat : glowMat);
          flame.position.set((k - 1) * 0.14, legH + 0.42, (k % 2) * 0.12 - 0.06);
          g.add(flame);
          bm.roof.push(flame);
          this.flames.push(flame);
        }
        bm.top = legH + 1.8;
        // when the tower is hurt, fire breaks out on the deck besides the beacon
        fireSpots = [
          [1.1, legH + 0.3, 1.0],
          [-1.0, legH + 0.3, 0.6],
          [0.1, legH + 0.3, -1.1],
        ];
      } else {
        const stilts = key === 'granary' ? 0.7 : 0;
        const wh = key === 'granary' ? 1.5 : 1.8;
        const cw = w - 0.7;
        const cd = d - 0.6;
        if (stilts > 0) {
          for (const px of [-1, 0, 1]) {
            for (const pz of [-1, 1]) {
              const post = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.14, stilts + 0.1, 6), darkMat);
              post.position.set((px * cw) / 2.3, stilts / 2, (pz * cd) / 2.3);
              add(post, true);
            }
          }
        }
        // ridge along the long side
        const along = cw >= cd;
        const walls = new THREE.Mesh(logWalls(along ? cd : cw, along ? cw : cd, wh, wood, r), wallMat);
        walls.position.y = stilts;
        walls.rotation.y = along ? Math.PI / 2 : 0;
        add(walls, true);
        const rise = Math.min(cw, cd) * 0.48;
        const roof = new THREE.Mesh(thatchRoof(along ? cd : cw, along ? cw : cd, rise, 0.35), roofMat);
        roof.position.y = stilts + wh;
        roof.rotation.y = walls.rotation.y;
        add(roof, false);
        const gab = new THREE.Mesh(gables(along ? cd : cw, along ? cw : cd, rise), new THREE.MeshLambertMaterial({ color: wood.clone().multiplyScalar(0.85) }));
        gab.position.y = stilts + wh;
        gab.rotation.y = walls.rotation.y;
        add(gab, false);
        const door = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.15, 0.12), darkMat);
        door.position.set(0, stilts + 0.58, cd / 2 + 0.08);
        add(door, true);
        bm.top = stilts + wh + rise + 0.3;
        // cracks across the logs, shown once the building is hurt
        const crackMat = new THREE.MeshBasicMaterial({ color: '#1c130c' });
        for (let k = 0; k < 8; k++) {
          const crack = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.35 + (k % 3) * 0.2, 0.03), crackMat);
          const front = k < 4;
          const off = ((k % 4) - 1.5) * (front ? cw : cd) * 0.22;
          crack.position.set(front ? off : cw / 2 + 0.12, stilts + 0.45 + (k % 2) * 0.55, front ? cd / 2 + 0.12 : off);
          crack.rotation.set(0, front ? 0 : Math.PI / 2, (k % 2 === 0 ? 1 : -1) * 0.35);
          crack.visible = false;
          g.add(crack);
          bm.cracks.push(crack);
        }
        // fire along the ridge
        const fy = stilts + wh + rise * 0.85;
        fireSpots = [-0.5, 0, 0.5].map((t): [number, number, number] => (along ? [t * cw * 0.55, fy, 0] : [0, fy, t * cd * 0.55]));
        if (key === 'workshop') {
          const amber = new THREE.Mesh(
            new THREE.IcosahedronGeometry(0.2, 0),
            new THREE.MeshLambertMaterial({ color: PALETTE.amber, emissive: new THREE.Color(PALETTE.amberGlow), emissiveIntensity: 1.4 }),
          );
          amber.position.set(0.7, 0.75, cd / 2 + 0.45);
          const bench = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.5, 0.5), darkMat);
          bench.position.set(0.7, 0.25, cd / 2 + 0.45);
          amber.position.y = 0.62;
          add(bench, true);
          g.add(amber);
          bm.roof.push(amber);
        }
      }
      for (const m of bm.body) bm.baseColors.push((m.material as THREE.MeshLambertMaterial).color.clone());
      for (const r of bm.roof) bm.roofRest.push({ y: r.position.y, rx: r.rotation.x, rz: r.rotation.z });
      // flames for the burning stage (hidden until then)
      const flameBright = new THREE.MeshBasicMaterial({ color: '#ffb347' });
      const flameDeep = new THREE.MeshBasicMaterial({ color: '#ff7a1a', transparent: true, opacity: 0.85 });
      fireSpots.forEach((p, i) => {
        const fl = new THREE.Mesh(new THREE.ConeGeometry(0.32, 1.1, 6).translate(0, 0.55, 0), i % 2 === 0 ? flameBright : flameDeep);
        fl.position.set(p[0], p[1], p[2]);
        fl.visible = false;
        g.add(fl);
        bm.fire.push(fl);
      });
      // health bar: a dark back plate and a fill that shrinks, turned to the camera every frame
      const back = new THREE.Mesh(
        new THREE.PlaneGeometry(2.4, 0.24),
        new THREE.MeshBasicMaterial({ color: '#1b1712', transparent: true, opacity: 0.8, depthTest: false, depthWrite: false, fog: false }),
      );
      back.renderOrder = 20;
      barFill.renderOrder = 21;
      barFill.position.set(-1.15, 0, 0.01);
      bm.bar.add(back, barFill);
      bm.bar.position.set(cx, bm.base.y + bm.top + 1.0, cz);
      bm.bar.visible = false;
      this.group.add(bm.bar, g);
      this.buildings.push(bm);
    }

    const hutRoof = roofMatFor(HUT_ROOF);
    const hutWall = new THREE.MeshLambertMaterial({ vertexColors: true });
    const gableMat = new THREE.MeshLambertMaterial({ color: new THREE.Color(HUT_WALLS[0]).multiplyScalar(0.85) });
    const doorMat = new THREE.MeshLambertMaterial({ color: PALETTE.woodDark });
    this.map.huts.forEach((h, i) => {
      const hut = new THREE.Group();
      const y = this.baseHeightAt(h.x, h.y);
      const hw = 1.15;
      const hd = 1.4;
      const wh = 0.85;
      const rise = 0.95;
      const walls = new THREE.Mesh(logWalls(hw, hd, wh, new THREE.Color(HUT_WALLS[i % HUT_WALLS.length]), r), hutWall);
      const roof = new THREE.Mesh(thatchRoof(hw, hd, rise, 0.26), hutRoof);
      roof.position.y = wh;
      const gab = new THREE.Mesh(gables(hw, hd, rise), gableMat);
      gab.position.y = wh;
      const door = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.66, 0.1), doorMat);
      door.position.set(0, 0.33, hd / 2 + 0.07);
      for (const m of [walls, roof, gab, door]) {
        m.castShadow = true;
        m.receiveShadow = true;
        hut.add(m);
      }
      hut.position.set(h.x, y - 0.04, h.y);
      // doors face the plaza center (rally point)
      hut.rotation.y = Math.atan2(this.map.rally.x - h.x, this.map.rally.y - h.y) + (rand(r) - 0.5) * 0.3;
      this.group.add(hut);
    });
  }

  /** A blow on a building makes it shake (the debris and dust come from the effects). */
  onEvents(events: GameEvent[]): void {
    for (const e of events) {
      if (e.t !== 'buildingHit') continue;
      const bm = this.buildings[e.building];
      if (bm) bm.jolt = JOLT_TIME;
    }
  }

  /**
   * Damage you can see: the walls darken and crack, a hurt building shows its health bar, a badly hurt one
   * burns, and at 0 HP the roof drops and the walls squash into a ruin. `dt` is simulation time (frozen
   * while paused); the bars face the camera every frame.
   */
  updateBuildings(s: GameState, dt: number, camera: THREE.Camera, reduced: boolean): void {
    this.clock += dt;
    const ruin = new THREE.Color(PALETTE.ruin);
    s.buildings.forEach((b, i) => {
      const bm = this.buildings[i];
      if (!bm) return;
      const ratio = b.hp / b.maxHp;
      const stage = buildingDamageStage(ratio);
      if (bm.lastHp !== b.hp) {
        const first = bm.lastHp < 0;
        bm.lastHp = b.hp;
        bm.body.forEach((m, k) => {
          const mat = m.material as THREE.MeshLambertMaterial;
          mat.color.copy(bm.baseColors[k]).lerp(ruin, b.hp <= 0 ? 1 : (1 - ratio) * 0.55);
        });
        for (const c of bm.cracks) c.visible = stage >= 1 && stage < 3;
        for (const f of bm.fire) f.visible = stage === 2;
        const showBar = b.hp > 0 && b.hp < b.maxHp;
        bm.bar.visible = showBar;
        bm.barFill.scale.x = Math.max(0.001, ratio);
        (bm.barFill.material as THREE.MeshBasicMaterial).color.set('#6fbf5a').lerp(new THREE.Color('#c4412f'), 1 - Math.min(1, ratio * 1.25));
        if (b.hp <= 0) {
          // a state loaded already destroyed starts as a ruin; a fresh blow starts the collapse
          if (bm.collapse < 0) bm.collapse = first ? COLLAPSE_TIME : 0;
        } else if (bm.collapse >= 0) {
          bm.collapse = -1;
          bm.group.scale.y = 1;
          bm.roof.forEach((r, k) => {
            r.visible = true;
            r.position.y = bm.roofRest[k].y;
            r.rotation.x = bm.roofRest[k].rx;
            r.rotation.z = bm.roofRest[k].rz;
          });
        }
      }
      if (bm.collapse >= 0) {
        bm.collapse = Math.min(COLLAPSE_TIME, bm.collapse + dt);
        const k = smooth(0, 1, bm.collapse / COLLAPSE_TIME);
        bm.roof.forEach((r, n) => {
          const rest = bm.roofRest[n];
          r.position.y = rest.y * (1 - 0.85 * k);
          r.rotation.z = rest.rz + k * (n % 2 === 0 ? 0.6 : -0.5);
          r.rotation.x = rest.rx + k * 0.25;
          r.visible = k < 1;
        });
        bm.group.scale.y = 1 - 0.65 * k;
        bm.bar.visible = false;
        for (const f of bm.fire) f.visible = false;
      }
      // the shake after a blow, decaying
      if (bm.jolt > 0) {
        bm.jolt = Math.max(0, bm.jolt - dt);
        const amp = reduced ? 0 : (bm.jolt / JOLT_TIME) ** 2 * 0.07;
        bm.group.position.set(bm.base.x + Math.sin(this.clock * 70) * amp, bm.base.y, bm.base.z + Math.cos(this.clock * 53) * amp);
        bm.group.rotation.z = Math.sin(this.clock * 45) * amp * 0.25;
        if (bm.jolt === 0) {
          bm.group.position.copy(bm.base);
          bm.group.rotation.z = 0;
        }
      }
      // flames dance; the bar looks at the camera
      if (stage === 2) {
        bm.fire.forEach((f, n) => {
          const k = reduced ? 1 : 1 + 0.2 * Math.sin(this.clock * 9 + n * 2.3) + 0.1 * Math.sin(this.clock * 17 + n);
          f.scale.set(1, k, 1);
        });
      }
      if (bm.bar.visible) bm.bar.quaternion.copy(camera.quaternion);
    });
  }
}
