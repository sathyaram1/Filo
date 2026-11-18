// Si segnala solo quello che l'utente ha chiesto e l'assistente non ha fatto (#2371, #2348, #2364): la regola sul
// messaggio, la mappa degli strumenti del manifesto, e l'invio anonimo uno per voce e per versione.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('../../src/shared/capabilities.js');
require('../../src/shared/autoFeedback.js');
const AF = globalThis.SN_AUTO_FEEDBACK;
const Caps = globalThis.SN_CAPABILITIES;
const CAPS = Caps.all();

// #2348: una riflessione sui default dell'interfaccia, e una risposta che a parole nomina menu e impostazioni.
const RIFLESSIONE = 'che sia ereditato non significa che non sia una scelta. i colori della selezione, le animazioni '
  + 'dello scorrimento: Apple li ha decisi decenni fa e tutti li tengono per inerzia, nessuno si chiede più se servono';
const RISPOSTA_ALLA_RIFLESSIONE = 'Hai ragione: ereditare un default è una scelta per omissione. Le convenzioni restano '
  + 'perché nessuno le rimette in discussione; in Filo colori e animazioni li trovi in Preferenze, nella sezione Aspetto.';

test('#2348: un messaggio che riflette, senza chiedere niente, non fa nascere nessuna segnalazione', () => {
  const a = AF.analyzeReply(RISPOSTA_ALLA_RIFLESSIONE, [], RIFLESSIONE, CAPS);
  assert.equal(a.kind, null);
  assert.equal(AF.composeProposal(a, { userMessage: RIFLESSIONE, textReply: RISPOSTA_ALLA_RIFLESSIONE }), null);
  assert.equal(AF.compose(a), null);
});

test('una richiesta vera di una funzione senza strumento fa nascere la proposta, che la nomina', () => {
  const chiesto = 'aprimi una finestra in incognito';
  const reply = 'Per aprire una finestra in incognito premi Ctrl+Shift+N oppure clicca l\'icona Nuova finestra '
    + 'incognito nella barra laterale: lì quello che visiti non resta.';
  const a = AF.analyzeReply(reply, [], chiesto, CAPS);
  assert.equal(a.kind, 'capability-uncommandable');
  const p = AF.composeProposal(a, { userMessage: chiesto, textReply: reply });
  assert.equal(p.type, 'INVIA_FEEDBACK');
  assert.match(p.testo, /«Finestra in incognito»/);
});

test('chiedeAzione: comandi, richieste cortesi e «non riesco a» sì; riflessioni e domande di istruzioni no', () => {
  const si = [
    'passa alla scheda dopo', 'riapri l\'ultima scheda chiusa', 'salvala per dopo', 'cerca questa immagine',
    'ok, metti il tema scuro', 'Filo, chiudi le schede di youtube', 'puoi passare alla scheda dopo?',
    'mi salvi questa pagina?', 'vorrei che la salvassi', 'fammi vedere le schede chiuse', 'non riesco a tradurre la pagina',
    'per favore riaprila',
  ];
  const no = [
    RIFLESSIONE, 'secondo me il tema chiaro è più leggibile', 'interessante, non ci avevo mai pensato',
    'si passa sempre dalla stessa schermata', 'vorrei capire perché lo fa', 'puoi spiegarmi come funziona?', '',
  ];
  for (const t of si) assert.equal(AF.chiedeAzione(t), true, t);
  for (const t of no) assert.equal(AF.chiedeAzione(t), false, t);
});

// #2349: «metti il tema scuro» più una domanda sul feedback → tema cambiato, nessuna risposta.
test('domandaOltreAlComando: una domanda accanto al comando sì, il comando detto come domanda no', () => {
  assert.equal(AF.domandaOltreAlComando('metti il tema scuro. Cos\'è quel feedback che mi hai proposto?'), true);
  assert.equal(AF.domandaOltreAlComando('metti il tema scuro e dimmi quante schede ho aperto'), true);
  assert.equal(AF.domandaOltreAlComando('puoi mettere il tema scuro?'), false);
  assert.equal(AF.domandaOltreAlComando('metti il tema scuro'), false);
  assert.equal(AF.domandaOltreAlComando(''), false);
});

// #2364: «Salva la pagina per dopo» esiste; citata dopo un «non posso» non diventa mai una funzione mancante.
test('#2364: una voce del manifesto citata dopo «non posso» non è mai «non disponibile»', () => {
  const reply = 'Non posso farlo io da qui: «Salva la pagina per dopo» lo trovi nella barra laterale, è l\'icona col segnalibro.';
  const a = AF.analyzeReply(reply, [], 'salvala per dopo', CAPS);
  assert.notEqual(a.kind, 'capability-gap');
  if (a.genericDesc) assert.doesNotMatch(a.genericDesc, /non disponibile/);
});

test('le voci segnalate l\'8 novembre che hanno uno strumento non diventano «non sa azionare»', () => {
  const voci = ['switch-tab-next-prev', 'reopen-closed-tab', 'save-for-later', 'search-image', 'site-own-menu',
    'spellcheck', 'google-account', 'fila-tasto-destro'];
  for (const id of voci) {
    const s = Caps.STRUMENTO[id];
    assert.ok(s && s !== Caps.SOLO_A_MANO, `${id}: nessuno strumento della chat la comanda`);
    const cap = CAPS.find((c) => c.id === id);
    const reply = `Non posso farlo da qui: «${cap.title}» lo trovi nel menu del tasto destro, clicca la voce e fai tu.`;
    assert.equal(AF.analyzeReply(reply, [], 'fallo tu adesso', CAPS).kind, null, id);
  }
});

test('invio anonimo: tre turni uguali sulla stessa voce ne mandano uno; con una versione nuova di nuovo uno', () => {
  const chiave = AF.chiaveInvio({ kind: 'capability-uncommandable', capabilityId: 'switch-tab-next-prev' });
  let registro;
  const partiti = [];
  for (let i = 0; i < 3; i++) {
    const r = AF.primoInvio(registro, '1.4.10', chiave);
    registro = r.registro;
    partiti.push(r.invia);
  }
  assert.deepEqual(partiti, [true, false, false]);
  assert.equal(AF.primoInvio(registro, '1.4.10', AF.chiaveInvio({ kind: 'complaint' })).invia, true, 'un\'altra voce parte');
  const nuova = AF.primoInvio(registro, '1.4.11', chiave);
  assert.equal(nuova.invia, true);
  assert.equal(AF.primoInvio(nuova.registro, '1.4.11', chiave).invia, false);
});
