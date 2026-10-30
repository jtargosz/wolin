import { describe, expect, it } from 'vitest';
import {
  ARP,
  arpMidi,
  chordForBar,
  chordLength,
  D_DORIAN_PCS,
  degreeToMidi,
  isChordStart,
  isChordTone,
  LOOP_BARS,
  midiToHz,
  OSTINATO,
  passOf,
  PASSES,
  PHRASES,
  phraseForBar,
  PROGRESSION,
} from '../audio/score.ts';

describe('score: harmony', () => {
  it('has an eight-bar progression that loops', () => {
    expect(PROGRESSION).toHaveLength(8);
    expect(LOOP_BARS).toBe(8);
    expect(chordForBar(8).name).toBe(chordForBar(0).name);
    expect(chordForBar(-1).name).toBe(PROGRESSION[7].name);
    expect(chordForBar(19).name).toBe(PROGRESSION[3].name);
  });

  it('every chord note belongs to D Dorian', () => {
    for (const c of PROGRESSION) for (const m of [c.root, ...c.tones]) expect(D_DORIAN_PCS).toContain(m % 12);
  });

  it('the form has two passes', () => {
    expect(PASSES).toBe(2);
    expect([0, 7, 8, 15, 16].map(passOf)).toEqual([0, 0, 1, 1, 0]);
  });

  it('a held chord is struck once: starts and lengths', () => {
    expect(isChordStart(0)).toBe(false); // bar 7 is the same Dm; the music forces the very first start itself
    expect(isChordStart(2)).toBe(true);
    expect(isChordStart(3)).toBe(false);
    expect(chordLength(2)).toBe(2);
    expect(chordLength(7)).toBe(3); // Dm into the next loop's two Dm bars
    expect(chordLength(4)).toBe(1);
  });

  it('midiToHz and degrees', () => {
    expect(midiToHz(69)).toBeCloseTo(440, 6);
    expect(midiToHz(57)).toBeCloseTo(220, 6);
    expect(degreeToMidi(0)).toBe(62);
    expect(degreeToMidi(7)).toBe(74);
    expect(degreeToMidi(-1)).toBe(60);
    expect(degreeToMidi(5)).toBe(71);
  });
});

describe('score: melody', () => {
  it('has four phrases per pass, starting on even bars only', () => {
    for (const pass of PHRASES) expect(pass).toHaveLength(4);
    expect(phraseForBar(0)).toBe(PHRASES[0][0]);
    expect(phraseForBar(1)).toBeNull();
    expect(phraseForBar(6)).toBe(PHRASES[0][3]);
    expect(phraseForBar(8)).toBe(PHRASES[1][0]);
    expect(phraseForBar(16)).toBe(PHRASES[0][0]);
  });

  it('notes are D Dorian, in range D4 to D6, and sit inside the two bars', () => {
    for (const pass of PHRASES) {
      for (const phrase of pass) {
        for (const note of phrase) {
          const midi = degreeToMidi(note.degree);
          expect(D_DORIAN_PCS).toContain(midi % 12);
          expect(midi).toBeGreaterThanOrEqual(62);
          expect(midi).toBeLessThanOrEqual(86);
          expect(note.beat).toBeGreaterThanOrEqual(0);
          expect(note.beat).toBeLessThan(8);
          expect(note.beat + note.beats).toBeLessThanOrEqual(8);
          expect(note.vel).toBeGreaterThan(0);
          expect(note.vel).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it('the first note of a phrase is a tone of the chord under it, and notes do not overlap', () => {
    PHRASES.forEach((pass, p) => {
      pass.forEach((phrase, i) => {
        const bar = p * LOOP_BARS + i * 2;
        expect(isChordTone(degreeToMidi(phrase[0].degree), chordForBar(bar)), `pass ${p} phrase ${i}`).toBe(true);
        expect(phrase[0].beat).toBe(0);
        for (let k = 1; k < phrase.length; k++) expect(phrase[k].beat).toBeGreaterThanOrEqual(phrase[k - 1].beat + phrase[k - 1].beats - 1e-9);
      });
    });
  });

  it('the second pass differs from the first', () => {
    for (let i = 0; i < 4; i++) expect(JSON.stringify(PHRASES[1][i])).not.toBe(JSON.stringify(PHRASES[0][i]));
  });
});

describe('score: accompaniment patterns', () => {
  it('harp patterns have eight steps and valid indices; notes stay in the harp range', () => {
    for (const pat of ARP) {
      expect(pat).toHaveLength(8);
      for (const i of pat) expect(i >= -1 && i <= 5).toBe(true);
    }
    expect(ARP[1].filter((i) => i >= 0).length).toBeGreaterThan(ARP[0].filter((i) => i >= 0).length);
    for (const c of PROGRESSION) {
      for (let i = 0; i < 6; i++) {
        const m = arpMidi(c, i);
        expect(m).toBeGreaterThanOrEqual(62);
        expect(m).toBeLessThanOrEqual(88);
        expect(D_DORIAN_PCS).toContain(m % 12);
      }
    }
  });

  it('the ostinato has eight steps with accents on the strong eighths', () => {
    expect(OSTINATO.offsets).toHaveLength(8);
    expect(OSTINATO.vel).toHaveLength(8);
    expect(OSTINATO.vel[0]).toBe(1);
    expect(OSTINATO.vel[0]).toBeGreaterThan(OSTINATO.vel[1]);
  });
});
