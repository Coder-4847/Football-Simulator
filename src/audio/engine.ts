import { settings } from '../core/settings';

/** Fully procedural audio (no sample assets): crowd, whistle, kicks, UI and a generative menu/match music bed. */
export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master!: GainNode; private musicG!: GainNode; private crowdG!: GainNode; private sfxG!: GainNode;
  private crowdSrc: AudioBufferSourceNode | null = null;
  private crowdFilter!: BiquadFilterNode; private crowdLevel!: GainNode;
  private noiseBuf!: AudioBuffer;
  private musicTimer: ReturnType<typeof setInterval> | null = null;
  private musicOn = false;
  private excitement = 0.2;
  private step = 0;

  /** Must be called from a user gesture. */
  unlock(): void {
    if (this.ctx) { void this.ctx.resume(); return; }
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    this.ctx = ctx;
    const comp = ctx.createDynamicsCompressor();
    this.master = ctx.createGain(); this.musicG = ctx.createGain(); this.crowdG = ctx.createGain(); this.sfxG = ctx.createGain();
    this.musicG.connect(this.master); this.crowdG.connect(this.master); this.sfxG.connect(this.master);
    this.master.connect(comp); comp.connect(ctx.destination);
    const len = ctx.sampleRate * 2;
    this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; b0 = 0.99765 * b0 + w * 0.099; b1 = 0.963 * b1 + w * 0.2965; b2 = 0.57 * b2 + w * 1.0526; d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.22; }
    this.applySettings();
    settings.on(() => this.applySettings());
    document.addEventListener('visibilitychange', () => this.applySettings());
  }

  applySettings(): void {
    if (!this.ctx) return;
    const a = settings.value.audio;
    const muted = document.hidden && a.muteOnBlur;
    this.master.gain.value = muted ? 0 : a.master;
    this.musicG.gain.value = a.music * 0.5; this.crowdG.gain.value = a.crowd; this.sfxG.gain.value = a.sfx;
  }

  private ok(): boolean { return !!this.ctx && this.ctx.state !== 'closed'; }

  // ---------- crowd
  startCrowd(): void {
    if (!this.ok() || this.crowdSrc) return;
    const ctx = this.ctx!;
    const src = ctx.createBufferSource(); src.buffer = this.noiseBuf; src.loop = true;
    this.crowdFilter = ctx.createBiquadFilter(); this.crowdFilter.type = 'bandpass'; this.crowdFilter.frequency.value = 520; this.crowdFilter.Q.value = 0.4;
    this.crowdLevel = ctx.createGain(); this.crowdLevel.gain.value = 0.1;
    src.connect(this.crowdFilter); this.crowdFilter.connect(this.crowdLevel); this.crowdLevel.connect(this.crowdG);
    src.start(); this.crowdSrc = src;
  }
  stopCrowd(): void { try { this.crowdSrc?.stop(); } catch { /* already stopped */ } this.crowdSrc = null; }
  setExcitement(e: number): void {
    this.excitement = e;
    if (!this.ok() || !this.crowdSrc) return;
    const t = this.ctx!.currentTime;
    const dyn = settings.value.audio.dynamicCrowd ? e : 0.3;
    this.crowdLevel.gain.setTargetAtTime(0.06 + dyn * 0.5, t, 0.25);
    this.crowdFilter.frequency.setTargetAtTime(380 + dyn * 900, t, 0.3);
  }
  roar(strength = 1): void {
    if (!this.ok() || !this.crowdSrc) return;
    const t = this.ctx!.currentTime;
    this.crowdLevel.gain.cancelScheduledValues(t);
    this.crowdLevel.gain.setTargetAtTime(0.25 + strength * 0.55, t, 0.08);
    this.crowdLevel.gain.setTargetAtTime(0.06 + this.excitement * 0.5, t + 1.6 * strength + 0.4, 1.2);
    this.crowdFilter.frequency.setTargetAtTime(1500, t, 0.1);
  }
  groan(): void { if (!this.ok() || !this.crowdSrc) return; const t = this.ctx!.currentTime; this.crowdLevel.gain.setTargetAtTime(0.28, t, 0.1); this.crowdLevel.gain.setTargetAtTime(0.06 + this.excitement * 0.5, t + 0.9, 0.6); this.crowdFilter.frequency.setTargetAtTime(380, t, 0.1); }

  // ---------- sfx
  private env(g: GainNode, t: number, peak: number, a: number, d: number): void {
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  }
  private noise(dur: number, freq: number, type: BiquadFilterType, peak: number, q = 1): void {
    if (!this.ok()) return;
    const ctx = this.ctx!, t = ctx.currentTime;
    const s = ctx.createBufferSource(); s.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain(); this.env(g, t, peak, 0.004, dur);
    s.connect(f); f.connect(g); g.connect(this.sfxG); s.start(t, Math.random()); s.stop(t + dur + 0.05);
  }
  private tone(freq: number, dur: number, type: OscillatorType, peak: number, slideTo?: number): void {
    if (!this.ok()) return;
    const ctx = this.ctx!, t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    const g = ctx.createGain(); this.env(g, t, peak, 0.004, dur);
    o.connect(g); g.connect(this.sfxG); o.start(t); o.stop(t + dur + 0.05);
  }
  kick(power: number): void { this.noise(0.09 + power * 0.06, 700 + power * 700, 'lowpass', 0.25 + power * 0.5); this.tone(120 + power * 40, 0.1, 'sine', 0.3 + power * 0.4, 55); }
  bounce(speed: number): void { if (speed < 1.5) return; this.tone(150, 0.07, 'sine', Math.min(0.4, speed * 0.05), 70); }
  net(speed: number): void { this.noise(0.35, 1800, 'bandpass', Math.min(0.5, 0.1 + speed * 0.015), 0.6); }
  post(): void { for (const f of [820, 1360, 2210]) this.tone(f, 0.6, 'sine', 0.18); this.noise(0.05, 3000, 'highpass', 0.3); }
  tackle(): void { this.noise(0.12, 300, 'lowpass', 0.5); this.tone(90, 0.12, 'sine', 0.4, 50); }
  whistle(kind: 'short' | 'long' | 'triple' = 'short'): void {
    if (!this.ok()) return;
    const ctx = this.ctx!;
    const play = (at: number, dur: number): void => {
      const t = ctx.currentTime + at;
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(2850, t);
      const lfo = ctx.createOscillator(); lfo.frequency.value = 38; const lg = ctx.createGain(); lg.gain.value = 90; lfo.connect(lg); lg.connect(o.frequency);
      const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.35, t + 0.02); g.gain.setValueAtTime(0.35, t + dur - 0.03); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(this.sfxG); o.start(t); lfo.start(t); o.stop(t + dur + 0.02); lfo.stop(t + dur + 0.02);
    };
    if (kind === 'short') play(0, 0.28); else if (kind === 'long') play(0, 0.8); else { play(0, 0.5); play(0.7, 0.5); play(1.4, 0.9); }
  }
  ui(kind: 'click' | 'hover' | 'back' | 'confirm' = 'click'): void {
    if (kind === 'hover') this.tone(660, 0.04, 'sine', 0.06);
    else if (kind === 'back') this.tone(380, 0.09, 'triangle', 0.15, 260);
    else if (kind === 'confirm') { this.tone(520, 0.09, 'triangle', 0.18); setTimeout(() => this.tone(780, 0.12, 'triangle', 0.18), 70); }
    else this.tone(520, 0.06, 'triangle', 0.14, 700);
  }
  card(): void { this.tone(300, 0.15, 'square', 0.12); }
  goalStinger(): void { [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => this.tone(f, 0.45, 'triangle', 0.22), i * 110)); }

  // ---------- generative music
  startMusic(mood: 'menu' | 'match' = 'menu'): void {
    if (!this.ok() || this.musicOn || !settings.value.audio.menuMusic && mood === 'menu') return;
    this.musicOn = true;
    const ctx = this.ctx!;
    const chords = mood === 'menu' ? [[0, 4, 7, 11], [-3, 0, 4, 7], [-5, -1, 2, 5], [-7, -3, 0, 4]] : [[0, 7, 12, 16], [-2, 5, 10, 14], [-4, 3, 8, 12], [-5, 2, 7, 11]];
    const base = 110;
    const tempo = mood === 'menu' ? 1.9 : 1.2;
    const play = (): void => {
      const t = ctx.currentTime;
      const chord = chords[Math.floor(this.step / 4) % chords.length]!;
      const n = chord[this.step % 4]!;
      const f = base * Math.pow(2, n / 12) * (this.step % 8 < 4 ? 2 : 4);
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f;
      const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.16, t + 0.05); g.gain.exponentialRampToValueAtTime(0.0001, t + tempo * 1.8);
      o.connect(g); g.connect(this.musicG); o.start(t); o.stop(t + tempo * 1.9);
      if (this.step % 4 === 0) {
        for (const nn of [chord[0]!, chord[1]!, chord[2]!]) {
          const p = ctx.createOscillator(); p.type = 'triangle'; p.frequency.value = (base / 2) * Math.pow(2, nn / 12);
          const pg = ctx.createGain(); pg.gain.setValueAtTime(0.0001, t); pg.gain.exponentialRampToValueAtTime(0.07, t + 0.8); pg.gain.exponentialRampToValueAtTime(0.0001, t + tempo * 4.2);
          p.connect(pg); pg.connect(this.musicG); p.start(t); p.stop(t + tempo * 4.3);
        }
      }
      this.step++;
    };
    play();
    this.musicTimer = setInterval(play, tempo * 500);
  }
  stopMusic(): void { if (this.musicTimer) clearInterval(this.musicTimer); this.musicTimer = null; this.musicOn = false; }

  /** Browser text-to-speech for the commentary ticker (opt-in). */
  speak(text: string): void {
    if (!settings.value.audio.tts || typeof speechSynthesis === 'undefined') return;
    const u = new SpeechSynthesisUtterance(text); u.rate = 1.05; u.volume = settings.value.audio.master;
    speechSynthesis.cancel(); speechSynthesis.speak(u);
  }
}

export const audio = new AudioEngine();
