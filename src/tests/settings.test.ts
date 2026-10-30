import { describe, expect, it } from 'vitest';
import { defaultSettings, loadSettings, saveSettings, SETTINGS_KEY } from '../ui/settings.ts';

function memory() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
}

describe('Settings', () => {
  it('save and load', () => {
    const st = memory();
    const s = { ...defaultSettings(), music: 0.2, largeText: true };
    saveSettings(st, s);
    expect(loadSettings(st)).toEqual(s);
  });

  it('corrupted JSON gives defaults; no storage gives defaults with the motion preference', () => {
    const st = memory();
    st.setItem(SETTINGS_KEY, '{not json');
    expect(loadSettings(st)).toEqual(defaultSettings());
    expect(loadSettings(null, true).reducedMotion).toBe(true);
  });

  it('values are clamped and type-checked', () => {
    const st = memory();
    st.setItem(SETTINGS_KEY, JSON.stringify({ music: 7, sfx: -1, ambient: 'x', muted: 'yes', lang: 'de' }));
    const s = loadSettings(st);
    expect(s.music).toBe(1);
    expect(s.sfx).toBe(0);
    expect(s.ambient).toBe(defaultSettings().ambient);
    expect(s.muted).toBe(false);
    expect(s.lang).toBe('en'); // unknown language falls back to the default
  });

  it('language is stored, and the detected default is used when nothing is saved', () => {
    const st = memory();
    expect(loadSettings(st, false, 'pl').lang).toBe('pl');
    saveSettings(st, { ...defaultSettings(), lang: 'pl' });
    expect(loadSettings(st, false, 'en').lang).toBe('pl');
  });
});
