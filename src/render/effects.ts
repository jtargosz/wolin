// Markers: selection, move target, facing arrow, threat warning, hits, arrows, horn.
// Everything is calm: soft fades, no flashes or shake.

import * as THREE from 'three/webgpu';
import { DT } from '../core/config.ts';
import type { GameEvent, GameState, MapData, Vec } from '../core/types.ts';
import { buildingDamageStage, smokeIntensity, smooth } from './anim.ts';
import { FX } from './palette.ts';
import type { Terrain } from './terrain.ts';

/** A flying chip: spark, splinter, dust speck or blood drop. */
interface Chip {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  age: number;
  life: number;
  size: number;
  spin: number;
  color: THREE.Color;
}

/** A soft dust cloud that grows, rises and dissolves. */
interface Puff {
  x: number;
  y: number;
  z: number;
  age: number;
  life: number;
  size: number;
  rise: number;
}

/** Pool capacities: bounded lists keep the cost of a long battle flat. */
export const CHIP_CAP = 160;
export const PUFF_CAP = 40;
export const STUCK_CAP = 24;

interface Pulse {
  mesh: THREE.Mesh;
  age: number;
  life: number;
  grow: number;
  base: number;
}

const ringGeo = new THREE.RingGeometry(0.78, 1, 32).rotateX(-Math.PI / 2);
const discGeo = new THREE.CircleGeometry(1, 16).rotateX(-Math.PI / 2);

export interface SmokeSpot {
  x: number;
  z: number;
  y: number; // puff origin above the roof
  building: number; // index into state.buildings, -1 for huts (always smoking)
}

/** Chimney spots: huts plus every key building (a ruin stops smoking). */
export function smokeSpots(map: MapData, groundY: (x: number, z: number) => number): SmokeSpot[] {
  const spots: SmokeSpot[] = map.huts.map((h) => ({ x: h.x, z: h.y, y: groundY(h.x, h.y) + 2.0, building: -1 }));
  map.buildings.forEach((b, i) => {
    const cx = (b.min.x + b.max.x) / 2;
    const cz = (b.min.y + b.max.y) / 2;
    spots.push({ x: cx, z: cz, y: groundY(cx, cz) + 3.7, building: i });
  });
  return spots;
}

// ponytail: a fixed pool of stains, the oldest is reused; a long battle loses its first marks.
const STAIN_CAP = 96;

/** Appends to a bounded list, dropping the oldest entries beyond cap. */
export function ringPush<T>(list: T[], item: T, cap: number): void {
  list.push(item);
  if (list.length > cap) list.splice(0, list.length - cap);
}

const SMOKE_LIFE = 6;
const SMOKE_PER_SPOT = 4;

/** Puff shape over its life (pure, tested): grows from nothing, rises, dissolves to nothing. */
export function smokePose(age: number): { dy: number; s: number; fade: number } {
  const k = Math.min(1, Math.max(0, age / SMOKE_LIFE));
  const smooth = (a: number, b: number, x: number): number => {
    const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  };
  return {
    dy: k * SMOKE_LIFE * 0.45,
    s: 0.8 * smooth(0, 0.22, k) * (1 - smooth(0.68, 1, k)),
    fade: k,
  };
}

function overlay(color: string, opacity: number): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthTest: false, depthWrite: false, fog: false });
}

/** Soft round puff texture: dense core fading to nothing, tinted per-instance. */
function makeSmokeTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,0.85)');
  grad.addColorStop(0.4, 'rgba(255,255,255,0.42)');
  grad.addColorStop(0.7, 'rgba(255,255,255,0.14)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class Effects {
  readonly group = new THREE.Group();
  private readonly selection: THREE.Mesh;
  private readonly selectionShadow: THREE.Mesh;
  private readonly moveMark: THREE.Mesh;
  private readonly moveShadow: THREE.Mesh;
  private readonly arrow: THREE.Group;
  private readonly arrowShaft: THREE.Mesh;
  private readonly threats = new Map<number, THREE.Mesh>();
  private pulses: Pulse[] = [];
  private readonly arrows = new Map<number, THREE.Mesh>();
  private readonly arrowGeo = new THREE.CylinderGeometry(0.045, 0.045, 0.8, 6).rotateX(Math.PI / 2);
  private readonly arrowMat = new THREE.MeshLambertMaterial({ color: FX.arrow });
  // Billboarded soft sprites instead of shaded 3D balls: unlit, fading edges,
  // tinted per-instance from smoke-dark to smoke-light.
  private readonly smokeGeo = new THREE.PlaneGeometry(1, 1);
  private readonly smokeMat = new THREE.MeshBasicMaterial({
    map: makeSmokeTexture(),
    transparent: true,
    opacity: 0.2,
    depthWrite: false,
  });
  private readonly smokeDark = new THREE.Color(FX.smoke);
  private readonly smokePale = new THREE.Color(FX.smokeLight);
  private readonly smokeSoot = new THREE.Color('#2e2a27');
  private smokeMesh: THREE.InstancedMesh | null = null;
  private smokeSpots: SmokeSpot[] = [];
  private readonly smokeM = new THREE.Matrix4();
  private readonly smokeQ = new THREE.Quaternion();
  private readonly smokeV = new THREE.Vector3();
  private readonly smokeS = new THREE.Vector3();
  private readonly smokeC = new THREE.Color();
  private moveAge = 99;
  private readonly stains: { x: number; y: number; z: number; s: number; yaw: number }[] = [];
  private readonly stainMesh: THREE.InstancedMesh;
  private readonly chipMesh: THREE.InstancedMesh;
  private readonly puffMesh: THREE.InstancedMesh;
  private chips: Chip[] = [];
  private puffs: Puff[] = [];
  private readonly stuck: { mesh: THREE.Mesh; age: number }[] = [];
  private stuckNext = 0;
  private readonly arrowEnd = new Map<number, { x: number; z: number; dx: number; dz: number }>();
  private readonly chipQ = new THREE.Quaternion();
  private readonly chipE = new THREE.Euler();
  /** Set by the view: flying debris and shaking are off under reduced motion. */
  reduced = false;

  constructor(private readonly terrain: Terrain) {
    const stainTex = makeSmokeTexture();
    this.stainMesh = new THREE.InstancedMesh(
      discGeo,
      new THREE.MeshBasicMaterial({ color: FX.blood, map: stainTex, transparent: true, opacity: 0.75, depthWrite: false }),
      STAIN_CAP,
    );
    this.stainMesh.count = 0;
    this.stainMesh.renderOrder = 5;
    this.stainMesh.frustumCulled = false;
    this.group.add(this.stainMesh);
    this.chipMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial({ color: '#ffffff' }), CHIP_CAP);
    this.chipMesh.count = 0;
    this.chipMesh.frustumCulled = false;
    this.chipMesh.setColorAt(0, this.smokeC.set('#ffffff'));
    this.puffMesh = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ map: stainTex, transparent: true, opacity: 0.5, depthWrite: false }),
      PUFF_CAP,
    );
    this.puffMesh.count = 0;
    this.puffMesh.renderOrder = 6;
    this.puffMesh.frustumCulled = false;
    this.puffMesh.setColorAt(0, this.smokeC.set('#ffffff'));
    this.group.add(this.chipMesh, this.puffMesh);
    this.selection = new THREE.Mesh(ringGeo, overlay(FX.selection, 0.9));
    this.selection.renderOrder = 10;
    this.selection.visible = false;
    // dark underlay so the white ring reads on pale sand as well as grass
    this.selectionShadow = new THREE.Mesh(discGeo, overlay(FX.selectionShadow, 0.28));
    this.selectionShadow.renderOrder = 9;
    this.selectionShadow.visible = false;
    this.moveMark = new THREE.Mesh(ringGeo, overlay(FX.moveMark, 0.8));
    this.moveMark.renderOrder = 10;
    this.moveMark.visible = false;
    this.moveShadow = new THREE.Mesh(discGeo, overlay(FX.selectionShadow, 0.22));
    this.moveShadow.renderOrder = 9;
    this.moveShadow.visible = false;
    this.arrow = new THREE.Group();
    this.arrowShaft = new THREE.Mesh(new THREE.PlaneGeometry(0.25, 1).rotateX(-Math.PI / 2).translate(0, 0, 0.5), overlay(FX.arrow, 0.9));
    const head = new THREE.Mesh(
      new THREE.ConeGeometry(0.4, 0.8, 3).rotateX(Math.PI / 2).scale(1, 0.05, 1),
      overlay(FX.arrow, 0.9),
    );
    head.name = 'head';
    this.arrow.add(this.arrowShaft, head);
    this.arrow.visible = false;
    this.arrow.renderOrder = 10;
    this.group.add(this.selection, this.selectionShadow, this.moveMark, this.moveShadow, this.arrow);
  }

  private y(x: number, z: number): number {
    return Math.max(0.05, this.terrain.heightAt(x, z)) + 0.06;
  }

  setSelection(p: Vec | null, routing: boolean): void {
    this.selection.visible = p !== null;
    this.selectionShadow.visible = p !== null;
    if (!p) return;
    this.selection.position.set(p.x, this.y(p.x, p.y), p.y);
    this.selectionShadow.position.set(p.x, this.y(p.x, p.y) - 0.01, p.y);
    this.selection.scale.setScalar(2.3);
    this.selectionShadow.scale.setScalar(2.3);
    (this.selection.material as THREE.MeshBasicMaterial).color.set(routing ? FX.selectionRouting : FX.selection);
  }

  showMove(p: Vec): void {
    this.moveAge = 0;
    this.moveMark.position.set(p.x, this.y(p.x, p.y), p.y);
    this.moveShadow.position.set(p.x, this.y(p.x, p.y) - 0.01, p.y);
    this.moveMark.visible = true;
    this.moveShadow.visible = true;
  }

  /** Facing arrow while right-drag ordering. */
  setFacingArrow(from: Vec | null, to: Vec | null): void {
    if (!from || !to) {
      this.arrow.visible = false;
      return;
    }
    const dx = to.x - from.x;
    const dz = to.y - from.y;
    const l = Math.max(0.5, Math.hypot(dx, dz));
    this.arrow.visible = true;
    this.arrow.position.set(from.x, this.y(from.x, from.y) + 0.05, from.y);
    this.arrow.rotation.y = Math.atan2(dx, dz);
    this.arrowShaft.scale.z = l;
    const head = this.arrow.getObjectByName('head');
    if (head) head.position.z = l + 0.2;
  }

  private pulse(p: Vec, color: string, size: number, grow: number, life: number, opacity: number): void {
    const mesh = new THREE.Mesh(ringGeo, overlay(color, opacity));
    mesh.renderOrder = 9;
    mesh.position.set(p.x, this.y(p.x, p.y) + 0.02, p.y);
    mesh.scale.setScalar(size);
    this.group.add(mesh);
    this.pulses.push({ mesh, age: 0, life, grow, base: opacity });
  }

  onEvents(s: GameState, events: GameEvent[]): void {
    for (const e of events) {
      if (e.t === 'boatSpawned') {
        const m = new THREE.Mesh(discGeo, overlay(FX.threat, 0.38));
        m.position.set(e.landing.x, 0.12, e.landing.y);
        m.scale.setScalar(2.6);
        m.renderOrder = 8;
        this.group.add(m);
        this.threats.set(e.boatId, m);
      } else if (e.t === 'boatLanded' || e.t === 'boatLeaving') {
        const m = this.threats.get(e.boatId);
        if (m) {
          this.group.remove(m);
          this.threats.delete(e.boatId);
        }
      } else if (e.t === 'hit') {
        const src = s.squads.find((q) => q.id === e.attacker);
        const p = src ? { x: (src.pos.x + e.at.x * 2) / 3, y: (src.pos.y + e.at.y * 2) / 3 } : e.at;
        this.pulse(p, e.flank === 'front' ? FX.hitFront : FX.hitFlank, 0.5, 1.2, 0.7, 0.6);
        this.impact(s, e);
      } else if (e.t === 'buildingHit') {
        this.pulse(e.at, FX.buildingHit, 1.6, 0.8, 0.9, 0.35);
        const top = s.map.buildings[e.building]?.key === 'lighthouse' ? 5.2 : 2.6;
        const y = this.terrain.heightAt(e.at.x, e.at.y) + top;
        this.spawnChips(e.at.x, y, e.at.y, 10, 3.2, ['#9a7048', '#6b4a30', '#b08a5c'], 0.1, 0.9, 6);
        this.spawnPuff(e.at.x, y - 0.6, e.at.y, 1.8, 1.6, 0.8);
      } else if (e.t === 'buildingDestroyed') {
        const y = this.terrain.heightAt(e.at.x, e.at.y);
        this.spawnChips(e.at.x, y + 2, e.at.y, 28, 4.5, ['#9a7048', '#6b4a30', '#c4a15b', '#b08a5c'], 0.14, 1.3, 7);
        for (let i = 0; i < 6; i++) this.spawnPuff(e.at.x + (i % 3 - 1) * 1.2, y + 0.6 + (i % 2) * 0.5, e.at.y + (Math.floor(i / 3) - 0.5) * 1.6, 3.4, 1.8, 2.2);
      } else if (e.t === 'fell') {
        // a dark stain stays on the ground where a warrior fell
        const k = e.warriorId * 2.399;
        const x = e.at.x + Math.sin(k) * 0.9;
        const z = e.at.y + Math.cos(k) * 0.9;
        ringPush(this.stains, { x, z, y: this.terrain.heightAt(x, z) + 0.04, s: 0.55 + ((e.warriorId * 37) % 10) * 0.05, yaw: k }, STAIN_CAP);
        this.drawStains();
      }
    }
  }

  /** Sparks on armor and shields, dust and blood on flesh, a soft thud for arrows. */
  private impact(s: GameState, e: Extract<GameEvent, { t: 'hit' }>): void {
    const dst = s.squads.find((q) => q.id === e.target);
    const src = s.squads.find((q) => q.id === e.attacker);
    if (!dst) return;
    const y = this.terrain.heightAt(e.at.x, e.at.y) + 1.0;
    const armored = dst.type === 'armored' || dst.shieldUntil > s.tick;
    if (armored) {
      this.spawnChips(e.at.x, y, e.at.y, 7, 3.6, ['#ffe9a8', '#fff6d6', '#e8c46a'], 0.05, 0.45, 8, src ? { x: dst.pos.x - src.pos.x, z: dst.pos.y - src.pos.y } : undefined);
    } else {
      const n = e.ranged ? 4 : 7 + (e.flank === 'front' ? 0 : 2);
      this.spawnChips(e.at.x, y, e.at.y, n, 2.6, ['#7a1c1c', '#5e1414', '#8c2a22'], 0.07, 0.6, 7, src ? { x: dst.pos.x - src.pos.x, z: dst.pos.y - src.pos.y } : undefined);
      this.spawnPuff(e.at.x, y - 0.3, e.at.y, 1.1, 0.9, 0.5);
    }
  }

  /** Flying chips (bounded pool). `dir` biases the burst away from the attacker. */
  private spawnChips(
    x: number,
    y: number,
    z: number,
    n: number,
    speed: number,
    colors: string[],
    size: number,
    life: number,
    up: number,
    dir?: { x: number; z: number },
  ): void {
    if (this.reduced) return;
    const l = dir ? Math.hypot(dir.x, dir.z) || 1 : 1;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.random();
      const bx = dir ? (dir.x / l) * 0.7 : 0;
      const bz = dir ? (dir.z / l) * 0.7 : 0;
      ringPush(
        this.chips,
        {
          x: x + (Math.random() - 0.5) * 0.5,
          y: y + (Math.random() - 0.5) * 0.3,
          z: z + (Math.random() - 0.5) * 0.5,
          vx: (Math.cos(a) * 0.6 * r + bx) * speed,
          vy: (0.4 + Math.random() * 0.6) * up * 0.5,
          vz: (Math.sin(a) * 0.6 * r + bz) * speed,
          age: 0,
          life: life * (0.6 + Math.random() * 0.6),
          size: size * (0.6 + Math.random() * 0.8),
          spin: Math.random() * 6,
          color: new THREE.Color(colors[i % colors.length]),
        },
        CHIP_CAP,
      );
    }
  }

  /** A dust cloud (bounded pool). */
  private spawnPuff(x: number, y: number, z: number, size: number, life: number, rise: number): void {
    ringPush(this.puffs, { x, y, z, age: 0, life, size, rise }, PUFF_CAP);
  }

  private updateParticles(dt: number, camera?: THREE.Camera): void {
    const alive: Chip[] = [];
    this.chipE.set(0, 0, 0);
    this.chips.forEach((c) => {
      c.age += dt;
      if (c.age >= c.life) return;
      c.vy -= 9 * dt;
      c.x += c.vx * dt;
      c.y += c.vy * dt;
      c.z += c.vz * dt;
      const ground = this.terrain.heightAt(c.x, c.z) + c.size * 0.5;
      if (c.y < ground) {
        c.y = ground;
        c.vy = 0;
        c.vx *= 0.3;
        c.vz *= 0.3;
      }
      alive.push(c);
    });
    this.chips = alive;
    alive.forEach((c, i) => {
      const k = c.age / c.life;
      const sc = c.size * (1 - smooth(0.6, 1, k));
      this.chipE.set(c.age * c.spin, c.age * c.spin * 0.7, 0);
      this.chipQ.setFromEuler(this.chipE);
      this.smokeM.compose(this.smokeV.set(c.x, c.y, c.z), this.chipQ, this.smokeS.set(sc, sc, sc));
      this.chipMesh.setMatrixAt(i, this.smokeM);
      this.chipMesh.setColorAt(i, c.color);
    });
    this.chipMesh.count = alive.length;
    this.chipMesh.instanceMatrix.needsUpdate = true;
    if (this.chipMesh.instanceColor) this.chipMesh.instanceColor.needsUpdate = true;

    const live: Puff[] = [];
    for (const p of this.puffs) {
      p.age += dt;
      if (p.age < p.life) live.push(p);
    }
    this.puffs = live;
    const billboard = camera ? camera.quaternion : this.chipQ.identity();
    live.forEach((p, i) => {
      const k = p.age / p.life;
      const sc = Math.max(0.001, p.size * smooth(0, 0.25, k) * (1 - smooth(0.55, 1, k)));
      this.smokeM.compose(this.smokeV.set(p.x, p.y + p.rise * p.age, p.z), billboard, this.smokeS.set(sc, sc, 1));
      this.puffMesh.setMatrixAt(i, this.smokeM);
      this.smokeC.set('#cdbd9c').lerp(this.smokePale, k);
      this.puffMesh.setColorAt(i, this.smokeC);
    });
    this.puffMesh.count = live.length;
    this.puffMesh.instanceMatrix.needsUpdate = true;
    if (this.puffMesh.instanceColor) this.puffMesh.instanceColor.needsUpdate = true;
  }

  /** An arrow that landed stays in the ground or in a shield for a few seconds. */
  private stickArrow(end: { x: number; z: number; dx: number; dz: number }): void {
    let slot = this.stuck[this.stuckNext];
    if (!slot) {
      const mesh = new THREE.Mesh(this.arrowGeo, this.arrowMat);
      this.group.add(mesh);
      slot = { mesh, age: 0 };
      this.stuck[this.stuckNext] = slot;
    }
    this.stuckNext = (this.stuckNext + 1) % STUCK_CAP;
    slot.age = 0;
    const y = this.terrain.heightAt(end.x, end.z) + 0.45;
    slot.mesh.visible = true;
    slot.mesh.scale.setScalar(1);
    slot.mesh.position.set(end.x, y, end.z);
    slot.mesh.lookAt(end.x + end.dx, y - 0.7, end.z + end.dz);
  }

  private updateStuck(dt: number): void {
    for (const s of this.stuck) {
      if (!s.mesh.visible) continue;
      s.age += dt;
      const sc = 1 - smooth(3, 4, s.age);
      s.mesh.scale.setScalar(Math.max(0.001, sc));
      if (s.age > 4) s.mesh.visible = false;
    }
  }

  private drawStains(): void {
    this.stains.forEach((st, i) => {
      this.smokeQ.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, st.yaw);
      this.smokeM.compose(this.smokeV.set(st.x, st.y, st.z), this.smokeQ, this.smokeS.set(st.s * 1.3, 1, st.s));
      this.stainMesh.setMatrixAt(i, this.smokeM);
    });
    this.stainMesh.count = this.stains.length;
    this.stainMesh.instanceMatrix.needsUpdate = true;
  }

  /** Horn: a wide, slow ring. Shield wall: a short ring at the squad. */
  horn(p: Vec, radius: number): void {
    this.pulse(p, FX.horn, 1, radius, 2.2, 0.5);
  }

  shield(p: Vec): void {
    this.pulse(p, FX.shield, 1.5, 1.4, 1.0, 0.5);
  }

  /** Chimney smoke emitters for the current map (called once per world load). */
  setSmoke(map: MapData): void {
    if (this.smokeMesh) {
      this.group.remove(this.smokeMesh);
      this.smokeMesh = null;
    }
    this.smokeSpots = smokeSpots(map, (x, z) => this.terrain.heightAt(x, z));
    if (this.smokeSpots.length === 0) return;
    this.smokeMesh = new THREE.InstancedMesh(this.smokeGeo, this.smokeMat, this.smokeSpots.length * SMOKE_PER_SPOT);
    this.smokeMesh.renderOrder = 4;
    this.smokeMesh.frustumCulled = false;
    this.smokeC.copy(this.smokeDark);
    for (let i = 0; i < this.smokeSpots.length * SMOKE_PER_SPOT; i++) this.smokeMesh.setColorAt(i, this.smokeC);
    this.group.add(this.smokeMesh);
  }

  private updateSmoke(s: GameState, time: number, camera?: THREE.Camera): void {
    if (!this.smokeMesh) return;
    // billboard: every puff faces the camera; falls back to identity
    const billboard = camera ? camera.quaternion : this.smokeQ.identity();
    let n = 0;
    this.smokeSpots.forEach((sp, ei) => {
      const alive = sp.building < 0 || (s.buildings[sp.building] && s.buildings[sp.building].hp > 0);
      // a damaged building smokes thicker and darker, a burning one most of all
      const b = sp.building >= 0 ? s.buildings[sp.building] : undefined;
      const inten = smokeIntensity(b ? buildingDamageStage(b.hp / b.maxHp) : 0);
      for (let k = 0; k < SMOKE_PER_SPOT; k++) {
        // ruins keep their slot but hide the puff underground; deterministic jitter
        // breaks the metronome so the loop is not visible
        const jitter = ((ei * 7 + k * 13) % 10) * 0.09;
        const age = alive ? (time + ei * 0.9 + (k * SMOKE_LIFE) / SMOKE_PER_SPOT + jitter) % SMOKE_LIFE : -1;
        const pose = smokePose(age);
        const sc = alive ? Math.max(0.001, pose.s * 1.35 * inten.size) : 0.001;
        this.smokeM.compose(
          this.smokeV.set(sp.x + Math.max(0, age) * 0.25, sp.y + pose.dy, sp.z + Math.max(0, age) * 0.08),
          billboard,
          this.smokeS.set(sc, sc, 1),
        );
        this.smokeMesh!.setMatrixAt(n, this.smokeM);
        this.smokeC.copy(this.smokeDark).lerp(this.smokePale, pose.fade).lerp(this.smokeSoot, inten.dark * (1 - pose.fade * 0.4));
        this.smokeMesh!.setColorAt(n, this.smokeC);
        n++;
      }
    });
    this.smokeMesh.instanceMatrix.needsUpdate = true;
    if (this.smokeMesh.instanceColor) this.smokeMesh.instanceColor.needsUpdate = true;
  }

  update(s: GameState, time: number, realDt: number, simDt: number, camera?: THREE.Camera): void {
    this.updateSmoke(s, time, camera);
    // selection: gentle breathing so it never looks frozen
    if (this.selection.visible) {
      const sc = 2.3 + 0.09 * Math.sin(time * 2.2);
      this.selection.scale.setScalar(sc);
      this.selectionShadow.scale.setScalar(sc);
    }
    // move target: gentle fade
    if (this.moveMark.visible) {
      this.moveAge += realDt;
      const k = this.moveAge / 1.4;
      (this.moveMark.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 0.8 * (1 - k));
      (this.moveShadow.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 0.22 * (1 - k));
      const sc = 1.2 - 0.4 * Math.min(1, k);
      this.moveMark.scale.setScalar(sc);
      this.moveShadow.scale.setScalar(sc);
      if (k >= 1) {
        this.moveMark.visible = false;
        this.moveShadow.visible = false;
      }
    }
    for (const m of this.threats.values()) {
      (m.material as THREE.MeshBasicMaterial).opacity = 0.26 + 0.12 * Math.sin(time * 1.6);
    }
    const keep: Pulse[] = [];
    for (const p of this.pulses) {
      p.age += simDt; // markers also freeze while paused
      const k = Math.min(1, p.age / p.life);
      p.mesh.scale.setScalar(p.mesh.scale.x + p.grow * (simDt / p.life));
      (p.mesh.material as THREE.MeshBasicMaterial).opacity = p.base * (1 - k);
      if (k >= 1) {
        this.group.remove(p.mesh);
        (p.mesh.material as THREE.Material).dispose();
      } else keep.push(p);
    }
    this.pulses = keep;

    // arrows in flight: arc based on simulation time
    const seen = new Set<number>();
    for (const pr of s.projectiles) {
      seen.add(pr.id);
      let m = this.arrows.get(pr.id);
      if (!m) {
        m = new THREE.Mesh(this.arrowGeo, this.arrowMat);
        this.arrows.set(pr.id, m);
        this.group.add(m);
      }
      const total = (pr.hitTick - pr.launchTick) * DT;
      const t = Math.min(1, Math.max(0, ((s.tick - pr.launchTick) * DT) / total));
      const x = pr.from.x + (pr.to.x - pr.from.x) * t;
      const z = pr.from.y + (pr.to.y - pr.from.y) * t;
      // the flight line runs between the shooter's and the target's terrace, not over every bump
      const h0 = this.terrain.heightAt(pr.from.x, pr.from.y);
      const h1 = this.terrain.heightAt(pr.to.x, pr.to.y);
      const base = h0 + (h1 - h0) * t + 1.2;
      const arc = Math.sin(t * Math.PI) * Math.min(5, Math.hypot(pr.to.x - pr.from.x, pr.to.y - pr.from.y) * 0.25);
      m.position.set(x, base + arc, z);
      const fl = Math.hypot(pr.to.x - pr.from.x, pr.to.y - pr.from.y) || 1;
      this.arrowEnd.set(pr.id, { x: pr.to.x, z: pr.to.y, dx: ((pr.to.x - pr.from.x) / fl) * 0.6, dz: ((pr.to.y - pr.from.y) / fl) * 0.6 });
      const vy = Math.cos(t * Math.PI) * Math.PI * arc;
      m.lookAt(x + (pr.to.x - pr.from.x), base + arc + vy, z + (pr.to.y - pr.from.y));
    }
    for (const [id, m] of this.arrows) {
      if (seen.has(id)) continue;
      this.group.remove(m);
      this.arrows.delete(id);
      const end = this.arrowEnd.get(id);
      if (end) this.stickArrow(end);
      this.arrowEnd.delete(id);
    }
    this.updateParticles(simDt, camera);
    this.updateStuck(simDt);
  }

  reset(): void {
    for (const m of this.threats.values()) this.group.remove(m);
    this.threats.clear();
    for (const p of this.pulses) this.group.remove(p.mesh);
    this.pulses = [];
    for (const m of this.arrows.values()) this.group.remove(m);
    this.arrows.clear();
    this.moveMark.visible = false;
    this.moveShadow.visible = false;
    this.stains.length = 0;
    this.stainMesh.count = 0;
    this.chips = [];
    this.chipMesh.count = 0;
    this.puffs = [];
    this.puffMesh.count = 0;
    this.arrowEnd.clear();
    for (const s of this.stuck) s.mesh.visible = false;
  }
}
