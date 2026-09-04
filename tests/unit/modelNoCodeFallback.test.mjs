// Unit test — nessun modello "di ripiego" scritto nel codice.
//
// Regola: i modelli che una funzione può usare sono SOLO quelli della
// configurazione effettiva. Una scorciatoia citata ma inesistente (mai definita,
// oppure eliminata dopo) non deve essere risolta di nascosto: va riconosciuta
// come mancante, così chi usa quella funzione riceve un errore leggibile invece
// di ritrovarsi su un modello che nessuno ha scelto.
//
// Resta invece intatta la catena di ripiego VOLUTA: più modelli configurati in
// ordine, provati a cascata.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');

require(join(ROOT, 'src', 'shared', 'constants.js'));
const C = globalThis.SN_CONST;

// Registry "configurato" realistico: nickname curati, nessuno di quelli
// integrati nel codice.
const REGISTRY = {
  text: { provider: 'openrouter', model: 'deepseek/deepseek-v4-flash-0731' },
  immagine: { provider: 'openrouter', model: 'moonshotai/kimi-k2.6' },
};

test('un nickname assente dal registry configurato è riconosciuto come mancante', () => {
  assert.deepEqual(C.missingModelRefs(['text', 'flash'], REGISTRY), ['flash']);
  assert.deepEqual(C.missingModelRefs(['text', 'immagine'], REGISTRY), []);
});

test('gli id grezzi stile provider restano ammessi (config salvate prima dei nickname)', () => {
  assert.equal(C.isRawModelId('google/gemini-2.0-flash-001'), true);
  assert.equal(C.isRawModelId('anthropic/claude-3.5-haiku'), true);
  assert.equal(C.isRawModelId('flash'), false);
  assert.deepEqual(C.missingModelRefs(['anthropic/claude-3.5-haiku'], REGISTRY), []);
});

test('i riferimenti utilizzabili tengono l\'ordine scelto (la catena di ripiego voluta resta)', () => {
  assert.deepEqual(C.usableModelRefs(['text', 'immagine'], REGISTRY), ['text', 'immagine']);
  // Il fantasma esce di scena, il resto della catena resta com'era.
  assert.deepEqual(C.usableModelRefs(['fantasma', 'text', 'immagine'], REGISTRY), ['text', 'immagine']);
});

test('una catena fatta di soli fantasmi non produce nessun tentativo', () => {
  const refs = C.parseModelRefs('flash, flash-or');
  assert.deepEqual(C.usableModelRefs(refs, REGISTRY), []);
  const attempts = C.buildModelAttempts(
    C.usableModelRefs(refs, REGISTRY), REGISTRY, ['openrouter'], { openrouter: 'k' },
  );
  assert.equal(attempts.length, 0,
    'una catena di scorciatoie inesistenti non deve produrre nessun modello da chiamare');
});

test('il registry scritto nel codice non risolve nulla se non è quello configurato', () => {
  // 'deepseek' esiste fra i nickname integrati: è il genere di scorciatoia su
  // cui si ripiegava in silenzio. Con il registry configurato dell'utente deve
  // risultare assente.
  assert.ok(C.DEFAULT_MODEL_REGISTRY.deepseek, 'presupposto del test: "deepseek" è un nickname integrato');
  assert.deepEqual(C.missingModelRefs(['deepseek'], REGISTRY), ['deepseek']);
});

test('la catena di ripiego fra modelli configurati produce i tentativi in ordine', () => {
  const refs = C.parseModelRefs('text, immagine');
  const attempts = C.buildModelAttempts(
    C.usableModelRefs(refs, REGISTRY), REGISTRY, ['openrouter'], { openrouter: 'k' },
  );
  assert.deepEqual(attempts.map((a) => a.model), [
    'deepseek/deepseek-v4-flash-0731',
    'moonshotai/kimi-k2.6',
  ]);
});

test('i nomi mostrati nel messaggio d\'errore restano leggibili anche se assurdi', () => {
  // Un nome incollato per sbaglio può essere lunghissimo: il messaggio deve
  // restare leggibile (prima ripeteva per intero migliaia di caratteri).
  const mostro = 'x'.repeat(10_000);
  const testo = C.formatModelRefsForMessage([mostro]);
  assert.ok(testo.length < 60, `il nome va troncato, invece è lungo ${testo.length}`);
  assert.ok(testo.startsWith('xxx') && testo.endsWith('…'));

  // Tanti nomi: si mostrano i primi e si dice quanti ne restano.
  const molti = C.formatModelRefsForMessage(['a', 'b', 'c', 'd', 'e', 'f', 'g']);
  assert.equal(molti, 'a, b, c, d, e +2');

  // Pochi e corti: invariato rispetto a prima.
  assert.equal(C.formatModelRefsForMessage(['fantasma']), 'fantasma');
  assert.equal(C.formatModelRefsForMessage(['uno', 'due']), 'uno, due');
});

test('ogni funzione che consuma un modello si può impostare dall\'editor', async () => {
  require(join(ROOT, 'src', 'shared', 'modelChainEditor.js'));
  const editable = new Set(globalThis.SN_MODEL_CHAIN.actionLabels().map(([action]) => action));
  // Se una funzione ha un modello di default deve anche essere impostabile:
  // altrimenti, quando la sua catena non risolve, l'errore direbbe "impostalo"
  // indicando un posto dove la funzione non compare.
  for (const action of Object.keys(C.DEFAULT_MODELS)) {
    assert.ok(editable.has(action),
      `la funzione "${action}" usa un modello ma non compare nell'editor dei modelli per azione`);
  }
});

test('ogni funzione impostabile ha un\'etichetta leggibile per i messaggi d\'errore', () => {
  require(join(ROOT, 'src', 'shared', 'modelChainEditor.js'));
  for (const [action] of globalThis.SN_MODEL_CHAIN.actionLabels()) {
    const label = C.actionLabel(action);
    assert.ok(label && label !== action,
      `la funzione "${action}" non ha un nome leggibile: l'errore mostrerebbe il codice interno`);
  }
});
