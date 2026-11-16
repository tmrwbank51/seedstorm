// Synthesized sound effects for SEEDSTORM: every sound is generated with the
// Web Audio API at run time, so the game ships no audio files and no network
// is ever involved. The context is created lazily on the first user gesture.
const Sfx = (function () {
  let ctx = null;
  let master = null;
  let muted = false;
  let noiseBuffer = null;

  function ensure() {
    if (ctx) {
      if (ctx.state === 'suspended') ctx.resume();
      return true;
    }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.5;
      master.connect(ctx.destination);
      const len = ctx.sampleRate * 0.5;
      noiseBuffer = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = noiseBuffer.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      return true;
    } catch (e) {
      return false;
    }
  }

  function tone(freq, dur, type, vol, slideTo, delay) {
    if (!ctx || muted) return;
    const t0 = ctx.currentTime + (delay || 0);
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type || 'sine';
    osc.frequency.setValueAtTime(freq, t0);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t0 + dur);
    gain.gain.setValueAtTime(vol || 0.2, t0);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    osc.connect(gain);
    gain.connect(master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  function noise(dur, vol, filterFreq, delay) {
    if (!ctx || muted) return;
    const t0 = ctx.currentTime + (delay || 0);
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = filterFreq || 800;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(vol || 0.3, t0);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(master);
    src.start(t0);
    src.stop(t0 + dur + 0.02);
  }

  const sounds = {
    ui: function () { tone(660, 0.07, 'triangle', 0.15); },
    launch: function () { tone(300, 0.25, 'sawtooth', 0.12, 900); noise(0.18, 0.1, 2400); },
    explosion: function () {
      noise(0.55, 0.5, 420);
      tone(120, 0.5, 'sine', 0.5, 38);
      noise(0.2, 0.2, 3000, 0.02);
    },
    bigExplosion: function () {
      noise(0.8, 0.6, 300);
      tone(95, 0.7, 'sine', 0.6, 30);
      noise(0.3, 0.25, 2600, 0.03);
    },
    freeze: function () {
      tone(1400, 0.3, 'sine', 0.14, 2200);
      tone(1900, 0.25, 'sine', 0.1, 2600, 0.08);
    },
    pickup: function () { tone(520, 0.1, 'triangle', 0.2); tone(780, 0.14, 'triangle', 0.2, null, 0.09); },
    jump: function () { tone(280, 0.16, 'sine', 0.14, 520); },
    hurt: function () { tone(180, 0.15, 'square', 0.12, 90); },
    fall: function () { tone(500, 0.3, 'sine', 0.1, 140); },
    turn: function () { tone(440, 0.09, 'triangle', 0.14); tone(560, 0.11, 'triangle', 0.14, null, 0.08); },
    victory: function () {
      const notes = [523, 659, 784, 1047];
      for (let i = 0; i < notes.length; i++) tone(notes[i], 0.22, 'triangle', 0.2, null, i * 0.13);
    },
    defeat: function () {
      const notes = [392, 330, 262, 196];
      for (let i = 0; i < notes.length; i++) tone(notes[i], 0.28, 'triangle', 0.18, null, i * 0.16);
    },
    teleport: function () { tone(900, 0.3, 'sine', 0.14, 240); tone(300, 0.3, 'sine', 0.12, 980, 0.12); },
    heal: function () { tone(480, 0.2, 'sine', 0.16, 720); tone(720, 0.25, 'sine', 0.14, 960, 0.12); }
  };

  return {
    unlock: ensure,
    play: function (name) {
      if (muted) return;
      if (!ensure()) return;
      if (sounds[name]) sounds[name]();
    },
    setMuted: function (m) { muted = !!m; },
    isMuted: function () { return muted; },
    toggleMuted: function () { muted = !muted; return muted; }
  };
})();
