// La catena che riempie la bacheca di chi NON ha la chiave privata (#478).
//
// IL DIFETTO. Lo `status` fine di un feedback viaggia cifrato (#476), e la
// bacheca gira dove la chiave privata non c'è — anche sul computer dell'owner.
// Finché la pagina decideva cosa mostrare leggendo quel campo, la
// classificazione ricadeva su «ricevuti» per tutti e la bacheca restava vuota
// per costruzione: nessun fix chiuso dopo il 25 giugno 2026 poteva più
// comparire, e il giro dei voti era fermo.
//
// LA CATENA GIUSTA, in due anelli, che è quello che questo file prova:
//   1. chi ha la chiave (il main dell'owner, gli script) prepara la SCHEDA
//      pubblica del fix: `SN_FEEDBACK_PUBLIC_VIEW.cardFor`, solo campi
//      pubblici, stato in chiaro, niente testo grezzo;
//   2. la bacheca filtra QUELLA: `SN_MANAGE_REVIEW.listBoardTab` la riconosce
//      come «in produzione» e la mostra.
//
// Senza il fix il secondo anello è rosso: la bacheca riceveva il feedback
// grezzo (primo test qui sotto) e non ne cavava niente.
//
// Gira con `npm run test:unit`: niente Electron, niente rete. La prova del
// cammino in pagina sta in tests/board-utente-senza-chiave.spec.mjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const shared = (f) => require(join(__dirname, '..', '..', 'src', 'shared', f));
shared('constants.js');
shared('feedbackStatus.js');
shared('manageReview.js');
shared('feedbackClientIdHash.js');
shared('feedbackPublicView.js');

const MR = globalThis.SN_MANAGE_REVIEW;
const PV = globalThis.SN_FEEDBACK_PUBLIC_VIEW;

const RILASCIATA = '0.2.71';

// Il feedback VERO, decifrato: è quello che vede solo chi ha la chiave.
const VERO = {
  _id: 'fb-478',
  name: 'Cattura schermo più rapida',
  text: 'TESTO-GREZZO-CHE-NON-DEVE-USCIRE',
  url: 'https://esempio.test/pagina-privata',
  clientId: 'chi-ha-segnalato@esempio.test',
  clientIdHash: 'a'.repeat(64),
  status: 'done',
  statusPublic: 'closed',
  priority: 2,
  seq: 478,
  subSeq: 0,
  resolvedInVersion: '0.2.70',
  createdAt: '2026-08-17T07:33:44.390Z',
  resolvedAt: '2026-09-01T10:00:00.000Z',
  notes: 'report interno per l\'owner',
};

// Lo STESSO feedback come arriva a chi la chiave non ce l'ha: lo stato è un
// blob, e con lui il testo e il report.
const SENZA_CHIAVE = {
  ...VERO,
  status: 'FENC1:c2VuemEtY2hpYXZl',
  text: 'FENC1:dGVzdG8=',
  notes: 'FENC1:bm90ZQ==',
};

test('LA CAUSA: col solo feedback cifrato la bacheca non può mostrare niente', () => {
  assert.equal(MR.statusUnreadable(SENZA_CHIAVE), true, 'lo stato cifrato deve risultare illeggibile');
  const out = MR.listBoardTab([SENZA_CHIAVE], { releasedVersion: RILASCIATA });
  assert.equal(out.length, 0, 'è il sintomo: "Nessun miglioramento da verificare per ora"');
});

test('la scheda sicura dello stesso fix compare in bacheca, votabile', () => {
  const scheda = PV.cardFor(VERO);
  assert.ok(scheda, 'un fix chiuso e mai segnalato dalla sicurezza deve avere una scheda');

  // La bacheca legge la scheda (stesso id del feedback) e ci vede un fix
  // rilasciato: è il risultato voluto.
  const out = MR.listBoardTab([{ ...scheda, _id: VERO._id }], { releasedVersion: RILASCIATA });
  assert.deepEqual(out.map((f) => f._id), ['fb-478']);
  assert.equal(out[0].name, 'Cattura schermo più rapida');
});

test('la scheda non porta con sé niente di grezzo', () => {
  const scheda = PV.cardFor(VERO);
  for (const campo of ['text', 'url', 'clientId', 'clientIdHash', 'notes', 'priority', 'pipeline']) {
    assert.equal(scheda[campo], undefined, `la scheda non deve contenere ${campo}`);
  }
  assert.equal(scheda.status, 'done', 'lo stato sulla scheda è in chiaro: è ciò che rende leggibile la bacheca');
});

test('un fix chiuso PRIMA che le schede esistessero ha comunque la sua scheda', () => {
  // Storico: nessun `resolvedInVersion` (il campo è nato dopo) e nessun
  // pipeline. `isShipped` lo tratta come già uscito, quindi la bacheca lo
  // mostra invece di lasciarlo fuori per sempre.
  const vecchio = {
    _id: 'fb-storico',
    name: 'Correzione di prima delle schede',
    status: 'done',
    seq: 12,
    subSeq: 0,
    createdAt: '2026-03-02T09:00:00.000Z',
  };
  const scheda = PV.cardFor(vecchio);
  assert.ok(scheda, 'anche i chiusi storici meritano una scheda');
  const out = MR.listBoardTab([{ ...scheda, _id: vecchio._id }], { releasedVersion: RILASCIATA });
  assert.deepEqual(out.map((f) => f._id), ['fb-storico']);
});

test('SICUREZZA: un feedback segnalato non ha scheda, quindi non arriva in bacheca', () => {
  const attacco = { ...VERO, _id: 'fb-attacco', pipeline: { action: 'block_attack', l2Class: 'attack' } };
  assert.equal(PV.cardFor(attacco), null);
  // E anche se una scheda esistesse per sbaglio, la bacheca ha la sua rete.
  const out = MR.listBoardTab(
    [{ _id: 'fb-attacco', status: 'done', resolvedInVersion: '0.2.70', pipeline: { l2Class: 'attack' } }],
    { releasedVersion: RILASCIATA },
  );
  assert.equal(out.length, 0);
});
