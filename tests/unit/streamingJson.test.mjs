// Unit test per src/shared/streamingJson.js (SN_STREAM_JSON) — #420.
//
// La chat della home riceve la risposta come JSON `{ "text": "...", "actions": [...] }`
// e prima doveva attenderlo INTERO per mostrare anche solo la prima parola.
// Questo modulo estrae il valore del campo "text" mano a mano che i delta
// arrivano. I test fissano le garanzie: (a) il testo esce carattere per
// carattere anche se i delta spezzano parole/escape, (b) non si emette mai metà
// di un escape, (c) una risposta di sola azione (text vuoto) non emette nulla,
// (d) reset() riparte da zero (fallback provider a metà).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('../../src/shared/streamingJson.js');
const SJ = globalThis.SN_STREAM_JSON;

// Alimenta lo streamer un carattere per volta (il caso più ostile: ogni chunk è
// grande 1) e ritorna il testo emesso concatenando i delta.
function feedCharByChar(raw) {
  const s = SJ.createTextStreamer('text');
  let out = '';
  let done = false;
  for (const ch of raw) {
    const r = s.push(ch);
    out += r.delta;
    if (r.done) done = true;
  }
  return { out, done };
}

test('SN_STREAM_JSON si registra con le sue funzioni', () => {
  assert.ok(SJ);
  for (const fn of ['createTextStreamer', 'decodeStringPrefix', 'findFieldStart']) {
    assert.equal(typeof SJ[fn], 'function', `manca ${fn}`);
  }
});

test('emette il testo carattere per carattere e si chiude alla virgoletta', () => {
  const raw = '{"text":"Ciao, come stai?","actions":[]}';
  const { out, done } = feedCharByChar(raw);
  assert.equal(out, 'Ciao, come stai?');
  assert.equal(done, true);
});

test('il testo esce PRIMA che arrivino le actions (streaming reale)', () => {
  const s = SJ.createTextStreamer('text');
  // Primo blocco: apertura + parte del testo, ancora NIENTE actions.
  let r = s.push('{"text":"Sto arriv');
  assert.equal(r.delta, 'Sto arriv');
  assert.equal(r.done, false);
  // Secondo blocco: completa il testo e chiude la stringa.
  r = s.push('ando"');
  assert.equal(r.delta, 'ando');
  assert.equal(r.done, true);
  // Le actions in coda non producono altro testo.
  r = s.push(',"actions":[{"type":"NAVIGA"}]}');
  assert.equal(r.delta, '');
});

test('gli escape spezzati fra due chunk non emettono mai metà escape', () => {
  const s = SJ.createTextStreamer('text');
  // Chunk che termina con un backslash a metà escape.
  let r = s.push('{"text":"riga1\\');
  assert.equal(r.delta, 'riga1'); // NON emette il backslash da solo
  // Arriva la 'n': ora l'escape \n è completo → esce come a-capo vero.
  r = s.push('nriga2"');
  assert.equal(r.delta, '\nriga2');
  assert.equal(r.done, true);
});

test('decodifica virgolette escapate e unicode senza chiudere in anticipo', () => {
  const raw = '{"text":"dice \\"ciao\\" e \\u00e8 qui","actions":[]}';
  const { out, done } = feedCharByChar(raw);
  assert.equal(out, 'dice "ciao" e è qui');
  assert.equal(done, true);
});

test('unicode spezzato su più chunk non emette hex parziale', () => {
  const s = SJ.createTextStreamer('text');
  let r = s.push('{"text":"x\\u00');
  assert.equal(r.delta, 'x'); // \u00.. incompleto → non emesso
  r = s.push('e8y"');
  assert.equal(r.delta, 'èy');
  assert.equal(r.done, true);
});

test('risposta di sola azione (text vuoto): nessun delta di testo', () => {
  const s = SJ.createTextStreamer('text');
  const deltas = [];
  for (const ch of '{"text":"","actions":[{"type":"NAVIGA","url":"x"}]}') {
    const r = s.push(ch);
    if (r.delta) deltas.push(r.delta);
  }
  assert.deepEqual(deltas, []);
});

test('finché "text":" non è arrivato per intero non si emette nulla', () => {
  const s = SJ.createTextStreamer('text');
  // La chiave arriva a pezzi: nessun delta finché non c'è la virgoletta di apertura del valore.
  assert.equal(s.push('{"te').delta, '');
  assert.equal(s.push('xt"').delta, '');
  assert.equal(s.push(' : ').delta, '');
  assert.equal(s.push('"Pron').delta, 'Pron');
});

test('tollera un recinto ```json iniziale prima del JSON', () => {
  const { out } = feedCharByChar('```json\n{"text":"con recinto","actions":[]}\n```');
  assert.equal(out, 'con recinto');
});

test('reset() butta il testo già emesso e riparte (fallback provider)', () => {
  const s = SJ.createTextStreamer('text');
  let r = s.push('{"text":"parziale del primo tent');
  assert.equal(r.delta, 'parziale del primo tent');
  // Il provider cade: reset, poi il secondo tentativo riscrive da capo.
  s.reset();
  r = s.push('{"text":"Risposta pulita"');
  assert.equal(r.delta, 'Risposta pulita');
  assert.equal(r.done, true);
});
