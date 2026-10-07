// Ambient museum music, generated live with the Web Audio API, so no audio file is needed:
// a slow, soft chord pad with occasional chime notes, all through a large-room echo.
// To play your own looping track instead, set MUSEUM.music.file in config.js.

const midiToHz = (note) => 440 * 2 ** ((note - 69) / 12);

const CHORDS = [
  [48, 55, 59, 64], // C major 7
  [45, 52, 55, 60], // A minor 7
  [41, 48, 52, 57], // F major 7
  [43, 50, 55, 59], // G major
];
const CHIME_NOTES = [60, 62, 64, 67, 69, 72, 74, 76, 79]; // C major pentatonic
const CHORD_SECONDS = 9;
const LOOKAHEAD = 1.5;

export class AmbientMusic {
  constructor({ enabled = true, volume = 0.3, file = '' } = {}) {
    this.enabled = enabled;
    this.volume = volume;
    this.file = file;
    this.ctx = null;
    this.timer = null;
  }

  // Browsers only allow sound after the visitor clicks or taps, so call this from a click handler.
  start() {
    if (!this.enabled) return;
    if (this.file) {
      if (!this.audio) {
        this.audio = new Audio(this.file);
        this.audio.loop = true;
        this.audio.volume = this.volume;
      }
      this.audio.play().catch(() => console.warn(`Could not play "${this.file}". Check the path in config.js.`));
      return;
    }
    if (!this.ctx) this.setup();
    this.ctx.resume();
    const t = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setTargetAtTime(this.volume, t, 1.2);
    if (!this.timer) {
      this.nextChord = t + 0.1;
      this.nextChime = t + 3;
      this.timer = setInterval(() => this.schedule(), 250);
      this.schedule();
    }
  }

  stop() {
    if (this.audio) this.audio.pause();
    if (!this.ctx) return;
    this.master.gain.setTargetAtTime(0, this.ctx.currentTime, 0.4);
    clearInterval(this.timer);
    this.timer = null;
  }

  toggle() {
    this.enabled = !this.enabled;
    if (this.enabled) this.start();
    else this.stop();
    return this.enabled;
  }

  // Pause the audio engine while the tab is hidden, and pick up again when it comes back.
  setVisible(visible) {
    if (!this.ctx || !this.enabled) return;
    if (visible) this.ctx.resume();
    else this.ctx.suspend();
  }

  setup() {
    const ctx = (this.ctx = new (window.AudioContext || window.webkitAudioContext)());
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    this.master.connect(ctx.createDynamicsCompressor()).connect(ctx.destination);

    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.makeImpulse(4.5);
    const wet = ctx.createGain();
    wet.gain.value = 0.6;
    this.reverb.connect(wet).connect(this.master);
    this.dry = ctx.createGain();
    this.dry.gain.value = 0.55;
    this.dry.connect(this.master);

    // warm low-pass on the pad that slowly opens and closes
    this.padFilter = ctx.createBiquadFilter();
    this.padFilter.type = 'lowpass';
    this.padFilter.frequency.value = 750;
    this.padFilter.Q.value = 0.5;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.05;
    const lfoDepth = ctx.createGain();
    lfoDepth.gain.value = 300;
    lfo.connect(lfoDepth).connect(this.padFilter.frequency);
    lfo.start();
    this.padFilter.connect(this.dry);
    this.padFilter.connect(this.reverb);

    this.chordIndex = 0;
  }

  // Decaying noise makes a convincing "big hall" echo.
  makeImpulse(seconds) {
    const rate = this.ctx.sampleRate;
    const length = Math.floor(rate * seconds);
    const buffer = this.ctx.createBuffer(2, length, rate);
    for (let ch = 0; ch < 2; ch++) {
      const data = buffer.getChannelData(ch);
      for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / length) ** 3;
    }
    return buffer;
  }

  schedule() {
    const now = this.ctx.currentTime;
    // after the tab was in the background, skip ahead instead of playing everything at once
    if (this.nextChord < now) this.nextChord = now + 0.1;
    if (this.nextChime < now) this.nextChime = now + 1;
    while (this.nextChord < now + LOOKAHEAD) {
      this.playChord(CHORDS[this.chordIndex++ % CHORDS.length], this.nextChord);
      this.nextChord += CHORD_SECONDS;
    }
    while (this.nextChime < now + LOOKAHEAD) {
      if (Math.random() < 0.75) this.playChime(this.nextChime);
      this.nextChime += 1.8 + Math.random() * 3.5;
    }
  }

  playChord(notes, when) {
    const ctx = this.ctx;
    const duration = CHORD_SECONDS + 3; // overlap so chords blend into each other
    for (const note of notes) {
      for (const [type, detune, level] of [['sine', -4, 0.05], ['triangle', 5, 0.022]]) {
        const osc = ctx.createOscillator();
        osc.type = type;
        osc.frequency.value = midiToHz(note);
        osc.detune.value = detune;
        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0, when);
        gain.gain.linearRampToValueAtTime(level, when + 3);
        gain.gain.setValueAtTime(level, when + duration - 4);
        gain.gain.linearRampToValueAtTime(0, when + duration);
        osc.connect(gain).connect(this.padFilter);
        osc.start(when);
        osc.stop(when + duration + 0.1);
      }
    }
  }

  playChime(when) {
    const ctx = this.ctx;
    const freq = midiToHz(CHIME_NOTES[Math.floor(Math.random() * CHIME_NOTES.length)]);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, when);
    gain.gain.linearRampToValueAtTime(0.05, when + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, when + 3.5);
    for (const [multiple, level] of [[1, 1], [2, 0.25], [3, 0.08]]) {
      const osc = ctx.createOscillator();
      osc.frequency.value = freq * multiple;
      const partial = ctx.createGain();
      partial.gain.value = level;
      osc.connect(partial).connect(gain);
      osc.start(when);
      osc.stop(when + 3.6);
    }
    gain.connect(this.reverb);
    const direct = ctx.createGain();
    direct.gain.value = 0.35;
    gain.connect(direct).connect(this.dry);
  }
}
