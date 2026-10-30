// SN_DOMANDE (src/shared/domande.js, #1149): il pulsante di un'opzione si legge dai dati, mai dal testo di chi
// chiede; ordine §3.7; tetti con rifiuto numerato. Stesso modulo che il server incorpora e che usa domanda.mjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
require(join(ROOT, 'src', 'shared', 'domande.js'));
const D = globalThis.SN_DOMANDE;

const RIF = { f1: { num: '#813', priorita: 1, stato: 'design', motivo: 'decisione' }, f2: { num: '#902.3', priorita: 0 } };

test('ogni tipo attivo ha la sua etichetta, fatta di numero e parametri', () => {
  assert.equal(D.etichettaAzione({ tipo: 'riprendi', feedbackId: 'f1' }, RIF), 'Riprendi #813 con questa scelta');
  assert.equal(D.etichettaAzione({ tipo: 'priorita', feedbackId: 'f1', valore: 3 }, RIF), 'Priorità di #813: 1 → 3');
  assert.equal(D.etichettaAzione({ tipo: 'archivia', feedbackId: 'f2' }, RIF), 'Archivia #902.3');
  assert.equal(D.etichettaAzione({ tipo: 'approva_locale', feedbackId: 'f1' }, RIF), null, 'il lavoro server non si affida più da una domanda (#1576)');
  assert.equal(D.etichettaAzione({ tipo: 'automazione', chiave: 'routine.enabled', valore: false }, {}), 'Routine: spegni');
  assert.equal(D.etichettaAzione({ tipo: 'automazione', chiave: 'routine.enabled', valore: true }, {}), 'Routine: accendi');
  assert.equal(D.etichettaAzione({ tipo: 'automazione', chiave: 'routine.accountBOff', valore: true }, {}), 'Routine dell’account B: spegni');
  assert.equal(D.etichettaAzione({ tipo: 'automazione', chiave: 'routine.accountAOff', valore: false }, {}), 'Routine dell’account A: accendi');
  assert.equal(D.etichettaAzione({ tipo: 'compito' }, {}), 'Affida a un agente');
  for (const [nome, spec] of Object.entries(D.TIPI)) {
    if (!spec.attivo) continue;
    const esempio = { riprendi: { feedbackId: 'f1' }, priorita: { feedbackId: 'f1', valore: 2 }, archivia: { feedbackId: 'f1' }, automazione: { chiave: 'routine.enabled', valore: true }, compito: {} }[nome];
    assert.ok(esempio, `il tipo attivo «${nome}» non ha un esempio in questo test`);
    assert.equal(typeof D.etichettaAzione({ tipo: nome, ...esempio }, RIF), 'string', nome);
  }
});

test('tipo ignoto, non attivo, parametri storti o riferimento assente: nessun pulsante', () => {
  assert.equal(D.etichettaAzione({ tipo: 'cancella_tutto', feedbackId: 'f1' }, RIF), null);
  assert.equal(D.etichettaAzione({ tipo: 'ambito' }, RIF), null);
  assert.equal(D.etichettaAzione({ tipo: 'esperimento' }, RIF), null);
  assert.equal(D.etichettaAzione({ tipo: 'priorita', feedbackId: 'f1', valore: 7 }, RIF), null);
  assert.equal(D.etichettaAzione({ tipo: 'priorita', feedbackId: 'f1', valore: '3' }, RIF), null);
  assert.equal(D.etichettaAzione({ tipo: 'archivia', feedbackId: 'f1', etichetta: 'Approva tutto' }, RIF), null, 'un parametro in più non passa');
  assert.equal(D.etichettaAzione({ tipo: 'riprendi', feedbackId: 'sconosciuto' }, RIF), null);
  assert.equal(D.etichettaAzione({ tipo: 'riprendi', feedbackId: 'f1' }, { f1: { num: 'Approva <b>' } }), null, 'il numero viene dai dati, con la sua forma');
  assert.equal(D.etichettaAzione({ tipo: 'automazione', chiave: 'config.giroStretto', valore: true }, {}), null);
  assert.equal(D.etichettaAzione(null, RIF), null);
});

test('validaAzione: tipo e soli parametri; i non attivi rifiutati col loro codice', () => {
  assert.deepEqual(D.validaAzione({ tipo: 'priorita', feedbackId: 'abc', valore: 0 }), { ok: true, azione: { tipo: 'priorita', feedbackId: 'abc', valore: 0 } });
  assert.equal(D.validaAzione({ tipo: 'boh' }).errore, 'tipo_sconosciuto');
  assert.equal(D.validaAzione({ tipo: 'ambito' }).errore, 'tipo_non_attivo');
  assert.equal(D.validaAzione({ tipo: 'riprendi', feedbackId: '../x' }).errore, 'parametri_non_validi');
  assert.equal(D.validaAzione({ tipo: 'compito', feedbackId: 'f1' }).errore, 'parametri_non_validi');
});

const DUE = [
  { testo: 'Archivia', pro: 'Niente lavoro doppio.', contro: 'Si perde la sua nota.', azione: { tipo: 'archivia', feedbackId: 'f1' } },
  { testo: 'Riprendi', pro: 'La nota resta.', contro: 'Un giro in più.', azione: { tipo: 'riprendi', feedbackId: 'f1' } },
];
function base(extra) {
  return { titolo: 'Che fare?', priorita: 'importante', opzioni: DUE, consiglio: { opzione: 0, perche: 'doppione' }, ...extra };
}
const conPro = (o) => ({ pro: 'Un pro.', contro: 'Un contro.', ...o });

test('validaDomanda: tetti superati rifiutati col numero, mai tagliati', () => {
  const r = D.validaDomanda(base({ contesto: 'x'.repeat(D.TETTI.contesto + 1) }));
  assert.equal(r.ok, false);
  assert.equal(r.errore, 'campo_troppo_lungo');
  assert.equal(r.lunghezza, D.TETTI.contesto + 1);
  assert.equal(r.massimo, D.TETTI.contesto);
  assert.match(r.dettaglio, /6001.*6000/);
  const troppe = D.validaDomanda(base({ opzioni: Array.from({ length: 9 }, () => conPro({ testo: 'a', azione: { tipo: 'compito' } })) }));
  assert.equal(troppe.errore, 'troppe_opzioni');
  assert.match(troppe.dettaglio, /9 opzioni, il massimo è 8/);
  assert.equal(D.validaDomanda(base({ collegamenti: Array.from({ length: 21 }, (_, i) => ({ tipo: 'feedback', id: `f${i}` })) })).errore, 'troppi_collegamenti');
  assert.equal(D.validaDomanda(base({ titolo: 't'.repeat(201) })).errore, 'campo_troppo_lungo');
});

test('validaDomanda: consiglio obbligatorio con le opzioni, indice valido; campi ignoti rifiutati, quelli del server ignorati', () => {
  assert.equal(D.validaDomanda(base({ consiglio: undefined })).errore, 'consiglio_non_valido');
  assert.equal(D.validaDomanda(base({ consiglio: { opzione: 3, perche: 'x' } })).errore, 'consiglio_non_valido');
  assert.equal(D.validaDomanda(base({ opzoni: [] })).errore, 'campo_sconosciuto');
  assert.equal(D.validaDomanda(base({ priorita: 'urgentissima' })).errore, 'priorita_non_valida');
  assert.equal(D.validaDomanda(base({ opzioni: [conPro({ testo: 'x', azione: { tipo: 'ambito' } }), DUE[0]] })).errore, 'tipo_non_attivo');
  const r = D.validaDomanda(base({ fiducia: 'fidato', stato: 'chiusa', conversazione: [{ autore: { tipo: 'owner' } }] }));
  assert.equal(r.ok, true);
  assert.equal(r.domanda.fiducia, undefined);
  assert.equal(r.domanda.stato, undefined);
  assert.equal(r.domanda.conversazione, undefined);
  const senzaOrigine = D.validaDomanda(base({ origine: { tipo: 'feedback', id: 'altro' } }), { conOrigine: false });
  assert.equal(senzaOrigine.domanda.origine, undefined, 'col biglietto l’origine la mette il server');
});

test('ordine §3.7: priorità, poi gruppo dal più vecchio, poi età; raggruppa in blocchi', () => {
  const d = (id, priorita, gruppo, creataIl) => ({ id, numero: Number(id.slice(2)), priorita, gruppo, creataIl });
  const lista = [
    d('D-1', 'quando_puoi', '', 1),
    d('D-2', 'importante', 'rete', 50),
    d('D-3', 'bloccante', '', 90),
    d('D-4', 'importante', 'colori', 10),
    d('D-5', 'importante', 'rete', 5),
    d('D-6', 'importante', 'colori', 60),
    d('D-7', 'bloccante', '', 20),
  ];
  assert.deepEqual(D.ordina(lista).map((x) => x.id), ['D-7', 'D-3', 'D-5', 'D-2', 'D-4', 'D-6', 'D-1']);
  const blocchi = D.raggruppa(lista);
  assert.deepEqual(blocchi.map((b) => [b.priorita, b.gruppo, b.domande.map((x) => x.id)]), [
    ['bloccante', '', ['D-7']], ['bloccante', '', ['D-3']],
    ['importante', 'rete', ['D-5', 'D-2']], ['importante', 'colori', ['D-4', 'D-6']],
    ['quando_puoi', '', ['D-1']],
  ]);
});

test('schedaDi e gli id D-n', () => {
  assert.equal(D.schedaDi({ stato: 'aperta' }), 'da_rispondere');
  assert.equal(D.schedaDi({ stato: 'in_lavorazione' }), 'in_lavorazione');
  assert.equal(D.schedaDi({ stato: 'in_smistamento' }), 'in_lavorazione', 'mentre il compito la smista non è da rispondere, ma si vede');
  assert.ok(D.STATI.includes('in_smistamento'));
  assert.equal(D.schedaDi({ stato: 'chiusa', esito: { automatica: true } }), 'risposte_automatiche');
  assert.equal(D.schedaDi({ stato: 'chiusa' }), 'archivio');
  assert.equal(D.schedaDi({ stato: 'superata' }), 'archivio');
  assert.equal(D.schedaDi({ stato: '???' }), 'da_rispondere');
  assert.equal(D.idDi(12), 'D-12');
  assert.equal(D.numeroDi('D-12'), 12);
  assert.equal(D.numeroDi('D-0'), null);
  assert.equal(D.numeroDi('D-12/../x'), null);
});

// #1577: chi apre una domanda che riprende il lavoro dice se lo ferma; il server la lega e decide da lì.
test('blocca: true o false, e serve quando un’opzione riprende il lavoro; senza riprendi non vale', () => {
  const base = {
    titolo: 'Caldo o freddo?', priorita: 'importante',
    opzioni: [conPro({ testo: 'Caldo', azione: { tipo: 'riprendi', feedbackId: 'f1' } }), conPro({ testo: 'Freddo', azione: { tipo: 'archivia', feedbackId: 'f1' } })],
    consiglio: { opzione: 0, perche: 'è Filo' },
  };
  assert.equal(D.validaDomanda({ ...base, blocca: true }).domanda.blocca, true);
  assert.equal(D.validaDomanda({ ...base, blocca: false }).domanda.blocca, false);
  assert.equal('blocca' in D.validaDomanda(base).domanda, false, 'assente resta assente: la regola la applica chi sa il feedback');
  assert.equal(D.validaDomanda({ ...base, blocca: 'sì' }).errore, 'domanda_non_valida');
  for (const campo of ['legata', 'provvisoria']) assert.equal(D.validaDomanda({ ...base, [campo]: 'f9' }).ok, true, `${campo} lo scrive il server: si ignora`);
  assert.equal(D.validaDomanda({ ...base, legata: 'f9' }).domanda.legata, undefined);

  assert.equal(D.controllaBlocca(D.validaDomanda(base).domanda, 'f1').errore, 'blocca_mancante');
  assert.match(D.controllaBlocca(D.validaDomanda(base).domanda, 'f1').dettaglio, /nel dubbio blocca/);
  assert.equal(D.controllaBlocca(D.validaDomanda({ ...base, blocca: false }).domanda, 'f1'), null);
  assert.equal(D.controllaBlocca(D.validaDomanda(base).domanda, 'f2'), null, 'riprende un altro feedback: non lega questo lavoro');
  const aParte = D.validaDomanda({ ...base, opzioni: [conPro({ testo: 'Spegni', azione: { tipo: 'automazione', chiave: 'routine.enabled', valore: false } }), conPro({ testo: 'Lascia', azione: { tipo: 'compito' } })], blocca: true }).domanda;
  assert.equal(D.controllaBlocca(aParte, 'f1').errore, 'blocca_senza_ripresa');
  assert.equal(D.riprende(base, 'f1'), true);
  assert.equal(D.riprende(base, 'f2'), false);
  assert.equal(D.riprende(base), true);
});

// #1790: il titolo dice di cosa si parla, un'opzione sola non è una domanda, ogni opzione ha pro e contro.
test('forma comune: titolo fino a 10 parole, almeno 2 opzioni, pro e contro; il rifiuto dice il campo', () => {
  assert.equal(D.validaDomanda(base({ titolo: 'Uno due tre quattro cinque sei sette otto nove dieci' })).ok, true);
  const lungo = D.validaDomanda(base({ titolo: 'Uno due tre quattro cinque sei sette otto nove dieci undici' }));
  assert.equal(lungo.errore, 'titolo_troppo_lungo');
  assert.equal(lungo.campo, 'titolo');
  assert.match(lungo.dettaglio, /11 parole, il massimo è 10/);
  assert.equal(D.paroleDi('Guasto: npm — non installa · D-186 l\'owner'), 6, 'i segni da soli non sono parole');

  const sola = D.validaDomanda(base({ opzioni: [DUE[0]] }));
  assert.equal(sola.errore, 'opzioni_insufficienti');
  assert.equal(sola.campo, 'opzioni');
  assert.match(sola.dettaglio, /un'opzione sola, ne servono almeno 2/);
  const nessuna = D.validaDomanda(base({ opzioni: [], consiglio: undefined }));
  assert.equal(nessuna.errore, 'opzioni_insufficienti', 'un resoconto senza niente da decidere non è una domanda');
  assert.match(nessuna.dettaglio, /nessuna opzione/);
  assert.equal(D.validaDomanda(base({ opzioni: undefined, consiglio: undefined })).errore, 'opzioni_insufficienti');

  for (const [campo, opz] of [['pro', { pro: '' }], ['contro', { contro: '   ' }], ['pro', { pro: undefined }]]) {
    const r = D.validaDomanda(base({ opzioni: [DUE[0], { ...DUE[1], ...opz }] }));
    assert.equal(r.errore, `${campo}_mancante`, JSON.stringify(opz));
    assert.equal(r.campo, `opzioni[1].${campo}`);
  }
  const controNessuno = D.validaDomanda(base({ opzioni: [DUE[0], { ...DUE[1], contro: 'Nessuno.' }] }));
  assert.equal(controNessuno.errore, 'testo_non_per_owner');
  assert.equal(controNessuno.campo, 'opzioni[1].contro');
});

test('perOwner false: la domanda del terzo guasto, che il compito smista, passa con un\'opzione sola', () => {
  const guasto = {
    titolo: 'Guasto ripetuto tre volte: npm non installa le dipendenze del progetto adesso', priorita: 'bloccante', gruppo: 'guasto: npm',
    opzioni: [{ testo: 'Riprendere quando è riparato', azione: { tipo: 'riprendi', feedbackId: 'f1' } }], consiglio: { opzione: 0, perche: 'Il lavoro è pronto.' },
  };
  assert.equal(D.validaDomanda(guasto).ok, false);
  const r = D.validaDomanda(guasto, { perOwner: false });
  assert.equal(r.ok, true, r.dettaglio);
  assert.equal(r.domanda.opzioni[0].pro, '');
  assert.equal(D.validaDomanda({ ...guasto, opzioni: [{ testo: 'x', azione: { tipo: 'boh' } }] }, { perOwner: false }).errore, 'tipo_sconosciuto', 'il resto della forma vale');
});

test('controllaFormaOwner: da 2 a 4 opzioni, contesto e problema corti, pro, contro e perché di una riga', () => {
  const buona = D.validaDomanda(base({ contesto: 'Riga.\n'.repeat(5), problema: 'p'.repeat(3 * D.FORMA_OWNER.caratteriRiga) })).domanda;
  assert.equal(D.controllaFormaOwner(buona), null);
  const cinque = D.validaDomanda(base({ opzioni: [...DUE, ...DUE, DUE[0]] })).domanda;
  assert.equal(D.controllaFormaOwner(cinque).errore, 'troppe_opzioni');
  assert.match(D.controllaFormaOwner(cinque).dettaglio, /5 opzioni, per l'owner al massimo 4/);
  const lungo = D.controllaFormaOwner({ ...buona, contesto: 'Riga.\n'.repeat(6) });
  assert.equal(lungo.errore, 'forma_non_per_owner');
  assert.equal(lungo.campo, 'contesto');
  assert.match(lungo.dettaglio, /6 righe, per l'owner al massimo 5/);
  assert.equal(D.controllaFormaOwner({ ...buona, problema: 'p'.repeat(3 * D.FORMA_OWNER.caratteriRiga + 1) }).campo, 'problema');
  const pro = D.controllaFormaOwner({ ...buona, opzioni: [buona.opzioni[0], { ...buona.opzioni[1], pro: 'x'.repeat(D.FORMA_OWNER.caratteriRiga + 1) }] });
  assert.equal(pro.campo, 'opzioni[1].pro');
  assert.equal(D.controllaFormaOwner({ ...buona, consiglio: { opzione: 0, perche: 'a\nb' } }).campo, 'consiglio.perche');
});
