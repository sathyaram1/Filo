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

test('domandaOltreAlComando: «spiegami», «non l\'ho capito», la domanda senza «?» o dopo una virgola sono domande', () => {
  const si = [
    'metti il tema scuro e spiegami cosa era quel feedback che mi hai proposto',
    'metti il tema scuro. perché mi hai proposto quel feedback',
    'apri youtube, quanti video ho visto oggi?',
    'metti il tema scuro; ho letto quel feedback più volte e non l\'ho capito',
    'metti il tema scuro e mi spieghi quel feedback?',
  ];
  const no = ['metti il tema scuro, ok?', 'metti il tema scuro e chiudi youtube?', 'metti il tema come prima',
    'cerca come si cucina il riso', 'apri il sito, per favore', 'imposta il timer: 5 minuti'];
  for (const t of si) assert.equal(AF.domandaOltreAlComando(t), true, t);
  for (const t of no) assert.equal(AF.domandaOltreAlComando(t), false, t);
});

// #2593: senza un comando la domanda è la richiesta, e l'azione che il modello sceglie le risponde (#1130).
test('domandaOltreAlComando: una domanda sola non è «oltre al comando»; chi chiede di spiegare sì', () => {
  for (const t of ['dov\'è la ricevuta dell\'assicurazione?', 'guarda lo schermo e dimmi cosa vedi', 'cosa c’è nella finestra del conto?']) {
    assert.equal(AF.domandaOltreAlComando(t), false, t);
  }
  assert.equal(AF.domandaOltreAlComando('non ho capito quel feedback, spiegamelo'), true);
});

test('una domanda di parere è discussione: nessuna segnalazione; una che chiede un dato resta una richiesta', () => {
  const casi = [
    ['non trovi strano che tutti i browser abbiano le schede in alto?',
      'Sì, è una convenzione dei vecchi schermi. Al momento non è possibile spostarle in Filo, ma è un\'idea interessante.'],
    ['che sia ereditato non significa che non sia una scelta, no? Apple li ha decisi decenni fa',
      'Hai ragione: ereditare un default è una scelta per omissione. C\'è un problema con le convenzioni: nessuno le discute.'],
    ['secondo te perché nessuno cambia il colore della selezione?', 'Per inerzia: non ho modo di sapere perché, ma succede.'],
    ['mi piacerebbe un mondo senza pubblicità, tu che dici?', 'Sarebbe bello. Non è previsto che Filo blocchi tutto.'],
  ];
  for (const [u, r] of casi) assert.equal(AF.analyzeReply(r, [], u, CAPS).kind, null, u);
  assert.equal(AF.analyzeReply('Non ho accesso ai passi che fai durante il giorno: Filo non legge il contapassi del telefono.',
    [], 'quanti passi ho fatto oggi?', CAPS).kind, 'capability-gap');
});

// #2364: «Salva la pagina per dopo» esiste e ha il suo strumento: dopo un «non posso» non diventa mai una funzione mancante.
test('#2364: una voce del manifesto citata o descritta dopo «non posso» non fa nascere nessuna segnalazione', () => {
  for (const reply of [
    'Non posso fare questa cosa da qui: «Salva la pagina per dopo» lo trovi nella barra laterale, è l\'icona col segnalibro.',
    'Mi dispiace, non posso fare il salvataggio da qui: premi Alt+S e la ritrovi in Aperti per dopo.',
  ]) {
    const a = AF.analyzeReply(reply, [], 'salvala per dopo', CAPS);
    assert.equal(a.kind, null, reply);
    assert.equal(AF.composeProposal(a, { userMessage: 'salvala per dopo', textReply: reply }), null);
    assert.equal(AF.compose(a), null);
  }
});

test('le voci segnalate l\'8 novembre che hanno uno strumento non diventano «non sa azionare»', () => {
  const voci = ['switch-tab-next-prev', 'reopen-closed-tab', 'save-for-later', 'search-image', 'site-own-menu',
    'spellcheck', 'google-account', 'fila-tasto-destro'];
  for (const id of voci) {
    const s = Caps.STRUMENTO[id];
    assert.ok(s && s !== Caps.SOLO_A_MANO, `${id}: nessuno strumento della chat la comanda`);
    const cap = CAPS.find((c) => c.id === id);
    const spiega = `«${cap.title}» lo trovi nel menu del tasto destro: clicca la voce e scegli quello che ti serve, ci metti un attimo.`;
    assert.equal(AF.analyzeReply(spiega, [], 'fallo tu adesso', CAPS).kind, null, id);
    const rifiuto = AF.analyzeReply(`Non posso farlo da qui: ${spiega}`, [], 'fallo tu adesso', CAPS);
    assert.notEqual(rifiuto.kind, 'capability-uncommandable', id);
    assert.equal(rifiuto.capabilityId || null, null, id);
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
