// Orbital camera with damping: panning, rotation, zoom. No shake.

import * as THREE from 'three/webgpu';

// a narrow lens from further away flattens perspective: the island reads like a miniature
const MIN_DIST = 32;
const MAX_DIST = 120;
const LOOK_Y = 3;
const BOUNDS = { x: 34, z: 28 };

export class CameraRig {
  readonly camera: THREE.PerspectiveCamera;
  // Start north of the town looking south: the palisade and squads are in
  // front, the southern cliffs stay in the background instead of covering
  // the view. (Map north = -Z; yaw PI puts the camera on the north sea side.)
  private target = new THREE.Vector2(0, -2);
  private goalTarget = new THREE.Vector2(0, -2);
  private yaw = Math.PI;
  private goalYaw = Math.PI;
  private dist = 88;
  private goalDist = 88;
  private tiltOffset = 0;
  private goalTilt = 0;
  reduced = false;

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(30, aspect, 1, 500);
    this.apply();
  }

  /** Movement in camera space (dx right, dz forward), in meters. */
  pan(dx: number, dz: number): void {
    const s = Math.sin(this.goalYaw);
    const c = Math.cos(this.goalYaw);
    this.goalTarget.x += dx * c - dz * s;
    this.goalTarget.y += -dx * s - dz * c;
    this.goalTarget.x = THREE.MathUtils.clamp(this.goalTarget.x, -BOUNDS.x, BOUNDS.x);
    this.goalTarget.y = THREE.MathUtils.clamp(this.goalTarget.y, -BOUNDS.z, BOUNDS.z);
  }

  /** Unlimited rotation around the island (360 degrees and more). */
  rotate(d: number): void {
    this.goalYaw += d;
  }

  /** Camera tilt (vertical drag), within sensible limits. */
  tilt(d: number): void {
    this.goalTilt = THREE.MathUtils.clamp(this.goalTilt + d, -0.3, 0.35);
  }

  zoom(factor: number): void {
    this.goalDist = THREE.MathUtils.clamp(this.goalDist * factor, MIN_DIST, MAX_DIST);
  }

  focus(x: number, z: number): void {
    this.goalTarget.set(THREE.MathUtils.clamp(x, -BOUNDS.x, BOUNDS.x), THREE.MathUtils.clamp(z, -BOUNDS.z, BOUNDS.z));
  }

  get distance(): number {
    return this.dist;
  }

  update(dt: number): void {
    const k = 1 - Math.exp(-dt * (this.reduced ? 20 : 6));
    this.target.lerp(this.goalTarget, k);
    this.yaw += (this.goalYaw - this.yaw) * k;
    this.dist += (this.goalDist - this.dist) * k;
    this.tiltOffset += (this.goalTilt - this.tiltOffset) * k;
    this.apply();
  }

  private apply(): void {
    const t = (this.dist - MIN_DIST) / (MAX_DIST - MIN_DIST);
    const pitch = THREE.MathUtils.clamp(THREE.MathUtils.lerp(0.72, 1.05, t) + this.tiltOffset, 0.4, 1.25);
    const h = Math.sin(pitch) * this.dist;
    const r = Math.cos(pitch) * this.dist;
    this.camera.position.set(this.target.x + Math.sin(this.yaw) * r, LOOK_Y + h, this.target.y + Math.cos(this.yaw) * r);
    this.camera.lookAt(this.target.x, LOOK_Y, this.target.y);
  }
}
