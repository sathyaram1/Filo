// Unit test — l'interruttore "solo modelli a pesi aperti" (#461).
//
// La politica sui modelli promette che chi usa Filo può rifiutare TUTTI i
// modelli proprietari, Anthropic compresa. Qui si verifica la parte pura di
// quella promessa: chi è ammesso, chi viene sostituito da chi, e — soprattutto —
// che non resti nessuna via per cui un modello proprietario torni in gioco.
//
// Senza il fix questi test non compilano nemmeno (le funzioni non esistono);
// con una sostituzione fatta male passano solo quelli banali.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');

require(join(ROOT, 'src', 'shared', 'constants.js'));
// Le capacità dei modelli servono alla sostituzione automatica: senza, un
// modello che macina solo testo finirebbe sulla dettatura.
require(join(ROOT, 'src', 'shared', 'modelCaps.js'));
const C = globalThis.SN_CONST;
const A = C.ACTIONS;
const REG = C.DEFAULT_MODEL_REGISTRY;

test('i pesi aperti si riconoscono dal NOME del modello, non dal fornitore nell\'id', () => {
  assert.equal(C.isOpenWeightsModelId('google/gemma-4-31b-it'), true);
  assert.equal(C.isOpenWeightsModelId('deepseek/deepseek-v4-pro'), true);
  assert.equal(C.isOpenWeightsModelId('moonshotai/kimi-k2.7-code'), true);
  // Versione attaccata al nome della famiglia: è la forma di molti id reali.
  assert.equal(C.isOpenWeightsModelId('qwen/qwen3-embedding-8b'), true);
  assert.equal(C.isOpenWeightsModelId('hexgrad/kokoro-82m'), true);
  assert.equal(C.isOpenWeightsModelId('openai/whisper-large-v3-turbo'), true);
  // Ma non una parola che CONTIENE la famiglia: 'gemmastone' non è Gemma.
  assert.equal(C.isOpenWeightsModelId('acme/gemmastone-1'), false);
  // Proprietari: stesso prefisso "google/", esito opposto.
  assert.equal(C.isOpenWeightsModelId('google/gemini-3.1-flash-lite-preview'), false);
  assert.equal(C.isOpenWeightsModelId('anthropic/claude-3.5-haiku'), false);
  assert.equal(C.isOpenWeightsModelId('openai/gpt-4o-mini'), false);
  // Sconosciuto = proprietario: l'interruttore non ammette ciò che non sa.
  assert.equal(C.isOpenWeightsModelId('acme/modello-misterioso'), false);
  assert.equal(C.isOpenWeightsModelId(''), false);
});

test('pesi aperti serviti dal produttore NON sono ammessi; oggi nessun fornitore di Filo lo è', () => {
  assert.equal(C.isOpenWeightsEntry({ provider: 'openrouter', model: 'google/gemma-4-31b-it' }), true);
  // La lista dei fornitori "API del produttore" esiste ancora (il meccanismo
  // resta), ma è vuota: l'API diretta di Google è fuori da Filo, e il router
  // non è un produttore.
  assert.ok(Array.isArray(C.PRODUCER_DIRECT_PROVIDERS));
  assert.ok(!C.PRODUCER_DIRECT_PROVIDERS.includes('openrouter'));
  for (const p of C.PRODUCER_DIRECT_PROVIDERS) {
    assert.equal(C.isOpenWeightsEntry({ provider: p, model: 'gemma-4-31b-it' }), false);
  }
  // Nessuna voce predefinita passa da un'API diretta del produttore.
  for (const [nick, e] of Object.entries(REG)) {
    assert.equal(e.provider, 'openrouter', `${nick} deve passare dal router`);
  }
});

test('una voce può dichiarare i propri pesi (l\'owner corregge senza toccare il codice)', () => {
  assert.equal(C.isOpenWeightsEntry({ provider: 'openrouter', model: 'acme/ignoto', weights: 'open' }), true);
  assert.equal(C.isOpenWeightsEntry({ provider: 'openrouter', model: 'deepseek/deepseek-v4-pro', weights: 'proprietary' }), false);
});

test('i modelli proprietari della catena vengono SOSTITUITI con l\'equivalente aperto', () => {
  const flash = C.applyOpenWeightsPolicy(C.parseModelRefs('flash, flash-or'), REG);
  assert.deepEqual(flash.refs, ['gemma']);
  assert.deepEqual(flash.substituted.map((s) => s.from), ['flash', 'flash-or']);
  assert.deepEqual(flash.dropped, []);

  const haiku = C.applyOpenWeightsPolicy(['claude-haiku'], REG);
  assert.deepEqual(haiku.refs, ['deepseek'], 'anche Anthropic viene sostituita: è il senso dell\'interruttore');
});

test('senza equivalente la catena resta VUOTA: mai un ripiego su un modello proprietario', () => {
  const tts = C.applyOpenWeightsPolicy(['tts'], REG);
  assert.deepEqual(tts.refs, []);
  assert.deepEqual(tts.dropped, ['tts']);

  const embed = C.applyOpenWeightsPolicy(['embed-004'], REG);
  assert.deepEqual(embed.refs, []);

  // Catena mista: sopravvive SOLO la parte ammessa, il resto non torna come fallback.
  const mixed = C.applyOpenWeightsPolicy(['tts', 'gemma', 'claude-haiku'], REG);
  assert.deepEqual(mixed.refs, ['gemma', 'deepseek']);
  assert.deepEqual(mixed.dropped, ['tts']);
});

test('il sostituto deve saper fare il MESTIERE della funzione, non solo avere i pesi aperti', () => {
  // Dettatura: serve un modello che ASCOLTI un audio. I sostituti a pesi aperti
  // leggono solo testo (e immagini): sostituire qui vorrebbe dire consegnare una
  // funzione che fallisce con un errore qualunque — un ripiego silenzioso come
  // gli altri, solo con un finale diverso. Deve fermarsi e dirlo.
  const dettatura = C.applyOpenWeightsPolicy(
    C.parseModelRefs(C.DEFAULT_MODELS[A.TRANSCRIBE_AUDIO]), REG, A.TRANSCRIBE_AUDIO,
  );
  assert.ok(dettatura.refs.length, 'la dettatura parte già da modelli a pesi aperti: resta viva');
  assert.deepEqual(dettatura.substituted, [], 'niente da sostituire: erano già aperti');
  assert.deepEqual(dettatura.dropped, []);
  // Un modello di chat proprietario messo sulla dettatura, invece, non viene
  // sostituito da uno che l'audio non lo sente: la funzione si ferma e lo dice.
  const chatSullaDettatura = C.applyOpenWeightsPolicy(['claude'], REG, A.TRANSCRIBE_AUDIO);
  assert.deepEqual(chatSullaDettatura.refs, []);
  assert.ok(chatSullaDettatura.dropped.length);

  // Le funzioni che leggono immagini invece continuano: i sostituti dichiarano
  // di saperlo fare, quindi fermarle sarebbe un danno gratuito.
  const immagini = C.applyOpenWeightsPolicy(
    C.parseModelRefs(C.DEFAULT_MODELS[A.DESCRIBE_IMAGE]), REG, A.DESCRIBE_IMAGE,
  );
  assert.ok(immagini.refs.length, 'la descrizione immagini ha un equivalente aperto e deve restare viva');

  // Capacità non dichiarate né note = non sappiamo = non si sostituisce.
  assert.equal(C.substituteFitsAction({ provider: 'openrouter', model: 'acme/qualcosa', weights: 'open' }, A.EXPLAIN, 'ignoto'), false);
  assert.equal(C.substituteFitsAction(REG.gemma, A.EXPLAIN, 'gemma'), true);
  assert.equal(C.substituteFitsAction(REG.gemma, A.TRANSCRIBE_AUDIO, 'gemma'), false);
  assert.equal(C.substituteFitsAction(REG.gemma, A.TTS, 'gemma'), false);
  assert.equal(C.substituteFitsAction(REG.gemma, A.ARCHIVE_EMBED, 'gemma'), false);

  // Il registry personale (righe delle Opzioni) porta solo fornitore e stringa
  // del modello: le capacità dei sostituti si sanno lo stesso, altrimenti
  // accendere l'interruttore con la propria configurazione fermerebbe TUTTO.
  const personale = {
    flash: { provider: 'openrouter', model: 'google/gemini-2.0-flash-001' },
    gemma: { provider: 'openrouter', model: 'google/gemma-4-31b-it' },
    'gemma-lite': { provider: 'openrouter', model: 'google/gemma-4-26b-a4b-it' },
  };
  assert.deepEqual(
    C.applyOpenWeightsPolicy(['flash'], personale, A.EXPLAIN).refs, ['gemma'],
    'con una configurazione personale la sostituzione deve funzionare uguale',
  );
  assert.deepEqual(C.applyOpenWeightsPolicy(['flash'], personale, A.TRANSCRIBE_AUDIO).refs, []);
});

test('NESSUNA funzione predefinita resta con un modello proprietario a interruttore acceso', () => {
  const colpevoli = [];
  for (const [action, value] of Object.entries(C.DEFAULT_MODELS)) {
    const res = C.applyOpenWeightsPolicy(C.parseModelRefs(value), REG);
    for (const ref of res.refs) {
      if (!C.isOpenWeightsRef(ref, REG)) colpevoli.push(`${action} → ${ref}`);
    }
  }
  assert.deepEqual(colpevoli, [],
    'una funzione predefinita può girare su un modello proprietario nonostante l\'interruttore');
});

test('la catena di tentativi passa solo dal router, con modelli a pesi aperti', () => {
  const refs = C.applyOpenWeightsPolicy(C.parseModelRefs(C.DEFAULT_MODELS[C.ACTIONS.EXPLAIN_DEEP]), REG).refs;
  const attempts = C.buildModelAttempts(refs, REG, ['openrouter'], { openrouter: 'k' });
  assert.ok(attempts.length, 'deve restare almeno un tentativo, altrimenti la funzione muore');
  assert.deepEqual([...new Set(attempts.map((a) => a.provider))], ['openrouter']);
  for (const a of attempts) assert.ok(C.isOpenWeightsModelId(a.model), `${a.model} deve essere a pesi aperti`);
  assert.ok(!attempts.some((a) => /claude/.test(a.model)), 'Anthropic esce dalla catena');
});

test('a interruttore acceso Anthropic entra fra i fornitori esclusi', () => {
  const base = C.DEFAULT_EXCLUDED_PROVIDERS;
  assert.equal(C.isProviderExcluded('Anthropic', base), false, 'a interruttore spento Anthropic è ammessa');

  const eff = C.effectiveExcludedProviders(base, true);
  assert.equal(C.isProviderExcluded('Anthropic', eff), true);
  assert.equal(C.isProviderExcluded('Google Vertex', eff), true);
  assert.equal(C.isProviderExcluded('DeepInfra', eff), false, 'i fornitori indipendenti restano ammessi');
  // Non duplica se qualcuno l'ha già messa nella lista condivisa.
  const already = C.effectiveExcludedProviders(['anthropic', 'Google'], true);
  assert.equal(already.filter((x) => /anthropic/i.test(x)).length, 1);
  // A interruttore spento la lista non viene toccata.
  assert.deepEqual(C.effectiveExcludedProviders(base, false), base);
});

test('l\'effetto dell\'interruttore è dichiarabile PRIMA di accenderlo', () => {
  const impact = C.openWeightsImpact(C.DEFAULT_MODELS, REG);
  const cambiano = impact.substituted.map((s) => s.action);
  const ferme = impact.unavailable.map((u) => u.action);

  assert.ok(cambiano.includes(C.ACTIONS.EXPLAIN_DEEP), 'le funzioni che cambiano modello vanno dichiarate');
  assert.ok(cambiano.includes(C.ACTIONS.EDIT_TEXT));
  // Le funzioni che partono già da un modello a pesi aperti non cambiano e
  // non si fermano: voce, dettatura e indicizzazione oggi sono fra queste.
  assert.ok(!cambiano.includes(C.ACTIONS.EXPLAIN));
  assert.ok(!cambiano.includes(C.ACTIONS.TRANSCRIBE_AUDIO));
  assert.deepEqual(ferme, [], 'nessuna funzione predefinita si ferma a interruttore acceso');
  // Una funzione non può stare in tutt'e due gli elenchi.
  assert.deepEqual(cambiano.filter((a) => ferme.includes(a)), []);
});
