// Adaptive cinematic music in two layers, both through one shared reverb.
// Calm: a string-like pad and a bass on slow chords, a harp arpeggio (Karplus-Strong plucks), and a flute
// melody made of short motifs. Tension: a staccato string ostinato, a cello drone, brass-like swells and a
// soft frame drum. The mix is driven by the pure function nextMood. The notes come from score.ts; the
// tuning of every level, filter and time is in the TUNE block below.
//
// Scheduling is bar by bar: a whole bar is queued shortly before it starts. After a long frame hitch the
// missed bars are skipped, never stacked, so nothing fires late or all at once.

import { ARP, arpMidi, chordForBar, chordLength, degreeToMidi, isChordStart, midiToHz, OSTINATO, passOf, phraseForBar, PROGRESSION } from './score.ts';
import type { Chord, MelodyNote } from './score.ts';
import { karplusStrong, mulberry32, reverbImpulse } from './synth.ts';

export interface Mood {
  level: number; // 0 calm .. 1 tension
  hold: number; // seconds left before the fall begins
}

export const RISE_SECONDS = 7;
export const FALL_SECONDS = 5;
export const HOLD_SECONDS = 2;

/** Smooth rise (~7 s) on threat and fall (~5 s) after 2 s of quiet. No jumps. */
export function nextMood(prev: Mood, threat: boolean, dt: number): Mood {
  if (threat) return { level: Math.min(1, prev.level + dt / RISE_SECONDS), hold: HOLD_SECONDS };
  if (prev.hold > 0) return { level: prev.level, hold: Math.max(0, prev.hold - dt) };
  return { level: Math.max(0, prev.level - dt / FALL_SECONDS), hold: 0 };
}

/** Music tempo; ambience swells in time with it (one wave per 4/4 bar). */
export const BPM = 64;
export const BAR_SECONDS = (60 / BPM) * 4;
const BEAT = 60 / BPM;
const EIGHTH = BEAT / 2;

/** Tuning: linear gains before the music bus, filter cutoffs in Hz, times in seconds. */
const TUNE = {
  /** A bar is queued when it starts within this many seconds. */
  lookahead: 0.6,
  /** The convolver is normalized by the browser, so the wet level is about send * wet below the dry signal in gain. */
  reverb: { seconds: 2.2, decay: 6, send: 0.9, wet: 1.1 },
  pad: { gain: 0.014, cutoff: 1200, attack: 1.2, release: 1.6, detune: 7 },
  bass: { gain: 0.04, attack: 0.5, release: 1.4 },
  harp: { gain: 0.047, seconds: 2.2 },
  flute: { gain: 0.04, breath: 0.014, vibratoCents: 11, cutoff: 3600 },
  strings: { gain: 0.09, detune: 6 },
  cello: { gain: 0.045, cutoff: 280 },
  swell: { gain: 0.07, seconds: 2.8 },
  drum: { accent: 0.2, soft: 0.12 },
  /** Mood at which each tension element comes in. */
  entry: { strings: 0.05, drum: 0.3, swell: 0.6 },
} as const;

export class Music {
  private readonly calm: GainNode;
  private readonly tense: GainNode;
  private readonly drumGain: GainNode;
  private readonly lead: BiquadFilterNode;
  private readonly plucks = new Map<number, AudioBuffer>();
  private nextBar: number;
  private barIdx = 0;
  /** Strike the pad on the next bar even if the chord did not change (first bar, after a hitch). */
  private resync = true;
  private mood: Mood = { level: 0, hold: 0 };

  constructor(
    private readonly ctx: AudioContext,
    out: AudioNode,
    private readonly noise: AudioBuffer,
  ) {
    this.calm = ctx.createGain();
    this.tense = ctx.createGain();
    this.drumGain = ctx.createGain();
    this.calm.gain.value = 0.9;
    this.tense.gain.value = 0;
    this.drumGain.gain.value = 0;

    // one reverb for both layers: dry to the bus, plus a send into a generated hall
    const send = ctx.createGain();
    send.gain.value = TUNE.reverb.send;
    const hall = ctx.createConvolver();
    hall.buffer = this.makeImpulse();
    const wet = ctx.createGain();
    wet.gain.value = TUNE.reverb.wet;
    send.connect(hall);
    hall.connect(wet);
    wet.connect(out);
    for (const layer of [this.calm, this.tense]) {
      layer.connect(out);
      layer.connect(send);
    }
    this.drumGain.connect(this.tense);

    // the flute goes through a soft lowpass, so it never gets glassy
    this.lead = ctx.createBiquadFilter();
    this.lead.type = 'lowpass';
    this.lead.frequency.value = TUNE.flute.cutoff;
    this.lead.connect(this.calm);

    // tension: a cello drone under everything (D, D and A, slightly detuned)
    this.drone(this.tense, [73.42, 73.42, 110.0], 'sawtooth', TUNE.cello.gain, TUNE.cello.cutoff);

    this.prepareHarp();
    this.nextBar = ctx.currentTime + 0.5;
  }

  private makeImpulse(): AudioBuffer {
    const [l, r] = reverbImpulse(this.ctx.sampleRate, TUNE.reverb.seconds, TUNE.reverb.decay, mulberry32(11), mulberry32(23));
    const buf = this.ctx.createBuffer(2, l.length, this.ctx.sampleRate);
    buf.getChannelData(0).set(l);
    buf.getChannelData(1).set(r);
    return buf;
  }

  /** Renders the pluck of every harp note once (a few milliseconds each), so scheduling a bar is cheap. */
  private prepareHarp(): void {
    const sr = this.ctx.sampleRate;
    for (const chord of PROGRESSION) {
      for (let i = 0; i < 6; i++) {
        const midi = arpMidi(chord, i);
        if (this.plucks.has(midi)) continue;
        const data = karplusStrong(sr, midiToHz(midi), TUNE.harp.seconds, mulberry32(midi * 7919));
        const buf = this.ctx.createBuffer(1, data.length, sr);
        buf.getChannelData(0).set(data);
        this.plucks.set(midi, buf);
      }
    }
  }

  private drone(out: AudioNode, freqs: number[], type: OscillatorType, gain: number, cutoff: number): void {
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = cutoff;
    f.connect(out);
    for (const [i, hz] of freqs.entries()) {
      const o = this.ctx.createOscillator();
      o.type = type;
      o.frequency.value = hz;
      o.detune.value = (i - 1) * 4;
      const g = this.ctx.createGain();
      g.gain.value = gain;
      // slow "breathing" of the drone
      const lfo = this.ctx.createOscillator();
      lfo.frequency.value = 0.05 + i * 0.03;
      const lg = this.ctx.createGain();
      lg.gain.value = gain * 0.4;
      lfo.connect(lg).connect(g.gain);
      o.connect(g).connect(f);
      o.start();
      lfo.start();
    }
  }

  /** Warm pad: detuned saws on the chord tones, a slow attack and a slow release, so chords melt together. */
  private pad(t: number, chord: Chord, dur: number): void {
    const P = TUNE.pad;
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.Q.value = 0.4;
    // the filter breathes open and closed over the chord
    f.frequency.setValueAtTime(P.cutoff * 0.6, t);
    f.frequency.linearRampToValueAtTime(P.cutoff, t + dur * 0.5);
    f.frequency.linearRampToValueAtTime(P.cutoff * 0.7, t + dur);
    f.connect(this.calm);
    const end = t + dur + P.release;
    for (const midi of chord.tones) {
      for (const d of [-P.detune, P.detune]) {
        const o = this.ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = midiToHz(midi);
        o.detune.value = d;
        const g = this.ctx.createGain();
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(P.gain, t + P.attack);
        g.gain.setValueAtTime(P.gain, t + dur);
        g.gain.linearRampToValueAtTime(0, end);
        o.connect(g).connect(f);
        o.start(t);
        o.stop(end + 0.1);
      }
    }
  }

  /** Bass: a sine on the root with a triangle an octave up, so it is heard on small speakers too. */
  private bass(t: number, chord: Chord, dur: number): void {
    const B = TUNE.bass;
    const end = t + dur + B.release;
    for (const [shift, type, k] of [
      [0, 'sine', 1],
      [12, 'triangle', 0.35],
    ] as const) {
      const o = this.ctx.createOscillator();
      o.type = type;
      o.frequency.value = midiToHz(chord.root + shift);
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(B.gain * k, t + B.attack);
      g.gain.setValueAtTime(B.gain * k, t + dur);
      g.gain.linearRampToValueAtTime(0, end);
      o.connect(g).connect(this.calm);
      o.start(t);
      o.stop(end + 0.1);
    }
  }

  /** Harp arpeggio: the pre-rendered plucks, accented on the strong eighths. */
  private harp(t0: number, chord: Chord, pass: number): void {
    ARP[pass].forEach((idx, step) => {
      if (idx < 0) return;
      const buf = this.plucks.get(arpMidi(chord, idx));
      if (!buf) return;
      const t = t0 + step * EIGHTH + Math.random() * 0.012;
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      const g = this.ctx.createGain();
      g.gain.value = TUNE.harp.gain * (step % 4 === 0 ? 1 : 0.68) * (0.85 + Math.random() * 0.15);
      src.connect(g).connect(this.calm);
      src.start(t);
      src.stop(t + TUNE.harp.seconds);
    });
  }

  /** Flute: sine plus a quiet octave, a late vibrato, and a breath of filtered noise at the start of each note. */
  private melody(t0: number, phrase: readonly MelodyNote[]): void {
    const F = TUNE.flute;
    for (const note of phrase) {
      const hz = midiToHz(degreeToMidi(note.degree));
      const t = t0 + note.beat * BEAT + Math.random() * 0.015;
      const len = note.beats * BEAT;
      const end = t + len * 0.96;
      const peak = F.gain * note.vel;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(peak, t + 0.09);
      g.gain.setTargetAtTime(0, end, 0.14);
      g.connect(this.lead);

      const lfo = this.ctx.createOscillator();
      lfo.frequency.value = 5.1;
      const depth = this.ctx.createGain();
      depth.gain.setValueAtTime(0, t);
      depth.gain.linearRampToValueAtTime(F.vibratoCents, t + Math.min(0.6, len * 0.6));
      lfo.connect(depth);
      for (const [mult, level] of [
        [1, 1],
        [2, 0.2],
      ] as const) {
        const o = this.ctx.createOscillator();
        o.type = 'sine';
        o.frequency.value = hz * mult;
        const og = this.ctx.createGain();
        og.gain.value = level;
        depth.connect(o.detune);
        o.connect(og).connect(g);
        o.start(t);
        o.stop(end + 1);
      }
      lfo.start(t);
      lfo.stop(end + 1);

      const n = this.ctx.createBufferSource();
      n.buffer = this.noise;
      const bp = this.ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = hz * 2;
      bp.Q.value = 2.5;
      const ng = this.ctx.createGain();
      ng.gain.setValueAtTime(0, t);
      ng.gain.linearRampToValueAtTime(F.breath * note.vel, t + 0.03);
      ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
      n.connect(bp).connect(ng).connect(this.lead);
      n.start(t, Math.random() * 1.5, 0.4);
    }
  }

  /** Staccato string ostinato on the chord root and fifth: eight short saw notes with a quick filter snap. */
  private strings(t0: number, chord: Chord): void {
    const S = TUNE.strings;
    for (let step = 0; step < 8; step++) {
      const t = t0 + step * EIGHTH;
      const hz = midiToHz(chord.root + 12 + OSTINATO.offsets[step]);
      const f = this.ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.setValueAtTime(380, t);
      f.frequency.exponentialRampToValueAtTime(1500, t + 0.03);
      f.frequency.exponentialRampToValueAtTime(520, t + 0.3);
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(S.gain * OSTINATO.vel[step], t + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0005, t + 0.34);
      f.connect(g).connect(this.tense);
      for (const d of [-S.detune, S.detune]) {
        const o = this.ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = hz;
        o.detune.value = d;
        o.connect(f);
        o.start(t);
        o.stop(t + 0.4);
      }
    }
  }

  /** Brass-like swell: two saws a fifth apart under a filter that opens for 1.6 s and closes again. */
  private swell(t0: number, chord: Chord): void {
    const W = TUNE.swell;
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(260, t0);
    f.frequency.linearRampToValueAtTime(1700, t0 + 1.6);
    f.frequency.linearRampToValueAtTime(500, t0 + W.seconds);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(W.gain, t0 + 1.5);
    g.gain.setTargetAtTime(0, t0 + 1.9, 0.5);
    f.connect(g).connect(this.tense);
    for (const shift of [24, 31]) {
      for (const d of [-8, 8]) {
        const o = this.ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = midiToHz(chord.root + shift);
        o.detune.value = d;
        o.connect(f);
        o.start(t0);
        o.stop(t0 + W.seconds + 1);
      }
    }
  }

  private drum(t: number, accent: boolean): void {
    const D = TUNE.drum;
    const o = this.ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(accent ? 95 : 80, t);
    o.frequency.exponentialRampToValueAtTime(48, t + 0.35);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(accent ? D.accent : D.soft, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0005, t + 0.6);
    o.connect(g).connect(this.drumGain);
    o.start(t);
    o.stop(t + 0.65);
    // skin rustle
    const n = this.ctx.createBufferSource();
    n.buffer = this.noise;
    const nf = this.ctx.createBiquadFilter();
    nf.type = 'bandpass';
    nf.frequency.value = 900;
    const ng = this.ctx.createGain();
    ng.gain.setValueAtTime(accent ? 0.025 : 0.016, t);
    ng.gain.exponentialRampToValueAtTime(0.0005, t + 0.15);
    n.connect(nf).connect(ng).connect(this.drumGain);
    n.start(t, Math.random() * 1.5, 0.2);
  }

  /** Queues everything that happens in one bar. All times are >= the bar start. */
  private scheduleBar(bar: number, t0: number): void {
    const chord = chordForBar(bar);
    const m = this.mood.level;
    if (this.resync || isChordStart(bar)) {
      const dur = chordLength(bar) * BAR_SECONDS;
      this.pad(t0, chord, dur);
      this.bass(t0, chord, dur);
    }
    this.resync = false;
    this.harp(t0, chord, passOf(bar));
    const phrase = phraseForBar(bar);
    if (phrase) this.melody(t0, phrase);
    if (m > TUNE.entry.strings) this.strings(t0, chord);
    if (m > TUNE.entry.swell && bar % 2 === 0) this.swell(t0, chord);
    if (m > TUNE.entry.drum) {
      for (const [beat, accent] of [
        [0, true],
        [1, false],
        [2, false],
        [3, false],
        [3.5, false],
      ] as const) this.drum(t0 + beat * BEAT, accent);
    }
  }

  /** Called every frame: layer mix and look-ahead bar scheduling. */
  update(threat: boolean, dt: number): void {
    this.mood = nextMood(this.mood, threat, dt);
    const t = this.ctx.currentTime;
    const m = this.mood.level;
    // equal-power curves; setTargetAtTime smooths the rest
    this.calm.gain.setTargetAtTime(0.75 * Math.cos((m * Math.PI) / 2) + 0.15, t, 0.3);
    this.tense.gain.setTargetAtTime(Math.sin((m * Math.PI) / 2) * 0.7, t, 0.3);
    this.drumGain.gain.setTargetAtTime(m > TUNE.entry.drum ? (m - TUNE.entry.drum) / (1 - TUNE.entry.drum) : 0, t, 0.5);

    // A frame hitch must never stack missed bars: skip them and resume from now.
    if (this.nextBar < t) {
      this.nextBar = t + 0.05;
      this.resync = true;
    }
    while (this.nextBar < t + TUNE.lookahead) {
      this.scheduleBar(this.barIdx, this.nextBar);
      this.nextBar += BAR_SECONDS;
      this.barIdx++;
    }
  }

  get level(): number {
    return this.mood.level;
  }
}
