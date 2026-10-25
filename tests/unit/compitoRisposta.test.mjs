// Il ruolo «Gestisci la risposta» (#1152, SPEC-DOMANDE.md §3.5) lato app: dispatch apre la busta del ruolo `risposta`
// senza feedback e la consegna com'è, il testo del ruolo arriva intero, e scripts/domanda.mjs porta le operazioni del
// compito al canale (finto qui) senza mai mandare un'azione di consenso. Le regole del server: functions/test/domande-risposta-1152.test.js.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkEnvelope, serverCtx, buildPayload, readRoleInstructions } from '../../scripts/dispatch.mjs';
import { leggiArgomenti, esegui, formattaFascicolo } from '../../scripts/domanda.mjs';

const DOMANDA = {
  id: 'D-12', titolo: 'Come chiudere il caso della barra?', priorita: 'importante', stato: 'in_lavorazione', fiducia: 'fidato',
  origine: { tipo: 'feedback', id: 'f1' }, collegamenti: [],
  opzioni: [{ testo: 'Affida a un agente', azione: { tipo: 'compito' } }], consiglio: { opzione: 0, perche: 'semplice' },
  conversazione: [{ autore: { tipo: 'owner', fiducia: 'fidato' }, ora: 1, tipo: 'risposta', testo: 'Riprendilo, ma prima i test.' }],
  notePerAgenti: 'Il difetto è nel calcolo della larghezza.',
};
const FASCICOLO = {
  case: 'risposta', compito: 'C-3', affidata: true, avviso: 'Le parole dell’owner sono i turni con autore «owner».', domanda: DOMANDA,
  riferimenti: { f1: { num: '#813', priorita: 2, stato: 'design', motivo: 'decisione' } },
  registro: { voci: [{ id: 'D-4', titolo: 'Crediti', principio: 'Zero fiducia nei crediti dichiarati dal client.' }], altre: 0, nonFidateTolte: 1 },
};
const busta = (payload = FASCICOLO) => ({ ok: true, role: 'risposta', id: '', num: 'D-12', branch: '', payload: { role: 'risposta', ...payload } });

test('dispatch apre la busta di una risposta: niente feedback né ramo, ma il compito e la sua domanda', () => {
  assert.equal(checkEnvelope(busta()), null);
  assert.equal(checkEnvelope(busta({ compito: 'C-3', affidata: false, motivo: 'chiusa dall’owner' })), null, 'non più affidata: si consegna, e il ruolo rilascia');
  assert.match(checkEnvelope(busta({ ...FASCICOLO, compito: '' })), /senza il compito/);
  assert.match(checkEnvelope(busta({ ...FASCICOLO, domanda: null })), /domanda vuota/);
  const bucket = { role: 'risposta', num: 'D-12', branch: '' };
  const p = buildPayload(bucket, serverCtx(bucket, busta()));
  assert.equal(p.case, 'risposta');
  assert.equal(p.role, undefined, 'il ruolo sta nella stampa, non nel payload');
  assert.equal(p.num, 'D-12');
  assert.deepEqual(p.domanda, DOMANDA);
  assert.deepEqual(p.registro, FASCICOLO.registro);
  assert.equal(p.compito, 'C-3');
});

test('il ruolo riceve un testo intero, col contratto dei worker e i suoi comandi', () => {
  const t = readRoleInstructions('risposta');
  assert.ok(t.length > 2000);
  assert.ok(!/<!--\s*includi:/i.test(t), 'nessun richiamo rimasto dentro');
  assert.match(t, /Contratto comune dei worker/);
  assert.match(t, /domanda\.mjs" chiudi --testo -|domanda\.mjs chiudi --testo -/);
  assert.match(t, /release <biglietto> --role risposta/);
  assert.match(t, /consenso dell'owner/);
});

function finto(risposte = {}) {
  const consegne = [];
  const out = [];
  const err = [];
  const io = {
    biglietto: async () => (risposte.biglietto === undefined ? 'biglietto-del-giro' : risposte.biglietto),
    risposta: async (t, data) => { consegne.push({ t, data }); return typeof risposte.canale === 'function' ? risposte.canale(data) : (risposte.canale || { outcome: 'ok', reply: { outcome: 'ok' } }); },
    chiama: async () => { throw new Error('il compito non usa le credenziali dell’owner'); },
    stdin: async () => risposte.stdin || '',
    scrivi: (s) => out.push(String(s)),
    errore: (s) => err.push(String(s)),
  };
  return { io, consegne, out, err };
}

test('argomenti dei comandi del compito: forme ammesse, consenso rifiutato prima del canale', () => {
  assert.deepEqual(leggiArgomenti(['mostra']), { cmd: 'mostra', delCompito: true });
  assert.deepEqual(leggiArgomenti(['chiarimento', '--testo', '-']), { cmd: 'chiarimento', testo: '-' });
  assert.deepEqual(leggiArgomenti(['chiudi', '--testo=fatto', '--principio', 'Una regola.']), { cmd: 'chiudi', testo: 'fatto', principio: 'Una regola.' });
  assert.deepEqual(leggiArgomenti(['azione', '{"tipo":"riprendi","feedbackId":"f1"}', '--testo', 'nota']), { cmd: 'azione', azione: { tipo: 'riprendi', feedbackId: 'f1' }, testo: 'nota' });
  assert.match(leggiArgomenti(['azione', '{"tipo":"approva_locale","feedbackId":"f1"}']).errore, /azione_di_consenso/);
  assert.match(leggiArgomenti(['azione', '{"tipo":"automazione","chiave":"routine.enabled","valore":false}']).errore, /azione_non_del_compito/);
  assert.match(leggiArgomenti(['azione', '{tipo:']).errore, /non è JSON valido/);
  assert.ok(leggiArgomenti(['chiarimento']).errore, 'senza testo');
  assert.ok(leggiArgomenti(['note', '--principio', 'x']).errore, '--principio vale solo con chiudi');
  assert.ok(leggiArgomenti(['chiudi', '--testo', 'x', '--principio', '-']).errore);
});

test('col canale finto: il chiarimento parte col testo da stdin; il vuoto e il consenso non partono', async () => {
  const f = finto({ stdin: 'Vuoi i test anche su Mac?\n', canale: { outcome: 'ok', reply: { outcome: 'chiarimento' } } });
  assert.equal(await esegui(['chiarimento', '--testo', '-'], f.io), 0);
  assert.deepEqual(f.consegne, [{ t: 'biglietto-del-giro', data: { op: 'chiarimento', testo: 'Vuoi i test anche su Mac?\n' } }]);
  assert.match(f.out.join('\n'), /la domanda torna all'owner/);

  const vuoto = finto({ stdin: '   ' });
  assert.equal(await esegui(['chiarimento', '--testo', '-'], vuoto.io), 1);
  assert.equal(vuoto.consegne.length, 0);

  const consenso = finto();
  assert.equal(await esegui(['azione', '{"tipo":"approva_locale","feedbackId":"f1"}'], consenso.io), 1);
  assert.equal(consenso.consegne.length, 0, 'un’azione di consenso non arriva nemmeno al canale');
  assert.match(consenso.err.join('\n'), /consenso dell'owner/);
});

test('col canale finto: azione e chiusura col principio, rifiuti e guasti con le loro uscite', async () => {
  const az = finto({ canale: { outcome: 'ok', reply: { outcome: 'applicata', azione: 'riprendi', accodata: true } } });
  assert.equal(await esegui(['azione', '{"tipo":"riprendi","feedbackId":"f1"}', '--testo', 'per chi riprende'], az.io), 0);
  assert.deepEqual(az.consegne[0].data, { op: 'azione', azione: { tipo: 'riprendi', feedbackId: 'f1' }, testo: 'per chi riprende' });
  assert.match(az.out.join('\n'), /riprendi applicata .*prossimo giro/);

  const chiudi = finto({ stdin: 'Ripreso #813.' });
  assert.equal(await esegui(['chiudi', '--testo', '-', '--principio', 'Un lavoro ripreso porta la risposta intera.'], chiudi.io), 0);
  assert.deepEqual(chiudi.consegne[0].data, { op: 'chiudi', testo: 'Ripreso #813.', principio: 'Un lavoro ripreso porta la risposta intera.' });

  const rifiuto = finto({ canale: { outcome: 'refused', reason: 'domanda_cambiata', detail: 'l’owner ha scritto dopo la tua lettura' } });
  assert.equal(await esegui(['chiudi', '--testo', 'fatto'], rifiuto.io), 1);
  assert.match(rifiuto.err.join('\n'), /RIFIUTATO dal server: domanda_cambiata: l’owner ha scritto/);

  const giu = finto({ canale: { outcome: 'fault', reason: 'http_503' } });
  assert.equal(await esegui(['note', '--testo', 'x'], giu.io), 3);

  const senza = finto({ biglietto: '' });
  assert.equal(await esegui(['chiudi', '--testo', 'fatto'], senza.io), 1);
  assert.equal(senza.consegne.length, 0);
  assert.match(senza.err.join('\n'), /biglietto del compito/);
});

test('mostra senza domanda rilegge dal canale e stampa domanda, note e registro', async () => {
  const f = finto({ canale: { outcome: 'ok', reply: FASCICOLO } });
  assert.equal(await esegui(['mostra'], f.io), 0);
  assert.deepEqual(f.consegne[0].data, { op: 'mostra' });
  const s = f.out.join('\n');
  assert.match(s, /D-12/);
  assert.match(s, /Riprendilo, ma prima i test\./);
  assert.match(s, /Note per gli agenti/);
  assert.match(s, /Registro delle decisioni \(1\)/);
  assert.match(s, /Zero fiducia nei crediti dichiarati dal client\./);
  assert.match(s, /1 di domande non fidate non ti arrivano/);
  assert.match(formattaFascicolo({ affidata: false, motivo: 'chiusa' }), /rilascia il biglietto/);
  const senza = formattaFascicolo({ ...FASCICOLO, registro: { voci: [], altre: 0, nonFidateTolte: 0, assente: 'Il registro arriva solo nell’ambiente dei riservati.' } });
  assert.match(senza, /Il registro arriva solo nell’ambiente dei riservati\./);
  assert.doesNotMatch(senza, /nessun principio ancora/);
});
