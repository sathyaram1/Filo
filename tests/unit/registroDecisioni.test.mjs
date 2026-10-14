// Registro delle decisioni (#1154, SPEC-DOMANDE.md §3.6) in SN_DOMANDE: una domanda coperta da un principio si chiude
// col tipo principio e va fra le automatiche, una riapertura la riporta aperta e mette il principio da rivedere,
// l'assorbimento lascia le superate collegate. Stesse funzioni che il server incorpora.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
require(join(ROOT, 'src', 'shared', 'domande.js'));
const D = globalThis.SN_DOMANDE;

const chiusa = (id, testo, extra = {}) => Object.assign({
  id, titolo: `Domanda ${id}`, stato: 'chiusa', gruppo: '', modificataIl: 1000,
  principio: { testo, fiducia: 'fidato', scrittoIl: Number(id.slice(2)) * 10 },
}, extra);

const REGISTRO = [
  chiusa('D-3', 'Zero fiducia nei crediti dichiarati dal client.', { gruppo: 'crediti' }),
  chiusa('D-5', 'Un doppione si archivia rimandando al feedback più vecchio.', { titolo: 'Doppioni in coda' }),
  chiusa('D-8', 'I crediti si contano sul server, mai nel processo dell’app.', { gruppo: 'crediti', principio: { testo: 'I crediti si contano sul server, mai nel processo dell’app.', fiducia: 'non_fidato' } }),
  chiusa('D-9', 'Vecchio principio sostituito.', { principio: { testo: 'Vecchio principio sostituito.', fiducia: 'fidato', sostituitoDa: 'D-12' } }),
  { id: 'D-10', titolo: 'Aperta col principio?', stato: 'aperta', principio: { testo: 'non conta: non è chiusa', fiducia: 'fidato' } },
  { id: 'D-11', titolo: 'Chiusa senza principio', stato: 'chiusa' },
];

test('il principio: una frase, non vuota, oltre il tetto rifiutata col numero', () => {
  assert.deepEqual(D.validaPrincipio('  Zero fiducia nel client.  '), { ok: true, principio: 'Zero fiducia nel client.' });
  for (const v of ['', '   ', null, 42, {}]) assert.equal(D.validaPrincipio(v).errore, 'principio_vuoto');
  const lungo = D.validaPrincipio('x'.repeat(D.TETTI.principio + 1));
  assert.equal(lungo.errore, 'campo_troppo_lungo');
  assert.match(lungo.dettaglio, new RegExp(`${D.TETTI.principio + 1} caratteri, il massimo è ${D.TETTI.principio}`));
  assert.equal(D.validaPrincipio('x'.repeat(D.TETTI.principio)).ok, true);
});

test('il registro sono le chiuse col principio non sostituito; senza fiducia scritta vale non fidato', () => {
  const tutti = D.cercaNelRegistro(REGISTRO, '');
  assert.equal(tutti.ok, true);
  assert.deepEqual(tutti.voci.map((v) => v.id).sort(), ['D-3', 'D-5', 'D-8']);
  assert.equal(tutti.totale, 3);
  assert.equal(tutti.altre, 0);
  assert.deepEqual(tutti.voci.map((v) => v.id), ['D-3', 'D-8', 'D-5'], 'per gruppo (i senza gruppo in fondo), dentro il fidato prima');
  assert.equal(D.voceRegistro(chiusa('D-4', 'x', { principio: { testo: 'x' } })).fiducia, 'non_fidato');
  assert.equal(D.voceRegistro({ id: 'D-4', stato: 'chiusa', principio: { testo: '   ' } }), null);
  assert.equal(D.voceRegistro(null), null);
});

test('cerca: parole flesse, accenti e maiuscole si incontrano; il principio pesa più del titolo', () => {
  const r = D.cercaNelRegistro(REGISTRO, 'CREDITO dichiarato');
  assert.equal(r.ok, true);
  assert.deepEqual(r.voci.map((v) => v.id), ['D-3', 'D-8']);
  assert.ok(r.voci[0].punteggio > r.voci[1].punteggio);
  assert.deepEqual(D.cercaNelRegistro(REGISTRO, 'doppioni').voci.map((v) => v.id), ['D-5']);
  assert.deepEqual(D.cercaNelRegistro(REGISTRO, 'più vecchio').voci.map((v) => v.id), ['D-5']);
  assert.deepEqual(D.cercaNelRegistro(REGISTRO, 'sostituito').voci, [], 'un principio sostituito non risponde più');
  assert.deepEqual(D.cercaNelRegistro(REGISTRO, 'zebra arcobaleno').voci, []);
});

test('cerca: niente parole utili, testo oltre il tetto, emoji e markup', () => {
  assert.equal(D.cercaNelRegistro(REGISTRO, 'di la e').errore, 'ricerca_vuota');
  assert.equal(D.cercaNelRegistro(REGISTRO, '🙂🙂').errore, 'ricerca_vuota');
  const lungo = D.cercaNelRegistro(REGISTRO, 'a'.repeat(D.TETTI.cerca + 1));
  assert.equal(lungo.errore, 'campo_troppo_lungo');
  assert.match(lungo.dettaglio, new RegExp(`${D.TETTI.cerca + 1} caratteri`));
  assert.deepEqual(D.cercaNelRegistro(REGISTRO, '<b>crediti</b>').voci.map((v) => v.id), ['D-3', 'D-8']);
  assert.deepEqual(D.cercaNelRegistro(null, 'crediti').voci, []);
});

test('cerca: oltre il limite dice quante ne restano fuori, mai un taglio muto', () => {
  const tanti = Array.from({ length: 45 }, (_, i) => chiusa(`D-${i + 100}`, `Regola numero ${i} sulle priorità della coda.`));
  const r = D.cercaNelRegistro(tanti, 'priorità coda');
  assert.equal(r.voci.length, D.TETTI.risultatiRegistro);
  assert.equal(r.totale, 45);
  assert.equal(r.altre, 45 - D.TETTI.risultatiRegistro);
  assert.equal(D.cercaNelRegistro(tanti, '').voci.length, 45, 'senza parole li dà tutti');
});

test('una domanda coperta da un principio si chiude col tipo principio e va fra le automatiche', () => {
  const voce = D.voceRegistro(REGISTRO[0]);
  const aperta = {
    id: 'D-20', stato: 'aperta', titolo: 'Fidarsi dei crediti del client?',
    opzioni: [
      { testo: 'Riprendi con il conto sul server', azione: { tipo: 'riprendi', feedbackId: 'f1' } },
      { testo: 'Approva come locale', azione: { tipo: 'approva_locale', feedbackId: 'f1' } },
    ],
  };
  const r = D.rispostaDaPrincipio(aperta, voce, 0);
  assert.equal(r.ok, true);
  assert.deepEqual(r.esito, {
    automatica: true, tipo: 'principio', principio: 'D-3', testoPrincipio: 'Zero fiducia nei crediti dichiarati dal client.',
    scelta: 0, azione: { tipo: 'riprendi', feedbackId: 'f1' },
  });
  const chiusaDaPrincipio = Object.assign({}, aperta, { stato: 'chiusa', esito: Object.assign({ ok: true }, r.esito) });
  assert.equal(D.schedaDi(chiusaDaPrincipio), 'risposte_automatiche');
  assert.equal(D.schedaDi({ stato: 'chiusa', esito: { tipo: 'principio' } }), 'risposte_automatiche');
  assert.equal(D.voceRegistro(chiusaDaPrincipio), null, 'la risposta automatica non duplica il principio nel registro');

  assert.equal(D.rispostaDaPrincipio(aperta, voce, 1).errore, 'principio_non_applicabile', 'un’azione di consenso resta all’owner');
  assert.equal(D.rispostaDaPrincipio(aperta, D.voceRegistro(REGISTRO[2]), 0).errore, 'principio_non_applicabile', 'principio non fidato');
  assert.equal(D.rispostaDaPrincipio(aperta, Object.assign({}, voce, { daRivedere: true }), 0).errore, 'principio_non_applicabile');
  assert.equal(D.rispostaDaPrincipio(aperta, voce, 5).errore, 'scelta_non_valida');
  assert.equal(D.rispostaDaPrincipio(Object.assign({}, aperta, { opzioni: [] }), voce, 0).errore, 'scelta_non_valida');
  assert.equal(D.rispostaDaPrincipio(Object.assign({}, aperta, { stato: 'chiusa' }), voce, 0).errore, 'domanda_non_aperta');
  assert.equal(D.rispostaDaPrincipio(Object.assign({}, aperta, { id: 'D-3' }), voce, 0).errore, 'principio_di_se_stessa');
  assert.equal(D.rispostaDaPrincipio(aperta, { id: 'D-3/../x', fiducia: 'fidato' }, 0).errore, 'principio_sconosciuto');
});

test('una riapertura riporta la domanda aperta e mette il principio da rivedere; la nuova risposta lo sostituisce', () => {
  const voce = D.voceRegistro(REGISTRO[0]);
  const aperta = { id: 'D-21', stato: 'aperta', opzioni: [{ testo: 'Archivia', azione: { tipo: 'archivia', feedbackId: 'f2' } }] };
  const esito = Object.assign({ ok: true }, D.rispostaDaPrincipio(aperta, voce, 0).esito);
  const automatica = Object.assign({}, aperta, { stato: 'chiusa', esito });

  const r = D.riapriAutomatica(automatica, { ora: 5000 });
  assert.equal(r.ok, true);
  assert.deepEqual(r.domanda, { stato: 'aperta', esito: null, riaperta: { il: 5000, esitoPrima: esito }, modificataIl: 5000 });
  assert.deepEqual(r.principio, { id: 'D-3', daRivedere: { il: 5000, da: 'D-21' } });
  const riaperta = Object.assign({}, automatica, r.domanda);
  assert.equal(D.schedaDi(riaperta), 'da_rispondere');

  const sorgente = Object.assign({}, REGISTRO[0], { principio: Object.assign({}, REGISTRO[0].principio, { daRivedere: r.principio.daRivedere }) });
  const v = D.voceRegistro(sorgente);
  assert.equal(v.daRivedere, true, 'resta nel registro, segnato');
  assert.equal(D.principioApplicabile(v, { tipo: 'archivia', feedbackId: 'f2' }), false, 'ma non chiude più niente da solo');
  assert.equal(D.cercaNelRegistro([sorgente, REGISTRO[2]], 'crediti').voci[1].id, 'D-3', 'e scende sotto quelli che valgono');

  const corretta = Object.assign({}, riaperta, { stato: 'chiusa', principio: { testo: 'I crediti del client contano solo firmati dal server.', fiducia: 'fidato' } });
  assert.equal(D.principioDaSostituire(corretta), 'D-3');
  assert.equal(D.principioDaSostituire(Object.assign({}, corretta, { principio: undefined })), '', 'senza un principio nuovo non sostituisce');
  assert.equal(D.principioDaSostituire(REGISTRO[0]), '', 'una chiusa mai riaperta non sostituisce niente');

  assert.equal(D.riapriAutomatica(REGISTRO[0], { ora: 1 }).errore, 'non_automatica', 'una risposta dell’owner non si riapre da qui');
  assert.equal(D.riapriAutomatica(aperta, { ora: 1 }).errore, 'non_automatica');
});

test('l’assorbimento lascia le superate collegate, coi loro feedback, e non abbassa la priorità', () => {
  const madre = { id: 'D-30', stato: 'aperta', priorita: 'quando_puoi', collegamenti: [{ tipo: 'feedback', id: 'fA' }], assorbite: ['D-29'] };
  const figlie = [
    { id: 'D-31', stato: 'aperta', priorita: 'importante', origine: { tipo: 'feedback', id: 'fB' } },
    { id: 'D-32', stato: 'aperta', priorita: 'bloccante', collegamenti: [{ tipo: 'feedback', id: 'fA' }, { tipo: 'ramo', id: 'claude/x' }] },
  ];
  const r = D.assorbi(madre, figlie, { ora: 7000 });
  assert.equal(r.ok, true);
  assert.deepEqual(r.figlie, [
    { id: 'D-31', stato: 'superata', assorbitaDa: 'D-30', modificataIl: 7000 },
    { id: 'D-32', stato: 'superata', assorbitaDa: 'D-30', modificataIl: 7000 },
  ]);
  assert.deepEqual(r.madre.assorbite, ['D-29', 'D-31', 'D-32']);
  assert.deepEqual(r.madre.collegamenti, [
    { tipo: 'feedback', id: 'fA' }, { tipo: 'domanda', id: 'D-31' }, { tipo: 'feedback', id: 'fB' }, { tipo: 'domanda', id: 'D-32' },
  ]);
  assert.equal(r.madre.priorita, 'bloccante');
  for (const f of r.figlie) assert.equal(D.schedaDi(Object.assign({}, f)), 'archivio');

  assert.equal(D.assorbi(Object.assign({}, madre, { stato: 'chiusa' }), figlie, { ora: 1 }).errore, 'madre_non_aperta');
  assert.equal(D.assorbi(madre, [], { ora: 1 }).errore, 'niente_da_assorbire');
  assert.equal(D.assorbi(madre, [{ id: 'D-30', stato: 'aperta' }], { ora: 1 }).errore, 'assorbe_se_stessa');
  assert.equal(D.assorbi(madre, [figlie[0], figlie[0]], { ora: 1 }).errore, 'assorbita_due_volte');
  assert.equal(D.assorbi(madre, [{ id: 'D-33', stato: 'in_lavorazione' }], { ora: 1 }).errore, 'assorbita_non_aperta');
  assert.equal(D.assorbi(madre, [{ id: 'x', stato: 'aperta' }], { ora: 1 }).errore, 'domanda_non_valida');
  const troppe = Array.from({ length: D.TETTI.assorbite + 1 }, (_, i) => ({ id: `D-${200 + i}`, stato: 'aperta' }));
  assert.match(D.assorbi(madre, troppe, { ora: 1 }).dettaglio, new RegExp(`${D.TETTI.assorbite + 1} domande da assorbire, il massimo è ${D.TETTI.assorbite}`));
  const piene = Array.from({ length: D.TETTI.collegamenti - 1 }, (_, i) => ({ tipo: 'feedback', id: `g${i}` }));
  const r2 = D.assorbi(Object.assign({}, madre, { collegamenti: piene }), figlie, { ora: 1 });
  assert.equal(r2.errore, 'troppi_collegamenti');
  assert.match(r2.dettaglio, /assorbine meno per volta/);
});

test('i campi del registro scritti dal server non fanno rifiutare una domanda rimandata', () => {
  const v = D.validaDomanda({ titolo: 'T', priorita: 'importante', principio: { testo: 'p', fiducia: 'fidato' }, assorbitaDa: 'D-1', assorbite: [], riaperta: null });
  assert.equal(v.ok, true);
  assert.ok(!('principio' in v.domanda) && !('assorbitaDa' in v.domanda), 'si ignorano: li decide il server');
});
