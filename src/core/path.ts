// 8-directional A* over the map grid + line-of-sight smoothing.

import type { MapData, Vec } from './types.ts';
import { COST_RAMP } from './config.ts';
import { canStep, cellCenter, codeAtCell, isRampLevel, isWalkableCode, terrainCost, worldToCell } from './map.ts';

const SQRT2 = 1.4142135623730951;
const DIRS: [number, number, number][] = [
  [1, 0, 1],
  [-1, 0, 1],
  [0, 1, 1],
  [0, -1, 1],
  [1, 1, SQRT2],
  [1, -1, SQRT2],
  [-1, 1, SQRT2],
  [-1, -1, SQRT2],
];

function walkableCell(map: MapData, cx: number, cy: number): boolean {
  return isWalkableCode(codeAtCell(map, cx, cy));
}

function octile(ax: number, ay: number, bx: number, by: number): number {
  const dx = Math.abs(ax - bx);
  const dy = Math.abs(ay - by);
  return Math.max(dx, dy) - Math.min(dx, dy) + SQRT2 * Math.min(dx, dy);
}

/**
 * Path from `from` to `to` as a list of world points (without the start point, last = `to`).
 * Returns null if the goal is not walkable or is unreachable.
 */
export function findPath(map: MapData, from: Vec, to: Vec): Vec[] | null {
  const { w, h } = map;
  const s = worldToCell(map, from);
  const g = worldToCell(map, to);
  if (!walkableCell(map, g.cx, g.cy)) return null;
  const sx = Math.min(w - 1, Math.max(0, s.cx));
  const sy = Math.min(h - 1, Math.max(0, s.cy));
  if (sx === g.cx && sy === g.cy) return [{ x: to.x, y: to.y }];

  const n = w * h;
  const gScore = new Float64Array(n).fill(Infinity);
  const hScore = new Float64Array(n);
  const parent = new Int32Array(n).fill(-1);
  const state = new Uint8Array(n); // 0 = new, 1 = open, 2 = closed
  // ponytail: open list as an array with a min scan - O(n^2), fine up to ~5k cells; larger maps need a binary heap.
  const open: number[] = [];
  const startIdx = sy * w + sx;
  const goalIdx = g.cy * w + g.cx;
  gScore[startIdx] = 0;
  hScore[startIdx] = octile(sx, sy, g.cx, g.cy);
  open.push(startIdx);
  state[startIdx] = 1;

  while (open.length > 0) {
    let bi = 0;
    let best = open[0];
    for (let i = 1; i < open.length; i++) {
      const c = open[i];
      const fc = gScore[c] + hScore[c];
      const fb = gScore[best] + hScore[best];
      if (fc < fb || (fc === fb && (hScore[c] < hScore[best] || (hScore[c] === hScore[best] && c < best)))) {
        best = c;
        bi = i;
      }
    }
    open[bi] = open[open.length - 1];
    open.pop();
    if (best === goalIdx) break;
    state[best] = 2;
    const cx = best % w;
    const cy = (best - cx) / w;
    for (const [dx, dy, base] of DIRS) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const ni = ny * w + nx;
      if (state[ni] === 2) continue;
      // walkable, no cliff between, no corner cutting
      if (!canStep(map, cx, cy, nx, ny)) continue;
      const cand = gScore[best] + base * (terrainCost(map.terrain[ni]) + (isRampLevel(map.level[ni]) ? COST_RAMP - 1 : 0));
      if (cand < gScore[ni]) {
        gScore[ni] = cand;
        parent[ni] = best;
        if (state[ni] === 0) {
          hScore[ni] = octile(nx, ny, g.cx, g.cy);
          state[ni] = 1;
          open.push(ni);
        }
      }
    }
  }
  if (parent[goalIdx] === -1) return null;

  const cells: number[] = [];
  for (let c = goalIdx; c !== startIdx && c !== -1; c = parent[c]) cells.push(c);
  cells.reverse();
  const pts: Vec[] = cells.map((c) => cellCenter(map, c % w, Math.floor(c / w)));
  pts[pts.length - 1] = { x: to.x, y: to.y };
  return smooth(map, from, pts);
}

/** Line of sight: walkable, no cliff crossed, with side clearance and without crossing costlier terrain than the endpoints. */
export function lineClear(map: MapData, a: Vec, b: Vec): boolean {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l = Math.sqrt(dx * dx + dy * dy);
  if (l < 1e-6) return true;
  const px = (-dy / l) * 0.5;
  const py = (dx / l) * 0.5;
  const ca = worldToCell(map, a);
  const cb = worldToCell(map, b);
  const maxCost = Math.max(terrainCost(codeAtCell(map, ca.cx, ca.cy)), terrainCost(codeAtCell(map, cb.cx, cb.cy)));
  const steps = Math.ceil(l / 0.3);
  for (const k of [0, 1, -1]) {
    let prev = -1;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const c = worldToCell(map, { x: a.x + dx * t + px * k, y: a.y + dy * t + py * k });
      const code = codeAtCell(map, c.cx, c.cy);
      if (!isWalkableCode(code)) return false;
      if (k === 0 && terrainCost(code) > maxCost) return false;
      const idx = c.cy * map.w + c.cx;
      if (prev >= 0 && idx !== prev && !canStep(map, prev % map.w, (prev - (prev % map.w)) / map.w, c.cx, c.cy)) return false;
      prev = idx;
    }
  }
  return true;
}

function smooth(map: MapData, from: Vec, pts: Vec[]): Vec[] {
  const out: Vec[] = [];
  let anchor = from;
  let i = 0;
  while (i < pts.length) {
    let j = pts.length - 1;
    while (j > i && !lineClear(map, anchor, pts[j])) j--;
    out.push(pts[j]);
    anchor = pts[j];
    i = j + 1;
  }
  return out;
}
