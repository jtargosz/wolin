// Squad to individual figures. Each figure has its own spring, phase, and small movements,
// so the group walks slightly different paths and "catches up" to formation after stopping. Purely cosmetic.

import * as THREE from 'three/webgpu';
import { ARROW_CYCLE, MELEE_CYCLE } from '../core/config.ts';
import { passable } from '../core/map.ts';
import type { GameEvent, GameState, MapData, Squad, SquadType, Vec } from '../core/types.ts';
import { attackPhase, FALL_DONE, fallPose, strikePose, type StrikeKind } from './anim.ts';
import { createBanner, createFigure, waveFlag, type Figure } from './figures.ts';
import { getLang, unitName, type Lang } from '../ui/i18n.ts';
import type { Terrain } from './terrain.ts';

const ENEMY_TYPES = new Set<SquadType>(['raiders', 'raiderArchers', 'armored']);

/** Figure scale: stylized but readable at the default camera distance. */
const FIG_SCALE = 1.18;

interface Fig {
  f: Figure;
  wid: number;
  x: number;
  z: number;
  vx: number;
  vz: number;
  yaw: number;
  k: number;
  hash: number;
  phase: number;
  lookYaw: number;
  lookGoal: number;
  nextLook: number;
  fidget: number;
  nextFidget: number;
}

interface Departing {
  f: Figure;
  x: number;
  z: number;
  yaw: number;
  t: number;
  /** 'fall': the slain tips over; 'board': sails away with its boat. */
  kind: 'fall' | 'board';
  tx: number;
  tz: number;
  /** Side the slain falls to (-1 or 1). */
  sign: number;
}

/** What a squad is doing with its weapons this frame. */
interface Attack {
  kind: StrikeKind;
  cd: number;
  cycle: number;
}

/** A blow just taken: direction away from the attacker and seconds since it landed. */
interface HitReaction {
  t: number;
  dx: number;
  dz: number;
}

const HIT_TIME = 0.28;

interface SquadGfx {
  id: number;
  type: SquadType;
  side: Squad['side'];
  figs: Map<number, Fig>;
  label: HTMLDivElement;
  bar: HTMLDivElement;
  banner: THREE.Group | null;
  bannerOwner: number;
  lastMorale: number;
  nameEl: HTMLSpanElement;
  index: number; // 1-based position among player squads (label prefix)
  lang: Lang; // language the label text was built for
  hit: HitReaction | null;
}

function labelText(g: { side: Squad['side']; index: number; type: SquadType }): string {
  return g.side === 'player' ? `${g.index} · ${unitName(g.type)}` : unitName(g.type);
}

export interface SquadFrame {
  state: GameState;
  alpha: number;
  time: number; // real time
  simTime: number;
  simDt: number;
  reduced: boolean;
  camera: THREE.Camera;
  width: number;
  height: number;
  selectedId: number;
  boatPos: (boatId: number) => Vec | null;
  sailing: Vec[];
}

function hash01(n: number): number {
  let h = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function angleLerp(a: number, b: number, t: number): number {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

/** Figure offset within the formation: side (right), fwd (forward). */
function slot(i: number, n: number, mode: 'column' | 'line' | 'wall', tight: number): { side: number; fwd: number } {
  if (mode === 'column') {
    const rows = Math.ceil(n / 2);
    const row = Math.floor(i / 2);
    const single = n % 2 === 1 && i === n - 1;
    return { side: single ? 0 : i % 2 === 0 ? -0.5 : 0.5, fwd: ((rows - 1) / 2 - row) * 0.95 };
  }
  if (mode === 'wall') {
    return { side: (i - (n - 1) / 2) * 0.72, fwd: 0.35 };
  }
  const front = Math.ceil(n / 2);
  const inFront = i < front;
  const count = inFront ? front : n - front;
  const col = inFront ? i : i - front;
  return { side: (col - (count - 1) / 2) * 1.05 * tight, fwd: (inFront ? 0.5 : -0.45) * tight };
}

export class SquadsView {
  readonly group = new THREE.Group();
  private readonly gfx = new Map<number, SquadGfx>();
  private departing: Departing[] = [];
  private readonly prev = new Map<number, Vec>();
  private snap = true;
  private readonly tmp = new THREE.Vector3();
  private readonly labelAnchors = new Map<number, { x: number; y: number }>();

  constructor(
    private readonly terrain: Terrain,
    private readonly labels: HTMLElement,
    private readonly map: MapData,
  ) {}

  /** Remembers positions before a simulation step (for interpolation). */
  capture(s: GameState): void {
    for (const sq of s.squads) this.prev.set(sq.id, { x: sq.pos.x, y: sq.pos.y });
  }

  reset(): void {
    for (const g of this.gfx.values()) this.removeGfx(g);
    this.gfx.clear();
    for (const d of this.departing) this.group.remove(d.f.root);
    this.departing = [];
    this.prev.clear();
    this.labelAnchors.clear();
    this.snap = true;
  }

  renderPos(sq: Squad, alpha: number): Vec {
    const p = this.prev.get(sq.id) ?? sq.pos;
    return { x: p.x + (sq.pos.x - p.x) * alpha, y: p.y + (sq.pos.y - p.y) * alpha };
  }

  private removeGfx(g: SquadGfx): void {
    for (const f of g.figs.values()) this.group.remove(f.f.root);
    g.label.remove();
  }

  private makeGfx(sq: Squad, index: number): SquadGfx {
    const label = document.createElement('div');
    label.className = 'squad-label' + (sq.side === 'enemy' ? ' enemy' : '');
    const name = document.createElement('span');
    name.textContent = labelText({ side: sq.side, index, type: sq.type });
    const mini = document.createElement('div');
    mini.className = 'mini';
    const bar = document.createElement('div');
    mini.appendChild(bar);
    label.append(name, mini);
    this.labels.appendChild(label);
    return {
      id: sq.id,
      type: sq.type,
      side: sq.side,
      figs: new Map(),
      label,
      bar,
      banner: sq.side === 'player' ? createBanner(sq.type) : null,
      bannerOwner: -1,
      lastMorale: -1,
      nameEl: name,
      index,
      lang: getLang(),
      hit: null,
    };
  }

  /** Blows taken in the last simulation steps: the target squad recoils away from the attacker. */
  onEvents(s: GameState, events: GameEvent[]): void {
    for (const e of events) {
      if (e.t !== 'hit') continue;
      const g = this.gfx.get(e.target);
      const src = s.squads.find((q) => q.id === e.attacker);
      const dst = s.squads.find((q) => q.id === e.target);
      if (!g || !src || !dst) continue;
      const dx = dst.pos.x - src.pos.x;
      const dz = dst.pos.y - src.pos.y;
      const l = Math.hypot(dx, dz) || 1;
      g.hit = { t: 0, dx: dx / l, dz: dz / l };
    }
  }

  update(fr: SquadFrame): void {
    const s = fr.state;
    const seen = new Set<number>();
    let playerIndex = 0;
    for (const sq of s.squads) {
      if (sq.side === 'player') playerIndex++;
      seen.add(sq.id);
      let g = this.gfx.get(sq.id);
      if (!g) {
        g = this.makeGfx(sq, playerIndex);
        this.gfx.set(sq.id, g);
      }
      if (g.hit) {
        g.hit.t += fr.simDt;
        if (g.hit.t > HIT_TIME) g.hit = null;
      }
      this.updateSquad(fr, sq, g);
    }
    for (const [id, g] of this.gfx) {
      if (seen.has(id)) continue;
      for (const f of g.figs.values()) this.depart(f, 'board', f.x, f.z);
      g.figs.clear();
      this.removeGfx(g);
      this.gfx.delete(id);
      this.labelAnchors.delete(id);
    }
    this.resolveLabels(fr);
    this.updateDeparting(fr);
    this.snap = false;
  }

  private depart(f: Fig, kind: Departing['kind'], tx: number, tz: number): void {
    this.departing.push({ f: f.f, x: f.x, z: f.z, yaw: f.yaw, t: 0, kind, tx, tz, sign: f.hash < 0.5 ? -1 : 1 });
  }

  private updateSquad(fr: SquadFrame, sq: Squad, g: SquadGfx): void {
    const s = fr.state;
    const c = this.renderPos(sq, fr.alpha);
    const visible = sq.warriors.filter((w) => w.alive && !w.aboard);
    const alive = new Set(visible.map((w) => w.id));

    // fallen and those boarding boats
    for (const [wid, f] of g.figs) {
      if (alive.has(wid) && sq.mode !== 'gone') continue;
      const w = sq.warriors.find((x) => x.id === wid);
      if (sq.mode === 'gone' || (w && w.alive)) {
        const bp = fr.boatPos(sq.boatId) ?? { x: f.x, y: f.z };
        this.depart(f, 'board', bp.x, bp.y);
      } else {
        // the slain of both sides tip over where they stood
        this.depart(f, 'fall', f.x, f.z);
      }
      if (g.bannerOwner === wid && g.banner) {
        f.f.pose.remove(g.banner);
        g.bannerOwner = -1;
      }
      g.figs.delete(wid);
    }

    const speed = Math.hypot(sq.vel.x, sq.vel.y);
    const shieldWall = sq.shieldUntil > s.tick;
    const mode = shieldWall ? 'wall' : speed > 0.25 ? 'column' : 'line';
    let enemyNear = false;
    for (const o of s.squads) {
      if (o.side !== sq.side && o.mode !== 'gone' && o.mode !== 'dead' && Math.hypot(o.pos.x - sq.pos.x, o.pos.y - sq.pos.y) < 8) {
        enemyNear = true;
        break;
      }
    }
    const tight = enemyNear ? 0.82 : 1;
    const fx = sq.facing.x;
    const fz = sq.facing.y;
    const rx = -fz;
    const rz = fx;
    const fighting = sq.targetId >= 0 && sq.contact;
    // weapons: blows at a squad (melee or arrows) and blows at a building both follow the attack cooldown
    const archer = sq.type === 'archers' || sq.type === 'raiderArchers';
    const building = sq.atBuilding && sq.buildingTarget >= 0 ? s.buildings[sq.buildingTarget] : undefined;
    const striking = sq.mode !== 'routing' && ((sq.targetId >= 0 && (sq.contact || archer)) || (building !== undefined && building.hp > 0));
    const attack: Attack | null = striking
      ? { kind: archer ? 'draw' : sq.type === 'spearmen' ? 'thrust' : 'chop', cd: sq.attackCd, cycle: archer ? ARROW_CYCLE : MELEE_CYCLE }
      : null;
    const hunch = sq.mode === 'routing' ? 1 : Math.min(1, Math.max(0, (50 - sq.morale) / 50));
    const targetSq = sq.targetId >= 0 ? s.squads.find((o) => o.id === sq.targetId) : undefined;

    visible.forEach((w, i) => {
      let f = g.figs.get(w.id);
      const off = slot(i, visible.length, mode, tight);
      const jitter = hash01(w.id * 7 + 3) - 0.5;
      let tx = c.x + rx * (off.side + jitter * 0.15) + fx * (off.fwd + jitter * 0.1);
      let tz = c.y + rz * (off.side + jitter * 0.15) + fz * (off.fwd + jitter * 0.1);
      if (!f) {
        let sx = tx;
        let sz = tz;
        if (!this.snap && sq.side === 'enemy') {
          const bp = fr.boatPos(sq.boatId);
          if (bp) {
            sx = bp.x + (hash01(w.id) - 0.5) * 1.2;
            sz = bp.y + (hash01(w.id + 1) - 0.5) * 1.2;
          }
        }
        const fig = createFigure(sq.type);
        fig.root.scale.setScalar(FIG_SCALE);
        const h = hash01(w.id);
        f = {
          f: fig,
          wid: w.id,
          x: sx,
          z: sz,
          vx: 0,
          vz: 0,
          yaw: Math.atan2(fx, fz),
          k: 2.2 + h * 1.3,
          hash: h,
          phase: h * 6.28,
          lookYaw: 0,
          lookGoal: 0,
          nextLook: 2 + h * 5,
          fidget: -1,
          nextFidget: 4 + h * 8,
        };
        g.figs.set(w.id, f);
        this.group.add(fig.root);
      }
      if (speed > 0.25 && !fr.reduced) {
        const wob = Math.sin(fr.simTime * 1.3 + f.hash * 12) * 0.14;
        tx += rx * wob;
        tz += rz * wob;
      }
      // a figure never stands across a cliff from its squad (it would float or sink)
      if (!passable(this.map, c, { x: tx, y: tz })) {
        tx = c.x;
        tz = c.y;
      }
      this.stepFig(f, tx, tz, fr.simDt);

      // turning: along the movement when marching, toward the opponent in combat, facing forward when idle
      const fs = Math.hypot(f.vx, f.vz);
      let yawGoal = Math.atan2(fx, fz);
      if (fs > 0.35) yawGoal = Math.atan2(f.vx, f.vz);
      else if (targetSq) yawGoal = Math.atan2(targetSq.pos.x - f.x, targetSq.pos.y - f.z);
      f.yaw = angleLerp(f.yaw, yawGoal, Math.min(1, fr.simDt * 5));

      this.animate(fr, f, fs, hunch, fighting, shieldWall, attack, g.hit);
    });

    // banner on the leader
    if (g.banner) {
      const leader = visible[0];
      if (leader && g.bannerOwner !== leader.id) {
        const lf = g.figs.get(leader.id);
        if (lf) {
          lf.f.pose.add(g.banner);
          g.bannerOwner = leader.id;
        }
      }
      const flag = g.banner.getObjectByName('flag');
      if (flag) {
        flag.rotation.y = fr.reduced ? 0 : Math.sin(fr.time * 1.7 + g.id) * 0.35 - Math.min(0.6, speed * 0.4);
        waveFlag(flag, fr.reduced ? null : fr.time + g.id);
      }
    }

    this.updateLabel(fr, sq, g, c);
  }

  private stepFig(f: Fig, tx: number, tz: number, dt: number): void {
    if (this.snap) {
      f.x = tx;
      f.z = tz;
      f.vx = 0;
      f.vz = 0;
      return;
    }
    if (dt <= 0) return;
    const n = Math.max(1, Math.ceil(dt / (1 / 30)));
    const h = dt / n;
    for (let i = 0; i < n; i++) {
      // critically damped spring: smooth start and stop, each figure with a different stiffness
      const ax = f.k * f.k * (tx - f.x) - 2 * f.k * f.vx;
      const az = f.k * f.k * (tz - f.z) - 2 * f.k * f.vz;
      f.vx += ax * h;
      f.vz += az * h;
      const sp = Math.hypot(f.vx, f.vz);
      if (sp > 2.6) {
        f.vx *= 2.6 / sp;
        f.vz *= 2.6 / sp;
      }
      f.x += f.vx * h;
      f.z += f.vz * h;
    }
  }

  private animate(
    fr: SquadFrame,
    f: Fig,
    speed: number,
    hunch: number,
    fighting: boolean,
    wall: boolean,
    attack: Attack | null,
    hit: HitReaction | null,
  ): void {
    const fig = f.f;
    const walk = Math.min(1, speed / 1.1);
    f.phase += speed * fr.simDt * 6.5;
    const bob = Math.abs(Math.sin(f.phase)) * 0.06 * walk;
    const y = this.terrain.heightAt(f.x, f.z);
    // a blow just taken pushes the figure back along the blow and bends it, then it recovers
    let recoil = 0;
    if (hit) {
      const k = Math.max(0, 1 - hit.t / HIT_TIME);
      recoil = k * k;
      const push = 0.24 * recoil * (0.7 + 0.6 * f.hash);
      fig.root.position.set(f.x + hit.dx * push, y + bob, f.z + hit.dz * push);
    } else fig.root.position.set(f.x, y + bob, f.z);
    fig.root.rotation.y = f.yaw;
    const strike = attack ? strikePose(attackPhase(attack.cd, attack.cycle, f.hash * 0.12), attack.kind) : null;
    fig.pose.rotation.z = fr.reduced ? 0 : Math.sin(f.phase) * 0.07 * walk;
    fig.pose.rotation.x = walk * 0.08 + hunch * 0.35 + (fighting ? 0.06 : 0) + (strike ? strike.lean : 0) + recoil * 0.28;
    fig.pose.position.z = strike ? strike.lunge : 0;
    fig.pose.scale.y = fr.reduced ? 1 : 1 + Math.sin(fr.time * 2.2 + f.hash * 6.28) * 0.018;

    // looking around; boats on the horizon draw the eye
    if (!fr.reduced) {
      if (fr.simTime > f.nextLook) {
        f.lookGoal = fighting ? 0 : (hash01(Math.floor(fr.simTime * 10) + f.wid) - 0.5) * 1.3;
        f.nextLook = fr.simTime + 2.5 + f.hash * 4;
      }
      let goal = f.lookGoal;
      if (!ENEMY_TYPES.has(fig.type) && !fighting) {
        let best = 45;
        for (const b of fr.sailing) {
          const d = Math.hypot(b.x - f.x, b.y - f.z);
          if (d < best) {
            best = d;
            let rel = Math.atan2(b.x - f.x, b.y - f.z) - f.yaw;
            while (rel > Math.PI) rel -= Math.PI * 2;
            while (rel < -Math.PI) rel += Math.PI * 2;
            goal = Math.max(-1.2, Math.min(1.2, rel));
          }
        }
      }
      f.lookYaw += (goal - f.lookYaw) * Math.min(1, fr.simDt * 3);
    } else f.lookYaw = 0;
    fig.head.rotation.y = f.lookYaw;
    fig.head.rotation.x = hunch * 0.3;

    if (fig.weapon) {
      const base = fig.type === 'raiders' || fig.type === 'armored' || fig.type === 'guard' ? 0.35 : 0;
      // at rest the weapon keeps its carry angle; in a fight it follows the attack cycle
      fig.weapon.rotation.x = strike ? strike.weaponX : base;
    }
    if (fig.shield) {
      if (wall) {
        fig.shield.position.set(0, 0.6, 0.32);
        fig.shield.rotation.set(0, 0, 0);
      } else {
        fig.shield.position.set(-0.24, 0.5, 0.2);
        let wiggle = 0;
        if (!fr.reduced) {
          if (f.fidget < 0 && fr.simTime > f.nextFidget && speed < 0.2) f.fidget = 0;
          if (f.fidget >= 0) {
            f.fidget += fr.simDt;
            wiggle = Math.sin((f.fidget / 0.6) * Math.PI) * 0.35;
            if (f.fidget > 0.6) {
              f.fidget = -1;
              f.nextFidget = fr.simTime + 5 + f.hash * 7;
            }
          }
        }
        fig.shield.rotation.set(fighting ? -0.15 : 0, -0.5, wiggle);
      }
    }
  }

  private updateDeparting(fr: SquadFrame): void {
    const keep: Departing[] = [];
    for (const d of this.departing) {
      d.t += fr.simDt;
      const fig = d.f;
      let scale = 1;
      let done = false;
      if (d.kind === 'fall') {
        // tips onto its side, lies for a while, then shrinks away
        const p = fallPose(d.t);
        fig.pose.rotation.z = p.tilt * d.sign;
        fig.pose.rotation.x = 0.25;
        fig.pose.position.y = p.drop;
        fig.pose.position.z = 0;
        fig.head.rotation.x = 0.4;
        scale = p.scale;
        done = d.t > FALL_DONE;
      } else {
        d.x += (d.tx - d.x) * Math.min(1, fr.simDt * 2);
        d.z += (d.tz - d.z) * Math.min(1, fr.simDt * 2);
        if (d.t > 0.8) scale = Math.max(0, 1 - (d.t - 0.8) / 0.5);
        done = d.t > 1.3;
      }
      fig.root.position.set(d.x, this.terrain.heightAt(d.x, d.z), d.z);
      fig.root.rotation.y = d.yaw;
      fig.root.scale.setScalar(Math.max(0.001, scale * FIG_SCALE));
      if (done) this.group.remove(fig.root);
      else keep.push(d);
    }
    this.departing = keep;
  }

  private updateLabel(fr: SquadFrame, sq: Squad, g: SquadGfx, c: Vec): void {
    const onField = sq.mode !== 'gone' && sq.mode !== 'dead' && sq.warriors.some((w) => w.alive && !w.aboard);
    if (!onField) {
      g.label.style.display = 'none';
      this.labelAnchors.delete(sq.id);
      return;
    }
    const p = this.tmp.set(c.x, this.terrain.heightAt(c.x, c.y) + 2.9, c.y).project(fr.camera);
    if (p.z > 1 || p.x < -1.1 || p.x > 1.1 || p.y < -1.1 || p.y > 1.1) {
      g.label.style.display = 'none';
      this.labelAnchors.delete(sq.id);
      return;
    }
    g.label.style.display = '';
    const x = ((p.x + 1) / 2) * fr.width;
    const y = ((1 - p.y) / 2) * fr.height;
    this.labelAnchors.set(sq.id, { x, y });
    g.label.classList.toggle('selected', sq.id === fr.selectedId);
    if (g.lang !== getLang()) {
      g.lang = getLang();
      g.nameEl.textContent = labelText(g);
    }
    const m = Math.round(sq.morale);
    if (m !== g.lastMorale) {
      g.lastMorale = m;
      g.bar.style.width = `${m}%`;
    }
  }

  /**
   * Stacks overlapping labels so squads standing close together stay
   * readable. Sorted top-to-bottom; each label is pushed up while it would
   * cover an already placed one. Selected squad keeps its anchor (drawn last
   * via z-index instead of moving).
   */
  private resolveLabels(fr: SquadFrame): void {
    const entries = [...this.labelAnchors.entries()]
      .map(([id, pos]) => ({ id, ...pos, selected: id === fr.selectedId }))
      // unselected first (they claim space), selected last (always on top)
      .sort((a, b) => a.y - b.y || a.x - b.x);
    const placed: { x: number; y: number }[] = [];
    for (const e of entries) {
      const g = this.gfx.get(e.id);
      if (!g) continue;
      let y = e.y;
      if (!e.selected) {
        for (const q of placed) {
          if (Math.abs(e.x - q.x) < 96 && Math.abs(y - q.y) < 36) {
            y = q.y - 36;
          }
        }
      } else {
        // selected label jumps above the stack instead of pushing into it
        for (const q of placed) {
          if (Math.abs(e.x - q.x) < 96 && Math.abs(y - q.y) < 36) {
            y = Math.min(y, q.y - 36);
          }
        }
      }
      placed.push({ x: e.x, y });
      g.label.style.transform = `translate(${e.x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -100%)`;
      g.label.style.zIndex = e.selected ? '3' : '2';
    }
  }

  /** Nearest squad within a radius of a point (for selection). */
  pickSquad(s: GameState, alpha: number, p: Vec, radius: number, boatPos?: (id: number) => Vec | null): Squad | null {
    let best: Squad | null = null;
    let bestD = radius;
    for (const sq of s.squads) {
      if (sq.mode === 'gone' || sq.mode === 'dead') continue;
      // with boatPos the crew aboard a boat can be picked too (archers' attack order)
      const ashore = sq.warriors.some((w) => w.alive && !w.aboard);
      if (!ashore && !(boatPos && sq.warriors.some((w) => w.alive))) continue;
      const c = (!ashore && boatPos ? boatPos(sq.boatId) : null) ?? this.renderPos(sq, alpha);
      const d = Math.hypot(c.x - p.x, c.y - p.y) - (sq.side === 'player' ? 0.4 : 0);
      if (d < bestD) {
        bestD = d;
        best = sq;
      }
    }
    return best;
  }
}
