// Unit test per src/shared/ttsChunk.js — la logica PURA della lettura ad alta
// voce a blocchi (chunk) e della mappatura avanzamento → parola evidenziata.
//
// Questa logica è il cuore di due feature richieste dall'utente:
//   1. ridurre l'attesa prima della prima parola (chunk: prima frase corta
//      sintetizzata subito);
//   2. evidenziare la parola letta (tokenizzazione + mappa frazione→token).
// Girano in millisecondi senza Electron.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
require(join(__dirname, '..', '..', 'src', 'shared', 'ttsChunk.js'));

const T = globalThis.SN_TTS_CHUNK;

test('il modulo si registra su globalThis con la sua API', () => {
  assert.ok(T);
  for (const fn of ['tokenize', 'chunkTokens', 'tokenIndexAtFraction', 'charIndexToToken', 'endsSentence']) {
    assert.equal(typeof T[fn], 'function', `manca ${fn}`);
  }
});

test('tokenize ritorna parole con offset esatti nel testo', () => {
  const text = 'Ciao  mondo!';
  const toks = T.tokenize(text);
  assert.equal(toks.length, 2);
  assert.deepEqual(toks[0], { text: 'Ciao', start: 0, end: 4 });
  // due spazi: "mondo!" parte a 6
  assert.deepEqual(toks[1], { text: 'mondo!', start: 6, end: 12 });
  // gli offset ricostruiscono la parola
  assert.equal(text.slice(toks[1].start, toks[1].end), 'mondo!');
});

test('tokenize gestisce stringa vuota / null', () => {
  assert.deepEqual(T.tokenize(''), []);
  assert.deepEqual(T.tokenize(null), []);
});

test('endsSentence riconosce la punteggiatura di fine frase', () => {
  for (const w of ['fine.', 'davvero?', 'no!', 'attesa…', 'detto."', "fatto.'", 'chiuso.)']) {
    assert.equal(T.endsSentence(w), true, `"${w}" dovrebbe chiudere la frase`);
  }
  for (const w of ['ciao', 'mondo', 'e,', 'quasi;']) {
    assert.equal(T.endsSentence(w), false, `"${w}" NON dovrebbe chiudere la frase`);
  }
});

test('chunkTokens: il PRIMO chunk è corto (firstCap) per partire prima', () => {
  // Tre frasi; con firstCap basso la prima frase deve stare da sola.
  const text = 'Prima frase qui. Seconda frase un poco piu lunga del solito. Terza.';
  const toks = T.tokenize(text);
  const chunks = T.chunkTokens(toks, { firstCap: 16, softCap: 40, hardCap: 200 });
  assert.ok(chunks.length >= 2, 'dovrebbe spezzare in piu chunk');
  // Il primo chunk corrisponde alla prima frase ("Prima frase qui.")
  const first = chunks[0];
  assert.equal(text.slice(first.start, first.end), 'Prima frase qui.');
  // I chunk coprono tutti i token senza buchi né sovrapposizioni.
  let expected = 0;
  for (const c of chunks) {
    assert.equal(c.from, expected, 'i chunk devono essere contigui');
    expected = c.to + 1;
  }
  assert.equal(expected, toks.length, 'tutti i token devono essere coperti');
});

test('chunkTokens: un solo chunk se il testo è corto', () => {
  const toks = T.tokenize('Testo breve.');
  const chunks = T.chunkTokens(toks, {});
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].from, 0);
  assert.equal(chunks[0].to, toks.length - 1);
});

test('chunkTokens: taglio FORZATO oltre hardCap anche senza fine frase', () => {
  // Nessuna punteggiatura: senza hard cap sarebbe un chunk solo enorme.
  const words = Array.from({ length: 60 }, (_, i) => `parola${i}`);
  const text = words.join(' ');
  const toks = T.tokenize(text);
  const chunks = T.chunkTokens(toks, { firstCap: 50, softCap: 50, hardCap: 60 });
  assert.ok(chunks.length >= 2, 'hardCap deve forzare il taglio');
  for (const c of chunks) {
    const len = toks[c.to].end - toks[c.from].start;
    // ogni chunk non supera di troppo l'hardCap (al più una parola in eccesso)
    assert.ok(len <= 60 + 12, `chunk troppo lungo: ${len}`);
  }
});

test('chunkTokens: array vuoto → nessun chunk', () => {
  assert.deepEqual(T.chunkTokens([], {}), []);
  assert.deepEqual(T.chunkTokens(null, {}), []);
});

test('tokenIndexAtFraction: 0 → prima parola del chunk, ~1 → ultima', () => {
  const toks = T.tokenize('uno due tre quattro cinque');
  // chunk su tutti i token
  assert.equal(T.tokenIndexAtFraction(toks, 0, 4, 0), 0);
  assert.equal(T.tokenIndexAtFraction(toks, 0, 4, 1), 4);
  // a metà cade su una parola centrale
  const mid = T.tokenIndexAtFraction(toks, 0, 4, 0.5);
  assert.ok(mid >= 1 && mid <= 3, `metà dovrebbe stare al centro, era ${mid}`);
});

test('tokenIndexAtFraction: frazione clampata e indici validi', () => {
  const toks = T.tokenize('a b c');
  assert.equal(T.tokenIndexAtFraction(toks, 0, 2, -5), 0);
  assert.equal(T.tokenIndexAtFraction(toks, 0, 2, 99), 2);
  assert.equal(T.tokenIndexAtFraction([], 0, 0, 0.5), -1);
});

test('charIndexToToken: mappa un offset di carattere alla parola giusta', () => {
  const text = 'Questo è il testo';
  const toks = T.tokenize(text);
  // "Questo" 0-6, "è" 7-8(?), ... verifichiamo che l'indice del carattere
  // dentro "testo" ritorni l'ultimo token.
  const idxTesto = text.indexOf('testo');
  assert.equal(T.charIndexToToken(toks, idxTesto), toks.length - 1);
  // carattere 0 → prima parola
  assert.equal(T.charIndexToToken(toks, 0), 0);
});
