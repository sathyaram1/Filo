// Unit test — voci PER MODELLO di lettura: ogni modello ha i suoi nomi, e a
// MAI-Voice (Azure) non si manda `if_sara` (una voce di Kokoro).

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

test('il catalogo si riconosce dall\'id del modello; un modello ignoto non ne ha', () => {
  assert.equal(V.catalogFor('hexgrad/kokoro-82m').id, 'kokoro');
  assert.equal(V.catalogFor('microsoft/mai-voice-2').id, 'azure');
  assert.equal(V.catalogFor('microsoft/mai-voice-2-flash').id, 'azure');
  assert.equal(V.catalogFor('deepgram/aura-2').id, 'aura2');
  assert.equal(V.catalogFor('deepgram/flux-tts:free').id, 'flux');
  assert.equal(V.catalogFor('canopylabs/orpheus-3b-0.1-ft').id, 'orpheus');
  assert.equal(V.catalogFor('fish-audio/s2-pro').id, 'fish');
  assert.equal(V.catalogFor('acme/voce-x'), null);
  assert.equal(V.catalogFor(''), null);
});

test('la voce di partenza è del catalogo del modello, nella lingua del testo', () => {
  assert.equal(V.defaultVoiceFor('it-IT', 'microsoft/mai-voice-2'), 'it-IT-ElsaNeural');
  assert.equal(V.defaultVoiceFor('en', 'microsoft/mai-voice-2'), 'en-US-AvaNeural');
  assert.equal(V.defaultVoiceFor('de', 'microsoft/mai-voice-2'), 'de-DE-KatjaNeural');
  assert.equal(V.defaultVoiceFor('it', 'deepgram/aura-2'), 'aura-2-cinzia-it');
  assert.equal(V.defaultVoiceFor('it', 'canopylabs/orpheus-3b-0.1-ft'), 'tara', 'solo inglese: inglese');
  assert.equal(V.defaultVoiceFor('it', 'fish-audio/s2-pro'), '', 'sceglie da sé');
  assert.equal(V.defaultVoiceFor('it', 'acme/voce-x'), '', 'ignoto: niente');
  // Senza modello resta Kokoro (compatibilità).
  assert.equal(V.defaultVoiceFor('it'), 'if_sara');
});

test('resolveVoice: la voce di un altro modello si ignora, un nome scritto a mano passa', () => {
  const mai = 'microsoft/mai-voice-2';
  // Voce Kokoro rimasta nelle Preferenze + modello MAI → voce MAI della lingua.
  assert.equal(V.resolveVoice({ chosen: 'if_sara', lang: 'it', modelId: mai }), 'it-IT-ElsaNeural');
  assert.equal(V.resolveVoice({ chosen: 'im_nicola', lang: 'en-US', modelId: mai }), 'en-US-AvaNeural');
  // Voce del catalogo giusto → quella.
  assert.equal(V.resolveVoice({ chosen: 'en-GB-SoniaNeural', lang: 'it', modelId: mai }), 'en-GB-SoniaNeural');
  assert.equal(V.resolveVoice({ chosen: 'im_nicola', lang: 'en', modelId: 'hexgrad/kokoro-82m' }), 'im_nicola');
  // Nome che nessun catalogo conosce → passa tale e quale, su qualunque modello.
  assert.equal(V.resolveVoice({ chosen: 'la-mia-voce', lang: 'it', modelId: mai }), 'la-mia-voce');
  assert.equal(V.resolveVoice({ chosen: 'la-mia-voce', lang: 'it', modelId: 'acme/voce-x' }), 'la-mia-voce');
  // Niente scelto: partenza per la lingua, o niente.
  assert.equal(V.resolveVoice({ chosen: '', lang: 'fr', modelId: mai }), 'fr-FR-DeniseNeural');
  assert.equal(V.resolveVoice({ chosen: '', lang: 'it', modelId: 'acme/voce-x' }), '');
  assert.equal(V.resolveVoice({ chosen: '', lang: 'it', modelId: 'fish-audio/s1' }), '');
  // Elenco imparato dal router: vale come catalogo per un modello ignoto.
  const learned = ['aura-2-thalia-en', 'aura-2-cinzia-it'];
  assert.equal(V.resolveVoice({ chosen: '', lang: 'it', modelId: 'acme/voce-x', learned }), 'aura-2-cinzia-it');
  assert.equal(V.resolveVoice({ chosen: 'aura-2-thalia-en', lang: 'it', modelId: 'acme/voce-x', learned }), 'aura-2-thalia-en');
});

test('gli errori del router: voci elencate e voce pretesa', () => {
  const msg = 'OpenRouter 400: {"error":{"message":"Unknown voice \\"x\\". Supported voices: aura-2-thalia-en, aura-2-cinzia-it, aura-2-agathe-fr.","code":400}}';
  assert.deepEqual(V.voicesFromError(msg), ['aura-2-thalia-en', 'aura-2-cinzia-it', 'aura-2-agathe-fr']);
  assert.deepEqual(V.voicesFromError('Provider returned 400'), []);
  assert.equal(V.pickFromList(V.voicesFromError(msg), 'it-IT'), 'aura-2-cinzia-it');
  assert.equal(V.pickFromList(V.voicesFromError(msg), 'de'), 'aura-2-thalia-en', 'lingua assente: inglese');
  assert.equal(V.pickFromList(['en-US-AvaNeural', 'it-IT-ElsaNeural'], 'it'), 'it-IT-ElsaNeural');
  assert.equal(V.pickFromList(['abc', 'def'], 'it'), 'abc');
  assert.ok(V.isVoiceRequiredError('OpenRouter 400: An explicit voice is required for this TTS provider.'));
  assert.ok(!V.isVoiceRequiredError('Provider returned 400'));
});

test('le tendine seguono il modello: italiano prima, etichette leggibili', () => {
  const mai = V.groupedByLang('microsoft/mai-voice-2');
  assert.equal(mai[0].lang, 'it');
  assert.equal(mai[1].lang, 'en');
  assert.ok(mai[0].voices.some((v) => v.id === 'it-IT-ElsaNeural' && v.label === 'Elsa'));
  assert.ok(mai.flatMap((g) => g.voices).some((v) => v.label === 'Sonia (UK)'));
  assert.equal(V.groupedByLang('fish-audio/s2-pro').length, 0);
  assert.equal(V.groupedByLang('acme/voce-x').length, 0);
  assert.equal(V.langOfVoice('it-IT-ElsaNeural'), 'it');
  assert.equal(V.langOfVoice('aura-2-agathe-fr'), 'fr');
  assert.equal(V.catalogOfVoice('tara'), 'orpheus');
  assert.equal(V.catalogOfVoice('la-mia-voce'), '');
  // Nessun id compare in due cataloghi: la regola "voce di un altro modello" sarebbe ambigua.
  const ids = V.allVoices().map((v) => v.id);
  assert.equal(new Set(ids).size, ids.length);
});
