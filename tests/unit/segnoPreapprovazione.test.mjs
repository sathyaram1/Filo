// Le fuse senza chiedere e il perché, come le legge l'owner in Automazioni (src/shared/mergeApprovals.js). Dal #1148
// la specie nuova è il lavoro fidato (motivo 'fiducia'); il segno a mano e quello nato da un sì restano leggibili per le
// tracce dei rami di prima e per il segno del clic (#515), che il server tiene nello stato del giro.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
require(join(__dirname, '..', '..', 'src', 'shared', 'mergeApprovals.js'));
const UI = globalThis.SN_MERGE_APPROVALS;

const AT = '2026-09-26T10:26:00.000Z';
const ID = 'ab12cd34ef56ab12cd34ef56';
const aMano = { by: 'owner@esempio.it', at: AT };
const daSi = { by: `owner@esempio.it · approvazione ${ID}`, at: AT };

test('le due specie di segno si riconoscono dalla forma di `by`', () => {
  assert.deepEqual(UI.segnoPreapprovazione(aMano), { tipo: 'pieno', by: aMano.by, at: AT });
  assert.deepEqual(UI.segnoPreapprovazione(daSi), { tipo: 'approvazione', by: daSi.by, at: AT, richiesta: ID });
  assert.equal(UI.segnoPreapprovazione({ by: 'x · approvazione 123', at: AT }).tipo, 'pieno');
  assert.equal(UI.segnoPreapprovazione({ by: '  ', at: AT }), null);
  assert.equal(UI.segnoPreapprovazione(null), null);
});

test('gli strumenti del segno messo dalla pagina non ci sono più: la pagina non fonde da sé (#1148)', () => {
  for (const nome of ['segnoTesti', 'segnoAlClic', 'chiaveSegno', 'richiesteCoperte']) assert.equal(UI[nome], undefined, nome);
});

test('fra le fusioni fatte senza chiedere, il segno da approvazione non si stampa grezzo', () => {
  assert.equal(UI.preapprovedBy({ preapprovedBy: 'owner@esempio.it' }), 'pre-approvata da owner@esempio.it');
  const s = UI.preapprovedBy({ preapprovedBy: daSi.by, preapprovedAt: AT });
  assert.equal(s, `pre-approvata dal tuo sì alla richiesta del ${UI.dateTimeText(Date.parse(AT))}`);
});

test('il lavoro fidato si dice per quello che è: «lavoro fidato: controllo registrato»', () => {
  const fidato = { skippedL5: true, motivo: 'fiducia', preapprovedBy: 'fiducia' };
  assert.equal(UI.isFiducia(fidato), true);
  assert.equal(UI.isFiducia({ skippedL5: true }), false, 'senza motivo è un ramo di prima');
  assert.equal(UI.isFiducia({ motivo: 'fiducia' }), false, 'il motivo vale solo sopra L5');
  assert.equal(UI.recentOutcome(fidato), 'lavoro fidato: controllo registrato');
  assert.match(UI.skippedL5Hint(fidato), /^Lavoro fidato: feedback fidato, scritto solo da sessioni col biglietto pulito\./);
  assert.match(UI.preapprovedIntro([fidato]), /fusi lo stesso\. Erano lavoro fidato/);
});

// #743: l'introduzione nomina solo le specie che l'elenco contiene.
test('fra le fuse senza chiedere, l’introduzione nomina solo i segni che l’elenco contiene', () => {
  const daSiRiga = { preapprovedBy: daSi.by, preapprovedAt: AT };
  const aManoRiga = { preapprovedBy: aMano.by, preapprovedAt: AT };
  const locale = { skippedL5: true, preapprovedBy: aMano.by };
  const fidato = { skippedL5: true, motivo: 'fiducia' };

  const soloSi = UI.preapprovedIntro([daSiRiga, daSiRiga]);
  assert.ok(!soloSi.includes('fondi senza chiedermelo'), soloSi);
  assert.match(soloSi, /fusi lo stesso\. Avevano solo blocchi che avevi già approvato, con un sì a una richiesta precedente/);

  const soloMano = UI.preapprovedIntro([aManoRiga]);
  assert.match(soloMano, /fusi lo stesso\. Sulla pratica avevi messo «fondi senza chiedermelo»\./);

  const misto = UI.preapprovedIntro([fidato, daSiRiga, locale, aManoRiga]);
  assert.match(misto, /^Lavori fermati dai controlli e fusi lo stesso\. Alcuni erano lavoro fidato \(feedback fidato, scritto solo da sessioni col biglietto pulito\); altri avevano sulla pratica il tuo «fondi senza chiedermelo»; altri ancora avevano solo blocchi/);
  assert.match(UI.preapprovedIntro([]), /^Lavori fermati dai controlli e fusi lo stesso\. Qui c’è/);
});
