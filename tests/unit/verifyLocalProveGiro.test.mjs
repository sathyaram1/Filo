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
import { readFileSync } from 'node:fs';

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

// Nominare la cartella del giro è l'unico modo in cui quelle prove girano, e
// una risposta vuota vuol dire due cose opposte: la cartella non c'è, oppure
// il percorso è scritto in una forma che il comando non riconosce (le barre di
// Windows, che il completamento del terminale produce da solo; il percorso per
// intero dalla radice del disco). Misurato a cartella piena: con le barre
// normali diciotto prove, con le altre due forme zero e un'uscita con errore.
// Chi legge «No tests found» e conclude «non c'era niente da rilanciare» lascia
// ferme le prove del giro, e il giro dopo ritrova la porta aperta — cioè
// esattamente il ripasso che tenerle nel ramo esiste per togliere.
// Quindi: ovunque quel comando sia scritto per esteso, accanto ci dev'essere
// come va scritto il percorso. Sono cinque posti, e ne è già mancato uno
// (le regole generali del repo, verifica del giro 7).
test('ovunque si dica di rilanciare le prove del giro, si dice anche come va scritto il percorso', () => {
  const ROOT = new URL('../../', import.meta.url);
  const leggi = (p) => readFileSync(new URL(p, ROOT), 'utf8');
  const superfici = [
    ['CLAUDE.md', leggi('CLAUDE.md')],
    ['routines/roles/verifier.md', leggi('routines/roles/verifier.md')],
    ['routines/roles/resolver.md', leggi('routines/roles/resolver.md')],
    ['il compito consegnato a chi verifica in locale',
      buildVerifierBrief({ request: 'fai X', branch: 'claude/giri-corti', recipe: 'RECIPE' })],
    ['la coda della fase di correzione',
      codaText({ findings: [{ level: 2, text: 'rotto' }], derived: [], budgets: {}, branch: 'claude/giri-corti' })],
  ];
  for (const [nome, testo] of superfici) {
    const punti = [...testo.matchAll(/playwright\s+test\s+tests\/verifica/gi)];
    assert.ok(punti.length > 0, `${nome} non nomina più il comando che rilancia le prove del giro: se la regola è cambiata, riscrivi questa sentinella`);
    for (const m of punti) {
      const intorno = testo.slice(Math.max(0, m.index - 500), m.index + 500);
      assert.match(intorno, /percors|barre/i,
        `${nome}: il comando c'è, ma niente dice che il percorso va scritto relativo alla radice del repo e con le barre normali — «No tests found» arriva anche a cartella piena, e viene letto come «niente da rilanciare»`);
    }
  }
});
