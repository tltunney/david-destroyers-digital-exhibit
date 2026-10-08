// Footsteps, made live with the Web Audio API (no sound files): a heel strike and a softer toe
// for each step, shaped by what's underfoot. Wood knocks, marble clicks and rings around the dome,
// a rug muffles the step almost to nothing.

const SURFACES = {
  wood: { freq: 650, q: 1.1, gain: 0.5, decay: 0.09, thump: 105, thumpGain: 0.32, echo: 0.12 },
  marble: { freq: 2300, q: 0.9, gain: 0.32, decay: 0.05, thump: 150, thumpGain: 0.16, echo: 0.55 },
  concrete: { freq: 1500, q: 0.8, gain: 0.32, decay: 0.06, thump: 120, thumpGain: 0.2, echo: 0.25 },
  rug: { freq: 300, q: 0.7, gain: 0.22, decay: 0.07, thump: 85, thumpGain: 0.12, echo: 0 },
};

export class Footsteps {
  constructor(volume = 0.35) {
    this.volume = volume;
    this.ctx = null;
  }

  // Browsers only allow sound after a click or tap, so call this from one.
  unlock() {
    if (!this.ctx) this.setup();
    this.ctx.resume();
  }

  setup() {
    const ctx = (this.ctx = new (window.AudioContext || window.webkitAudioContext)());
    this.out = ctx.createGain();
    this.out.gain.value = this.volume;
    this.out.connect(ctx.destination);
    // a short burst of noise, reused for every step
    const length = Math.floor(ctx.sampleRate * 0.2);
    this.noise = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    // the echo of a big room, for hard floors
    this.hall = ctx.createConvolver();
    const tail = Math.floor(ctx.sampleRate * 1.8);
    const impulse = ctx.createBuffer(2, tail, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = impulse.getChannelData(ch);
      for (let i = 0; i < tail; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / tail) ** 4;
    }
    this.hall.buffer = impulse;
    this.hall.connect(this.out);
  }

  setVisible(visible) {
    if (!this.ctx) return;
    if (visible) this.ctx.resume();
    else this.ctx.suspend();
  }

  step(surface = 'wood') {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const s = SURFACES[surface] ?? SURFACES.wood;
    const t = ctx.currentTime;
    this.hit(s, t, 1);
    this.hit(s, t + 0.055 + Math.random() * 0.02, 0.45); // the toe comes down just after the heel
  }

  hit(s, t, level) {
    const ctx = this.ctx;
    const vary = 0.85 + Math.random() * 0.3; // no two steps sound quite alike
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = vary;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = s.freq * vary;
    filter.Q.value = s.q;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.linearRampToValueAtTime(s.gain * level, t + 0.004);
    env.gain.exponentialRampToValueAtTime(0.0001, t + s.decay);
    src.connect(filter).connect(env).connect(this.out);
    if (s.echo) {
      const send = ctx.createGain();
      send.gain.value = s.echo;
      env.connect(send).connect(this.hall);
    }
    src.start(t);
    src.stop(t + 0.2);

    const osc = ctx.createOscillator();
    osc.frequency.setValueAtTime(s.thump * vary, t);
    osc.frequency.exponentialRampToValueAtTime(s.thump * 0.55, t + 0.07);
    const body = ctx.createGain();
    body.gain.setValueAtTime(s.thumpGain * level, t);
    body.gain.exponentialRampToValueAtTime(0.0001, t + 0.08);
    osc.connect(body).connect(this.out);
    osc.start(t);
    osc.stop(t + 0.1);
  }
}
