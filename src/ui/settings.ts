// Player settings in localStorage, validated (external data is treated as untrusted).

import { DEFAULT_QUALITY, isQuality, type Quality } from '../render/quality.ts';
import { isLang, type Lang } from './i18n.ts';

export interface Settings {
  music: number;
  sfx: number;
  ambient: number;
  muted: boolean;
  reducedMotion: boolean;
  largeText: boolean;
  lang: Lang;
  quality: Quality;
}

export const SETTINGS_KEY = 'wolin.settings.v1';

export function defaultSettings(prefersReduced = false, lang: Lang = 'en'): Settings {
  return { music: 0.6, sfx: 0.8, ambient: 0.45, muted: false, reducedMotion: prefersReduced, largeText: true, lang, quality: DEFAULT_QUALITY };
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

const vol = (x: unknown, d: number) => (typeof x === 'number' && Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : d);
const bool = (x: unknown, d: boolean) => (typeof x === 'boolean' ? x : d);

export function loadSettings(store: StorageLike | null, prefersReduced = false, lang: Lang = 'en'): Settings {
  const d = defaultSettings(prefersReduced, lang);
  if (!store) return d;
  try {
    const raw = store.getItem(SETTINGS_KEY);
    if (!raw) return d;
    const o = JSON.parse(raw) as Record<string, unknown>;
    if (typeof o !== 'object' || o === null) return d;
    return {
      music: vol(o.music, d.music),
      sfx: vol(o.sfx, d.sfx),
      ambient: vol(o.ambient, d.ambient),
      muted: bool(o.muted, d.muted),
      reducedMotion: bool(o.reducedMotion, d.reducedMotion),
      largeText: bool(o.largeText, d.largeText),
      lang: isLang(o.lang) ? o.lang : d.lang,
      quality: isQuality(o.quality) ? o.quality : d.quality,
    };
  } catch {
    return d;
  }
}

export function saveSettings(store: StorageLike | null, s: Settings): void {
  try {
    store?.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    // private mode / full storage: settings last until the end of the session
  }
}
