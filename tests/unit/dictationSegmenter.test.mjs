// Unit test — dettatura in diretta: il segmentatore spezza il microfono in frasi.
//
// Il tempo è misurato sui campioni, quindi la stessa sequenza produce sempre
// gli stessi eventi. Si simula voce con rumore bianco a energia alta e pause
// con silenzio (o rumore di fondo debole), e si verifica CHI riceve cosa:
//   - una frase chiusa da una pausa → una trascrizione DEFINITIVA;
//   - una frase lunga → trascrizioni PROVVISORIE mentre va avanti;
//   - una pausa senza aver mai parlato → niente (non si spende per il silenzio);
//   - flush() a fine registrazione → la frase rimasta a metà è definitiva.
// Senza il segmentatore la dettatura mandava un unico file alla fine: nessuno
// di questi eventi esisteva.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');

require(join(ROOT, 'src', 'shared', 'dictationSegmenter.js'));
const Seg = globalThis.SN_DICTATION_SEGMENTER;

const RATE = 16000;

// Rumore pseudo-casuale deterministico (LCG), ampiezza data: "voce".
function noise(ms, amp, seed = 1) {
  const n = Math.round(RATE * ms / 1000);
  const out = new Float32Array(n);
  let s = seed >>> 0;
  for (let i = 0; i < n; i++) {
    s = (s * 1664525 + 1013904223) >>> 0;
    out[i] = ((s / 0xffffffff) * 2 - 1) * amp;
  }
  return out;
}
const silence = (ms) => new Float32Array(Math.round(RATE * ms / 1000));

function run(parts, opts) {
  const events = [];
  const seg = Seg.createSegmenter({
    sampleRate: RATE,
    onInterim: (s) => events.push({ kind: 'interim', ms: s.ms, speechMs: s.speechMs }),
    onFinal: (s) => events.push({ kind: 'final', ms: s.ms, speechMs: s.speechMs }),
    ...(opts || {}),
  });
  // Spinge a blocchi irregolari, come farebbe l'audio reale (4096 campioni).
  for (const p of parts) {
    for (let off = 0; off < p.length; off += 4096) seg.push(p.subarray(off, Math.min(p.length, off + 4096)));
  }
  return { seg, events };
}

test('una frase chiusa da una pausa diventa una trascrizione definitiva', () => {
  const { events } = run([silence(300), noise(1000, 0.2), silence(900)]);
  const finals = events.filter((e) => e.kind === 'final');
  assert.equal(finals.length, 1, `attesa una frase definitiva, eventi: ${JSON.stringify(events)}`);
  assert.ok(finals[0].speechMs >= 800 && finals[0].speechMs <= 1100, `voce riconosciuta: ${finals[0].speechMs} ms`);
  // Lo spezzone porta con sé un po' di attacco e la pausa di chiusura, non minuti di niente.
  assert.ok(finals[0].ms >= 1000 && finals[0].ms <= 2300, `durata spezzone: ${finals[0].ms} ms`);
});

test('mentre la frase va avanti arrivano trascrizioni provvisorie, e alla pausa quella definitiva', () => {
  const { events } = run([noise(4000, 0.2), silence(900)]);
  const interim = events.filter((e) => e.kind === 'interim');
  const finals = events.filter((e) => e.kind === 'final');
  assert.ok(interim.length >= 2, `attese almeno due provvisorie su 4 s di voce, eventi: ${JSON.stringify(events)}`);
  assert.equal(finals.length, 1);
  // Le provvisorie crescono: ogni volta si manda lo spezzone dall'inizio.
  for (let i = 1; i < interim.length; i++) assert.ok(interim[i].ms > interim[i - 1].ms);
  // La definitiva contiene tutta la frase, non solo la coda.
  assert.ok(finals[0].speechMs >= 3500, `la definitiva copre tutta la frase: ${finals[0].speechMs} ms`);
});

test('il silenzio prima della prima parola non viene spedito', () => {
  const { seg, events } = run([silence(6000)]);
  assert.deepEqual(events, [], 'senza voce non si manda niente');
  assert.ok(seg.state().segmentMs <= 400, `il buffer resta corto: ${seg.state().segmentMs} ms`);
});

test('un rumore di fondo costante e debole non è parlato', () => {
  const { events } = run([noise(5000, 0.004, 7)]);
  assert.deepEqual(events, []);
});

test('una frase troppo corta (un colpo di tosse) si butta', () => {
  const { events } = run([silence(200), noise(150, 0.3), silence(1000)]);
  assert.deepEqual(events.filter((e) => e.kind === 'final'), []);
});

test('una frase lunghissima si chiude comunque al tetto, senza aspettare una pausa', () => {
  const { events } = run([noise(20000, 0.2)], { maxSegmentMs: 6000 });
  const finals = events.filter((e) => e.kind === 'final');
  assert.ok(finals.length >= 3, `attese ≥3 definitive su 20 s col tetto a 6 s: ${finals.length}`);
  for (const f of finals) assert.ok(f.ms <= 6100, `nessuno spezzone oltre il tetto: ${f.ms}`);
});

test('due frasi separate da una pausa arrivano come due definitive, in ordine', () => {
  const { events } = run([noise(800, 0.2, 3), silence(900), noise(1200, 0.2, 5), silence(900)]);
  const finals = events.filter((e) => e.kind === 'final');
  assert.equal(finals.length, 2);
  assert.ok(finals[0].speechMs < finals[1].speechMs, 'la seconda è la più lunga');
});

test('flush(): la frase rimasta a metà a fine registrazione è definitiva', () => {
  const { seg, events } = run([noise(900, 0.2)]);
  assert.deepEqual(events.filter((e) => e.kind === 'final'), [], 'senza pausa non è ancora chiusa');
  seg.flush();
  assert.equal(events.filter((e) => e.kind === 'final').length, 1);
  // E dopo il flush il segmentatore è pulito.
  assert.equal(seg.state().hadSpeech, false);
});

test('downsample: 48 kHz → 16 kHz conserva la durata; il WAV ha intestazione e campioni giusti', () => {
  const src = new Float32Array(48000); // un secondo
  for (let i = 0; i < src.length; i++) src[i] = Math.sin(i / 10) * 0.5;
  const down = Seg.downsample(src, 48000, 16000);
  assert.equal(down.length, 16000);
  const int16 = Seg.floatToInt16(down);
  const wav = Seg.pcm16ToWav(int16, 16000);
  assert.equal(wav.length, 44 + 16000 * 2);
  assert.equal(String.fromCharCode(...wav.subarray(0, 4)), 'RIFF');
  assert.equal(String.fromCharCode(...wav.subarray(8, 12)), 'WAVE');
  const view = new DataView(wav.buffer);
  assert.equal(view.getUint32(24, true), 16000, 'sample rate nell\'intestazione');
  assert.equal(view.getUint16(34, true), 16, 'bit per campione');
  // Base64 valido e lungo quanto deve.
  const b64 = Seg.bytesToBase64(wav);
  assert.equal(Buffer.from(b64, 'base64').length, wav.length);
});
