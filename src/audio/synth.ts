// Pure DSP for buffers generated in code: a plucked string and a reverb impulse response. No Web Audio
// here (an injected random source keeps it deterministic), so it is unit-tested.

export type Rng = () => number;

/** Small deterministic generator in [0, 1). */
export function mulberry32(seed: number): Rng {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Karplus-Strong plucked string. A softened noise burst circulates in a delay line with a lowpass (the average
 * of two neighbors), so the upper partials die first. A first-order allpass tunes the loop to a fraction of a
 * sample, so the pitch is accurate also high up. Peak is normalized to 1, the end fades out.
 */
export function karplusStrong(sampleRate: number, hz: number, seconds: number, rng: Rng, decay = 0.997): Float32Array {
  const total = sampleRate / hz - 0.5; // the averaging filter adds half a sample of delay
  const len = Math.max(2, Math.floor(total - 0.5));
  const frac = total - len; // in [0.5, 1.5): the allpass supplies it
  const a = (1 - frac) / (1 + frac);
  const line = new Float32Array(len);
  let soft = 0;
  for (let i = 0; i < len; i++) {
    soft += 0.55 * ((rng() * 2 - 1) - soft); // a gentle pluck, not a click
    line[i] = soft;
  }
  const out = new Float32Array(Math.floor(sampleRate * seconds));
  let p = 0;
  let prev = 0;
  let apIn = 0;
  let apOut = 0;
  for (let i = 0; i < out.length; i++) {
    const x = line[p];
    out[i] = x;
    const avg = decay * 0.5 * (x + prev);
    prev = x;
    const ap = a * avg + apIn - a * apOut;
    apIn = avg;
    apOut = ap;
    line[p] = ap;
    p = (p + 1) % len;
  }
  let peak = 0;
  for (const v of out) peak = Math.max(peak, Math.abs(v));
  const fade = Math.floor(sampleRate * 0.05);
  const k = peak > 0 ? 1 / peak : 1;
  for (let i = 0; i < out.length; i++) {
    const tail = out.length - i;
    out[i] *= k * (tail < fade ? tail / fade : 1);
  }
  return out;
}

/**
 * Stereo reverb impulse response: exponentially decaying noise (`decay` is the total fall in nepers over the
 * length), a short ramp at the start, and a tail that gets darker with time like a real hall. Two channels
 * from two random sources, so the left and right ears differ.
 */
export function reverbImpulse(sampleRate: number, seconds: number, decay: number, rngL: Rng, rngR: Rng): [Float32Array, Float32Array] {
  const n = Math.floor(sampleRate * seconds);
  const ramp = Math.floor(sampleRate * 0.01);
  const make = (rng: Rng): Float32Array => {
    const ch = new Float32Array(n);
    let y = 0;
    for (let i = 0; i < n; i++) {
      const u = i / n;
      const k = 0.9 - 0.75 * u; // one-pole lowpass: bright at first, dark at the end
      y += k * ((rng() * 2 - 1) - y);
      ch[i] = y * Math.exp(-decay * u) * (i < ramp ? i / ramp : 1);
    }
    return ch;
  };
  return [make(rngL), make(rngR)];
}
