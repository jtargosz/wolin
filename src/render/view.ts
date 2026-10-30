// Render facade: WebGPURenderer (automatic WebGL 2 fallback), scene, light, haze, post-processing, picking.

import * as THREE from 'three/webgpu';
import type { GameEvent, GameState, Vec } from '../core/types.ts';
import { BoatsView } from './boats.ts';
import { CameraRig } from './camera.ts';
import { Effects } from './effects.ts';
import { configureFigures } from './figures.ts';
import { Post } from './post.ts';
import { QUALITY_PROFILES, type Quality, type QualityProfile } from './quality.ts';
import { SquadsView } from './squads.ts';
import { Terrain } from './terrain.ts';
import { LIGHTS, SKY } from './palette.ts';
import { setWaveAmplitude, Water } from './water.ts';

const FOG_COLOR = new THREE.Color(SKY.fog);
// Warm haze swallows the open sea toward the horizon; boats sail out of it. The island stays crisp.
const HAZE_NEAR = 105;
const HAZE_FAR = 250;

export interface FrameInfo {
  alpha: number;
  realDt: number;
  simDt: number; // realDt x speed, 0 when paused
  selectedId: number;
}

export class View {
  readonly renderer: THREE.WebGPURenderer;
  readonly scene = new THREE.Scene();
  readonly rig: CameraRig;
  terrain!: Terrain;
  squads!: SquadsView;
  boats!: BoatsView;
  effects!: Effects;
  readonly profile: QualityProfile;
  private readonly water: Water;
  private post: Post | null = null;
  private readonly raycaster = new THREE.Raycaster();
  private readonly ndc = new THREE.Vector2();
  private readonly plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private world: THREE.Group | null = null;
  private time = 0;
  private simTime = 0;
  reduced = false;
  /** Smoothed JS milliseconds per frame, shown in the debug line. */
  cpuMs = 0;
  /** Smoothed JS milliseconds per frame section (debug line). */
  readonly parts: Record<string, number> = {};
  private lastLap = 0;

  constructor(
    readonly canvas: HTMLCanvasElement,
    private readonly labels: HTMLElement,
    forceWebGL: boolean,
    private readonly usePost = true,
    readonly quality: Quality = 'high',
  ) {
    this.profile = QUALITY_PROFILES[quality];
    this.water = new Water(this.profile.waterSegments);
    configureFigures(this.profile.shadowSmall);
    // MSAA happens in the post-processing scene pass; the plain path keeps the canvas MSAA
    this.renderer = new THREE.WebGPURenderer({ canvas, antialias: !usePost, samples: usePost ? 0 : 4, forceWebGL });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.profile.pixelRatioCap));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.95;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap; // PCFSoft is unsupported by WebGPURenderer
    this.rig = new CameraRig(1);
    this.scene.background = FOG_COLOR.clone();
    this.scene.fog = new THREE.Fog(FOG_COLOR, HAZE_NEAR, HAZE_FAR);

    this.scene.add(new THREE.HemisphereLight(LIGHTS.hemiSky, LIGHTS.hemiGround, LIGHTS.hemiIntensity));
    // low afternoon sun from the south-west: long shadows across the terraces
    const sun = new THREE.DirectionalLight(LIGHTS.sun, LIGHTS.sunIntensity);
    sun.position.set(-34, 30, 26);
    sun.castShadow = true;
    sun.shadow.mapSize.set(this.profile.shadowSize, this.profile.shadowSize);
    sun.shadow.radius = 2.5;
    sun.shadow.bias = -0.0003;
    sun.shadow.normalBias = 0.05;
    const sc = sun.shadow.camera;
    sc.left = -42;
    sc.right = 42;
    sc.top = 38;
    sc.bottom = -38;
    sc.near = 1;
    sc.far = 130;
    this.scene.add(sun, sun.target);
    this.scene.add(this.water.mesh);
    this.resize();
  }

  async init(): Promise<void> {
    await this.renderer.init();
    if (this.usePost) this.post = new Post(this.renderer, this.scene, this.rig.camera, this.profile);
  }

  get backendName(): string {
    const b = (this.renderer as unknown as { backend: { isWebGPUBackend?: boolean } }).backend;
    return (b?.isWebGPUBackend ? 'WebGPU' : 'WebGL 2') + (this.post ? '' : ' (no post)');
  }

  /** Builds the world for a state (new game or undo). */
  load(s: GameState): void {
    if (this.world) this.scene.remove(this.world);
    this.world = new THREE.Group();
    this.terrain = new Terrain(s.map, s.seed, this.profile.terrainSub, this.profile.shadowSmall);
    this.water.setMap(s.map);
    this.squads = new SquadsView(this.terrain, this.labels, s.map);
    this.boats = new BoatsView(this.terrain, this.profile.shadowSmall);
    this.effects = new Effects(this.terrain);
    this.effects.setSmoke(s.map);
    this.world.add(this.terrain.group, this.squads.group, this.boats.group, this.effects.group);
    this.scene.add(this.world);
    this.resetDynamic(s);
  }

  /** When the state is replaced by a snapshot of the same world. */
  resetDynamic(_s: GameState): void {
    this.labels.replaceChildren();
    this.squads.reset();
    this.boats.reset();
    this.effects.reset();
  }

  capture(s: GameState): void {
    this.squads.capture(s);
    this.boats.capture(s);
  }

  onEvents(s: GameState, ev: GameEvent[]): void {
    this.effects.onEvents(s, ev);
    this.squads.onEvents(s, ev);
    this.terrain.onEvents(ev);
  }

  resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    // Refresh the ratio on every resize: moving the window across monitors
    // or changing the browser zoom changes devicePixelRatio without a reload.
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.profile.pixelRatioCap));
    this.renderer.setSize(w, h, false);
    this.rig.camera.aspect = w / h;
    this.rig.camera.updateProjectionMatrix();
  }

  /** Point on the terrain (or water level) under the cursor. */
  groundPoint(clientX: number, clientY: number): Vec | null {
    const r = this.canvas.getBoundingClientRect();
    this.ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(this.ndc, this.rig.camera);
    const hit = this.raycaster.intersectObject(this.terrain.ground, false)[0];
    if (hit) return { x: hit.point.x, y: hit.point.z };
    const p = new THREE.Vector3();
    return this.raycaster.ray.intersectPlane(this.plane, p) ? { x: p.x, y: p.z } : null;
  }

  render(s: GameState, f: FrameInfo): void {
    const t0 = performance.now();
    this.lastLap = t0;
    this.renderFrame(s, f);
    // smoothed JS time of one frame (encoding and submitting included, GPU time is not)
    this.cpuMs += (performance.now() - t0 - this.cpuMs) * 0.1;
  }

  /** Adds the time since the previous lap to the smoothed per-part JS times (debug line). */
  private lap(name: string): void {
    const now = performance.now();
    this.parts[name] = (this.parts[name] ?? 0) + (now - this.lastLap - (this.parts[name] ?? 0)) * 0.1;
    this.lastLap = now;
  }

  private renderFrame(s: GameState, f: FrameInfo): void {
    this.time += f.realDt;
    this.simTime += f.simDt;
    setWaveAmplitude(this.reduced ? 0.35 : 1);
    this.rig.reduced = this.reduced;
    this.rig.update(f.realDt);
    this.water.update(this.time);

    this.effects.reduced = this.reduced;
    this.terrain.updateBuildings(s, f.simDt, this.rig.camera, this.reduced);
    this.terrain.updateTrees(this.time, this.reduced);
    this.lap('terrain');
    const sailing: Vec[] = [];
    for (const b of s.boats) if (b.state === 'sailing') sailing.push(this.boats.renderPos(b, f.alpha));
    this.boats.update(s, f.alpha, this.time, f.simDt);
    this.lap('boats');
    this.squads.update({
      state: s,
      alpha: f.alpha,
      time: this.time,
      simTime: this.simTime,
      simDt: f.simDt,
      reduced: this.reduced,
      camera: this.rig.camera,
      width: window.innerWidth,
      height: window.innerHeight,
      selectedId: f.selectedId,
      boatPos: (id) => this.boats.boatPos(s, id, f.alpha),
      sailing,
    });
    this.lap('squads');
    const sel = s.squads.find((q) => q.id === f.selectedId);
    this.effects.setSelection(sel ? this.squads.renderPos(sel, f.alpha) : null, sel?.mode === 'routing');
    this.effects.update(s, this.time, f.realDt, f.simDt, this.rig.camera);
    this.lap('effects');
    if (this.post) {
      this.post.setFocus(this.rig.distance);
      this.post.render();
    } else this.renderer.render(this.scene, this.rig.camera);
    this.lap('submit');
  }

  get drawCalls(): number {
    return this.renderer.info.render.drawCalls;
  }

  get triangles(): number {
    return this.renderer.info.render.triangles;
  }
}
