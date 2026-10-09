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
  assert.equal(D.etichettaAzione({ tipo: 'approva_locale', feedbackId: 'f1' }, RIF), 'Approva come lavoro locale #813');
  assert.equal(D.etichettaAzione({ tipo: 'automazione', chiave: 'routine.enabled', valore: false }, {}), 'Routine: spegni');
  assert.equal(D.etichettaAzione({ tipo: 'automazione', chiave: 'routine.enabled', valore: true }, {}), 'Routine: accendi');
  assert.equal(D.etichettaAzione({ tipo: 'automazione', chiave: 'routine.accountBOff', valore: true }, {}), 'Routine dell’account B: spegni');
  assert.equal(D.etichettaAzione({ tipo: 'automazione', chiave: 'routine.accountAOff', valore: false }, {}), 'Routine dell’account A: accendi');
  assert.equal(D.etichettaAzione({ tipo: 'compito' }, {}), 'Affida a un agente');
  for (const [nome, spec] of Object.entries(D.TIPI)) {
    if (!spec.attivo) continue;
    const esempio = { riprendi: { feedbackId: 'f1' }, priorita: { feedbackId: 'f1', valore: 2 }, archivia: { feedbackId: 'f1' }, approva_locale: { feedbackId: 'f1' }, automazione: { chiave: 'routine.proberWhenIdle', valore: true }, compito: {} }[nome];
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

function base(extra) {
  return { titolo: 'Che fare?', priorita: 'importante', opzioni: [{ testo: 'Archivia', azione: { tipo: 'archivia', feedbackId: 'f1' } }], consiglio: { opzione: 0, perche: 'doppione' }, ...extra };
}

test('validaDomanda: tetti superati rifiutati col numero, mai tagliati', () => {
  const r = D.validaDomanda(base({ contesto: 'x'.repeat(D.TETTI.contesto + 1) }));
  assert.equal(r.ok, false);
  assert.equal(r.errore, 'campo_troppo_lungo');
  assert.equal(r.lunghezza, D.TETTI.contesto + 1);
  assert.equal(r.massimo, D.TETTI.contesto);
  assert.match(r.dettaglio, /6001.*6000/);
  const troppe = D.validaDomanda(base({ opzioni: Array.from({ length: 9 }, () => ({ testo: 'a', azione: { tipo: 'compito' } })) }));
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
  assert.equal(D.validaDomanda(base({ opzioni: [{ testo: 'x', azione: { tipo: 'ambito' } }] })).errore, 'tipo_non_attivo');
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
  assert.equal(D.schedaDi({ stato: 'chiusa', esito: { automatica: true } }), 'risposte_automatiche');
  assert.equal(D.schedaDi({ stato: 'chiusa' }), 'archivio');
  assert.equal(D.schedaDi({ stato: 'superata' }), 'archivio');
  assert.equal(D.schedaDi({ stato: '???' }), 'da_rispondere');
  assert.equal(D.idDi(12), 'D-12');
  assert.equal(D.numeroDi('D-12'), 12);
  assert.equal(D.numeroDi('D-0'), null);
  assert.equal(D.numeroDi('D-12/../x'), null);
});
