// Toni sintetici dell'interfaccia (nessun file audio): Preferenze, shell e timer
// devono suonare gli STESSI motivi. IIFE su globalThis: `SN_SOUNDS`.
(function (global) {
  'use strict';

  // Sequenze [frequenzaHz, durataMs], freq 0 = pausa: gli stessi motivi della
  // suoneria del timer, riusati per le notifiche.
  const TONES = {
    default: [[880, 150], [0, 80], [880, 150], [0, 80], [880, 150], [0, 400]],
    gentle:  [[523, 200], [0, 100], [659, 200], [0, 100], [784, 300], [0, 600]],
    urgent:  [[1047, 80], [0, 50], [1047, 80], [0, 50], [1047, 80], [0, 50],
              [1047, 80], [0, 50], [1047, 80], [0, 300]],
    chime:   [[1046, 120], [0, 60], [1318, 120], [0, 60], [1568, 120], [0, 60],
              [2093, 200], [0, 700]],
  };
  const TONE_IDS = Object.keys(TONES);

  const TONE_LABELS = {
    default: 'Standard',
    gentle: 'Delicata',
    urgent: 'Urgente',
    chime: 'Carillon',
  };

  let _ctx = null;
  function ctx() {
    const AC = global.AudioContext || global.webkitAudioContext;
    if (!AC) return null;
    if (!_ctx) _ctx = new AC();
    return _ctx;
  }

  // Non lancia mai: senza audio (headless) è un no-op silenzioso.
  // true se la riproduzione è partita.
  function play(toneId) {
    try {
      const c = ctx();
      if (!c) return false;
      const notes = TONES[toneId] || TONES.default;
      const start = () => {
        let t = c.currentTime;
        for (const [freq, durMs] of notes) {
          if (freq > 0) {
            const osc = c.createOscillator();
            const gain = c.createGain();
            osc.type = 'sine';
            osc.frequency.value = freq;
            gain.gain.setValueAtTime(0.35, t);
            gain.gain.exponentialRampToValueAtTime(0.001, t + durMs / 1000 - 0.01);
            osc.connect(gain);
            gain.connect(c.destination);
            osc.start(t);
            osc.stop(t + durMs / 1000);
          }
          t += durMs / 1000;
        }
      };
      if (c.state === 'suspended') c.resume().then(start).catch(() => {});
      else start();
      return true;
    } catch (_) {
      return false;
    }
  }

  global.SN_SOUNDS = { TONES, TONE_IDS, TONE_LABELS, play };
})(typeof globalThis !== 'undefined' ? globalThis : self);
