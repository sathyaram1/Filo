// #2229: i «da fare» dell'owner stanno fra le Domande. Un'opzione sola passa solo lì, il pulsante prende il nome dalla
// posizione, e le azioni accettano il numero del feedback che il server traduce nell'id (SN_DOMANDE.traduciNumeri).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
require(join(ROOT, 'src', 'shared', 'domande.js'));
require(join(ROOT, 'src', 'shared', 'feedbackAttese.js'));
require(join(ROOT, 'src', 'shared', 'manageReview.js'));
const D = globalThis.SN_DOMANDE;
const MR = globalThis.SN_MANAGE_REVIEW;

const FATTO = { testo: 'Fatto', azione: { tipo: 'riprendi', feedbackId: 'f1' } };
const daFare = (extra = {}) => ({
  tipo: 'da_fare', titolo: 'Permessi di Claude Code dal tuo PC', priorita: 'importante',
  contesto: 'In cloud il classificatore ferma le modifiche ai permessi.', problema: 'Apri una sessione sul PC e approva la modifica.',
  opzioni: [FATTO], blocca: true, ...extra,
});

test('un «da fare» passa con un\'opzione sola, senza pro né contro e senza consiglio; il tipo resta sulla domanda', () => {
  const r = D.validaDomanda(daFare());
  assert.equal(r.ok, true, r.dettaglio);
  assert.equal(r.domanda.tipo, 'da_fare');
  assert.equal(r.domanda.consiglio, null);
  assert.equal(D.daFare(r.domanda), true);
  assert.equal(D.controllaBlocca(r.domanda, 'f1'), null);
  assert.equal(D.controllaFormaOwner(r.domanda), null);
});

test('una domanda vera con un\'opzione sola resta rifiutata, e il rifiuto indica il «da fare»', () => {
  const vera = daFare({ tipo: undefined, consiglio: { opzione: 0, perche: 'x' } });
  const r = D.validaDomanda(vera);
  assert.equal(r.ok, false);
  assert.equal(r.errore, 'opzioni_insufficienti');
  assert.match(r.dettaglio, /da_fare/);
  const decidere = D.validaDomanda({ ...vera, tipo: 'da_decidere' });
  assert.equal(decidere.errore, 'opzioni_insufficienti', '«da_decidere» scritto per esteso vale come oggi');
  const ok = D.validaDomanda({ ...vera, tipo: 'da_decidere', opzioni: [{ ...FATTO, pro: 'a', contro: 'b' }, { testo: 'No', pro: 'c', contro: 'd', azione: { tipo: 'archivia', feedbackId: 'f1' } }] });
  assert.equal(ok.ok, true, ok.dettaglio);
  assert.equal('tipo' in ok.domanda, false, 'una domanda da decidere non porta il segno');
});

test('un «da fare»: niente opzioni, più di due o un consiglio si rifiutano; tipo ignoto rifiutato col campo', () => {
  assert.equal(D.validaDomanda(daFare({ opzioni: [] })).errore, 'opzioni_insufficienti');
  const tre = D.validaDomanda(daFare({ opzioni: [FATTO, FATTO, FATTO] }));
  assert.equal(tre.errore, 'troppe_opzioni');
  assert.equal(tre.massimo, 2);
  assert.equal(D.validaDomanda(daFare({ consiglio: { opzione: 0, perche: 'fallo' } })).errore, 'consiglio_non_valido');
  const ignoto = D.validaDomanda(daFare({ tipo: 'promemoria' }));
  assert.equal(ignoto.ok, false);
  assert.equal(ignoto.campo, 'tipo');
  // Il testo per l'owner resta pulito anche qui: niente nomi di file.
  assert.equal(D.validaDomanda(daFare({ problema: 'Modifica settings.json dal PC.' })).errore, 'testo_non_per_owner');
});

test('«nessuna» vale solo in un «da fare»; «Non lo faccio» è la seconda opzione', () => {
  const solo = D.validaDomanda(daFare({ opzioni: [{ testo: 'Fatto', azione: { tipo: 'nessuna' } }], blocca: undefined }));
  assert.equal(solo.ok, true, solo.dettaglio);
  const due = D.validaDomanda(daFare({ opzioni: [FATTO, { testo: 'No', azione: { tipo: 'archivia', feedbackId: 'f1' } }] }));
  assert.equal(due.ok, true, due.dettaglio);
  const vera = D.validaDomanda({ titolo: 'Che fare', priorita: 'importante', consiglio: { opzione: 0, perche: 'x' }, blocca: true,
    opzioni: [{ testo: 'a', pro: 'p', contro: 'c', azione: { tipo: 'nessuna' } }, { testo: 'b', pro: 'p', contro: 'c', azione: { tipo: 'riprendi', feedbackId: 'f1' } }] });
  assert.equal(vera.ok, false);
  assert.equal(vera.campo, 'opzioni[0].azione');
});

test('il pulsante di un «da fare» si chiama dalla posizione, l\'azione lo segue; la domanda vera resta com\'è', () => {
  const RIF = { f1: { num: '#1736' } };
  const d = D.validaDomanda(daFare({ opzioni: [{ testo: 'scrivi quello che vuoi', azione: { tipo: 'riprendi', feedbackId: 'f1' } },
    { testo: 'idem', azione: { tipo: 'archivia', feedbackId: 'f1' } }] })).domanda;
  assert.equal(D.etichettaOpzione(d, 0, RIF), 'Fatto: riprendi #1736');
  assert.equal(D.etichettaOpzione(d, 1, RIF), 'Non lo faccio: archivia #1736');
  assert.equal(D.etichettaOpzione(d, 0, {}), null, 'senza il riferimento nessun pulsante, come per le domande');
  const sola = { tipo: 'da_fare', opzioni: [{ testo: 'x', azione: { tipo: 'nessuna' } }] };
  assert.equal(D.etichettaOpzione(sola, 0, {}), 'Fatto');
  const vera = { opzioni: [{ testo: 'x', azione: { tipo: 'riprendi', feedbackId: 'f1' } }] };
  assert.equal(D.etichettaOpzione(vera, 0, RIF), 'Riprendi #1736 con questa scelta');
});

test('le azioni accettano il numero col cancelletto; il server lo traduce, un numero inesistente si rifiuta col numero', () => {
  const r = D.validaDomanda(daFare({ opzioni: [{ testo: 'Fatto', azione: { tipo: 'riprendi', feedbackId: '#1736' } },
    { testo: 'No', azione: { tipo: 'archivia', feedbackId: '#831.2' } }] }));
  assert.equal(r.ok, true, r.dettaglio);
  assert.deepEqual(D.numeriDaTradurre(r.domanda), ['1736', '831.2']);
  const t = D.traduciNumeri(r.domanda, { 1736: 'E5JpkNp9q3adMJb1zikU', '831.2': 'abc_DEF-1' });
  assert.equal(t.ok, true);
  assert.equal(t.domanda.opzioni[0].azione.feedbackId, 'E5JpkNp9q3adMJb1zikU');
  assert.equal(t.domanda.opzioni[1].azione.feedbackId, 'abc_DEF-1');
  assert.equal(r.domanda.opzioni[0].azione.feedbackId, '#1736', 'la domanda in ingresso non si tocca');
  assert.deepEqual(D.numeriDaTradurre(t.domanda), []);
  assert.equal(D.controllaBlocca(t.domanda, 'E5JpkNp9q3adMJb1zikU'), null);

  const manca = D.traduciNumeri(r.domanda, { 1736: 'E5JpkNp9q3adMJb1zikU' });
  assert.equal(manca.ok, false);
  assert.equal(manca.errore, 'feedback_inesistente');
  assert.deepEqual(manca.numeri, ['831.2']);
  assert.match(manca.dettaglio, /#831\.2/);
  // Un id resta un id; un numero storto non passa la validazione.
  assert.deepEqual(D.traduciNumeri({ opzioni: [FATTO] }, {}).domanda.opzioni[0].azione.feedbackId, 'f1');
  for (const storto of ['#0', '#12a', '#1.0', '##3', '#']) {
    assert.equal(D.validaAzione({ tipo: 'riprendi', feedbackId: storto }).ok, false, storto);
  }
});

test('il contatore della sezione conta a parte i «da fare» che aspettano l\'owner', () => {
  const lista = [
    { id: 'D-1', stato: 'aperta', priorita: 'importante' },
    { id: 'D-2', stato: 'aperta', priorita: 'importante', tipo: 'da_fare' },
    { id: 'D-3', stato: 'aperta', priorita: 'quando_puoi', tipo: 'da_fare' },
    { id: 'D-4', stato: 'chiusa', priorita: 'importante', tipo: 'da_fare' },
  ];
  assert.equal(MR.contaDomande(lista).domande, 3);
  assert.deepEqual(MR.contaDaRispondere(lista), { daDecidere: 1, daFare: 2 });
  assert.deepEqual(MR.contaDaRispondere(null), { daDecidere: 0, daFare: 0 });
});
