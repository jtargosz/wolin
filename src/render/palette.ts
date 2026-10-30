// Scene palette: a warm late-summer afternoon over the Oder mouth. Every scene color in one
// place, easy to edit. Only colors, lights and fog values live here - no geometry, no game logic.
// Hex strings are sRGB; THREE.ColorManagement converts them automatically.

import * as THREE from 'three/webgpu';
import type { BuildingKey, SquadType } from '../core/types.ts';

/** Ground tones (vertex colors on the terrain). */
export const GROUND = {
  seabed: '#6f8f7c',
  sandWet: '#bfa77a',
  sand: '#e6d1a0',
  meadow: ['#a3b85a', '#b2c066', '#94ad52', '#bfc574'] as const,
  meadowLush: '#7fa24a',
  lip: '#6c8a3a', // darker grass along the cliff lip
  plaza: '#c3a171',
  ramp: '#b08c5c',
  forestFloor: '#6f8a42',
  moss: '#58702f',
  path: '#b7ab8f',
  rock: ['#a29380', '#8a7d6c', '#b9ab94', '#7a6e60'] as const,
  rockDark: '#5f564c',
};

/** Wood, vegetation and small props. */
export const PALETTE = {
  wood: '#8a6440',
  woodDark: '#5c4129',
  woodLight: '#b08a5c',
  trunk: '#6e5036',
  pine: ['#3f6b3a', '#4b7a40', '#36603a'] as const,
  leaf: ['#7f9d3e', '#93a949', '#6f8d38', '#a8ad4e'] as const,
  bush: '#6c8b3a',
  grass: ['#9fb44f', '#b6c262', '#87a245'] as const,
  stone: ['#a1978a', '#8d8478', '#b4aa9b'] as const,
  amber: '#f2b63c',
  amberGlow: '#c87a18',
  ruin: '#6e6560',
};

/** Log walls and thatch per building. */
export const BUILDINGS: Record<BuildingKey, { wall: string; roof: string }> = {
  granary: { wall: '#9a7148', roof: '#c9a65e' },
  workshop: { wall: '#8c6844', roof: '#bf9a55' },
  lighthouse: { wall: '#7d5c3c', roof: '#b8914e' },
};

/** Hut walls rotate through these log tones by hut index. */
export const HUT_WALLS = ['#9c744a', '#8e6a44', '#a57d50', '#93704a'] as const;
export const HUT_ROOF = '#c4a15b';

/** Lighthouse fire. */
export const LIGHT = { bowl: '#3e3229', ember: '#ffb347', emberGlow: '#ff7a1a' };

/** Sea: clear shallows over sand, deep blue-green far out, white foam. */
export const WATER = {
  shallow: '#63c9b4',
  mid: '#2f9a9a',
  deep: '#1d5f78',
  foam: '#fbfaf2',
  specular: '#7a7466',
};

/** Sky gradient and horizon haze. */
export const SKY = {
  top: '#8fb8d8',
  horizon: '#f1dcb4',
  fog: '#e9d7b4',
};

/** Lights: low honey sun from the west, sky-blue fill, warm bounce from the ground. */
export const LIGHTS = {
  sun: '#ffd49a',
  sunIntensity: 3.1,
  hemiSky: '#b9d3ee',
  hemiGround: '#8a7452',
  hemiIntensity: 1.25,
};

/** Squad colors: muted tunics, saturated shields and banners for reading at distance. */
export const SQUAD_COLORS: Record<SquadType, { tunic: string; accent: string; flag: string; shield: string; cape: string }> = {
  guard: { tunic: '#7a3a2e', accent: '#8c8f92', flag: '#d8432f', shield: '#d8432f', cape: '#a8352a' },
  archers: { tunic: '#3c5a34', accent: '#2e4a2a', flag: '#3fae5a', shield: '#3fae5a', cape: '#2f6e3a' },
  spearmen: { tunic: '#7a5a2a', accent: '#5e4422', flag: '#e2a52c', shield: '#e2a52c', cape: '#b5822a' },
  raiders: { tunic: '#3d3448', accent: '#2c2536', flag: '#5a4b7a', shield: '#3b3157', cape: '#2a2238' },
  raiderArchers: { tunic: '#4a3e56', accent: '#2c2536', flag: '#6e5c8e', shield: '#4a3d66', cape: '#30283e' },
  armored: { tunic: '#4e2a34', accent: '#9aa0a6', flag: '#7e2f42', shield: '#5a2a3a', cape: '#3a1c26' },
};

/** Figure details. */
export const FIGURE = {
  skin: '#d8ab86',
  steel: '#9a9ea2',
  wood: '#6e4e30',
  shieldGuard: '#d8432f',
  shieldArmored: '#54435f',
  boss: '#c9b27a',
  quiver: '#5a4630',
  shaft: '#8a6a44',
  haft: '#5d4632',
  crest: '#b8352a',
  pole: '#5c4129',
};

/** Boats. */
export const BOATS = {
  hull: '#5a3e26',
  plank: '#6e4c2e',
  rim: '#3e2c1e',
  sail: '#efe3c6',
  stripe: '#9e3b30',
  foam: '#ffffff',
  oar: '#8a6a44',
  wakeOpacity: 0.36,
};

/** UI overlays in the 3D scene. */
export const FX = {
  selection: '#ffffff',
  selectionRouting: '#e0b070',
  selectionShadow: '#3a2f28',
  moveMark: '#ffffff',
  arrow: '#4a3a2a',
  threat: '#e07840',
  hitFront: '#ffd27a',
  hitFlank: '#ff8a4a',
  buildingHit: '#d9b48a',
  horn: '#f2e2b0',
  shield: '#d8dde0',
  smoke: '#b9b6b0',
  smokeLight: '#f1ede6',
  blood: '#6a1414',
};

export const WATER_COLOR = new THREE.Color(WATER.mid);
