// #1685 — un sì o un no dato al bottone dopo il turno chiude la voce aperta nella risposta che l'aveva proposta: riaperta,
// la chat e il modello leggono com'è finita lì, e non resta una risposta di Filo senza parole.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
for (const f of ['contenutoEsterno.js', 'nomiFile.js', 'timeFormat.js', 'actionLevels.js', 'esitoAzione.js', 'righeAttivita.js', 'chatArchive.js', 'filoEventi.js']) {
  require(join(ROOT, 'src', 'shared', f));
}
const E = globalThis.SN_ESITO;
const FE = globalThis.SN_FILO_EVENTI;

function chatDa(messaggi) {
  const stato = FE.nuovoStato();
  let t = Date.parse('2026-11-04T10:00:00Z');
  FE.applica(stato, FE.crea(FE.TIPI.CHAT_APERTA, { chat: 'c1' }, { autore: 'utente', ts: new Date(t).toISOString() }));
  for (const msg of messaggi) {
    t += 1000;
    FE.applica(stato, FE.crea(FE.TIPI.MESSAGGIO, { chat: 'c1', msg }, { autore: msg.role === 'user' ? 'utente' : 'filo', ts: new Date(t).toISOString() }));
  }
  return stato.chat.get('c1');
}
const nota = (voce, actions = []) => ({ role: 'filo', text: '', actions, esiti: [voce], confermaDopo: true });

test('un OK dato dopo il turno prende il posto della conferma chiesta, senza una risposta vuota a parte', () => {
  const c = chatDa([
    { role: 'user', text: 'crea la cartella' },
    { role: 'filo', text: 'Creo la cartella.', esiti: [{ type: 'ESEGUI_COMANDO', esito: 'chiesto', riga: 'Creo la cartella nuova' }] },
    nota({ type: 'ESEGUI_COMANDO', esito: 'fatto', riga: 'Comando eseguito · mkdir nuova', proposta: 'Creo la cartella nuova' }, ['ESEGUI_COMANDO']),
  ]);
  assert.equal(c.messages.length, 2);
  assert.deepEqual(c.messages[1].esiti, [{ type: 'ESEGUI_COMANDO', esito: 'fatto', riga: 'Comando eseguito · mkdir nuova' }]);
  assert.deepEqual(c.messages[1].actions, ['ESEGUI_COMANDO']);
  assert.match(E.perModello(c.messages[1].esiti), /- fatta: Comando eseguito · mkdir nuova/);
  assert.doesNotMatch(E.perModello(c.messages[1].esiti), /non l'aveva ancora data/);
});

test('un no resta come no; un sì dato dopo il no lo sostituisce', () => {
  const chiesta = { type: 'IMPOSTA_PREFERENZA', esito: 'chiesto', riga: 'Filo vuole impostare: Modalità terminale → attiva' };
  const no = E.voceArchivio({ type: 'IMPOSTA_PREFERENZA', _confirm: { text: 'Filo vuole impostare: Modalità terminale → attiva' }, _rifiutata: true });
  assert.equal(no.esito, 'fallito');
  assert.equal(no.motivo, E.MOTIVO_NO);
  const c = chatDa([
    { role: 'user', text: 'accendi il terminale' },
    { role: 'filo', text: '', esiti: [chiesta] },
    nota({ ...no, proposta: chiesta.riga }),
  ]);
  assert.equal(c.messages.length, 2);
  assert.equal(c.messages[1].esiti[0].esito, 'fallito');
  assert.match(E.perModello(c.messages[1].esiti), /NON riuscita: .*perché: detto no alla conferma/);
  const dopo = chatDa([
    { role: 'user', text: 'accendi il terminale' },
    { role: 'filo', text: '', esiti: [chiesta] },
    nota({ ...no, proposta: chiesta.riga }),
    nota({ type: 'IMPOSTA_PREFERENZA', esito: 'fatto', riga: 'Modalità terminale attivata', proposta: chiesta.riga }, ['IMPOSTA_PREFERENZA']),
  ]);
  assert.equal(dopo.messages.length, 2);
  assert.equal(dopo.messages[1].esiti[0].esito, 'fatto');
});

test('due conferme nella stessa risposta: ognuna chiude la sua, anche nell\'ordine inverso', () => {
  const c = chatDa([
    { role: 'user', text: 'crea uno e due' },
    { role: 'filo', text: 'Le creo.', esiti: [
      { type: 'ESEGUI_COMANDO', esito: 'chiesto', riga: 'Creo la cartella uno' },
      { type: 'ESEGUI_COMANDO', esito: 'chiesto', riga: 'Creo la cartella due' },
    ] },
    nota({ type: 'ESEGUI_COMANDO', esito: 'fatto', riga: 'Comando eseguito · mkdir due', proposta: 'Creo la cartella due' }, ['ESEGUI_COMANDO']),
  ]);
  assert.deepEqual(c.messages[1].esiti.map((v) => v.esito + ':' + v.riga), ['chiesto:Creo la cartella uno', 'fatto:Comando eseguito · mkdir due']);
});

test('un evento aggiunto col bottone chiude la proposta; senza una proposta aperta la riga resta a parte', () => {
  const evento = E.voceArchivio({ type: 'EVENTO_CALENDARIO', esito: 'proposto', riga: 'Evento proposto · Dentista', evento: { data: '2026-12-01', titolo: 'Dentista', ora: '10:00' } });
  assert.deepEqual(evento.evento, { data: '2026-12-01', titolo: 'Dentista', ora: '10:00' }, 'la proposta tiene i dati per ridisegnare il bottone');
  const c = chatDa([
    { role: 'user', text: 'dentista' },
    { role: 'filo', text: 'Ecco l\'evento.', esiti: [evento] },
    nota({ type: 'EVENTO_CALENDARIO', esito: 'compiuto', riga: 'Evento aggiunto al calendario · Dentista' }, ['EVENTO_CALENDARIO']),
  ]);
  assert.equal(c.messages.length, 2);
  assert.equal(c.messages[1].esiti[0].esito, 'compiuto');
  const sola = chatDa([
    { role: 'user', text: 'ciao' },
    { role: 'filo', text: 'Ciao.' },
    nota({ type: 'TIMER', esito: 'fatto', riga: 'Timer avviato' }, ['TIMER']),
  ]);
  assert.equal(sola.messages.length, 3);
  assert.equal(sola.messages[2].confermaDopo, true);
});
