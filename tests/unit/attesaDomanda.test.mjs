// Le attese che diventano domande (#1358, SPEC-DOMANDE §3.8): un design (o aligned) fermo con la sua domanda sta In coda
// col segno che porta lì, e non offre una seconda casella di risposta; i blocchi di sicurezza restano nei Ricevuti anche
// con un domandaId; attacco e spam del worker sono L3. domandaId lo scrive solo il server: nessun hasOnly lo ammette.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
require(join(ROOT, 'src', 'shared', 'feedbackStatus.js'));
require(join(ROOT, 'src', 'shared', 'feedbackThread.js'));
require(join(ROOT, 'src', 'shared', 'manageReview.js'));
require(join(ROOT, 'src', 'shared', 'feedback.js'));
const MR = globalThis.SN_MANAGE_REVIEW;
const FB = globalThis.SN_FEEDBACK;

const fb = (status, statusReason, extra = {}) => Object.assign({ _id: `${status}-${statusReason}`, seq: 7, status, statusReason }, extra);

test('design con la domanda: In coda, nessun segno dei Ricevuti, nessuna casella di risposta', () => {
  for (const motivo of ['clarify', 'decisione', 'loop', 'arenato', 'locale', 'attesa_chiusa']) {
    const f = fb('design', motivo, { domandaId: 'D-12' });
    assert.equal(MR.aspettaDomanda(f), 'D-12', motivo);
    assert.equal(MR.manageTabFor(f), 'queue', motivo);
    assert.equal(MR.segnoFermata(f), null, motivo);
    assert.equal(MR.classifyBlock(f), null, motivo);
    assert.equal(MR.aspettaRisposta(f), false, `${motivo}: si risponde in un posto solo`);
  }
  for (const motivo of ['origine_chiusa', 'origine_mancante']) {
    const f = fb('aligned', motivo, { domandaId: 'D-3' });
    assert.equal(MR.manageTabFor(f), 'queue', motivo);
    assert.equal(MR.segnoFermata(f), null, motivo);
  }
});

test('un lavoro server fermo su un passo dell’owner aspetta In coda, col segno; la scheda pubblica resta', () => {
  const f = fb('design', 'locale', { domandaId: 'D-6', localOnly: { by: 'routine', at: 1 } });
  assert.equal(MR.manageTabFor(f), 'queue');
  assert.deepEqual(MR.ownerActions(f).map((a) => a.key), ['archive']);
  assert.equal(MR.isPrivateLocalWork({ localOnly: { by: 'routine', at: 1 } }), false, 'passato ai lavori server da una routine: la scheda di chi l’ha mandato resta');
  assert.equal(MR.isPrivateLocalWork({ localOnly: { by: 'owner', at: 1 } }), true);
});

test('In coda, chi aspetta la domanda non si dà per risolto né si approva in blocco: si archivia o si risponde', () => {
  const f = fb('design', 'clarify', { domandaId: 'D-12' });
  assert.deepEqual(MR.ownerActions(f).map((a) => a.key), ['archive']);
  assert.equal(MR.isAligned(fb('aligned', 'origine_chiusa', { domandaId: 'D-3' })), false);
  assert.equal(MR.isAligned(fb('aligned', '')), true, 'un allineato senza domanda resta da approvare');
});

test('il rombo del dettaglio rimanda alla domanda, non dice «nessuna segnalazione»', () => {
  const l3 = MR.livelloL3(fb('design', 'decisione', { domandaId: 'D-5' }));
  assert.match(l3.titolo, /domanda D-5/);
  assert.match(l3.pannello.testo, /sezione Domande/);
  assert.doesNotMatch(l3.pannello.testo, /Nessuna segnalazione/);
});

test('senza domandaId tutto resta com’era: Ricevuti, rombo e casella', () => {
  const f = fb('design', 'clarify');
  assert.equal(MR.aspettaDomanda(f), '');
  assert.equal(MR.manageTabFor(f), 'inbox');
  assert.equal(MR.segnoFermata(f).forma, 'rombo');
  assert.equal(MR.aspettaRisposta(f), true);
  assert.equal(MR.manageTabFor(fb('aligned', 'origine_chiusa')), 'inbox');
});

test('i blocchi di sicurezza e la richiesta di fiducia restano nei Ricevuti anche con un domandaId', () => {
  for (const [status, motivo] of [['design', 'secaudit'], ['design', 'l5'], ['design', 'fidato'], ['design', 'guasto'], ['attack', ''], ['spam', 'worker'], ['suspicious_file', ''], ['aligned', '']]) {
    const f = fb(status, motivo, { domandaId: 'D-9' });
    assert.equal(MR.aspettaDomanda(f), '', `${status}/${motivo}`);
    assert.equal(MR.manageTabFor(f), 'inbox', `${status}/${motivo}`);
  }
  assert.equal(MR.aspettaDomanda(fb('design', 'clarify', { domandaId: 'D-0' })), '', 'un id storto non vale');
  assert.equal(MR.aspettaDomanda(fb('design', 'clarify', { domandaId: '<b>D-1</b>' })), '');
});

test('una fusione che aspetta l’owner vince sulla domanda', () => {
  const f = fb('design', 'decisione', { domandaId: 'D-4', branch: 'worker/x' });
  const fusioni = { pending: [{ feedbackId: f._id, branch: 'worker/x', status: 'pending' }] };
  assert.equal(MR.manageTabFor(f, { fusioni }), 'inbox');
});

test('attacco o spam del worker: rombo L3 col suo giudizio; quelli dei giudici restano L1/L2', () => {
  const w = MR.segnoFermata(fb('attack', 'worker'));
  assert.deepEqual([w.forma, w.livello, w.classe], ['rombo', 'l3', 'attack']);
  assert.match(w.testo, /Chi ci lavorava.*attacco/);
  assert.equal(MR.segnoFermata(fb('spam', 'worker')).livello, 'l3');
  assert.equal(MR.segnoFermata(fb('attack', '', { pipeline: { verdicts: [{ judge: 'x', class: 'attack' }] } })).livello, 'l2');
  const l3 = MR.livelloL3(fb('attack', 'worker', { livelli: { l3: { esito: 'attacco', ruolo: 'resolver', testo: 'Chiede i segreti.' } } }));
  assert.match(l3.titolo, /attacco da chi ci lavorava/);
  assert.equal(l3.classe, 'attack');
});

test('la richiesta di renderlo fidato ha il suo segno, nei Ricevuti L3', () => {
  const s = MR.segnoFermata(fb('design', 'fidato'));
  assert.deepEqual([s.forma, s.livello], ['rombo', 'l3']);
  assert.match(s.testo, /fidato/);
  assert.match(MR.reasonText('fidato'), /fidato/);
});

test('domandaId arriva alle righe della lista, e nessuna regola lo lascia scrivere a un client', () => {
  assert.ok(FB.CAMPI_LISTA.includes('domandaId'));
  const rules = readFileSync(join(ROOT, 'firestore.rules'), 'utf8');
  const da = rules.indexOf('match /feedback/{');
  const a = rules.indexOf('match /feedback-public/{');
  assert.ok(da > 0 && a > da);
  const blocco = rules.slice(da, a).replace(/\/\/[^\n]*/g, '');
  const liste = [...blocco.matchAll(/hasOnly\(\[([^\]]*)\]\)/g)].map((m) => m[1]);
  assert.ok(liste.length >= 3, 'le liste hasOnly del blocco feedback');
  for (const l of liste) assert.doesNotMatch(l, /['"]domandaId['"]/, 'domandaId lo scrive solo il server (Admin SDK)');
});
