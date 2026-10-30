import { BAR_SECONDS } from './music.ts';

// Ambience: water (noise through a low-pass with a slow swell), wind (wandering band), wood creaks.

export class Ambient {
  private nextCreak = 0;

  constructor(
    private readonly ctx: AudioContext,
    private readonly out: AudioNode,
    noise: AudioBuffer,
  ) {
    // surf waves in time with the music (1 wave per bar), quiet - background, not foreground
    this.loop(noise, 'lowpass', 320, 0.07, 1 / BAR_SECONDS, 0.2);
    this.loop(noise, 'bandpass', 700, 0.03, 1 / (BAR_SECONDS * 4), 0.13, true);
    this.nextCreak = ctx.currentTime + 6;
  }

  private loop(noise: AudioBuffer, type: BiquadFilterType, freq: number, gain: number, lfoHz: number, depth: number, wander = false): void {
    const src = this.ctx.createBufferSource();
    src.buffer = noise;
    src.loop = true;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = wander ? 0.8 : 0.5;
    const g = this.ctx.createGain();
    g.gain.value = gain;
    const lfo = this.ctx.createOscillator();
    lfo.frequency.value = lfoHz;
    const lg = this.ctx.createGain();
    lg.gain.value = gain * depth * 3;
    lfo.connect(lg).connect(g.gain);
    if (wander) {
      const l2 = this.ctx.createOscillator();
      l2.frequency.value = 0.031;
      const g2 = this.ctx.createGain();
      g2.gain.value = 350;
      l2.connect(g2).connect(f.frequency);
      l2.start();
    }
    src.connect(f).connect(g).connect(this.out);
    src.start(0, Math.random() * 2);
    lfo.start();
  }

  update(): void {
    const t = this.ctx.currentTime;
    if (t < this.nextCreak) return;
    this.nextCreak = t + 7 + Math.random() * 12;
    // creak: a short, slowly tuned tone through a band-pass
    const o = this.ctx.createOscillator();
    o.type = 'sawtooth';
    const base = 180 + Math.random() * 120;
    o.frequency.setValueAtTime(base, t);
    o.frequency.linearRampToValueAtTime(base * 1.25, t + 0.5);
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 650;
    f.Q.value = 6;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.025, t + 0.15);
    g.gain.linearRampToValueAtTime(0, t + 0.6);
    o.connect(f).connect(g).connect(this.out);
    o.start(t);
    o.stop(t + 0.65);
  }
}
