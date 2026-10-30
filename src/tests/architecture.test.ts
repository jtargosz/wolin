// Architecture guard: src/core does not depend on three/DOM and uses no non-deterministic APIs.

import { describe, expect, it } from 'vitest';

const sources = import.meta.glob('../core/*.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

/** Strips comments so words in descriptions are not matched. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

const FORBIDDEN: [RegExp, string][] = [
  [/from\s+['"]three/, 'import three'],
  [/from\s+['"]\.\.\//, 'import from outside core'],
  [/\bdocument\./, 'DOM: document'],
  [/\bwindow\./, 'DOM: window'],
  [/\blocalStorage\b/, 'localStorage'],
  [/Math\.random/, 'Math.random'],
  [/Date\.now|new Date\(/, 'system clock'],
  [/performance\.now/, 'performance.now'],
  [/Math\.(sin|cos|tan|asin|acos|atan|atan2|sinh|cosh|tanh|pow|exp|expm1|log|log2|log10|log1p|hypot|cbrt)\b/, 'approximated function'],
  [/[\w)\]]\s*\*\*\s*[\w(]/, 'operator **'],
];

describe('src/core architecture', () => {
  it('the scan covers the core files', () => {
    expect(Object.keys(sources).length).toBeGreaterThanOrEqual(10);
  });

  for (const [file, raw] of Object.entries(sources)) {
    it(`${file} uses no forbidden APIs`, () => {
      const src = stripComments(raw);
      for (const [re, label] of FORBIDDEN) expect(re.test(src), `${file}: ${label}`).toBe(false);
    });
  }
});
