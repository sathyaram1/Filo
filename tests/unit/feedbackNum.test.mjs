// Unit test per la numerazione/titolazione dei feedback (src/shared/feedback.js):
// formatNum (#22, #22.1) e fallbackName (titolo di ripiego quando l'LLM non
// risponde). Logica pura, gira via `npm run test:unit` senza Electron né rete.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
require(join(__dirname, '..', '..', 'src', 'shared', 'feedback.js'));

const FB = globalThis.SN_FEEDBACK;

test('feedback espone formatNum e fallbackName', () => {
  assert.equal(typeof FB.formatNum, 'function');
  assert.equal(typeof FB.fallbackName, 'function');
});

test('formatNum: top-level e sub-feedback', () => {
  assert.equal(FB.formatNum(22, 0), '22');
  assert.equal(FB.formatNum(22), '22');
  assert.equal(FB.formatNum(22, 1), '22.1');
  assert.equal(FB.formatNum(7, 12), '7.12');
});

test('formatNum: input non numerabili → stringa vuota (nessun "#" in dashboard)', () => {
  assert.equal(FB.formatNum(undefined, undefined), '');
  assert.equal(FB.formatNum(null, null), '');
  assert.equal(FB.formatNum(0, 0), '');
  assert.equal(FB.formatNum(-3, 0), '');
  assert.equal(FB.formatNum('abc', 1), '');
  assert.equal(FB.formatNum(2.5, 0), '');
});

test('formatNum: subSeq non valido degrada a top-level', () => {
  assert.equal(FB.formatNum(22, 'x'), '22');
  assert.equal(FB.formatNum(22, -1), '22');
  assert.equal(FB.formatNum(22, 1.5), '22');
});

test('fallbackName: prime parole del testo, con ellissi se tronca', () => {
  assert.equal(FB.fallbackName('La gestione dei segreti non funziona quando riavvio'),
    'La gestione dei segreti non funziona…');
  assert.equal(FB.fallbackName('Bug breve'), 'Bug breve');
  assert.equal(FB.fallbackName('  spazi   doppi \n e a capo  '), 'spazi doppi e a capo');
});

test('fallbackName: testo vuoto → stringa vuota; parole lunghissime troncate a ~60', () => {
  assert.equal(FB.fallbackName(''), '');
  assert.equal(FB.fallbackName('   '), '');
  const long = FB.fallbackName('a'.repeat(200));
  assert.ok(long.length <= 60, `titolo troppo lungo: ${long.length}`);
  assert.ok(long.endsWith('…'));
});

// Una stringa contiene un surrogato solitario (mezza emoji) se, dopo aver
// rimosso le coppie surrogate valide, resta un code unit nel range surrogati.
function hasLoneSurrogate(s) {
  const noPairs = String(s).replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, '');
  return /[\uD800-\uDFFF]/.test(noPairs);
}

test('fallbackName: testo di sole emoji non produce caratteri rotti (nessun surrogato solitario)', () => {
  // 40 emoji consecutive: senza troncamento per grafema, slice(0,57) su unità
  // UTF-16 cadrebbe a metà di una coppia surrogata e lascerebbe mezza emoji.
  const title = FB.fallbackName('😀'.repeat(40));
  assert.ok(title.endsWith('…'), 'manca ellissi sul titolo troncato');
  assert.ok(!hasLoneSurrogate(title), `titolo con carattere rotto: ${JSON.stringify(title)}`);
  // Ogni unità visibile prima dell'ellissi deve essere un'emoji intera.
  const emojiPart = title.slice(0, -1);
  for (const ch of emojiPart) assert.equal(ch, '😀', 'emoji spezzata nel titolo');

  // Emoji composte (ZWJ e modificatore tono pelle): niente ZWJ/ modificatori
  // penzolanti né surrogati soli.
  const family = FB.fallbackName('👨‍👩‍👧 '.repeat(30).trim());
  assert.ok(!hasLoneSurrogate(family), 'surrogato solitario con emoji ZWJ');
  const thumbs = FB.fallbackName('👍🏽'.repeat(40));
  assert.ok(!hasLoneSurrogate(thumbs), 'surrogato solitario con modificatore tono pelle');
});
