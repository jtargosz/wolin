// Boats: hull, mast and sail, swaying on waves, seated crew, wake on the water.

import * as THREE from 'three/webgpu';
import type { Boat, GameState, SquadType, Vec } from '../core/types.ts';
import { BOAT_REST_Z, restPose, smooth } from './anim.ts';
import { createFigure, type Figure } from './figures.ts';
import { BOATS, SQUAD_COLORS } from './palette.ts';
import type { Terrain } from './terrain.ts';
import { WATER_COLOR, waveHeight } from './water.ts';

const WAKE_COUNT = 64;
const WAKE_LIFE = 3.2;
const FOAM = new THREE.Color(BOATS.foam);

/** Soft wake puff: feathered edge so the trail melts into the water, not coins. */
function makeWakeTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,0.9)');
  grad.addColorStop(0.55, 'rgba(255,255,255,0.4)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

interface BoatGfx {
  group: THREE.Group;
  oars: THREE.Object3D[];
  crew: Figure[];
  wakeTimer: number;
  shownCrew: number;
  kind: SquadType;
  sail: THREE.BufferGeometry;
  sailBase: Float32Array;
  stripe: THREE.BufferGeometry;
  stripeBase: Float32Array;
  phase: number;
  /** 0 afloat .. 1 resting on the sand (eased over about 1.5 s after landing). */
  rest: number;
  /** Plank from the bow to the beach, shown while the boat is landed. */
  gang: THREE.Group;
  gangPlank: THREE.Mesh;
  gangCleats: THREE.Mesh[];
  /** Seconds until the next patch of surf foam along the hull. */
  foamTimer: number;
}

interface Wake {
  x: number;
  z: number;
  yaw: number;
  age: number;
  /** Size multiplier (surf foam along a beached hull is small). */
  scale: number;
}

function hullGeometry(): THREE.BufferGeometry {
  // oval clinker boat: an open truncated cone stretched along the z axis (crew sits inside)
  const g = new THREE.CylinderGeometry(1, 0.55, 0.7, 16, 1, true);
  g.scale(0.9, 1, 3.4);
  g.translate(0, 0.1, 0);
  return g;
}

/** Belly depth of the sail cloth at normalized coords (u, v in 0..1): full in the middle. */
function belly(u: number, v: number): number {
  return 0.34 * Math.sin(u * Math.PI) * (0.55 + 0.45 * Math.sin(v * Math.PI));
}

function belliedCloth(w: number, h: number, segW: number, segH: number): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(w, h, segW, segH);
  const a = g.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < a.count; i++) {
    const u = a.getX(i) / w + 0.5;
    const v = a.getY(i) / h + 0.5;
    a.setZ(i, belly(u, v));
  }
  a.needsUpdate = true;
  g.computeVertexNormals();
  return g;
}

export class BoatsView {
  readonly group = new THREE.Group();
  private readonly gfx = new Map<number, BoatGfx>();
  private readonly prev = new Map<number, Vec>();
  private readonly wakes: Wake[] = [];
  private readonly wakeMesh: THREE.InstancedMesh;
  private readonly hullGeo = hullGeometry();
  // the underside: a cap exactly matching the bottom ring of the hull (radii 0.495 x 1.87 at y -0.25)
  private readonly bottomGeo = (() => {
    const g = new THREE.CircleGeometry(0.55, 24);
    g.rotateX(-Math.PI / 2);
    g.scale(0.9, 1, 3.4);
    g.translate(0, -0.25, 0);
    return g;
  })();
  // the floor boards inside, spanning the inner ellipse at floor height
  private readonly floorGeo = (() => {
    const g = new THREE.CircleGeometry(0.64, 24);
    g.rotateX(-Math.PI / 2);
    g.scale(0.9, 1, 3.4);
    g.translate(0, -0.12, 0);
    return g;
  })();
  private readonly keelGeo = new THREE.BoxGeometry(0.15, 0.1, 5.4).translate(0, -0.25, 0);
  private readonly seamGeo = new THREE.BoxGeometry(1.1, 0.012, 0.025);
  private readonly thwartGeo = new THREE.BoxGeometry(1.5, 0.07, 0.2);
  private readonly plankMat = new THREE.MeshLambertMaterial({ color: BOATS.plank, side: THREE.DoubleSide });
  private readonly hullMat = new THREE.MeshLambertMaterial({ color: BOATS.hull, side: THREE.DoubleSide });
  private readonly rimMat = new THREE.MeshLambertMaterial({ color: BOATS.rim });
  private readonly sailMat = new THREE.MeshLambertMaterial({ color: BOATS.sail, side: THREE.DoubleSide });
  private readonly stripeMat = new THREE.MeshLambertMaterial({
    color: BOATS.stripe,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -1,
  });
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly c = new THREE.Color();
  private readonly gangStart = new THREE.Vector3();
  private readonly gangEnd = new THREE.Vector3();
  private foamFlip = false;
  private readonly stemGeo = (() => {
    // the post rises from the keel and curls back over the bow
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, -0.3, -0.5),
      new THREE.Vector3(0, 0.2, 0.15),
      new THREE.Vector3(0, 0.95, 0.45),
      new THREE.Vector3(0, 1.55, 0.25),
      new THREE.Vector3(0, 1.7, -0.1),
    ]);
    return new THREE.TubeGeometry(curve, 16, 0.11, 6, false);
  })();
  private readonly boatShieldGeo = new THREE.CylinderGeometry(0.3, 0.3, 0.05, 12).rotateX(Math.PI / 2);
  private readonly oarGeo = new THREE.CylinderGeometry(0.03, 0.03, 2.2, 5).rotateZ(Math.PI / 2);
  private readonly oarMat = new THREE.MeshLambertMaterial({ color: BOATS.oar });
  private readonly shieldMats = new Map<SquadType, THREE.MeshLambertMaterial>();

  private shieldMat(kind: SquadType): THREE.MeshLambertMaterial {
    let m = this.shieldMats.get(kind);
    if (!m) {
      m = new THREE.MeshLambertMaterial({ color: SQUAD_COLORS[kind].shield });
      this.shieldMats.set(kind, m);
    }
    return m;
  }

  /** `shadows` false: the boats do not cast shadows (the quality profile). */
  constructor(
    private readonly terrain: Terrain,
    private readonly shadows = true,
  ) {
    const wakeGeo = new THREE.CircleGeometry(1, 14);
    wakeGeo.rotateX(-Math.PI / 2);
    this.wakeMesh = new THREE.InstancedMesh(
      wakeGeo,
      new THREE.MeshBasicMaterial({
        color: BOATS.foam,
        map: makeWakeTexture(),
        transparent: true,
        opacity: BOATS.wakeOpacity,
        depthWrite: false,
      }),
      WAKE_COUNT,
    );
    this.wakeMesh.count = 0;
    this.wakeMesh.renderOrder = 2;
    this.wakeMesh.frustumCulled = false;
    for (let i = 0; i < WAKE_COUNT; i++) this.wakeMesh.setColorAt(i, FOAM);
    this.group.add(this.wakeMesh);
  }

  capture(s: GameState): void {
    for (const b of s.boats) this.prev.set(b.id, { x: b.pos.x, y: b.pos.y });
  }

  reset(): void {
    for (const g of this.gfx.values()) this.group.remove(g.group, g.gang);
    this.gfx.clear();
    this.prev.clear();
    this.wakes.length = 0;
    this.wakeMesh.count = 0;
  }

  renderPos(b: Boat, alpha: number): Vec {
    const p = this.prev.get(b.id) ?? b.pos;
    return { x: p.x + (b.pos.x - p.x) * alpha, y: p.y + (b.pos.y - p.y) * alpha };
  }

  private makeGfx(kind: SquadType, id: number): BoatGfx {
    const group = new THREE.Group();
    const hull = new THREE.Mesh(this.hullGeo, this.hullMat);
    hull.castShadow = true;
    const floor = new THREE.Mesh(this.floorGeo, this.plankMat);
    floor.receiveShadow = true;
    const bottom = new THREE.Mesh(this.bottomGeo, this.hullMat);
    const keel = new THREE.Mesh(this.keelGeo, this.rimMat);
    keel.castShadow = true;
    const inside = new THREE.Group();
    // plank seams across the floor and thwarts (seats) between the rows of the crew
    for (let k = -4; k <= 4; k++) {
      const seam = new THREE.Mesh(this.seamGeo, this.rimMat);
      seam.position.set(0, -0.11, k * 0.4);
      inside.add(seam);
    }
    for (const z of [1.1, 0.1, -0.9]) {
      const thwart = new THREE.Mesh(this.thwartGeo, this.plankMat);
      thwart.position.set(0, 0.12, z);
      inside.add(thwart);
    }
    const rim = new THREE.Mesh(new THREE.TorusGeometry(1, 0.06, 8, 24), this.rimMat);
    rim.rotation.x = Math.PI / 2;
    rim.scale.set(0.9, 3.4, 1);
    rim.position.y = 0.45;
    // curled stem and stern posts
    const prow = new THREE.Group();
    for (const end of [1, -1]) {
      const post = new THREE.Mesh(this.stemGeo, this.rimMat);
      post.position.set(0, 0.3, end * 2.95);
      if (end < 0) post.rotation.y = Math.PI;
      post.castShadow = true;
      prow.add(post);
    }
    // a row of painted shields on each side, oars between them
    const shieldMat = this.shieldMat(kind);
    const oars: THREE.Object3D[] = [];
    for (let k = 0; k < 5; k++) {
      const z = -1.7 + k * 0.85;
      const halfW = 0.9 * Math.sqrt(Math.max(0.05, 1 - (z / 3.4) * (z / 3.4)));
      for (const side of [-1, 1]) {
        const sh = new THREE.Mesh(this.boatShieldGeo, shieldMat);
        sh.position.set(side * (halfW + 0.02), 0.5, z);
        sh.rotation.y = (side * Math.PI) / 2;
        prow.add(sh);
        const oarPivot = new THREE.Group();
        oarPivot.position.set(side * halfW, 0.42, z + 0.42);
        const oar = new THREE.Mesh(this.oarGeo, this.oarMat);
        oar.rotation.z = side * 1.2;
        oar.position.x = side * 1.0;
        oarPivot.add(oar);
        oarPivot.userData.side = side;
        oarPivot.userData.phase = k * 0.15;
        prow.add(oarPivot);
        oars.push(oarPivot);
      }
    }
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 4.2, 8), this.rimMat);
    mast.position.set(0, 2.3, 0.4);
    mast.castShadow = true;
    const sailGeo = belliedCloth(2.4, 2.0, 6, 4);
    const sail = new THREE.Mesh(sailGeo, this.sailMat);
    sail.position.set(0, 2.8, 0.45);
    sail.castShadow = true;
    const stripeGeo = belliedCloth(2.42, 0.35, 6, 1);
    const stripe = new THREE.Mesh(stripeGeo, this.stripeMat);
    stripe.position.set(0, 2.8, 0.48);
    group.add(hull, bottom, keel, floor, inside, rim, prow, mast, sail, stripe);
    // the gangway lies in the world, not in the boat: it spans from the bow to the sand
    const gang = new THREE.Group();
    const gangPlank = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.06, 1), this.plankMat);
    gangPlank.castShadow = true;
    gang.add(gangPlank);
    const gangCleats: THREE.Mesh[] = [];
    for (let k = 0; k < 6; k++) {
      const cleat = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.045, 0.07), this.rimMat);
      gang.add(cleat);
      gangCleats.push(cleat);
    }
    gang.visible = false;
    this.group.add(gang);
    if (!this.shadows) {
      group.traverse((o) => {
        o.castShadow = false;
      });
      gangPlank.castShadow = false;
    }
    return {
      rest: 0,
      gang,
      gangPlank,
      gangCleats,
      foamTimer: 0,
      group,
      oars,
      crew: [],
      wakeTimer: 0,
      shownCrew: -1,
      kind,
      sail: sailGeo,
      sailBase: Float32Array.from(sailGeo.getAttribute('position').array as Float32Array),
      stripe: stripeGeo,
      stripeBase: Float32Array.from(stripeGeo.getAttribute('position').array as Float32Array),
      phase: (id * 1.7) % (Math.PI * 2),
    };
  }

  private setCrew(g: BoatGfx, n: number): void {
    if (g.shownCrew === n) return;
    g.shownCrew = n;
    while (g.crew.length < n) {
      const f = createFigure(g.kind);
      f.pose.scale.set(0.95, 0.72, 0.95);
      g.group.add(f.root);
      g.crew.push(f);
    }
    g.crew.forEach((f, i) => {
      f.root.visible = i < n;
      const row = Math.floor(i / 2);
      f.root.position.set(i % 2 === 0 ? -0.35 : 0.35, 0.05, 1.6 - row * 1.0);
    });
  }

  update(s: GameState, alpha: number, time: number, simDt: number): void {
    const seen = new Set<number>();
    for (const b of s.boats) {
      if (b.state === 'waiting' || b.state === 'gone') continue;
      seen.add(b.id);
      let g = this.gfx.get(b.id);
      if (!g) {
        g = this.makeGfx(b.kind, b.id);
        this.gfx.set(b.id, g);
        this.group.add(g.group);
      }
      const p = this.renderPos(b, alpha);
      const yaw = Math.atan2(b.heading.x, b.heading.y);
      const fx = Math.sin(yaw);
      const fz = Math.cos(yaw);
      const calm = b.state === 'landed' ? 0.45 : 1;
      const hc = waveHeight(p.x, p.y, time) * calm;
      const hb = waveHeight(p.x + fx * 3, p.y + fz * 3, time) * calm;
      const hs = waveHeight(p.x - fx * 3, p.y - fz * 3, time) * calm;
      // a landed boat settles onto the sand (closed bottom on the ground, bow a little up); afloat it follows the waves
      const target = b.state === 'landed' ? 1 : 0;
      g.rest += Math.sign(target - g.rest) * Math.min(Math.abs(target - g.rest), simDt / 1.5);
      let boatY = hc - 0.05;
      let pitch = (hb - hs) / 6;
      if (g.rest > 0) {
        const rp = restPose(
          boatY,
          this.terrain.baseHeightAt(p.x + fx * BOAT_REST_Z, p.y + fz * BOAT_REST_Z),
          this.terrain.baseHeightAt(p.x, p.y),
          this.terrain.baseHeightAt(p.x - fx * BOAT_REST_Z, p.y - fz * BOAT_REST_Z),
        );
        const k = smooth(0, 1, g.rest);
        boatY += (rp.y - boatY) * k;
        pitch += (rp.pitch - pitch) * k;
      }
      g.group.position.set(p.x, boatY, p.y);
      g.group.rotation.set(0, 0, 0);
      g.group.rotateY(yaw);
      g.group.rotateX(-pitch);
      g.group.rotateZ(Math.sin(time * 0.9 + b.id) * 0.035 * calm * (1 - g.rest * 0.8));
      this.updateGangway(g, b.state === 'landed' && g.rest > 0.6, fx, fz);
      // surf washes along a beached hull
      if (b.state === 'landed' && simDt > 0) {
        g.foamTimer -= simDt;
        if (g.foamTimer <= 0) {
          g.foamTimer = 0.7;
          const side = (this.foamFlip = !this.foamFlip) ? 1 : -1;
          const along = (Math.random() - 0.5) * 3.2;
          this.wakes.push({ x: p.x + fz * side * 0.95 + fx * along, z: p.y - fx * side * 0.95 + fz * along, yaw, age: 0, scale: 0.4 });
          if (this.wakes.length > WAKE_COUNT) this.wakes.shift();
        }
      }
      // sail cloth breathes gently (a few dozen verts per boat - negligible cost)
      const flutter = 1 + 0.12 * Math.sin(time * 2.2 + g.phase) * calm;
      this.flutterCloth(g.sail, g.sailBase, flutter);
      this.flutterCloth(g.stripe, g.stripeBase, flutter);
      // oars sweep while under way, rest shipped (raised) once beached
      const rowing = b.state !== 'landed';
      for (const o of g.oars) {
        const side = o.userData.side as number;
        const ph = time * 2.4 + (o.userData.phase as number);
        o.rotation.set(0, rowing ? side * 0.45 * Math.sin(ph) : 0, rowing ? side * 0.18 * Math.cos(ph) : side * -0.55);
      }

      // crew: everyone before landing, afterwards only those who have not disembarked yet
      let crew = b.crew;
      const sq = s.squads.find((q) => q.id === b.squadId);
      if (b.state === 'landed') crew = sq ? sq.warriors.filter((w) => w.alive && w.aboard).length : 0;
      if (b.state === 'leaving') crew = sq ? sq.warriors.filter((w) => w.alive).length : Math.max(0, g.shownCrew);
      this.setCrew(g, crew);

      if (simDt > 0 && b.speed > 0.3) {
        g.wakeTimer -= simDt;
        if (g.wakeTimer <= 0) {
          g.wakeTimer = 0.28;
          this.wakes.push({ x: p.x - fx * 3.2, z: p.y - fz * 3.2, yaw, age: 0, scale: 1 });
          if (this.wakes.length > WAKE_COUNT) this.wakes.shift();
        }
      }
    }
    for (const [id, g] of this.gfx) {
      if (seen.has(id)) continue;
      this.group.remove(g.group, g.gang);
      this.gfx.delete(id);
    }
    this.updateWakes(time, simDt);
  }

  /** The gangway: from the bow gunwale down to the sand, so the crew steps off onto something. */
  private updateGangway(g: BoatGfx, show: boolean, fx: number, fz: number): void {
    g.gang.visible = show;
    if (!show) return;
    g.group.updateMatrixWorld(true);
    const start = this.gangStart.set(0.4, 0.5, 3.0).applyMatrix4(g.group.matrixWorld);
    const ex = start.x + fx * 2.6;
    const ez = start.z + fz * 2.6;
    const end = this.gangEnd.set(ex, this.terrain.baseHeightAt(ex, ez) + 0.05, ez);
    const len = Math.max(0.5, start.distanceTo(end));
    g.gang.position.copy(start).add(end).multiplyScalar(0.5);
    g.gang.lookAt(end);
    g.gangPlank.scale.z = len;
    g.gangCleats.forEach((c, i) => {
      c.position.set(0, 0.05, (i / (g.gangCleats.length - 1) - 0.5) * (len - 0.2));
    });
  }

  /** Scales the cloth belly around its stored base shape (sail and stripe stay together). */
  private flutterCloth(geo: THREE.BufferGeometry, base: Float32Array, k: number): void {
    const a = geo.getAttribute('position') as THREE.BufferAttribute;
    const arr = a.array as Float32Array;
    for (let i = 2; i < arr.length; i += 3) arr[i] = base[i] * k;
    a.needsUpdate = true;
  }

  private updateWakes(time: number, simDt: number): void {
    let n = 0;
    for (let i = 0; i < this.wakes.length; i++) {
      const w = this.wakes[i];
      w.age += simDt;
      if (w.age > WAKE_LIFE) continue;
      const k = w.age / WAKE_LIFE;
      const sc = (0.5 + k * 1.8) * w.scale;
      this.q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, w.yaw);
      this.m.compose(new THREE.Vector3(w.x, waveHeight(w.x, w.z, time) + 0.05, w.z), this.q, new THREE.Vector3(sc * 0.7, 1, sc * 1.4));
      this.wakeMesh.setMatrixAt(n, this.m);
      this.c.copy(FOAM).lerp(WATER_COLOR, k);
      this.wakeMesh.setColorAt(n, this.c);
      n++;
    }
    // drop expired ones from the start (oldest)
    while (this.wakes.length > 0 && this.wakes[0].age > WAKE_LIFE) this.wakes.shift();
    this.wakeMesh.count = n;
    this.wakeMesh.instanceMatrix.needsUpdate = true;
    if (this.wakeMesh.instanceColor) this.wakeMesh.instanceColor.needsUpdate = true;
  }

  /** Boat position in the render (for figures disembarking). */
  boatPos(s: GameState, id: number, alpha: number): Vec | null {
    const b = s.boats.find((x) => x.id === id);
    return b ? this.renderPos(b, alpha) : null;
  }
}
