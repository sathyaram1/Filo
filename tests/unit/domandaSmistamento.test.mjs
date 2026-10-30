// scripts/domanda.mjs, #1790: il compito «Gestisci la domanda» parla col canale con `smista`, il registro si consulta
// prima di chiedere, `elenco` dice quante sono in smistamento e quante automatiche, `chiedi` dice il campo rifiutato.
// I/O finto: nessuna rete.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  leggiArgomenti, esegui, conteggiDi, formattaConteggi, formattaElenco, formattaFascicoloSmistamento, formattaDomanda, MAX_PAROLE_REGISTRO,
} from '../../scripts/domanda.mjs';

const OPZ = (testo, tipo) => ({ testo, pro: 'Un pro.', contro: 'Un contro.', azione: { tipo, feedbackId: 'f1' } });
const RISCRITTA = {
  titolo: 'Bordo caldo o freddo?', priorita: 'importante', contesto: 'Il riquadro nuovo ha il bordo grigio.',
  problema: 'Se sbagliamo, il riquadro stona col resto.', opzioni: [OPZ('Caldo', 'riprendi'), OPZ('Tenere com\'è', 'archivia')],
  consiglio: { opzione: 0, perche: 'Filo usa colori caldi.' }, notePerAgenti: 'Il token sta in themeTokens.',
};

function finto(risposte = {}) {
  const chiamate = [];
  const canale = [];
  const out = [];
  const err = [];
  const sporcate = [];
  const io = {
    chiama: async (data) => { chiamate.push(data); return risposte[data.op] || { ok: true }; },
    consegna: async (t, domanda) => { canale.push({ intento: 'domanda', t, domanda }); return risposte.consegna || { outcome: 'ok', num: 'D-7', reply: { stato: 'in_smistamento' } }; },
    smistamento: async (t, data) => { canale.push({ intento: 'smistamento', t, data }); return risposte.smistamento || { outcome: 'ok', reply: {} }; },
    registroCanale: async (t, data) => { canale.push({ intento: 'registro', t, data }); return risposte.registro || { outcome: 'ok', reply: { voci: [] } }; },
    biglietto: async () => (risposte.biglietto === undefined ? 'biglietto-del-compito' : risposte.biglietto),
    bigliettoLocale: async () => '',
    sporca: async (cosa, motivi) => { sporcate.push({ cosa, motivi }); return 'Biglietto della sessione sporcato.'; },
    leggiFile: (p) => { if (!(p in (risposte.file || {}))) throw Object.assign(new Error('no'), { code: 'ENOENT' }); return risposte.file[p]; },
    stdin: async () => risposte.stdin || '',
    scrivi: (s) => out.push(String(s)),
    errore: (s) => err.push(String(s)),
  };
  return { io, chiamate, canale, out, err, sporcate };
}

test('smista: operazioni e campi controllati prima del canale', () => {
  assert.deepEqual(leggiArgomenti(['smista', 'mostra']), { cmd: 'smista', op: 'mostra' });
  assert.deepEqual(leggiArgomenti(['smista', 'pubblica', '-']), { cmd: 'smista', op: 'pubblica', file: '-' });
  assert.deepEqual(
    leggiArgomenti(['smista', 'guasto', '--chiave', 'git-server: 403', '--titolo', 'Il clone del server è respinto', '--testo', '-', '--resoconto=Riprende da solo.']),
    { cmd: 'smista', op: 'guasto', chiave: 'git-server: 403', titolo: 'Il clone del server è respinto', testo: '-', resoconto: 'Riprende da solo.' },
  );
  assert.deepEqual(leggiArgomenti(['smista', 'automatica', '--scelta', '2', '--principio', 'D-41', '--testo', 'x']), { cmd: 'smista', op: 'automatica', scelta: 1, principio: 'D-41', testo: 'x' });
  assert.deepEqual(leggiArgomenti(['smista', 'ricevuti', '--richiesta', 'fiducia', '--testo', 'x']), { cmd: 'smista', op: 'ricevuti', richiesta: 'fiducia', testo: 'x' });
  assert.match(leggiArgomenti(['smista']).errore, /un'operazione fra mostra, guasto, ricevuti, automatica, pubblica/);
  assert.match(leggiArgomenti(['smista', 'guasto', '--chiave', 'x']).errore, /--titolo, --testo, --resoconto/);
  assert.match(leggiArgomenti(['smista', 'guasto', '--chiave', '  ', '--titolo', 't', '--testo', 't', '--resoconto', 'r']).errore, /--chiave/, 'un campo di soli spazi manca');
  assert.match(leggiArgomenti(['smista', 'ricevuti', '--richiesta', 'soldi', '--testo', 'x']).errore, /fiducia o permesso/);
  assert.match(leggiArgomenti(['smista', 'automatica', '--scelta', '0', '--principio', 'D-4', '--testo', 'x']).errore, /numero dell'opzione/);
  assert.match(leggiArgomenti(['smista', 'automatica', '--scelta', '1', '--principio', '41', '--testo', 'x']).errore, /forma D-12/);
  assert.match(leggiArgomenti(['smista', 'guasto', '--chiave', '-', '--titolo', 't', '--testo', 't', '--resoconto', 'r']).errore, /da stdin arriva solo --testo/);
  assert.match(leggiArgomenti(['smista', 'mostra', '--testo', 'x']).errore, /non vuole altro/);
  assert.match(leggiArgomenti(['smista', 'guasto', '--chiave', 'k'.repeat(301), '--titolo', 't', '--testo', 't', '--resoconto', 'r']).errore, /301 caratteri, il massimo è 300/);
  assert.match(leggiArgomenti(['smista', 'pubblica']).errore, /file JSON della domanda riscritta/);
});

test('smista pubblica: la riscrittura passa la forma comune e quella corta per l\'owner, o non parte', async () => {
  const ok = finto({ file: { 'r.json': JSON.stringify(RISCRITTA) }, smistamento: { outcome: 'ok', reply: { id: 'D-12' } } });
  assert.equal(await esegui(['smista', 'pubblica', 'r.json'], ok.io), 0);
  assert.equal(ok.canale[0].intento, 'smistamento');
  assert.equal(ok.canale[0].data.op, 'pubblica');
  assert.equal(ok.canale[0].data.domanda.titolo, RISCRITTA.titolo);
  assert.match(ok.out.join('\n'), /D-12 è aperta all'owner, riscritta/);

  const cinque = { ...RISCRITTA, opzioni: [...RISCRITTA.opzioni, ...RISCRITTA.opzioni, RISCRITTA.opzioni[0]] };
  const lunga = { ...RISCRITTA, contesto: 'Una riga.\n'.repeat(6) };
  const sola = { ...RISCRITTA, opzioni: [RISCRITTA.opzioni[0]] };
  for (const [nome, d, campo] of [['cinque opzioni', cinque, 'opzioni'], ['contesto lungo', lunga, 'contesto'], ['un\'opzione', sola, 'opzioni']]) {
    const f = finto({ stdin: JSON.stringify(d) });
    assert.equal(await esegui(['smista', 'pubblica', '-'], f.io), 1, nome);
    assert.equal(f.canale.length, 0, `${nome}: non parte`);
    assert.match(f.err.join('\n'), new RegExp(`campo «${campo.replace(/[[\]]/g, '\\$&')}»`), nome);
  }
});

test('smista guasto, ricevuti, automatica: il testo da stdin, le uscite del canale', async () => {
  const g = finto({ stdin: 'Il clone viene respinto con 403.\n', smistamento: { outcome: 'ok', reply: { difetto: '#1801', riusato: true, fermo: '#1790' } } });
  assert.equal(await esegui(['smista', 'guasto', '--chiave', 'git-server: 403', '--titolo', 'Clone respinto', '--testo', '-', '--resoconto', 'Aspetta #1801.'], g.io), 0);
  assert.deepEqual(g.canale[0].data, { op: 'guasto', chiave: 'git-server: 403', titolo: 'Clone respinto', resoconto: 'Aspetta #1801.', testo: 'Il clone viene respinto con 403.\n' });
  assert.match(g.out.join('\n'), /#1801 \(riusato\); #1790 lo aspetta e riparte da solo/);
  assert.match(g.out.join('\n'), /all'owner non arriva/);

  const vuoto = finto({ stdin: '  \n' });
  assert.equal(await esegui(['smista', 'ricevuti', '--richiesta', 'permesso', '--testo', '-'], vuoto.io), 1);
  assert.equal(vuoto.canale.length, 0);

  const auto = finto({ smistamento: { outcome: 'ok', reply: { principio: 'D-41', etichetta: 'Archivia #1640' } } });
  assert.equal(await esegui(['smista', 'automatica', '--scelta', '2', '--principio', 'D-41', '--testo', 'Il principio di D-41 lo copre.'], auto.io), 0);
  assert.deepEqual(auto.canale[0].data, { op: 'automatica', scelta: 1, principio: 'D-41', testo: 'Il principio di D-41 lo copre.' });
  assert.match(auto.out.join('\n'), /col principio di D-41, applicata: Archivia #1640/);

  const no = finto({ smistamento: { outcome: 'refused', reason: 'principio_contestato', detail: 'l\'owner l\'ha riaperto' } });
  assert.equal(await esegui(['smista', 'automatica', '--scelta', '1', '--principio', 'D-41', '--testo', 'x'], no.io), 1);
  assert.match(no.err.join('\n'), /RIFIUTATO dal server: principio_contestato: l'owner l'ha riaperto/);
  const giu = finto({ smistamento: { outcome: 'down', reason: 'timeout' } });
  assert.equal(await esegui(['smista', 'mostra'], giu.io), 3);

  const senza = finto({ biglietto: '' });
  assert.equal(await esegui(['smista', 'mostra'], senza.io), 1);
  assert.match(senza.err.join('\n'), /col biglietto del compito che gestisce una domanda appena nata/);
});

test('smista mostra: domanda, feedback d\'origine e registro, coi caratteri di controllo resi visibili', async () => {
  const fascicolo = {
    domanda: { id: 'D-9', stato: 'in_smistamento', titolo: 'Guasto\u001b[2J', priorita: 'bloccante', opzioni: [], notePerAgenti: 'git: 403' },
    feedback: { num: '#1790', stato: 'design', motivo: 'guasto', nome: 'Domande', testo: 'Testo\u0007', conversazione: [{ ora: 1, chi: 'routine:new-work', testo: 'fermo' }] },
    registro: { voci: [{ id: 'D-41', titolo: 'Lavori server', principio: 'Un lavoro fidato va alla corsia server.', contestato: true }] },
  };
  const f = finto({ smistamento: { outcome: 'ok', reply: fascicolo } });
  assert.equal(await esegui(['smista', 'mostra'], f.io), 0);
  const testo = f.out.join('\n');
  assert.ok(!/[\u0000-\u0008\u000b-\u001f\u007f]/.test(testo));
  assert.match(testo, /la sta smistando un agente/);
  assert.match(testo, /Feedback d'origine: #1790 · design \(guasto\)/);
  assert.match(testo, /D-41 Lavori server {2}\[contestato: non riusarlo\]/);
  assert.match(formattaFascicoloSmistamento({ affidata: false, motivo: 'superata' }), /non è più affidata a te \(superata\)/);
  assert.match(formattaFascicoloSmistamento({ domanda: { id: 'D-1' } }), /nessuno \(la domanda non viene da un lavoro\)/);
});

test('registro: col biglietto passa dal canale, da una sessione da ownerDomande e chi stampa un principio non fidato si sporca', async () => {
  assert.deepEqual(leggiArgomenti(['registro', 'crediti', 'dichiarati']), { cmd: 'registro', parole: 'crediti dichiarati' });
  assert.match(leggiArgomenti(['registro']).errore, /le parole da cercare/);
  assert.match(leggiArgomenti(['registro', 'x'.repeat(MAX_PAROLE_REGISTRO + 1)]).errore, new RegExp(`${MAX_PAROLE_REGISTRO + 1} caratteri, il massimo è ${MAX_PAROLE_REGISTRO}`));

  const routine = finto({ registro: { outcome: 'ok', reply: { voci: [], assente: 'il registro è riservato: il tuo biglietto non lo legge' } } });
  assert.equal(await esegui(['registro', 'crediti'], routine.io), 0);
  assert.deepEqual(routine.canale[0], { intento: 'registro', t: 'biglietto-del-compito', data: { parole: 'crediti' } });
  assert.match(routine.out.join('\n'), /il registro è riservato/);

  const sessione = finto({ biglietto: '', registro: { ok: true, voci: [
    { id: 'D-3', titolo: 'Crediti', principio: 'Zero fiducia nei crediti dichiarati dal client.', fiducia: 'fidato' },
    { id: 'D-8', titolo: 'Altro', principio: 'x', fiducia: 'non_fidato' },
  ] } });
  assert.equal(await esegui(['registro', 'crediti'], sessione.io), 0);
  assert.deepEqual(sessione.chiamate[0], { op: 'registro', parole: 'crediti' });
  assert.equal(sessione.sporcate.length, 1);
  assert.match(sessione.out.join('\n'), /Principi per «crediti» \(2\)/);
  assert.match(sessione.out.join('\n'), /Zero fiducia nei crediti dichiarati dal client\./);

  const niente = finto({ biglietto: '', registro: { ok: true, voci: [] } });
  await esegui(['registro', 'colori'], niente.io);
  assert.match(niente.out.join('\n'), /nessun principio copre queste parole/);
});

test('elenco: i conteggi dal server, o contati sull\'elenco; le non riscritte e le automatiche si vedono', async () => {
  assert.equal(formattaConteggi(conteggiDi([], { da_rispondere: 3, in_smistamento: 2, in_lavorazione: 1, risposte_automatiche: 4, non_riscritte: 0 })),
    '3 da rispondere · 2 in smistamento · 1 in lavorazione · 4 risposte automatiche');
  const lista = [
    { id: 'D-1', titolo: 'a', priorita: 'bloccante', stato: 'aperta', smistamento: 'fallito' },
    { id: 'D-2', titolo: 'b', priorita: 'importante', stato: 'in_smistamento' },
    { id: 'D-3', titolo: 'c', priorita: 'importante', stato: 'chiusa', esito: { automatica: true } },
  ];
  const contati = conteggiDi(lista);
  assert.deepEqual(contati, { da_rispondere: 1, in_smistamento: 1, in_lavorazione: 0, risposte_automatiche: 1, non_riscritte: 1 });
  assert.match(formattaConteggi(contati), /1 non riscritte/);
  assert.equal(conteggiDi(lista.slice(0, 2)).risposte_automatiche, null, 'senza le chiuse il numero delle automatiche non si sa');
  assert.match(formattaConteggi(conteggiDi(lista.slice(0, 2))), /\? risposte automatiche/);
  const e = formattaElenco(lista);
  assert.match(e, /D-1 {2}a {2}\[aperta · non fidata · non riscritta\]/);
  assert.match(e, /D-3 {2}c {2}\[chiusa · non fidata · automatica\]/);

  const f = finto({ biglietto: '', elenco: { ok: true, domande: lista.slice(0, 2), conteggi: { da_rispondere: 5, in_smistamento: 2, in_lavorazione: 0, risposte_automatiche: 7, non_riscritte: 1 } } });
  assert.equal(await esegui(['elenco'], f.io), 0);
  assert.match(f.out[0], /^5 da rispondere · 2 in smistamento · 0 in lavorazione · 7 risposte automatiche · 1 non riscritte/);
});

test('chiedi: la domanda storta si ferma col campo; quella buona dice che prima la smista un agente', async () => {
  const sola = finto({ file: { 'd.json': JSON.stringify({ ...RISCRITTA, opzioni: [RISCRITTA.opzioni[0]] }) } });
  assert.equal(await esegui(['chiedi', 'd.json'], sola.io), 1);
  assert.equal(sola.canale.length, 0);
  assert.match(sola.err.join('\n'), /opzioni_insufficienti \(campo «opzioni»\): un'opzione sola, ne servono almeno 2/);
  const titolo = finto({ file: { 'd.json': JSON.stringify({ ...RISCRITTA, titolo: 'Il bordo del riquadro nuovo deve essere caldo come il resto oppure no?' }) } });
  assert.equal(await esegui(['chiedi', 'd.json'], titolo.io), 1);
  assert.match(titolo.err.join('\n'), /titolo_troppo_lungo \(campo «titolo»\): il titolo ha 13 parole, il massimo è 10/);

  const buona = finto({ file: { 'd.json': JSON.stringify({ ...RISCRITTA, blocca: true }) } });
  assert.equal(await esegui(['chiedi', 'd.json'], buona.io), 0);
  assert.match(buona.out.join('\n'), /OK: domanda D-7 aperta: prima di arrivare all'owner la smista un agente\./);
  assert.match(formattaDomanda({ id: 'D-1', stato: 'aperta', smistamento: 'fallito' }, {}, { quando: () => 'ora' }), /non riscritta/);
});
