// Terraced island generator from a seed. Fixed: the town plateau with the palisade. Randomized:
// the coastline, the side of the lighthouse rock (with its north cove on the other side), the west,
// east and south coves, the three ramps up to the plateau, the south edge of the plateau, forests
// and boulders. Only the seeded RNG, no trigonometry. Every island goes through validateIsland;
// a failed attempt is repeated, and as a last resort the hand-made Wolin map is returned.

import { canStep, codeAtCell, parseMap, worldToCell, WOLIN_LEVELS, WOLIN_MAP } from './map.ts';
import { findPath } from './path.ts';
import { hashSeed, rand, randInt } from './rng.ts';
import type { MapData } from './types.ts';
import { T } from './types.ts';

const W = 40;
const H = 32;
const ATTEMPTS = 8;
// town plateau core (columns PL..PR, rows PT..PB); the palisade sits inside with a margin
const PL = 11;
const PR = 29;
const PT = 3;
const PB = 17;

type Grid = { t: string[][]; l: string[][] };

function blank(): Grid {
  return {
    t: Array.from({ length: H }, () => new Array<string>(W).fill('~')),
    l: Array.from({ length: H }, () => new Array<string>(W).fill('0')),
  };
}

function put(g: Grid, x: number, y: number, ch: string, lv?: string): void {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  g.t[y][x] = ch;
  if (lv !== undefined) g.l[y][x] = lv;
}

function rect(g: Grid, x0: number, y0: number, x1: number, y1: number, ch: string, lv?: string): void {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) put(g, x, y, ch, lv);
}

function town(g: Grid): void {
  rect(g, 13, 5, 27, 5, '#');
  rect(g, 13, 15, 27, 15, '#');
  for (let y = 6; y <= 14; y++) {
    put(g, 13, y, '#');
    put(g, 27, y, '#');
  }
  put(g, 19, 15, '=');
  put(g, 20, 15, '=');
  rect(g, 16, 8, 18, 9, 'A');
  rect(g, 22, 8, 24, 9, 'B');
  put(g, 20, 11, 'R');
  for (const x of [15, 16, 23, 24]) put(g, x, 12, 'h');
  put(g, 17, 13, '2');
  put(g, 20, 13, '1');
  put(g, 23, 13, '3');
}

function island(s: { rng: number }): Grid {
  const g = blank();
  const reserve = new Set<number>();
  const keep = (x0: number, y0: number, x1: number, y1: number) => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) reserve.add(y * W + x);
  };
  const bot = randInt(s, 24, 26);
  // coastline: random walk of the west (L) and east (R) edge, narrowing in the last rows
  const L: number[] = [];
  const R: number[] = [];
  let l = randInt(s, 4, 5);
  let r = randInt(s, 34, 35);
  for (let y = PT; y <= bot; y++) {
    l = Math.min(6, Math.max(3, l + randInt(s, -1, 1)));
    r = Math.min(36, Math.max(34, r + randInt(s, -1, 1)));
    const k = Math.max(0, y - (bot - 3));
    L[y] = l + k * 2;
    R[y] = r - k * 2;
  }
  // bays: short stretches where the sea bites deeper into the meadow (kept clear of the ramp columns)
  for (const west of [true, false]) {
    if (rand(s) < 0.75) {
      const by = randInt(s, 7, bot - 6);
      const n = randInt(s, 3, 4);
      for (let i = 0; i < n; i++) {
        if (west && L[by + i] < 6) L[by + i] = Math.min(6, L[by + i] + 2);
        if (!west && R[by + i] > 34) R[by + i] = Math.max(34, R[by + i] - 2);
      }
    }
  }
  for (let y = PT; y <= bot; y++) rect(g, L[y], y, R[y], y, '_', '1');
  // plateau: fixed core, the south edge wanders by a cell in short segments
  rect(g, PL, PT, PR, 16, '_', '2');
  for (let x = PL; x <= PR; ) {
    const n = randInt(s, 2, 4);
    const pb = PB + randInt(s, -1, 1);
    for (let i = 0; i < n && x <= PR; i++, x++) rect(g, x, 16, x, pb, '_', '2');
  }
  town(g);

  // lighthouse rock on the east or the west, north cove on the other side
  const east = rand(s) < 0.5;
  const mx = (x: number) => (east ? x : 40 - x);
  const x0 = (a: number, b: number) => Math.min(mx(a), mx(b));
  const x1 = (a: number, b: number) => Math.max(mx(a), mx(b));
  rect(g, x0(30, 31), 2, x1(30, 31), 6, '_', '1');
  rect(g, x0(32, 35), 2, x1(32, 35), 6, '_', '3');
  rect(g, x0(33, 34), 3, x1(33, 34), 4, 'C', '3');
  rect(g, x0(30, 31), 4, x1(30, 31), 5, '_', 'c');
  rect(g, x0(30, 31), 2, x1(30, 31), 3, 'T', '1');
  // beyond the rock the cliff drops straight into the sea (no sealed meadow pocket)
  rect(g, x0(36, 39), 2, x1(36, 39), 6, '~', '0');
  // north cove opposite the rock: a broad beach, or a gorge (two-cell beach between rock walls
  // and a two-deep ramp)
  const lanes: { x: number; y: number; ch: string; dir: 'N' | 'S' | 'E' | 'W' }[] = [];
  const stacks: { x: number; y: number }[] = [];
  if (rand(s) < 0.5) {
    rect(g, x0(6, 11), 2, x1(6, 11), 2, '.', '0');
    rect(g, x0(7, 10), 3, x1(7, 10), 3, '_', 'a');
    rect(g, x0(5, 12), 4, x1(5, 12), 4, '_', '1');
    lanes.push({ x: mx(7), y: 1, ch: 'n', dir: 'N' }, { x: mx(10), y: 1, ch: 'N', dir: 'N' });
  } else {
    rect(g, x0(5, 12), 4, x1(5, 12), 4, '_', '1');
    rect(g, x0(8, 9), 2, x1(8, 9), 2, '.', '0');
    rect(g, x0(8, 9), 3, x1(8, 9), 4, '_', 'a');
    for (const wx of [7, 10]) rect(g, mx(wx), 2, mx(wx), 4, 'x', '1');
    lanes.push({ x: mx(8), y: 1, ch: 'n', dir: 'N' }, { x: mx(9), y: 1, ch: 'N', dir: 'N' });
  }
  rect(g, Math.min(mx(PL), mx(PR)), 4, Math.max(mx(PL), mx(PR)), 4, '_', '2');
  keep(x0(5, 12), 2, x1(5, 12), 5);
  keep(x0(29, 32), 3, x1(29, 32), 6);

  // ramps from the meadow up to the plateau: west and south always, east most of the time; each
  // is one or two cells wide and two long
  const rw = randInt(s, 8, 13);
  const wr = randInt(s, 1, 2);
  rect(g, PL - 2, rw, PL - 1, rw + wr - 1, '_', 'b');
  keep(PL - 4, rw - 1, PL, rw + wr);
  const re = randInt(s, 8, 14);
  const er = randInt(s, 1, 2);
  if (rand(s) < 0.7) {
    rect(g, PR + 1, re, PR + 2, re + er - 1, '_', 'b');
    keep(PR, re - 1, PR + 4, re + er);
  }
  const rs = randInt(s, 15, 23);
  const sw = randInt(s, 1, 2);
  rect(g, rs, 16, rs + sw - 1, PB, '_', '2');
  rect(g, rs, PB + 1, rs + sw - 1, PB + 2, '_', 'b');
  keep(rs - 1, PB, rs + sw, PB + 4);
  // the plateau edge must be straight next to the ramp, or it would touch the meadow from the side
  for (const x of [rs - 1, rs + sw]) if (g.l[PB + 1][x] === '2') rect(g, x, PB + 1, x, PB + 2, '_', '1');

  // west and east coves: a standard beach, a wide beach, a gorge (two-cell beach between rock
  // walls) or a beach with a rock stack in the shallows between the two boat runs
  const verticalCove = (west: boolean): void => {
    const kind = (['standard', 'wide', 'gorge', 'rock'] as const)[randInt(s, 0, 3)];
    const hgt = kind === 'wide' || kind === 'rock' ? 7 : kind === 'gorge' ? 4 : 5;
    const y0 = randInt(s, 9, 21 - hgt);
    const rows = Array.from({ length: hgt }, (_, i) => y0 + i);
    // the cove is cut into the land: its edge is the innermost coast cell of those rows
    const edge = west ? Math.max(...rows.map((y) => L[y])) : Math.min(...rows.map((y) => R[y]));
    const dir = west ? 1 : -1; // inland direction
    const depth = kind === 'wide' && (west ? edge <= 5 : edge >= 35) ? 3 : 2;
    const rampX = edge + dir * depth;
    for (const y of rows) {
      if (west) rect(g, 0, y, edge - 1, y, '~', '0');
      else rect(g, edge + 1, y, W - 1, y, '~', '0');
      if (west) L[y] = edge;
      else R[y] = edge;
    }
    const beach = (y: number) => rect(g, Math.min(edge, edge + dir * (depth - 1)), y, Math.max(edge, edge + dir * (depth - 1)), y, '.', '0');
    const landA = y0 + 1;
    let landB = y0 + 3;
    if (kind === 'gorge') {
      landB = y0 + 2;
      beach(y0 + 1);
      beach(y0 + 2);
      put(g, rampX, y0 + 1, '_', 'a');
      put(g, rampX, y0 + 2, '_', 'a');
      for (const wy of [y0, y0 + 3]) rect(g, Math.min(edge, rampX), wy, Math.max(edge, rampX), wy, 'x', '1');
    } else {
      for (const y of rows) beach(y);
      const last = kind === 'standard' ? 3 : 5;
      for (let y = y0 + 1; y <= y0 + last; y++) put(g, rampX, y, '_', 'a');
      if (kind !== 'standard') landB = y0 + 5;
      if (kind === 'rock') stacks.push({ x: edge - dir * 3, y: y0 + 3 });
    }
    keep(Math.min(edge, rampX) - 1, y0 - 1, Math.max(edge, rampX) + 1, y0 + hgt);
    const d = west ? 'W' : 'E';
    lanes.push({ x: edge - dir, y: landA, ch: west ? 'W' : 'E', dir: d }, { x: edge - dir, y: landB, ch: west ? 'w' : 'e', dir: d });
  };
  verticalCove(true);
  verticalCove(false);

  // south cove at the bottom of the island: a standard or a wide beach under the meadow edge
  let beachW = 11;
  if (Math.min(R[bot] - 15, 19) >= Math.max(L[bot] - 1, 9) && rand(s) < 0.5) beachW = 17;
  const xs = randInt(s, Math.max(L[bot] - 1, 9), Math.min(R[bot] - beachW + 2, 19));
  rect(g, xs + 1, bot - 1, xs + beachW - 2, bot - 1, '.', '0');
  rect(g, xs, bot, xs + beachW - 1, bot, '.', '0');
  const rampL = xs + (beachW - 5) / 2;
  rect(g, rampL, bot - 2, rampL + 4, bot - 2, '_', 'a');
  keep(xs, bot - 4, xs + beachW - 1, bot);
  lanes.push({ x: xs + 2, y: bot + 1, ch: 's', dir: 'S' }, { x: xs + beachW - 3, y: bot + 1, ch: 'S', dir: 'S' });

  // an optional knoll (level 2) on the south meadow with its own ramp: a post for the archers
  const meadow = (x: number, y: number) => g.t[y]?.[x] === '_' && g.l[y][x] === '1' && !reserve.has(y * W + x);
  if (rand(s) < 0.75) {
    for (let tries = 0; tries < 8; tries++) {
      const kx = randInt(s, 9, 24);
      const ky = randInt(s, 19, bot - 5);
      const west = rand(s) < 0.5;
      const lo = west ? kx - 3 : kx;
      const hi = west ? kx + 2 : kx + 5;
      let ok = true;
      for (let y = ky - 1; y <= ky + 3; y++) for (let x = lo; x <= hi; x++) if (!meadow(x, y)) ok = false;
      if (!ok) continue;
      rect(g, kx, ky, kx + 2, ky + 2, '_', '2');
      rect(g, west ? kx - 2 : kx + 3, ky + 1, west ? kx - 1 : kx + 4, ky + 1, '_', 'b');
      keep(lo - 1, ky - 2, hi + 1, ky + 4);
      break;
    }
  }

  // forests and boulders on the open meadow, never on ramps or their approaches
  const clumps = randInt(s, 4, 6);
  for (let i = 0; i < clumps; i++) {
    const fx = randInt(s, 4, 33);
    const fy = randInt(s, 4, bot - 2);
    const fw = randInt(s, 2, 3);
    const fh = randInt(s, 2, 3);
    let ok = true;
    for (let y = fy; y < fy + fh; y++) for (let x = fx; x < fx + fw; x++) if (!meadow(x, y)) ok = false;
    if (ok) rect(g, fx, fy, fx + fw - 1, fy + fh - 1, 'T');
  }
  const stones = randInt(s, 2, 4);
  for (let i = 0; i < stones; i++) {
    const x = randInt(s, 4, 35);
    const y = randInt(s, 4, bot - 1);
    if (meadow(x, y)) put(g, x, y, 'x');
  }

  // rock stacks in front of some landings (between the two boat runs of a cove)
  for (const st of stacks) if (st.x >= 1 && st.x <= W - 2) put(g, st.x, st.y, 'x', '1');
  // offshore islets: pillars of rock well away from the land and clear of every boat run
  const onRun = (x: number, y: number): boolean =>
    lanes.some((ln) =>
      ln.dir === 'N' ? Math.abs(x - ln.x) <= 2 && y <= ln.y + 1
      : ln.dir === 'S' ? Math.abs(x - ln.x) <= 2 && y >= ln.y - 1
      : ln.dir === 'W' ? Math.abs(y - ln.y) <= 2 && x <= ln.x + 1
      : Math.abs(y - ln.y) <= 2 && x >= ln.x - 1,
    );
  const islets = randInt(s, 0, 4);
  for (let i = 0; i < islets; i++) {
    for (let tries = 0; tries < 30; tries++) {
      const ix = randInt(s, 2, W - 4);
      const iy = randInt(s, 2, H - 4);
      const iw = randInt(s, 1, 2);
      let ok = true;
      for (let y = iy - 2; y <= iy + 3 && ok; y++) {
        for (let x = ix - 2; x <= ix + iw + 1; x++) {
          if (g.t[y]?.[x] !== undefined && g.t[y][x] !== '~') ok = false;
        }
      }
      for (let y = iy; y <= iy + 1; y++) for (let x = ix; x < ix + iw; x++) if (onRun(x, y)) ok = false;
      if (!ok) continue;
      rect(g, ix, iy, ix + iw - 1, iy + 1, 'x', '1');
      break;
    }
  }

  // shallows around the land, then the landing spots
  const land = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H && g.t[y][x] !== '~' && g.t[y][x] !== ':';
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (g.t[y][x] !== '~') continue;
      let near = false;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (land(x + dx, y + dy)) near = true;
      if (near) put(g, x, y, ':', '0');
    }
  }
  rect(g, xs - 2, bot + 1, xs + beachW + 1, bot + 1, ':', '0');
  for (const ln of lanes) put(g, ln.x, ln.y, ln.ch, '0');
  return g;
}

/**
 * Checks that an island is playable: three buildings and squads, two landing spots per direction,
 * a straight boat run over water, every beach reaches the town and every building, and all land
 * forms one connected walk (no terrace sealed off by cliffs).
 */
export function validateIsland(map: MapData, why: string[] = []): boolean {
  const fail = (r: string) => {
    why.push(r);
    return false;
  };
  if (map.buildings.length !== 3 || map.starts.length !== 3) return fail('buildings or starts');
  for (const b of map.buildings) if (b.approach.length === 0 || findPath(map, map.rally, b.approach[0]) === null) return fail('reach ' + b.key);
  for (const [dir, lanes] of Object.entries(map.lanes)) {
    if (lanes.length !== 2) return fail('lanes ' + dir);
    for (const l of lanes) {
      if (codeAtCell(map, worldToCell(map, l.shore).cx, worldToCell(map, l.shore).cy) !== T.BEACH) return fail('shore ' + dir);
      if (findPath(map, l.shore, map.rally) === null) return fail('path ' + dir);
      const dx = l.landing.x - l.start.x;
      const dy = l.landing.y - l.start.y;
      for (let i = 0; i <= 80; i++) {
        const c = worldToCell(map, { x: l.start.x + (dx * i) / 80, y: l.start.y + (dy * i) / 80 });
        const code = codeAtCell(map, c.cx, c.cy);
        if (code !== T.DEEP && code !== T.SHALLOW) return fail(`boat ${dir} ${c.cx},${c.cy}`);
        // a boat is wider than its line: rocks may not stand right beside the run either
        const sideX = Math.abs(dx) < Math.abs(dy) ? map.cell : 0;
        const sideY = sideX === 0 ? map.cell : 0;
        for (const k of [-1, 1]) {
          const q = worldToCell(map, { x: l.start.x + (dx * i) / 80 + k * sideX, y: l.start.y + (dy * i) / 80 + k * sideY });
          const qc = codeAtCell(map, q.cx, q.cy);
          if (qc !== T.DEEP && qc !== T.SHALLOW) return fail(`boat side ${dir} ${q.cx},${q.cy}`);
        }
      }
    }
  }
  // every land cell must be reachable from the rally point
  const seen = reachable(map);
  for (let i = 0; i < map.w * map.h; i++) {
    const code = map.terrain[i];
    const landCell = code === T.BEACH || code === T.GRASS || code === T.GATE || code === T.BUILDING;
    if (landCell && !seen[i]) return fail(`sealed ${i % map.w},${Math.floor(i / map.w)}`);
  }
  return rampsLinked(map, fail);
}

/** Cells reachable from the rally point over legal steps. */
function reachable(map: MapData): Uint8Array {
  const r = worldToCell(map, map.rally);
  const seen = new Uint8Array(map.w * map.h);
  const stack = [r.cy * map.w + r.cx];
  seen[stack[0]] = 1;
  while (stack.length > 0) {
    const i = stack.pop()!;
    const cx = i % map.w;
    const cy = (i - cx) / map.w;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = cx + dx;
        const ny = cy + dy;
        if ((dx === 0 && dy === 0) || nx < 0 || ny < 0 || nx >= map.w || ny >= map.h) continue;
        const ni = ny * map.w + nx;
        if (seen[ni] || !canStep(map, cx, cy, nx, ny)) continue;
        seen[ni] = 1;
        stack.push(ni);
      }
    }
  }
  return seen;
}

/** Every ramp (a connected group of ramp cells) must touch both the lower and the upper terrace. */
function rampsLinked(map: MapData, fail: (r: string) => boolean): boolean {
  const done = new Uint8Array(map.w * map.h);
  const side: [number, number][] = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];
  for (let i = 0; i < map.w * map.h; i++) {
    const v = map.level[i];
    if (v === Math.floor(v) || done[i] || !isWalk(map, i)) continue;
    let lo = false;
    let hi = false;
    const group = [i];
    done[i] = 1;
    while (group.length > 0) {
      const g = group.pop()!;
      const cx = g % map.w;
      const cy = (g - cx) / map.w;
      for (const [dx, dy] of side) {
        if (!canStep(map, cx, cy, cx + dx, cy + dy)) continue;
        const ni = (cy + dy) * map.w + cx + dx;
        const n = map.level[ni];
        if (n < v) lo = true;
        else if (n > v) hi = true;
        else if (!done[ni]) {
          done[ni] = 1;
          group.push(ni);
        }
      }
    }
    if (!lo || !hi) return fail(`ramp ${i % map.w},${Math.floor(i / map.w)}`);
  }
  return true;
}

/** First attempt without validation or fallback (debugging aid). */
export function generateIslandRaw(seed: string): MapData {
  const g = island({ rng: hashSeed('island-' + seed) | 0 });
  return parseMap(
    g.t.map((r) => r.join('')),
    g.l.map((r) => r.join('')),
  );
}

function isWalk(map: MapData, i: number): boolean {
  const c = map.terrain[i];
  return c === T.GRASS || c === T.BEACH || c === T.SHALLOW || c === T.GATE || c === T.BUILDING;
}

/** Island from a seed: the same seed gives the same island. */
export function generateIsland(seed: string): MapData {
  const s = { rng: hashSeed('island-' + seed) | 0 };
  for (let i = 0; i < ATTEMPTS; i++) {
    const g = island(s);
    const map = parseMap(
      g.t.map((r) => r.join('')),
      g.l.map((r) => r.join('')),
    );
    // stray meadow cells cut off by cliffs and forest grow into thicket
    const seen = reachable(map);
    for (let k = 0; k < map.w * map.h; k++) if (map.terrain[k] === T.GRASS && !seen[k]) map.terrain[k] = T.FOREST;
    if (validateIsland(map)) return map;
  }
  return parseMap(WOLIN_MAP, WOLIN_LEVELS);
}
