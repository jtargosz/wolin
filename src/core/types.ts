// Game state is plain data (JSON): no classes or functions. A snapshot is structuredClone.
// World coordinates: Vec.x = east, Vec.y = south (Three.js: x and z). 1 unit = 1 m.

export interface Vec {
  x: number;
  y: number;
}

export type Side = 'player' | 'enemy';
export type SquadType = 'guard' | 'archers' | 'spearmen' | 'raiders' | 'raiderArchers' | 'armored';
export type Trait = 'fast' | 'strong' | 'careful' | 'calm' | 'none';
export type LaneDir = 'S' | 'E' | 'W' | 'N';
export type BuildingKey = 'granary' | 'workshop' | 'lighthouse';

/** Terrain codes in MapData.terrain. */
export const T = {
  DEEP: 0,
  SHALLOW: 1,
  BEACH: 2,
  GRASS: 3,
  FOREST: 5,
  WALL: 6,
  GATE: 7,
  BUILDING: 8,
  HUT: 9,
  CLIFF: 11, // boulders: rock outcrops that block movement
} as const;
export type TerrainCode = (typeof T)[keyof typeof T];

export interface Lane {
  dir: LaneDir;
  start: Vec; // far out at sea (in the fog)
  landing: Vec; // shallows where the boat beaches
  shore: Vec; // beach where the landing party gathers
}

export interface BuildingDef {
  key: BuildingKey;
  min: Vec; // rectangle in world space
  max: Vec;
  approach: Vec[]; // walkable points along the edge
}

export interface SquadStart {
  type: SquadType;
  pos: Vec;
  facing: Vec;
}

export interface MapData {
  w: number;
  h: number;
  cell: number;
  terrain: number[]; // w*h, TerrainCode
  /** w*h terrace level: 0 sea and beaches, 1 meadow, 2 plateau, 3 rock. A ramp is
   * stored as k + 0.5 and links levels k and k + 1. Neighbors whose levels differ
   * by more than 0.5 are separated by a cliff. */
  level: number[];
  buildings: BuildingDef[];
  huts: Vec[]; // centers of decorative huts (cells)
  rally: Vec;
  starts: SquadStart[];
  lanes: Record<LaneDir, Lane[]>;
}

export interface Warrior {
  id: number;
  name: string;
  trait: Trait;
  hp: number;
  maxHp: number;
  alive: boolean;
  aboard: boolean; // still in the boat
}

export type SquadMode = 'ready' | 'landing' | 'routing' | 'gone' | 'dead';

export type Order =
  | { kind: 'hold' }
  | { kind: 'move'; to: Vec; facing: Vec | null }
  | { kind: 'attack'; target: number };

export interface Squad {
  id: number;
  side: Side;
  type: SquadType;
  pos: Vec;
  vel: Vec;
  facing: Vec;
  holdFacing: Vec;
  home: Vec;
  mode: SquadMode;
  order: Order;
  warriors: Warrior[];
  morale: number;
  maxHp: number; // total HP of a full squad
  // movement
  goal: Vec | null;
  path: Vec[];
  pathIdx: number;
  pathGoal: Vec | null;
  repathTick: number;
  progressDist: number;
  progressTick: number;
  ghostUntil: number;
  // combat
  targetId: number; // current target (squad), -1 = none
  buildingTarget: number; // building index (raiders), -1 = none
  preferredBuilding: number;
  atBuilding: boolean;
  attackCd: number;
  contact: boolean;
  lastCombatTick: number;
  // abilities
  shieldUntil: number;
  shieldDir: Vec;
  shieldReady: number;
  // raiders
  boatId: number;
  /** Tick when the squad started waiting at a ramp foot for its wave (-1 = not waiting). */
  waitSince: number;
  /** Terrace level at which the squad was released from waiting (-1 = none). */
  waitLevel: number;
}

export type BoatState = 'waiting' | 'sailing' | 'landed' | 'leaving' | 'gone';

export interface Boat {
  id: number;
  wave: number;
  dir: LaneDir;
  state: BoatState;
  spawnTick: number;
  start: Vec;
  landing: Vec;
  shore: Vec;
  pos: Vec;
  heading: Vec;
  speed: number;
  crew: number;
  kind: SquadType; // crew class: raiders | raiderArchers | armored
  squadId: number;
  nextDisembark: number;
  leaveTick: number;
  preferredBuilding: number;
}

export interface Building {
  key: BuildingKey;
  hp: number;
  maxHp: number;
}

export interface Projectile {
  id: number;
  from: Vec;
  to: Vec;
  source: number;
  target: number;
  launchTick: number;
  hitTick: number;
  dmg: number;
  flank: Flank;
}

export type Flank = 'front' | 'side' | 'back';

export interface BoatSpec {
  dir: LaneDir;
  crew: number;
  kind?: SquadType; // defaults to raiders
  delay: number; // seconds from the start of the wave
  target?: BuildingKey;
}

export interface WaveSpec {
  boats: BoatSpec[];
}

export type Phase = 'prep' | 'wave' | 'won' | 'lost';

export type Difficulty = 'easy' | 'normal' | 'hard' | 'brutal';

export interface Rules {
  permadeath: boolean;
  prepTicks: number;
  breakTicks: number;
}

export interface GameState {
  seed: string;
  tick: number;
  rng: number;
  nextId: number;
  map: MapData;
  rules: Rules;
  difficulty: Difficulty;
  waves: WaveSpec[];
  phase: Phase;
  waveIndex: number; // current or nearest wave (0-based)
  phaseEnd: number; // tick of the automatic wave start (prep)
  squads: Squad[];
  boats: Boat[];
  buildings: Building[];
  projectiles: Projectile[];
  hornReady: number;
  fallen: { name: string; type: SquadType; wave: number }[];
}

export type Command =
  | { kind: 'move'; squadId: number; to: Vec; facing?: Vec | null }
  | { kind: 'attack'; squadId: number; targetId: number }
  | { kind: 'shieldWall'; squadId: number }
  | { kind: 'horn'; at: Vec }
  | { kind: 'callWave' };

export type GameEvent =
  | { t: 'wavePrep'; wave: number }
  | { t: 'waveStarted'; wave: number }
  | { t: 'boatSpawned'; boatId: number; dir: LaneDir; at: Vec; landing: Vec }
  | { t: 'boatLanded'; boatId: number; at: Vec }
  | { t: 'disembark'; boatId: number; squadId: number; count: number; at: Vec }
  | { t: 'boatLeaving'; boatId: number }
  | { t: 'hit'; attacker: number; target: number; amount: number; flank: Flank; ranged: boolean; at: Vec }
  | { t: 'shot'; squadId: number; at: Vec }
  | { t: 'fell'; squadId: number; warriorId: number; side: Side; at: Vec }
  | { t: 'squadLost'; squadId: number; side: Side }
  | { t: 'routed'; squadId: number; side: Side; at: Vec }
  | { t: 'rallied'; squadId: number; at: Vec }
  | { t: 'boarded'; squadId: number; boatId: number }
  | { t: 'pushed'; squadId: number; at: Vec }
  | { t: 'buildingHit'; building: number; at: Vec }
  | { t: 'buildingDestroyed'; building: number; at: Vec }
  | { t: 'waveCleared'; wave: number }
  | { t: 'outcome'; result: 'won' | 'lost' };
