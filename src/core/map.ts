// Wolin map stored as ASCII (terrain layer + terrace level layer), plus the parser and terrain queries.
// Terrain legend:
//   ~ deep water   : shallows   . beach   _ grass   x boulders   T forest
//   # palisade     = gate       h hut     A Granary   B Amber workshop   C Lighthouse
//   R rally point  1/2/3 start of guard/archers/spearmen
//   S/s E/e W/w N/n  boat landing spots (shallows) for each direction, two variants each
// Level legend: 0-3 flat terrace level, a/b/c ramp linking levels 0-1, 1-2, 2-3.
// Cells whose levels differ by more than half a level are separated by a cliff.

import { BOAT_SPAWN_DIST, CELL, COST_SHALLOW } from './config.ts';
import type { BuildingDef, BuildingKey, Lane, LaneDir, MapData, SquadStart, SquadType, Vec } from './types.ts';
import { T } from './types.ts';
import { add, scale } from './vec.ts';

export const WOLIN_MAP: string[] = [
  '~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~',
  '~~~~~~::nN::~~~~~~~~~~~~~~~~~::::::::~~~',
  '~~~~~~:x..x:::::::::::::::::::TT____:~~~',
  '~~~~~~:x__x___________________TT_CC_:~~~',
  '~~~::::x__x______________________CC_:~~~',
  '~~~:__TT_____###############________:~~~',
  '~~~:__TT_____#_____________#________:~~~',
  '~::::________#_____________#________:~~~',
  '~:xx::_______#__AAA___BBB__#____TTT_::::',
  '~:xx::_______#__AAA___BBB__#____TTT_:xx:',
  '~:::...______#_____________#___xTTT_:xx:',
  '~~~W...______#______R______#________::::',
  '~~~:...______#_hh______hh__#________:~~~',
  '~~~:...______#___2__1__3___#_______::~~~',
  '~~~:...__x___#_____________#_______:~~~~',
  '~~~w...______######==#######_______:~~~~',
  '~~~:...____________________________::~~~',
  '~~~:______________________________..E~~~',
  '~~~:______________________________..:::~',
  '~~~:__TT____x_____________________..:x:~',
  '::::__TT_____________________x____..:::~',
  ':xx:__TT_____TT___________________..e~~~',
  ':xx::________TT________________::::::~~~',
  ':::::::_______________________::~~~~~~~~',
  '~~~~~~:::::......_____......:::~~~~~~~~~',
  '~~~~~~~~~~:.................:~~~~~~~~~~~',
  '~~~~~~~~~~:.................:~~~~~~~~~~~',
  '~~~~~~~~~~::::::s:::::S::::::~~~~~~~~~~~',
  '~~~~~~~~~~~~~~~~~~~~~~~~~~~~~::::~~~~~~~',
  '~~~~~~~~~~~~~~~~~~~~~~~~~~~~~:xx:~~~~~~~',
  '~~~~~~~~~~~~~~~~~~~~~~~~~~~~~:xx:~~~~~~~',
  '~~~~~~~~~~~~~~~~~~~~~~~~~~~~~::::~~~~~~~',
];

/** Terraces: the town plateau (2) with ramps west, south and east, the lighthouse rock (3)
 * reached only from the plateau, the meadow (1), and beaches (0) only in the four coves. */
export const WOLIN_LEVELS: string[] = [
  '0000000000000000000000000000000000000000',
  '0000000000000000000000000000000000000000',
  '0000000100100000000000000000001133330000',
  '00000001aa122222222222222222221133330000',
  '00000001aa12222222222222222222cc33330000',
  '000011111112222222222222222222cc33330000',
  '0000111111122222222222222222221133330000',
  '0000011111122222222222222222221111110000',
  '0011001111122222222222222222221111110000',
  '001100111bb22222222222222222221111110110',
  '000000011bb22222222222222222221111110110',
  '0000000a11122222222222222222221111110000',
  '0000000a11122222222222222222221111110000',
  '0000000a1112222222222222222222bb11100000',
  '0000000a11122222222222222222221111100000',
  '0000000a11122222222222222222221111100000',
  '0000000111122222222222222222221111100000',
  '0000111111122222222222222222221111000000',
  '0000111111111111111bb111111111111a000000',
  '0000111111111111111bb111111111111a000100',
  '000011111111111111111111222111111a000000',
  '0110111111111111111111bb2221111111000000',
  '0110011111111111111111112221111000000000',
  '0000000111111111111111111111110000000000',
  '00000000000000000aaaaa000000000000000000',
  '0000000000000000000000000000000000000000',
  '0000000000000000000000000000000000000000',
  '0000000000000000000000000000000000000000',
  '0000000000000000000000000000000000000000',
  '0000000000000000000000000000001100000000',
  '0000000000000000000000000000001100000000',
  '0000000000000000000000000000000000000000',
];

const BASE_CODES: Record<string, number> = {
  '~': T.DEEP,
  ':': T.SHALLOW,
  '.': T.BEACH,
  _: T.GRASS,
  x: T.CLIFF,
  T: T.FOREST,
  '#': T.WALL,
  '=': T.GATE,
  h: T.HUT,
  A: T.BUILDING,
  B: T.BUILDING,
  C: T.BUILDING,
  R: T.GRASS,
  '1': T.GRASS,
  '2': T.GRASS,
  '3': T.GRASS,
};

const LEVEL_CHARS: Record<string, number> = { '0': 0, '1': 1, '2': 2, '3': 3, a: 0.5, b: 1.5, c: 2.5 };

const LANE_CHARS: Record<string, LaneDir> = { S: 'S', s: 'S', E: 'E', e: 'E', W: 'W', w: 'W', N: 'N', n: 'N' };
const LANE_OUT: Record<LaneDir, Vec> = { S: { x: 0, y: 1 }, E: { x: 1, y: 0 }, W: { x: -1, y: 0 }, N: { x: 0, y: -1 } };
const BUILDING_CHARS: Record<string, BuildingKey> = {
  A: 'granary',
  B: 'workshop',
  C: 'lighthouse',
};
const START_CHARS: Record<string, SquadType> = { '1': 'guard', '2': 'archers', '3': 'spearmen' };

export function isWalkableCode(code: number): boolean {
  return (
    code === T.SHALLOW ||
    code === T.BEACH ||
    code === T.GRASS ||
    code === T.GATE ||
    code === T.BUILDING
  );
}

/** Cost of entering a cell for A* (terrain only; ramps add COST_RAMP in path.ts). */
export function terrainCost(code: number): number {
  if (code === T.SHALLOW) return COST_SHALLOW;
  if (code === T.BUILDING) return 2.5;
  return 1;
}

export function cellCenter(map: MapData, cx: number, cy: number): Vec {
  return { x: (cx + 0.5) * map.cell - (map.w * map.cell) / 2, y: (cy + 0.5) * map.cell - (map.h * map.cell) / 2 };
}

export function worldToCell(map: MapData, p: Vec): { cx: number; cy: number } {
  return {
    cx: Math.floor((p.x + (map.w * map.cell) / 2) / map.cell),
    cy: Math.floor((p.y + (map.h * map.cell) / 2) / map.cell),
  };
}

export function codeAtCell(map: MapData, cx: number, cy: number): number {
  if (cx < 0 || cy < 0 || cx >= map.w || cy >= map.h) return T.DEEP;
  return map.terrain[cy * map.w + cx];
}

/** Terrace level of a cell (ramps are k + 0.5); 0 outside the map. */
export function levelAtCell(map: MapData, cx: number, cy: number): number {
  if (cx < 0 || cy < 0 || cx >= map.w || cy >= map.h) return 0;
  return map.level[cy * map.w + cx];
}

export function isRampLevel(level: number): boolean {
  return level !== Math.floor(level);
}

export function terrainAt(map: MapData, p: Vec): number {
  const { cx, cy } = worldToCell(map, p);
  return codeAtCell(map, cx, cy);
}

export function isWalkable(map: MapData, p: Vec): boolean {
  return isWalkableCode(terrainAt(map, p));
}

/**
 * Whether a walker may step from cell a to the neighboring cell b (8-neighborhood).
 * b must be walkable and no cliff may lie between them (levels differ by at most a half,
 * so only ramps link terraces). A diagonal step also needs both side steps, so nobody
 * slips past a cliff corner or a wall corner.
 */
export function canStep(map: MapData, ax: number, ay: number, bx: number, by: number): boolean {
  if (!isWalkableCode(codeAtCell(map, bx, by))) return false;
  if (ax !== bx && ay !== by) {
    return (
      canStep(map, ax, ay, bx, ay) && canStep(map, bx, ay, bx, by) && canStep(map, ax, ay, ax, by) && canStep(map, ax, by, bx, by)
    );
  }
  return Math.abs(levelAtCell(map, ax, ay) - levelAtCell(map, bx, by)) <= 0.5;
}

/** Straight walk from p to q: every cell crossed is walkable and no cliff is crossed. */
export function passable(map: MapData, p: Vec, q: Vec): boolean {
  if (!isWalkable(map, q)) return false;
  const dx = q.x - p.x;
  const dy = q.y - p.y;
  const n = Math.max(1, Math.ceil(Math.sqrt(dx * dx + dy * dy) / 0.3));
  let { cx, cy } = worldToCell(map, p);
  for (let i = 1; i <= n; i++) {
    const c = worldToCell(map, { x: p.x + (dx * i) / n, y: p.y + (dy * i) / n });
    if (c.cx === cx && c.cy === cy) continue;
    if (!canStep(map, cx, cy, c.cx, c.cy)) return false;
    cx = c.cx;
    cy = c.cy;
  }
  return true;
}

/** Height level for combat: the terrace (ramps count as the lower one), +1 on a building (tower deck). */
export function heightLevel(map: MapData, p: Vec): number {
  const { cx, cy } = worldToCell(map, p);
  return Math.floor(levelAtCell(map, cx, cy)) + (codeAtCell(map, cx, cy) === T.BUILDING ? 1 : 0);
}

/** Beach or shallows: spearmen have the edge over a landing here. */
export function isShore(map: MapData, p: Vec): boolean {
  const c = terrainAt(map, p);
  return c === T.BEACH || c === T.SHALLOW;
}

/** Nearest walkable point (cell center) if p itself is not walkable. */
export function nearestWalkable(map: MapData, p: Vec, maxCells = 8): Vec | null {
  if (isWalkable(map, p)) return { x: p.x, y: p.y };
  const { cx, cy } = worldToCell(map, p);
  let best: Vec | null = null;
  let bestD = Infinity;
  for (let dy = -maxCells; dy <= maxCells; dy++) {
    for (let dx = -maxCells; dx <= maxCells; dx++) {
      const x = cx + dx;
      const y = cy + dy;
      if (!isWalkableCode(codeAtCell(map, x, y))) continue;
      const c = cellCenter(map, x, y);
      const d = (c.x - p.x) * (c.x - p.x) + (c.y - p.y) * (c.y - p.y);
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
  }
  return best;
}

/** Clamps a point to the map bounds. */
export function clampToMap(map: MapData, p: Vec): Vec {
  const hw = (map.w * map.cell) / 2 - 0.01;
  const hh = (map.h * map.cell) / 2 - 0.01;
  return { x: Math.min(hw, Math.max(-hw, p.x)), y: Math.min(hh, Math.max(-hh, p.y)) };
}

/** Parses the terrain rows and the optional level rows (missing = everything on level 0). */
export function parseMap(rows: string[], levels?: string[], cell = CELL): MapData {
  const h = rows.length;
  const w = rows[0]?.length ?? 0;
  if (h === 0 || w === 0) throw new Error('Empty map');
  if (levels && levels.length !== h) throw new Error(`Level layer has ${levels.length} rows, expected ${h}`);
  const terrain: number[] = new Array(w * h);
  const level: number[] = new Array(w * h).fill(0);
  const buildingCells = new Map<string, { cx: number; cy: number }[]>();
  const landings: { dir: LaneDir; cx: number; cy: number }[] = [];
  const huts: { cx: number; cy: number }[] = [];
  const starts: { type: SquadType; cx: number; cy: number }[] = [];
  let rally: { cx: number; cy: number } | null = null;

  for (let cy = 0; cy < h; cy++) {
    const row = rows[cy];
    if (row.length !== w) throw new Error(`Row ${cy} has length ${row.length}, expected ${w}`);
    if (levels) {
      const lr = levels[cy];
      if (lr.length !== w) throw new Error(`Level row ${cy} has length ${lr.length}, expected ${w}`);
      for (let cx = 0; cx < w; cx++) {
        const v = LEVEL_CHARS[lr[cx]];
        if (v === undefined) throw new Error(`Unknown level character '${lr[cx]}' (${cx},${cy})`);
        level[cy * w + cx] = v;
      }
    }
    for (let cx = 0; cx < w; cx++) {
      const ch = row[cx];
      const lane = LANE_CHARS[ch];
      if (lane) {
        terrain[cy * w + cx] = T.SHALLOW;
        landings.push({ dir: lane, cx, cy });
        continue;
      }
      const code = BASE_CODES[ch];
      if (code === undefined) throw new Error(`Unknown map character '${ch}' (${cx},${cy})`);
      terrain[cy * w + cx] = code;
      if (BUILDING_CHARS[ch]) {
        const list = buildingCells.get(ch) ?? [];
        list.push({ cx, cy });
        buildingCells.set(ch, list);
      } else if (ch === 'h') huts.push({ cx, cy });
      else if (ch === 'R') rally = { cx, cy };
      else if (START_CHARS[ch]) starts.push({ type: START_CHARS[ch], cx, cy });
    }
  }

  const map: MapData = {
    w,
    h,
    cell,
    terrain,
    level,
    buildings: [],
    huts: [],
    rally: { x: 0, y: 0 },
    starts: [],
    lanes: { S: [], E: [], W: [], N: [] },
  };
  map.huts = huts.map((c) => cellCenter(map, c.cx, c.cy));
  map.rally = rally ? cellCenter(map, rally.cx, rally.cy) : { x: 0, y: 0 };
  map.starts = starts
    .sort((a, b) => a.type.localeCompare(b.type))
    .map((s): SquadStart => ({ type: s.type, pos: cellCenter(map, s.cx, s.cy), facing: { x: 0, y: 1 } }));

  for (const ch of ['A', 'B', 'C']) {
    const cells = buildingCells.get(ch);
    if (!cells) continue;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const c of cells) {
      minX = Math.min(minX, c.cx);
      minY = Math.min(minY, c.cy);
      maxX = Math.max(maxX, c.cx);
      maxY = Math.max(maxY, c.cy);
    }
    // approach: the walkable ring around the building on its own terrace
    const own = levelAtCell(map, minX, minY);
    const approach: Vec[] = [];
    for (let cy = minY - 1; cy <= maxY + 1; cy++) {
      for (let cx = minX - 1; cx <= maxX + 1; cx++) {
        const inside = cx >= minX && cx <= maxX && cy >= minY && cy <= maxY;
        if (!inside && isWalkableCode(codeAtCell(map, cx, cy)) && Math.abs(levelAtCell(map, cx, cy) - own) <= 0.5)
          approach.push(cellCenter(map, cx, cy));
      }
    }
    const lo = cellCenter(map, minX, minY);
    const hi = cellCenter(map, maxX, maxY);
    const def: BuildingDef = {
      key: BUILDING_CHARS[ch],
      min: { x: lo.x - cell / 2, y: lo.y - cell / 2 },
      max: { x: hi.x + cell / 2, y: hi.y + cell / 2 },
      approach,
    };
    map.buildings.push(def);
  }

  for (const l of landings) {
    const landing = cellCenter(map, l.cx, l.cy);
    let shore = landing;
    let best = Infinity;
    for (let cy = 0; cy < h; cy++) {
      for (let cx = 0; cx < w; cx++) {
        if (terrain[cy * w + cx] !== T.BEACH) continue;
        const d = (cx - l.cx) * (cx - l.cx) + (cy - l.cy) * (cy - l.cy);
        if (d < best) {
          best = d;
          shore = cellCenter(map, cx, cy);
        }
      }
    }
    const lane: Lane = { dir: l.dir, landing, shore, start: add(landing, scale(LANE_OUT[l.dir], BOAT_SPAWN_DIST)) };
    map.lanes[l.dir].push(lane);
  }
  return map;
}

let wolinCache: MapData | null = null;
/** Parsed Wolin map (a copy, because game state is mutable). */
export function wolinMap(): MapData {
  if (!wolinCache) wolinCache = parseMap(WOLIN_MAP, WOLIN_LEVELS);
  return structuredClone(wolinCache);
}
