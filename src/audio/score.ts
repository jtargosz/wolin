// The score: chords, melody phrases and patterns as plain data. No Web Audio here, so it is unit-tested.
// Key: D Dorian (D E F G A B C). Eight-bar progression, sixteen-bar form (the second pass sings
// different phrases and plays a denser harp), 4/4.

/** Pitch classes of D Dorian, as semitones from C. */
export const D_DORIAN_PCS: readonly number[] = [2, 4, 5, 7, 9, 11, 0];

export function midiToHz(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}

export interface Chord {
  name: string;
  /** Bass note (MIDI). */
  root: number;
  /** Pad voicing, three notes (MIDI), close position around F3 to D4. */
  tones: readonly [number, number, number];
}

/** One chord per bar; the loop repeats every eight bars. */
export const PROGRESSION: readonly Chord[] = [
  { name: 'Dm', root: 38, tones: [53, 57, 62] },
  { name: 'Dm', root: 38, tones: [53, 57, 62] },
  { name: 'C', root: 36, tones: [52, 55, 60] },
  { name: 'C', root: 36, tones: [52, 55, 60] },
  { name: 'F', root: 41, tones: [53, 57, 60] },
  { name: 'G', root: 43, tones: [55, 59, 62] },
  { name: 'Am', root: 45, tones: [52, 57, 60] },
  { name: 'Dm', root: 38, tones: [53, 57, 62] },
];

export const LOOP_BARS = PROGRESSION.length;
/** Passes in the full form: the melody and the harp differ between them. */
export const PASSES = 2;

const wrap = (bar: number): number => ((Math.floor(bar) % LOOP_BARS) + LOOP_BARS) % LOOP_BARS;

export function chordForBar(bar: number): Chord {
  return PROGRESSION[wrap(bar)];
}

/** 0 or 1: which pass of the sixteen-bar form a bar belongs to. */
export function passOf(bar: number): number {
  return ((Math.floor(Math.floor(bar) / LOOP_BARS) % PASSES) + PASSES) % PASSES;
}

/** A new chord begins at this bar (the pad is not re-struck while the same chord goes on). */
export function isChordStart(bar: number): boolean {
  return chordForBar(bar).name !== chordForBar(bar - 1).name;
}

/** Bars (counting this one) before the chord changes, at most 4. */
export function chordLength(bar: number): number {
  let n = 1;
  while (n < 4 && chordForBar(bar + n).name === chordForBar(bar).name) n++;
  return n;
}

export function isChordTone(midi: number, chord: Chord): boolean {
  const pc = ((midi % 12) + 12) % 12;
  return [chord.root, ...chord.tones].some((m) => m % 12 === pc);
}

/** D Dorian scale degree (0 = D4, 7 = D5, -1 = C4) to MIDI. */
export function degreeToMidi(degree: number): number {
  const octave = Math.floor(degree / 7);
  const idx = ((degree % 7) + 7) % 7;
  return 62 + 12 * octave + [0, 2, 3, 5, 7, 9, 10][idx];
}

export interface MelodyNote {
  /** Position inside the two-bar phrase, in beats (0 to <8). */
  beat: number;
  degree: number;
  /** Length in beats. */
  beats: number;
  vel: number;
}

const n = (beat: number, degree: number, beats: number, vel = 0.8): MelodyNote => ({ beat, degree, beats, vel });

/** [pass][phrase]: four two-bar phrases per pass, starting on bars 0, 2, 4 and 6 of the loop. */
export const PHRASES: readonly (readonly (readonly MelodyNote[])[])[] = [
  [
    // Dm: rises to the fifth above, falls back
    [n(0, 4, 1.5), n(1.5, 5, 0.5, 0.6), n(2, 7, 2), n(4, 6, 1, 0.7), n(5, 5, 1, 0.65), n(6, 4, 2, 0.7)],
    // C: the same shape a step higher, settles on G
    [n(0, 6, 1.5), n(1.5, 7, 0.5, 0.6), n(2, 8, 2, 0.85), n(4, 7, 1, 0.7), n(5, 6, 1, 0.65), n(6, 3, 2, 0.7)],
    // F, G: a gentle question
    [n(0, 4, 2), n(2, 6, 1, 0.7), n(3, 5, 1, 0.65), n(4, 7, 1.5, 0.8), n(5.5, 5, 0.5, 0.6), n(6, 3, 2, 0.7)],
    // Am, Dm: the answer, home on the low D
    [n(0, 4, 1.5), n(1.5, 6, 0.5, 0.6), n(2, 8, 1, 0.8), n(3, 7, 1, 0.7), n(4, 4, 1, 0.65), n(5, 2, 1, 0.6), n(6, 0, 2, 0.8)],
  ],
  [
    // the same story an octave higher and calmer
    [n(0, 7, 2, 0.75), n(2, 9, 1, 0.7), n(3, 8, 1, 0.65), n(4, 7, 1.5, 0.7), n(5.5, 6, 0.5, 0.6), n(6, 4, 2, 0.7)],
    [n(0, 8, 2, 0.75), n(2, 7, 1, 0.65), n(3, 6, 1, 0.6), n(4, 3, 2, 0.65), n(6, 6, 2, 0.7)],
    [n(0, 6, 2, 0.75), n(2, 4, 1, 0.65), n(3, 6, 1, 0.65), n(4, 7, 2, 0.75), n(6, 5, 1, 0.6), n(7, 7, 1, 0.65)],
    [n(0, 6, 1.5, 0.75), n(1.5, 5, 0.5, 0.6), n(2, 4, 2, 0.7), n(4, 2, 1, 0.6), n(5, 4, 1, 0.65), n(6, 7, 2, 0.8)],
  ],
];

/** The phrase that starts on this bar, or null on the second bar of a phrase. */
export function phraseForBar(bar: number): readonly MelodyNote[] | null {
  const w = wrap(bar);
  if (w % 2 !== 0) return null;
  return PHRASES[passOf(bar)][w / 2];
}

/**
 * Harp arpeggio, eight steps per bar (eighth notes). Index into the chord: 0..2 are the pad tones an octave up,
 * 3..5 two octaves up, -1 is a rest. Per pass: sparse, then denser.
 */
export const ARP: readonly (readonly number[])[] = [
  [0, -1, 2, -1, 3, -1, 2, -1],
  [0, 1, 2, 3, 4, 3, 2, 1],
];

export function arpMidi(chord: Chord, index: number): number {
  return chord.tones[index % 3] + 12 * (1 + Math.floor(index / 3));
}

/** String ostinato, eight eighth notes per bar: semitones above the chord root an octave up, and accents. */
export const OSTINATO = {
  offsets: [0, 0, 7, 0, 0, 7, 12, 7],
  vel: [1, 0.55, 0.7, 0.55, 0.9, 0.55, 0.7, 0.55],
} as const;
