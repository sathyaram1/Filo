// Sentinella della suoneria lunga (src/shared/sounds.js).
// Una scadenza suona finché qualcuno non la ferma, quindi i lotti di note si
// susseguono per minuti: se un lotto ricomincia da «adesso» invece che dalla
// coda del precedente, per una decina di secondi si sentono due copie della
// stessa suoneria sovrapposte (verifica #667, giro 2).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));

// Uno solo per tutto il file: il modulo si tiene il suo AudioContext dalla prima
// chiamata in poi, quindi un contesto nuovo a ogni prova non verrebbe mai usato.
const NOTE = [];
const CTX = contestoFinto(NOTE);

function contestoFinto(note) {
  return {
    currentTime: 0,
    state: 'running',
    destination: {},
    createGain: () => ({ gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} }),
    createOscillator() {
      return {
        type: '', frequency: { value: 0 }, onended: null, connect() {},
        start(t) { this._t0 = t; },
        // `silence()` richiama stop() senza argomento per zittire subito: non è
        // una nota in più, è la stessa troncata.
        stop(t) { if (t !== undefined) note.push([this._t0, t]); },
      };
    },
  };
}

// Suona `giri` lotti di seguito, con il rifornimento che arriva quando il codice
// se l'è programmato. Ritorna le note nell'ordine in cui vanno in onda.
function noteDi(tone, giri, ritardoRifornimento = 0) {
  const note = NOTE;
  const ctx = CTX;
  note.length = 0;
  const veroTimeout = globalThis.setTimeout;
  const veroClear = globalThis.clearTimeout;
  const coda = [];
  globalThis.AudioContext = function () { return ctx; };
  globalThis.setTimeout = (fn, ms) => { coda.push({ fn, ms }); return 0; };
  globalThis.clearTimeout = () => {};
  try {
    const S = globalThis.SN_SOUNDS;
    S.silence();
    S.ring(tone);
    for (let i = 0; i < giri; i++) {
      const p = coda.pop();
      if (!p) break;
      ctx.currentTime += p.ms / 1000 + ritardoRifornimento;
      p.fn();
    }
    S.silence();
  } finally {
    globalThis.setTimeout = veroTimeout;
    globalThis.clearTimeout = veroClear;
  }
  return note.sort((a, b) => a[0] - b[0]);
}

function sovrapposte(note) {
  let n = 0;
  for (let i = 1; i < note.length; i++) if (note[i][0] < note[i - 1][1] - 1e-9) n++;
  return n;
}

// Il modulo si auto-registra su globalThis; l'AudioContext finto lo mette ogni
// chiamata, prima che `ctx()` lo cerchi.
require(join(__dirname, '..', '..', 'src', 'shared', 'sounds.js'));

test('i lotti si accodano: nessuna nota suona sopra un\'altra', () => {
  for (const tone of globalThis.SN_SOUNDS.TONE_IDS) {
    const note = noteDi(tone, 4);
    assert.ok(note.length > 20, `il motivo ${tone} deve programmare delle note`);
    assert.equal(sovrapposte(note), 0, `motivo ${tone}: note sovrapposte`);
  }
});

test('un rifornimento in ritardo lascia un buco, mai una sovrapposizione', () => {
  // Con la finestra ridotta a icona i timer della pagina vengono strozzati e il
  // lotto nuovo arriva tardi: peggio che può, si sente una pausa.
  for (const tone of globalThis.SN_SOUNDS.TONE_IDS) {
    const note = noteDi(tone, 3, 30);
    assert.equal(sovrapposte(note), 0, `motivo ${tone}: note sovrapposte col rifornimento tardivo`);
  }
});
