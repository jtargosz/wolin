// Bootstrap and frame loop: clock, simulation steps, render, audio, HUD. Snapshots at wave starts.

import './style.css';
import * as THREE from 'three/webgpu';
import { AudioEngine } from './audio/engine.ts';
import { DT, HORN_RADIUS, SPEEDS } from './core/config.ts';
import { createGame, isDifficulty, issueCommand, step } from './core/game.ts';
import type { Difficulty } from './core/types.ts';
import { advance, createClock } from './core/loop.ts';
import { generateIsland } from './core/mapgen.ts';
import type { GameEvent, GameState, Vec } from './core/types.ts';
import { Input, type KeyAction } from './input/input.ts';
import { isQuality, qualityFromUrl, type Quality } from './render/quality.ts';
import { View } from './render/view.ts';
import { Hud } from './ui/hud.ts';
import { applyStatic, buildingName, detectLang, getLang, isLang, setLang, t, unitName } from './ui/i18n.ts';
import { loadSettings, saveSettings, type Settings } from './ui/settings.ts';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

// --- URL parameters (untrusted: validated) ---
const params = new URLSearchParams(location.search);
const rawSeed = (params.get('seed') ?? '').toLowerCase();
const seed = /^[a-z0-9-]{1,32}$/.test(rawSeed)
  ? rawSeed
  : Array.from(crypto.getRandomValues(new Uint8Array(4)), (b) => b.toString(36).padStart(2, '0')).join('');
const debug = params.get('debug') === '1';
const forceWebGL = params.get('webgl') === '1';
const usePost = params.get('post') !== '0';

// --- settings ---
const media = window.matchMedia('(prefers-reduced-motion: reduce)');
const store = (() => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
})();
let settings: Settings = loadSettings(store, media.matches, detectLang());
setLang(settings.lang);

// ?quality=low|medium|high overrides the saved setting for this page load
const quality: Quality = qualityFromUrl(location.search) ?? settings.quality;

const audio = new AudioEngine();
const view = new View($<HTMLCanvasElement>('scene'), $('labels'), forceWebGL, usePost, quality);
const hud = new Hud();
const clock = createClock();
// measurement hook for the debug page (scene breakdown, quality experiments)
if (debug) (window as unknown as { __view: View }).__view = view;

// ?gen=1 generates the island from the seed (variable south); the default is the hand-made Wolin map
function selectedDifficulty(): Difficulty {
  const el = document.getElementById('difficulty') as HTMLSelectElement | null;
  const v = el?.value ?? 'normal';
  return isDifficulty(v) ? v : 'normal';
}
const newGame = () =>
  createGame(seed, {
    ...(params.get('gen') === '1' ? { map: generateIsland(seed) } : {}),
    difficulty: selectedDifficulty(),
  });
let state: GameState = newGame();
let waveSnapshot: GameState = structuredClone(state);
let selectedId = -1;
let aimingHorn = false;
let started = false;
let alpha = 0;

function applySettings(): void {
  document.documentElement.classList.toggle('large-text', settings.largeText);
  document.documentElement.classList.toggle('reduced-motion', settings.reducedMotion);
  view.reduced = settings.reducedMotion;
  audio.setVolumes(settings);
  $('mute').setAttribute('aria-pressed', String(settings.muted));
  saveSettings(store, settings);
}

/** Keeps the pause button label in sync with the clock (and the current language). */
function syncPauseButton(): void {
  const b = $('pause');
  const key = clock.paused ? 'hud.resume' : 'hud.pause';
  b.dataset.i18n = key;
  b.textContent = t(key);
  b.setAttribute('aria-pressed', String(clock.paused));
}

function setPaused(p: boolean): void {
  clock.paused = p;
  syncPauseButton();
  $('paused-banner').hidden = !p;
}

/** Applies the selected language to all static markup and both language selects. */
function applyLanguage(): void {
  setLang(settings.lang);
  syncPauseButton();
  applyStatic();
  $<HTMLSelectElement>('lang').value = settings.lang;
  $<HTMLSelectElement>('lang-title').value = settings.lang;
}

function playerSquads() {
  return state.squads.filter((q) => q.side === 'player');
}

function selected() {
  return state.squads.find((q) => q.id === selectedId);
}

function select(id: number): void {
  selectedId = id;
  const sq = selected();
  if (sq) hud.announce(t('live.selected', { unit: unitName(sq.type), n: Math.round(sq.morale) }));
}

/** Panning and attenuation of effects relative to the camera. */
function locate(p: Vec): { pan: number; gain: number } {
  const cam = view.rig.camera;
  const right = new THREE.Vector3(1, 0, 0).applyQuaternion(cam.quaternion);
  const dx = p.x - cam.position.x;
  const dz = p.y - cam.position.z;
  const d = Math.hypot(dx, dz, cam.position.y);
  return { pan: (dx * right.x + dz * right.z) / 25, gain: Math.min(1, 40 / Math.max(20, d)) };
}

function command(ok: boolean, fail: string): boolean {
  if (!ok) hud.toast(fail);
  return ok;
}

function useShield(): void {
  const sq = selected();
  if (!sq || sq.type !== 'guard') return hud.toast(t('toast.needGuard'));
  if (command(issueCommand(state, { kind: 'shieldWall', squadId: sq.id }), t('toast.shieldNotReady'))) {
    audio.ui('shield', sq.pos, locate);
    view.effects.shield(sq.pos);
  }
}

function setAiming(on: boolean): void {
  aimingHorn = on;
  $('aim-banner').hidden = !on;
}

function hornAt(p: Vec): void {
  setAiming(false);
  if (command(issueCommand(state, { kind: 'horn', at: p }), t('toast.hornResting'))) {
    audio.ui('horn', p, locate);
    view.effects.horn(p, HORN_RADIUS);
  }
}

function replaceState(next: GameState): void {
  state = next;
  waveSnapshot = structuredClone(next);
  selectedId = -1;
  setAiming(false);
  view.resetDynamic(state);
  setPaused(true);
}

function restart(): void {
  replaceState(newGame());
  hud.showHints();
}

function undoWave(): void {
  replaceState(structuredClone(waveSnapshot));
  hud.toast(t('toast.waveRetry', { n: state.waveIndex + 1 }));
}

function showEnd(result: 'won' | 'lost'): void {
  const dlg = $<HTMLDialogElement>('end');
  const standing = state.buildings.filter((b) => b.hp > 0).map((b) => buildingName(b.key));
  $('end-title').textContent = t(result === 'won' ? 'end.won.title' : 'end.lost.title');
  $('end-text').textContent =
    result === 'won' ? t('end.won.text', { buildings: standing.join(', ') }) : t('end.lost.text');
  const list = $('end-fallen');
  list.replaceChildren(
    ...state.fallen.map((f) => {
      const li = document.createElement('li');
      li.textContent = t('end.fallen', { name: f.name, unit: unitName(f.type).toLowerCase(), n: f.wave + 1 });
      return li;
    }),
  );
  $('undo-wave').hidden = result === 'won';
  dlg.showModal();
}

function handleEvents(ev: GameEvent[]): void {
  if (ev.length === 0) return;
  view.onEvents(state, ev);
  hud.onEvents(state, ev);
  for (const e of ev) {
    if (e.t === 'wavePrep') waveSnapshot = structuredClone(state);
    if (e.t === 'outcome') queueMicrotask(() => showEnd(e.result));
  }
}

function onKey(k: KeyAction): void {
  if (!started) return;
  switch (k) {
    case 'pause':
      setPaused(!clock.paused);
      break;
    case 'deselect':
      if (aimingHorn) setAiming(false);
      else selectedId = -1;
      break;
    case 'restart':
      $<HTMLDialogElement>('confirm-restart').showModal();
      break;
    case 'mute':
      settings.muted = !settings.muted;
      applySettings();
      break;
    case 'shield':
      useShield();
      break;
    case 'horn':
      setAiming(true);
      break;
    default: {
      const sq = playerSquads()[Number(k.slice(-1)) - 1];
      if (!sq || sq.mode === 'dead') break;
      if (selectedId === sq.id) view.rig.focus(sq.pos.x, sq.pos.y);
      select(sq.id);
    }
  }
}

const input = new Input($<HTMLCanvasElement>('scene'), {
  ground: (x, y) => view.groundPoint(x, y),
  select: (p) => {
    if (aimingHorn) return hornAt(p);
    const sq = view.squads.pickSquad(state, alpha, p, 2.5);
    if (sq && sq.side === 'player') select(sq.id);
    else selectedId = -1;
  },
  order: (p, facing) => {
    const sq = selected();
    if (!sq || sq.side !== 'player') return;
    // archers can also target the crew aboard a boat
    const boatPos = sq.type === 'archers' ? (id: number) => view.boats.boatPos(state, id, alpha) : undefined;
    const target = view.squads.pickSquad(state, alpha, p, 2.2, boatPos);
    if (target && target.side === 'enemy') {
      if (command(issueCommand(state, { kind: 'attack', squadId: sq.id, targetId: target.id }), t('toast.deaf')))
        audio.ui('order');
      return;
    }
    if (command(issueCommand(state, { kind: 'move', squadId: sq.id, to: p, facing }), t('toast.deaf'))) {
      const o = sq.order;
      view.effects.showMove(o.kind === 'move' ? o.to : p);
      audio.ui('order');
    }
  },
  dragPreview: (a, b) => view.effects.setFacingArrow(a, b),
  key: onKey,
  pan: (dx, dz) => view.rig.pan(dx, dz),
  rotate: (d) => view.rig.rotate(d),
  tilt: (d) => view.rig.tilt(d),
  zoom: (f) => view.rig.zoom(f),
});

// --- buttons and dialogs ---
$('pause').addEventListener('click', () => setPaused(!clock.paused));
$('call-wave').addEventListener('click', () => issueCommand(state, { kind: 'callWave' }));
$('horn').addEventListener('click', () => setAiming(true));
$('shield').addEventListener('click', useShield);
$('mute').addEventListener('click', () => {
  settings.muted = !settings.muted;
  applySettings();
});
const speed = $<HTMLInputElement>('speed');
speed.addEventListener('input', () => {
  clock.speed = SPEEDS[Number(speed.value)] ?? 1;
  const label = `${String(clock.speed).replace('.', getLang() === 'pl' ? ',' : '.')}x`;
  $('speed-out').textContent = label;
  speed.setAttribute('aria-valuetext', label);
});

const settingsDlg = $<HTMLDialogElement>('settings');
const bindRange = (id: string, key: 'music' | 'sfx' | 'ambient') => {
  const el = $<HTMLInputElement>(id);
  el.value = String(settings[key]);
  el.addEventListener('input', () => {
    settings[key] = Number(el.value);
    applySettings();
  });
};
bindRange('vol-music', 'music');
bindRange('vol-sfx', 'sfx');
bindRange('vol-ambient', 'ambient');
const bindCheck = (id: string, key: 'reducedMotion' | 'largeText') => {
  const el = $<HTMLInputElement>(id);
  el.checked = settings[key];
  el.addEventListener('change', () => {
    settings[key] = el.checked;
    applySettings();
  });
};
bindCheck('opt-motion', 'reducedMotion');
bindCheck('opt-text', 'largeText');
const onLangChange = (e: Event) => {
  const value = (e.target as HTMLSelectElement).value;
  if (!isLang(value)) return;
  settings.lang = value;
  applyLanguage();
  applySettings();
};
$<HTMLSelectElement>('lang').addEventListener('change', onLangChange);
$<HTMLSelectElement>('lang-title').addEventListener('change', onLangChange);
// The shadow map, mesh density and post-processing graph are built at startup, so a new level reloads the page.
const onQualityChange = (e: Event) => {
  const value = (e.target as HTMLSelectElement).value;
  if (!isQuality(value) || value === quality) return;
  if (started && !window.confirm(t('quality.reload'))) {
    for (const id of ['quality', 'quality-title']) $<HTMLSelectElement>(id).value = quality;
    return;
  }
  settings.quality = value;
  applySettings();
  const url = new URL(location.href);
  url.searchParams.delete('quality');
  location.assign(url.href);
};
for (const id of ['quality', 'quality-title']) {
  const el = $<HTMLSelectElement>(id);
  el.value = quality;
  el.addEventListener('change', onQualityChange);
}
$('open-settings').addEventListener('click', () => settingsDlg.showModal());

const endDlg = $<HTMLDialogElement>('end');
endDlg.addEventListener('close', () => {
  if (endDlg.returnValue === 'undo') undoWave();
  else if (endDlg.returnValue === 'restart') restart();
});
const confirmDlg = $<HTMLDialogElement>('confirm-restart');
confirmDlg.addEventListener('close', () => {
  if (confirmDlg.returnValue === 'ok') restart();
});

window.addEventListener('resize', () => view.resize());

$('start').addEventListener('click', () => {
  audio.start(); // the player gesture unlocks audio
  applySettings();
  started = true;
  $('title').hidden = true;
  $('hud').hidden = false;
  $('seed').textContent = seed;
  hud.showHints();
  setPaused(false);
});

// --- loop ---
let last = performance.now();
const lapMs = { sim: 0, audioHud: 0, frame: 0, worst: 0, n: 0 };
let fpsAcc = 0;
let fpsFrames = 0;

async function main(): Promise<void> {
  applyLanguage();
  applySettings();
  await view.init();
  view.load(state);
  $('debug').hidden = !debug;
  setPaused(true);
  $('paused-banner').hidden = true;
  const startBtn = $<HTMLButtonElement>('start');
  startBtn.disabled = false;
  startBtn.dataset.i18n = 'title.start';
  startBtn.textContent = t('title.start');
  view.renderer.setAnimationLoop(() => {
    const now = performance.now();
    const realDt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (started) input.update(realDt);
    const all: GameEvent[] = [];
    const tSim = performance.now();
    if (started) {
      const r = advance(clock, realDt);
      for (let i = 0; i < r.steps; i++) {
        view.capture(state);
        const ev = step(state);
        handleEvents(ev);
        all.push(...ev);
      }
      alpha = r.alpha;
    }
    const simDt = started && !clock.paused ? realDt * clock.speed : 0;
    const tView = performance.now();
    view.render(state, { alpha, realDt, simDt, selectedId });
    const tAudio = performance.now();
    audio.update(state, all, realDt, locate);
    hud.update(state, selected(), realDt);
    if (debug) {
      const end = performance.now();
      lapMs.sim += (tView - tSim - lapMs.sim) * 0.1;
      lapMs.audioHud += (end - tAudio - lapMs.audioHud) * 0.1;
      lapMs.frame += (end - now - lapMs.frame) * 0.1;
      if (realDt * 1000 > lapMs.worst) lapMs.worst = realDt * 1000;
    }

    if (debug) {
      fpsAcc += realDt;
      fpsFrames++;
      if (fpsAcc > 0.5) {
        $('debug').textContent = `${view.backendName} · ${quality} · ${Math.round(fpsFrames / fpsAcc)} fps · ${view.drawCalls} dc · ${view.triangles} tri · cpu ${lapMs.frame.toFixed(1)} ms (sim ${lapMs.sim.toFixed(1)}, view ${view.cpuMs.toFixed(1)}: ${Object.entries(view.parts).map(([k, v]) => `${k} ${v.toFixed(1)}`).join(', ')}; audio+hud ${lapMs.audioHud.toFixed(1)}) · worst ${lapMs.worst.toFixed(0)} ms · ${view.terrain.plantCount} plants · tick ${state.tick} (${(state.tick * DT).toFixed(0)} s)`;
        fpsAcc = 0;
        fpsFrames = 0;
        if (++lapMs.n % 10 === 0) lapMs.worst = 0; // worst frame of the last 5 s
      }
    }
  });
  if (!debug) $('debug').hidden = true;
  $('hud').title = view.backendName;
}

void main().catch((err: unknown) => {
  console.error(err);
  const p = document.createElement('p');
  p.setAttribute('role', 'alert');
  p.style.cssText = 'position:fixed;inset:auto 1rem 1rem;background:#f7f2e6;padding:1rem;border-radius:8px';
  p.textContent = t('error.graphics');
  document.body.append(p);
});
