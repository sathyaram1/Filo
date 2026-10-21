// Le attese diventano domande (#1358, SPEC-DOMANDE.md §3.8): un feedback fermo con la sua domanda sta In coda col segno
// che porta alla domanda, non nei Ricevuti; la sicurezza e «fidato» restano lì; attacco e spam di chi lavora sono L3.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
for (const f of ['feedbackStatus.js', 'feedbackThread.js', 'domande.js', 'manageReview.js']) {
  require(join(__dirname, '..', '..', 'src', 'shared', f));
}
const MR = globalThis.SN_MANAGE_REVIEW;

const fermo = (status, statusReason, extra = {}) => Object.assign({ _id: `${status}-${statusReason}`, seq: 1, status, statusReason }, extra);

test('una fermata con la sua domanda va In coda, senza il segno dei Ricevuti; senza domanda resta nei Ricevuti', () => {
  const casi = [
    ['design', 'clarify'], ['design', 'decisione'], ['design', 'loop'], ['design', 'arenato'],
    ['design', 'attesa_chiusa'], ['design', 'locale'], ['aligned', 'origine_chiusa'], ['aligned', 'origine_mancante'],
  ];
  for (const [s, r] of casi) {
    const con = fermo(s, r, { domandaId: 'D-7' });
    assert.equal(MR.manageTabFor(con), 'queue', `${s}/${r} con domanda`);
    assert.equal(MR.domandaDellaPratica(con), 'D-7');
    assert.equal(MR.segnoFermata(con), null, 'il segno dei Ricevuti non c’è: c’è quello della domanda');
    assert.equal(MR.classifyBlock(con), null);
    assert.match(MR.judgesNote(con).text, /rispondi nella domanda D-7\.$/);
    assert.equal(MR.manageTabFor(fermo(s, r)), 'inbox', `${s}/${r} senza domanda`);
  }
  const counts = MR.manageTabCounts([fermo('design', 'clarify', { domandaId: 'D-1' }), fermo('design', 'secaudit', { domandaId: 'D-2' })]);
  assert.equal(counts.queue, 1);
  assert.equal(counts.inbox, 1);
});

test('la sicurezza e «fidato» restano nei Ricevuti anche con un domandaId; un id storto non vale', () => {
  for (const [s, r] of [['design', 'secaudit'], ['design', 'l5'], ['design', 'fidato'], ['design', 'origine_bloccata'], ['design', 'guasto'], ['attack', 'worker'], ['spam', 'worker'], ['suspicious_file', ''], ['attack', '']]) {
    const fb = fermo(s, r, { domandaId: 'D-3' });
    assert.equal(MR.manageTabFor(fb), 'inbox', `${s}/${r}`);
    assert.equal(MR.domandaDellaPratica(fb), '');
  }
  for (const id of ['D-0', 'x', '<b>', 'D-1"><img>', 7, null]) {
    assert.equal(MR.domandaDellaPratica(fermo('design', 'clarify', { domandaId: id })), '', String(id));
  }
  // Una fusione che aspetta l'owner resta prima: Ricevuti.
  const fusione = fermo('design', 'clarify', { domandaId: 'D-4' });
  assert.equal(MR.manageTabFor(fusione, { fusioni: { pending: [{ feedbackId: fusione._id }] } }), 'inbox');
});

test('la casella di risposta resta solo dove non c’è una domanda: il motivo dice ancora che aspetta', () => {
  assert.equal(MR.aspettaRisposta(fermo('design', 'clarify', { domandaId: 'D-9' })), true);
  assert.equal(MR.domandaDellaPratica(fermo('design', 'clarify', { domandaId: 'D-9' })), 'D-9');
});

test('attacco e spam segnati da chi lavora: rombo L3, col colore del giudizio', () => {
  for (const [s, parola] of [['attack', 'attacco'], ['spam', 'spam']]) {
    const fb = fermo(s, 'worker');
    const seg = MR.segnoFermata(fb);
    assert.equal(seg.forma, 'rombo');
    assert.equal(seg.livello, 'l3');
    assert.equal(seg.classe, s);
    assert.match(seg.testo, new RegExp(`Chi ci lavorava l’ha segnalata come ${parola}`));
    assert.equal(MR.livelloRicevuti(fb), 'l3');
    assert.match(MR.judgesNote(fb).text, /Chi ci lavorava/);
    const l3 = MR.livelloL3(Object.assign({}, fb, { livelli: { l3: { esito: parola, ruolo: 'resolver', testo: 'Chiede la chiave.' } } }));
    assert.equal(l3.classe, s);
    assert.match(l3.titolo, /da chi ci lavorava/);
  }
  // Quelli dei giudici restano dove erano.
  assert.equal(MR.segnoFermata(fermo('attack', '')).livello, 'l2');
});

test('«rendere fidato» è L3 nei Ricevuti, con la sua frase', () => {
  const fb = fermo('design', 'fidato');
  const seg = MR.segnoFermata(fb);
  assert.equal(seg.forma, 'rombo');
  assert.equal(seg.livello, 'l3');
  assert.match(seg.testo, /fidato/);
  assert.match(MR.judgesNote(fb).text, /segnalo fidato/);
  assert.equal(MR.reasonText('fidato'), 'chiede di renderlo fidato');
  assert.equal(MR.reasonText('worker'), 'segnalato da chi ci lavorava');
});
