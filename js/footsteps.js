// Footsteps, made live with the Web Audio API (no sound files): a soft, short brush of a shoe sole,
// just loud enough to notice. Hard floors are a touch brighter, a rug is barely a whisper.

const SURFACES = {
  wood: { tone: 1100, gain: 0.5, attack: 0.012, decay: 0.12, echo: 0.04 },
  marble: { tone: 1700, gain: 0.45, attack: 0.008, decay: 0.1, echo: 0.12 },
  concrete: { tone: 1400, gain: 0.45, attack: 0.01, decay: 0.1, echo: 0.06 },
  rug: { tone: 600, gain: 0.25, attack: 0.016, decay: 0.1, echo: 0 },
};

export class Footsteps {
  constructor(volume = 0.12) {
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
    this.hit(s, t + 0.07 + Math.random() * 0.03, 0.35); // the toe rolls down just after the heel
  }

  hit(s, t, level) {
    const ctx = this.ctx;
    const vary = 0.85 + Math.random() * 0.3; // no two steps sound quite alike
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = vary;
    // soft: everything above the tone rolled off, and the very lowest rumble removed too
    const low = ctx.createBiquadFilter();
    low.type = 'lowpass';
    low.frequency.value = s.tone * vary;
    low.Q.value = 0.3;
    const high = ctx.createBiquadFilter();
    high.type = 'highpass';
    high.frequency.value = 180;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.linearRampToValueAtTime(s.gain * level, t + s.attack);
    env.gain.exponentialRampToValueAtTime(0.0001, t + s.attack + s.decay);
    src.connect(low).connect(high).connect(env).connect(this.out);
    if (s.echo) {
      const send = ctx.createGain();
      send.gain.value = s.echo;
      env.connect(send).connect(this.hall);
    }
    src.start(t);
    src.stop(t + 0.2);
  }
}
