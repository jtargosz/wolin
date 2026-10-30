import { afterEach, describe, expect, it } from 'vitest';
import { UNIT_STATS } from '../core/config.ts';
import { dictionaries, detectLang, LANGS, setLang, t, unitName, buildingName, traitName, dirName, type Key } from '../ui/i18n.ts';

afterEach(() => setLang('en'));

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe('i18n', () => {
  it('both languages define exactly the same keys', () => {
    expect(Object.keys(dictionaries.pl).sort()).toEqual(Object.keys(dictionaries.en).sort());
  });

  it('translations use the same placeholders and are non-empty (except intentionally empty keys)', () => {
    const keys = Object.keys(dictionaries.en) as Key[];
    for (const key of keys) {
      expect(placeholders(dictionaries.pl[key]), key).toEqual(placeholders(dictionaries.en[key]));
      if (key !== 'trait.none') {
        expect(dictionaries.en[key].length, key).toBeGreaterThan(0);
        expect(dictionaries.pl[key].length, key).toBeGreaterThan(0);
      }
    }
  });

  it('interpolates placeholders and switches language', () => {
    setLang('en');
    expect(t('hud.wave', { n: 2, total: 3 })).toBe('Wave 2/3');
    setLang('pl');
    expect(t('hud.wave', { n: 2, total: 3 })).toBe('Fala 2/3');
  });

  it('every unit type, building, trait, and direction has a name in both languages', () => {
    for (const lang of LANGS) {
      setLang(lang);
      for (const type of Object.keys(UNIT_STATS) as (keyof typeof UNIT_STATS)[]) expect(unitName(type), `${lang} ${type}`).not.toBe('');
      for (const b of ['granary', 'workshop', 'lighthouse'] as const) expect(buildingName(b)).not.toBe('');
      for (const tr of ['fast', 'strong', 'careful', 'calm'] as const) expect(traitName(tr)).not.toBe('');
      for (const d of ['S', 'E', 'W', 'N'] as const) expect(dirName(d)).not.toBe('');
    }
  });

  it('detects Polish from the browser language, English otherwise', () => {
    expect(detectLang({ language: 'pl-PL' })).toBe('pl');
    expect(detectLang({ language: 'en-GB' })).toBe('en');
    // no language info means English; pass an explicit object so the test
    // never depends on the global navigator (its language follows the OS locale)
    expect(detectLang({})).toBe('en');
    expect(detectLang({ language: undefined })).toBe('en');
  });
});
