// Le prove di un giro LOCALE hanno un indirizzo, e chi corregge sa di doverle
// rilanciare (verifica del giro 2 su questo lavoro).
//
// Senza queste tre cose il giro locale perdeva la memoria in silenzio: chi
// verificava non sapeva dove lasciare le sue prove (in locale un numero di
// feedback non c'è), quindi non ne lasciava; chi correggeva non aveva niente da
// rilanciare; e il rifiuto della consegna con l'albero sporco diceva metà di
// quello che dice l'altra strada.

import test from 'node:test';
import assert from 'node:assert/strict';

const { cartellaProveGiro, codaText, withFixed, buildVerifierBrief, withRequest, withCritique } = await import('../../scripts/verify-local.mjs');

const SHA = 'a'.repeat(40);
const ALTRO = 'b'.repeat(40);

test('cartellaProveGiro: la cartella viene dal ramo, ed è la stessa a ogni giro', () => {
  assert.equal(cartellaProveGiro('claude/giri-corti'), 'tests/verifica/locale-giri-corti');
  assert.equal(cartellaProveGiro('claude/giri-corti'), cartellaProveGiro('claude/giri-corti'));
  // Un ramo con caratteri che in un percorso non stanno bene resta un nome solo.
  assert.equal(cartellaProveGiro('claude/Prova #2/però'), 'tests/verifica/locale-prova-2-pero');
  assert.match(cartellaProveGiro(''), /^tests\/verifica\/locale-/, 'senza ramo si finisce comunque in un posto');
  assert.ok(cartellaProveGiro('c/' + 'x'.repeat(200)).length < 100, 'niente nomi di cartella smisurati');
});

test('il compito consegnato a chi verifica in locale dice DOVE lasciare le prove', () => {
  const brief = buildVerifierBrief({ request: 'fai X', branch: 'claude/giri-corti', recipe: 'RECIPE' });
  assert.match(brief, /tests\/verifica\/locale-giri-corti/, 'la cartella per esteso, non «<numero>»');
  assert.match(brief, /non si\s*\n?cancellano|non si cancellano/, 'e che non si cancellano');
});

test('la coda stampata dopo la critica dice di rilanciare le prove del giro, e con quale comando', () => {
  const t = codaText({ findings: [{ level: 2, text: 'rotto' }], derived: [], budgets: {}, branch: 'claude/giri-corti' });
  assert.match(t, /npx playwright test tests\/verifica\/locale-giri-corti/);
  assert.match(t, /regressione della correzione/);
  // Quello che c'era prima resta: i rilievi e come si consegna.
  assert.match(t, /\[2\] rotto/);
  assert.match(t, /verify-local\.mjs corretto/);
});

test('consegnare una correzione con file non salvati: il rifiuto elenca i file e spiega il salvataggio automatico', () => {
  const dopoCritica = withCritique(withRequest({}, 'r', { request: 'fai X', sha: SHA }), 'r', {
    critique: 'provato tutto.\n[2] rotto', sha: SHA,
  });
  const rifiuto = withFixed(dopoCritica.state, 'r', {
    report: 'corretto', sha: ALTRO, dirtyFiles: ['tests/verifica/locale-r/giro1-prova.spec.mjs', 'avanzo.txt'],
  });
  assert.equal(rifiuto.ok, false);
  assert.match(rifiuto.reason, /giro1-prova\.spec\.mjs/, 'i file rimasti fuori si vedono');
  assert.match(rifiuto.reason, /avanzo\.txt/);
  assert.match(rifiuto.reason, /rm dalla shell non arriva da solo/, 'e l\'attesa inutile è detta');
  // Con l'albero pulito la consegna passa.
  const ok = withFixed(dopoCritica.state, 'r', { report: 'corretto', sha: ALTRO, dirtyFiles: [] });
  assert.equal(ok.ok, true);
  assert.equal(ok.outcome, 'fixed');
});
