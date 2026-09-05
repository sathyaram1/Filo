// Unit test — voci del modello di lettura: la lingua del testo sceglie la voce.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');

require(join(ROOT, 'src', 'shared', 'ttsVoices.js'));
const V = globalThis.SN_TTS_VOICES;

test('la lingua del testo sceglie una voce di quella lingua; l\'ignoto legge in inglese', () => {
  assert.equal(V.langOfVoice(V.defaultVoiceFor('it-IT')), 'it');
  assert.equal(V.langOfVoice(V.defaultVoiceFor('it')), 'it');
  assert.equal(V.langOfVoice(V.defaultVoiceFor('en-GB')), 'en');
  assert.equal(V.langOfVoice(V.defaultVoiceFor('fr_FR')), 'fr');
  assert.equal(V.langOfVoice(V.defaultVoiceFor('de')), 'en', 'tedesco non c\'è: inglese');
  assert.equal(V.langOfVoice(V.defaultVoiceFor('')), 'en');
  assert.equal(V.langOfVoice(V.defaultVoiceFor(null)), 'en');
});

test('ogni voce ha lingua, genere ed etichetta; gli id sono quelli del catalogo', () => {
  assert.ok(V.VOICES.length >= 50);
  for (const v of V.VOICES) {
    assert.match(v.id, /^[abefhijpz][fm]_[a-z]+$/, v.id);
    assert.ok(['it', 'en', 'es', 'fr', 'hi', 'ja', 'pt', 'zh'].includes(v.lang), v.id);
    assert.ok(v.gender === 'f' || v.gender === 'm');
    assert.ok(v.label && v.label[0] === v.label[0].toUpperCase());
  }
  assert.ok(V.isKnownVoice('if_sara'));
  assert.ok(!V.isKnownVoice('xx_nessuno'));
});

test('il raggruppamento per lingua copre tutte le voci, una volta sola', () => {
  const groups = V.groupedByLang();
  const ids = groups.flatMap((g) => g.voices.map((v) => v.id));
  assert.equal(ids.length, V.VOICES.length);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(groups[0].lang, 'it', 'l\'italiano viene prima');
});
