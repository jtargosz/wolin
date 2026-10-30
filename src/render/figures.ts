// Low-poly figures with distinct silhouettes. Geometries and materials are shared between figures.
// Rounded segments and smooth shading keep edges clean at typical camera distance.
// Guard: big round shield, conical helmet. Archer: tall hood, bow, quiver.
// Spearman: long spear (~1.6x body height), flat cap. Raider: domed helmet, axe.
//
// Draw calls matter more than triangles here: the parts of one animated group (torso, head,
// shield, weapon) are baked into a single vertex-colored geometry per squad type, so a figure
// costs three or four meshes instead of up to ten.

import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { SquadType } from '../core/types.ts';
import { FIGURE, SQUAD_COLORS } from './palette.ts';

export { SQUAD_COLORS };

const geo = {
  body: new THREE.CylinderGeometry(0.19, 0.3, 0.72, 10).translate(0, 0.36, 0),
  head: new THREE.IcosahedronGeometry(0.19, 1),
  cone: new THREE.ConeGeometry(0.21, 0.28, 10),
  nasal: new THREE.BoxGeometry(0.06, 0.12, 0.05),
  hood: new THREE.ConeGeometry(0.24, 0.46, 10),
  cap: new THREE.CylinderGeometry(0.2, 0.21, 0.08, 12),
  dome: new THREE.SphereGeometry(0.215, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2),
  shield: new THREE.CylinderGeometry(0.38, 0.38, 0.05, 18).rotateX(Math.PI / 2),
  boss: new THREE.SphereGeometry(0.08, 8, 6),
  bow: new THREE.TorusGeometry(0.4, 0.03, 6, 14, Math.PI),
  quiver: new THREE.CylinderGeometry(0.065, 0.065, 0.42, 8),
  shaft: new THREE.CylinderGeometry(0.035, 0.035, 2.0, 8).translate(0, 1.0, 0),
  tip: new THREE.ConeGeometry(0.06, 0.2, 8),
  haft: new THREE.CylinderGeometry(0.035, 0.035, 0.75, 6).translate(0, 0.375, 0),
  axe: new THREE.BoxGeometry(0.05, 0.17, 0.22),
  pole: new THREE.CylinderGeometry(0.03, 0.03, 2.3, 6).translate(0, 1.15, 0),
  flag: new THREE.PlaneGeometry(0.55, 0.34, 4, 2).translate(0.275, 0, 0),
  shoulders: new THREE.BoxGeometry(0.76, 0.14, 0.38),
  tower: new THREE.BoxGeometry(0.5, 0.74, 0.06),
  crest: new THREE.ConeGeometry(0.06, 0.32, 6),
  blade: new THREE.BoxGeometry(0.07, 0.8, 0.025).translate(0, 0.45, 0),
  crossguard: new THREE.BoxGeometry(0.24, 0.045, 0.06),
  cape: new THREE.PlaneGeometry(0.5, 0.68, 1, 2).translate(0, -0.34, 0),
};

const matCache = new Map<string, THREE.MeshLambertMaterial>();
function mat(color: string, doubleSide = false): THREE.MeshLambertMaterial {
  const key = color + (doubleSide ? 'd' : '');
  let m = matCache.get(key);
  if (!m) {
    // Smooth shading on figures: round helmets, shields and bodies stay clean
    // from afar instead of breaking into visible facets.
    m = new THREE.MeshLambertMaterial({ color, side: doubleSide ? THREE.DoubleSide : THREE.FrontSide });
    matCache.set(key, m);
  }
  return m;
}

/** One material for every baked figure part; the cape needs both sides, the rest never shows its back. */
const figureMat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });

const SKIN = FIGURE.skin;
const STEEL = FIGURE.steel;
const WOOD = FIGURE.wood;

type V3 = [number, number, number];

/** One primitive of a baked part: geometry, color, and its transform inside the part. */
interface Piece {
  g: THREE.BufferGeometry;
  color: string;
  at?: V3;
  rot?: V3;
  scale?: V3 | number;
}

const baked = new Map<string, THREE.BufferGeometry>();
const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpE = new THREE.Euler();
const tmpP = new THREE.Vector3();
const tmpS = new THREE.Vector3();
const tmpC = new THREE.Color();

/** Merges pieces into one geometry with vertex colors; cached per key, shared by all figures of a type. */
function bake(key: string, pieces: Piece[]): THREE.BufferGeometry {
  const hit = baked.get(key);
  if (hit) return hit;
  const list = pieces.map((p) => {
    // mergeGeometries needs all-indexed or all-non-indexed input; the primitives are mixed
    const g = p.g.index ? p.g.toNonIndexed() : p.g.clone();
    const s = p.scale === undefined ? ([1, 1, 1] as V3) : typeof p.scale === 'number' ? ([p.scale, p.scale, p.scale] as V3) : p.scale;
    const at = p.at ?? [0, 0, 0];
    const rot = p.rot ?? [0, 0, 0];
    tmpM.compose(tmpP.set(at[0], at[1], at[2]), tmpQ.setFromEuler(tmpE.set(rot[0], rot[1], rot[2])), tmpS.set(s[0], s[1], s[2]));
    g.applyMatrix4(tmpM);
    tmpC.set(p.color);
    const n = g.getAttribute('position').count;
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      col[i * 3] = tmpC.r;
      col[i * 3 + 1] = tmpC.g;
      col[i * 3 + 2] = tmpC.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    return g;
  });
  const merged = mergeGeometries(list)!;
  baked.set(key, merged);
  return merged;
}

/** Whether figures cast shadows (the quality profile; set before any figure is created). */
let castShadows = true;
export function configureFigures(shadows: boolean): void {
  castShadows = shadows;
}

function bakedMesh(key: string, pieces: Piece[], shadow: boolean): THREE.Mesh {
  const m = new THREE.Mesh(bake(key, pieces), figureMat);
  m.castShadow = shadow && castShadows;
  return m;
}

export interface Figure {
  root: THREE.Group; // position and rotation in the world
  pose: THREE.Group; // lean (morale, kneeling)
  head: THREE.Group;
  shield: THREE.Group | null;
  weapon: THREE.Group | null;
  banner: THREE.Group | null;
  type: SquadType;
}

function part(g: THREE.BufferGeometry, color: string, shadow = true): THREE.Mesh {
  const m = new THREE.Mesh(g, mat(color));
  m.castShadow = shadow && castShadows;
  return m;
}

export function createFigure(type: SquadType): Figure {
  const c = SQUAD_COLORS[type];
  const root = new THREE.Group();
  const pose = new THREE.Group();
  root.add(pose);

  // torso: tunic, short cloak from the shoulders (a colored silhouette readable from the camera height),
  // and per class a quiver or heavy armor
  const torso: Piece[] = [
    { g: geo.body, color: c.tunic },
    { g: geo.cape, color: c.cape, at: [0, 0.8, -0.2], rot: [0.2, 0, 0] },
  ];
  // head group contents (relative to the head group)
  const headParts: Piece[] = [{ g: geo.head, color: SKIN }];
  let shieldParts: Piece[] | null = null;
  let weaponParts: Piece[] | null = null;
  let shieldPos: V3 = [-0.24, 0.5, 0.2];
  let weaponPos: V3 = [0.27, 0.35, 0.1];
  let weaponRotX = 0.35;
  let weaponScale = 1;

  if (type === 'guard') {
    headParts.push({ g: geo.cone, color: STEEL, at: [0, 0.17, 0] }, { g: geo.nasal, color: STEEL, at: [0, 0.05, 0.19] });
    shieldParts = [
      { g: geo.shield, color: c.shield },
      { g: geo.boss, color: FIGURE.boss, at: [0, 0, 0.04] },
    ];
    // a sword in the right hand, so the guard can visibly strike
    weaponParts = [
      { g: geo.blade, color: STEEL },
      { g: geo.crossguard, color: FIGURE.boss },
    ];
  } else if (type === 'archers' || type === 'raiderArchers') {
    headParts.push({ g: geo.hood, color: c.accent, at: [0, 0.14, 0] });
    weaponParts = [{ g: geo.bow, color: WOOD, rot: [0, 0, -Math.PI / 2] }];
    weaponPos = [0.27, 0.62, 0.08];
    weaponRotX = 0;
    torso.push({ g: geo.quiver, color: FIGURE.quiver, at: [-0.1, 0.72, -0.24], rot: [0.35, 0, 0] });
  } else if (type === 'spearmen') {
    headParts.push({ g: geo.cap, color: c.accent, at: [0, 0.16, 0] });
    weaponParts = [
      { g: geo.shaft, color: FIGURE.shaft },
      { g: geo.tip, color: STEEL, at: [0, 2.08, 0] },
    ];
    weaponPos = [0.27, 0.02, 0.06];
    weaponRotX = 0;
  } else {
    headParts.push({ g: geo.dome, color: type === 'armored' ? STEEL : c.accent, at: [0, 0.04, 0] });
    weaponParts = [
      { g: geo.haft, color: FIGURE.haft },
      { g: geo.axe, color: STEEL, at: [0, 0.68, 0.09] },
    ];
    if (type === 'raiders') {
      // a painted round shield in the raiders' colors
      shieldParts = [
        { g: geo.shield, color: c.shield, scale: 0.85 },
        { g: geo.boss, color: FIGURE.boss, at: [0, 0, 0.04] },
      ];
      shieldPos = [-0.24, 0.5, 0.18];
    }
    if (type === 'armored') {
      // heavy armor: crested helmet, pauldrons, chest plate, tower shield, bigger axe
      headParts.push({ g: geo.crest, color: FIGURE.crest, at: [0, 0.3, 0] });
      torso.push({ g: geo.shoulders, color: STEEL, at: [0, 0.76, 0] }, { g: geo.body, color: STEEL, at: [0, 0.26, 0], scale: [1.2, 0.62, 1.2] });
      weaponScale = 1.3;
      shieldParts = [{ g: geo.tower, color: FIGURE.shieldArmored }];
      shieldPos = [-0.3, 0.5, 0.22];
    }
  }

  pose.add(bakedMesh(`${type}:torso`, torso, true));
  const head = new THREE.Group();
  head.position.y = 0.9;
  head.add(bakedMesh(`${type}:head`, headParts, true));
  pose.add(head);

  let shield: THREE.Group | null = null;
  if (shieldParts) {
    shield = new THREE.Group();
    shield.add(bakedMesh(`${type}:shield`, shieldParts, true));
    shield.position.set(...shieldPos);
    shield.rotation.y = -0.5;
    pose.add(shield);
  }
  let weapon: THREE.Group | null = null;
  if (weaponParts) {
    weapon = new THREE.Group();
    weapon.add(bakedMesh(`${type}:weapon`, weaponParts, false));
    weapon.position.set(...weaponPos);
    weapon.rotation.x = weaponRotX;
    weapon.scale.setScalar(weaponScale);
    pose.add(weapon);
  }
  return { root, pose, head, shield, weapon, banner: null, type };
}

/** Squad banner carried by the leader. */
export function createBanner(type: SquadType): THREE.Group {
  const g = new THREE.Group();
  g.add(part(geo.pole, FIGURE.pole, false));
  // own geometry per banner so each flag ripples with its own phase
  const flag = new THREE.Mesh(geo.flag.clone(), mat(SQUAD_COLORS[type].flag, true));
  flag.position.y = 2.05;
  flag.name = 'flag';
  g.add(flag);
  g.position.set(-0.12, 0.25, -0.18);
  return g;
}

const flagBase = new WeakMap<THREE.BufferGeometry, Float32Array>();

/** Cloth wave of the banner: free end flutters, hoist edge stays. Null time lays it flat. */
export function waveFlag(flag: THREE.Object3D, time: number | null): void {
  const mesh = flag as THREE.Mesh;
  const g = mesh.geometry;
  const a = g.getAttribute('position') as THREE.BufferAttribute;
  let base = flagBase.get(g);
  if (!base) {
    base = Float32Array.from(a.array as Float32Array);
    flagBase.set(g, base);
  }
  const arr = a.array as Float32Array;
  if (time === null) {
    arr.set(base);
  } else {
    for (let i = 0; i < arr.length; i += 3) {
      const u = base[i] / 0.55; // 0 at the hoist, 1 at the free end
      arr[i + 2] = base[i + 2] + 0.07 * u * Math.sin(base[i] * 14 - time * 7);
    }
  }
  a.needsUpdate = true;
}
