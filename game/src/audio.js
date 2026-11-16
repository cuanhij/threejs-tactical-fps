// Sound, synthesised with WebAudio: no audio files are shipped, so the game
// loads nothing over the network. Every effect is a short node graph built on
// demand and dropped when it ends. Audio starts on the first user gesture.
export function createAudio() {
  let ctx = null;
  let master = null;

  function ensure() {
    if (ctx) return true;
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      master = ctx.createGain();
      master.gain.value = 0.4;
      master.connect(ctx.destination);
      return true;
    } catch {
      return false;
    }
  }

  function noiseBuffer(seconds) {
    const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
    return buffer;
  }

  function burst({ duration, filterFreq, filterType = 'lowpass', gain, decay, pitch = null }) {
    if (!ensure()) return;
    const t = ctx.currentTime;
    const source = ctx.createBufferSource();
    source.buffer = noiseBuffer(duration + 0.05);
    const filter = ctx.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.value = filterFreq;
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(gain, t);
    amp.gain.exponentialRampToValueAtTime(0.001, t + decay);
    source.connect(filter);
    filter.connect(amp);
    amp.connect(master);
    source.start(t);
    source.stop(t + duration + 0.05);
    if (pitch) {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(pitch, t);
      osc.frequency.exponentialRampToValueAtTime(Math.max(30, pitch * 0.4), t + decay);
      const oAmp = ctx.createGain();
      oAmp.gain.setValueAtTime(gain * 0.7, t);
      oAmp.gain.exponentialRampToValueAtTime(0.001, t + decay);
      osc.connect(oAmp);
      oAmp.connect(master);
      osc.start(t);
      osc.stop(t + decay);
    }
  }

  function tone({ freq, duration, gain, type = 'sine', slideTo = null }) {
    if (!ensure()) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + duration);
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(gain, t);
    amp.gain.exponentialRampToValueAtTime(0.001, t + duration);
    osc.connect(amp);
    amp.connect(master);
    osc.start(t);
    osc.stop(t + duration);
  }

  return {
    unlock() {
      ensure();
      if (ctx && ctx.state === 'suspended') ctx.resume();
    },
    shot(kind) {
      if (kind === 'sniper') burst({ duration: 0.3, filterFreq: 900, gain: 0.9, decay: 0.28, pitch: 140 });
      else if (kind === 'smg') burst({ duration: 0.12, filterFreq: 1600, gain: 0.55, decay: 0.1, pitch: 220 });
      else if (kind === 'pistol') burst({ duration: 0.14, filterFreq: 1400, gain: 0.6, decay: 0.12, pitch: 190 });
      else burst({ duration: 0.18, filterFreq: 1100, gain: 0.8, decay: 0.16, pitch: 160 });
    },
    distantShot() {
      burst({ duration: 0.2, filterFreq: 500, gain: 0.22, decay: 0.18, pitch: 110 });
    },
    dryFire() {
      tone({ freq: 1400, duration: 0.04, gain: 0.12, type: 'square' });
    },
    reload() {
      tone({ freq: 900, duration: 0.05, gain: 0.15, type: 'square' });
      setTimeout(() => tone({ freq: 600, duration: 0.05, gain: 0.15, type: 'square' }), 260);
    },
    footstep(run) {
      burst({ duration: 0.07, filterFreq: 320, gain: run ? 0.16 : 0.09, decay: 0.06 });
    },
    hit() {
      tone({ freq: 2400, duration: 0.05, gain: 0.2, type: 'square' });
    },
    kill() {
      tone({ freq: 1800, duration: 0.07, gain: 0.22, type: 'square' });
      setTimeout(() => tone({ freq: 2600, duration: 0.08, gain: 0.2, type: 'square' }), 70);
    },
    hurt() {
      burst({ duration: 0.15, filterFreq: 300, gain: 0.35, decay: 0.14, pitch: 90 });
    },
    plantBeep(final) {
      tone({ freq: final ? 1900 : 1200, duration: final ? 0.3 : 0.08, gain: 0.2, type: 'square' });
    },
    explosion() {
      burst({ duration: 1.1, filterFreq: 400, gain: 1.0, decay: 1.0, pitch: 70 });
    },
    roundWin() {
      tone({ freq: 523, duration: 0.14, gain: 0.2 });
      setTimeout(() => tone({ freq: 659, duration: 0.14, gain: 0.2 }), 130);
      setTimeout(() => tone({ freq: 784, duration: 0.22, gain: 0.22 }), 260);
    },
    roundLose() {
      tone({ freq: 392, duration: 0.16, gain: 0.2 });
      setTimeout(() => tone({ freq: 311, duration: 0.26, gain: 0.2 }), 150);
    },
    buy() {
      tone({ freq: 880, duration: 0.06, gain: 0.18, type: 'square' });
      setTimeout(() => tone({ freq: 1174, duration: 0.08, gain: 0.18, type: 'square' }), 60);
    },
    denied() {
      tone({ freq: 220, duration: 0.12, gain: 0.2, type: 'square' });
    },
    grenadePin() {
      tone({ freq: 1500, duration: 0.03, gain: 0.14, type: 'square' });
    },
  };
}
