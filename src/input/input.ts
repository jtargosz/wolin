// Mouse and keyboard to game actions. main.ts translates them into Commands.

import type { Vec } from '../core/types.ts';

export interface InputActions {
  ground(x: number, y: number): Vec | null;
  select(p: Vec): void; // left mouse button
  order(p: Vec, facing: Vec | null): void; // right mouse button (+ drag)
  dragPreview(from: Vec | null, to: Vec | null): void;
  key(action: KeyAction): void;
  pan(dx: number, dz: number): void;
  rotate(d: number): void;
  tilt(d: number): void;
  zoom(f: number): void;
}

export type KeyAction = 'pause' | 'deselect' | 'restart' | 'mute' | 'shield' | 'horn' | 'squad1' | 'squad2' | 'squad3';

const KEYMAP: Record<string, KeyAction> = {
  Space: 'pause',
  Escape: 'deselect',
  KeyR: 'restart',
  KeyM: 'mute',
  KeyF: 'shield',
  KeyG: 'horn',
  Digit1: 'squad1',
  Digit2: 'squad2',
  Digit3: 'squad3',
  Numpad1: 'squad1',
  Numpad2: 'squad2',
  Numpad3: 'squad3',
};

export class Input {
  private readonly held = new Set<string>();
  private rightFrom: Vec | null = null;
  private rightStart = { x: 0, y: 0 };
  private orbitX: number | null = null; // middle button: camera rotation
  private left: { x: number; y: number; lastX: number; lastY: number; dragged: boolean } | null = null;

  constructor(
    canvas: HTMLCanvasElement,
    private readonly a: InputActions,
  ) {
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('pointerdown', (e) => {
      if (e.button === 1) {
        e.preventDefault();
        this.orbitX = e.clientX;
        canvas.setPointerCapture(e.pointerId);
        return;
      }
      if (e.button === 0) {
        // left button: click = select, drag = 360-degree rotation
        this.left = { x: e.clientX, y: e.clientY, lastX: e.clientX, lastY: e.clientY, dragged: false };
        canvas.setPointerCapture(e.pointerId);
        return;
      }
      const p = a.ground(e.clientX, e.clientY);
      if (!p) return;
      if (e.button === 2) {
        this.rightFrom = p;
        this.rightStart = { x: e.clientX, y: e.clientY };
        canvas.setPointerCapture(e.pointerId);
      }
    });
    canvas.addEventListener('pointermove', (e) => {
      const l = this.left;
      if (l) {
        if (!l.dragged && Math.hypot(e.clientX - l.x, e.clientY - l.y) >= 6) l.dragged = true;
        if (l.dragged) {
          a.rotate((e.clientX - l.lastX) * 0.008);
          a.tilt((e.clientY - l.lastY) * 0.004);
          l.lastX = e.clientX;
          l.lastY = e.clientY;
        }
        return;
      }
      if (this.orbitX !== null) {
        a.rotate((e.clientX - this.orbitX) * 0.008);
        this.orbitX = e.clientX;
        return;
      }
      if (!this.rightFrom) return;
      if (Math.hypot(e.clientX - this.rightStart.x, e.clientY - this.rightStart.y) < 12) return a.dragPreview(null, null);
      a.dragPreview(this.rightFrom, a.ground(e.clientX, e.clientY));
    });
    canvas.addEventListener('pointerup', (e) => {
      if (e.button === 1) this.orbitX = null;
      if (e.button === 0 && this.left) {
        const wasDrag = this.left.dragged;
        this.left = null;
        const p = wasDrag ? null : a.ground(e.clientX, e.clientY);
        if (p) a.select(p);
        return;
      }
      if (e.button !== 2 || !this.rightFrom) return;
      const from = this.rightFrom;
      this.rightFrom = null;
      a.dragPreview(null, null);
      const dragged = Math.hypot(e.clientX - this.rightStart.x, e.clientY - this.rightStart.y) >= 12;
      const to = dragged ? a.ground(e.clientX, e.clientY) : null;
      a.order(from, to ? { x: to.x - from.x, y: to.y - from.y } : null);
    });
    canvas.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        a.zoom(e.deltaY > 0 ? 1.1 : 1 / 1.1);
      },
      { passive: false },
    );

    window.addEventListener('keydown', (e) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA')) return;
      if (document.querySelector('dialog[open]')) return;
      const act = KEYMAP[e.code];
      if (act) {
        if (e.code === 'Space') e.preventDefault();
        if (!e.repeat) a.key(act);
        return;
      }
      this.held.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.held.delete(e.code));
    window.addEventListener('blur', () => this.held.clear());
  }

  /** Continuous camera control from the keyboard. */
  update(dt: number): void {
    const h = this.held;
    const v = 22 * dt;
    let dx = 0;
    let dz = 0;
    if (h.has('KeyA') || h.has('ArrowLeft')) dx -= v;
    if (h.has('KeyD') || h.has('ArrowRight')) dx += v;
    if (h.has('KeyW') || h.has('ArrowUp')) dz += v;
    if (h.has('KeyS') || h.has('ArrowDown')) dz -= v;
    if (dx || dz) this.a.pan(dx, dz);
    if (h.has('KeyQ')) this.a.rotate(-1.4 * dt);
    if (h.has('KeyE')) this.a.rotate(1.4 * dt);
  }
}
