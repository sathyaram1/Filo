// Unit test per la rete di sicurezza del "buco muto" (#419) — logica pura in
// src/shared/autoFeedback.js.
//
// Il caso: l'assistente NON ammette niente. La funzione esiste nel manifesto
// delle capacità, l'utente chiede di farla, e lui — che non ha un'azione per
// comandarla — spiega a parole dove cliccare. Quella risposta è indistinguibile
// da una riuscita, quindi finché la segnalazione dipendeva solo dal fatto che
// il modello si ricordasse di emetterla, il buco poteva restare invisibile.
//
// Senza il rilevamento deterministico questi test sono rossi: analyzeReply
// ritorna { kind: null } e nessuna proposta viene composta.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('../../src/shared/capabilities.js');
require('../../src/shared/autoFeedback.js');
const AF = globalThis.SN_AUTO_FEEDBACK;
// Il manifesto VERO: la rete deve reggere sulle capacità reali di Filo, non su
// un elenco finto costruito attorno al test.
const CAPS = globalThis.SN_CAPABILITIES.all();

// Una voce che nessuno strumento della chat comanda (capabilities.js, STRUMENTO: SOLO_A_MANO).
const CHIESTO = 'ricarica la pagina';
const SPIEGAZIONE_MANUALE =
  'Per ricaricare la pagina clicca il pulsante Ricarica nella barra laterale, oppure '
  + 'premi Ctrl+R: la pagina si carica di nuovo con quello che il sito mostra adesso.';

test('spiegazione manuale di una capacità esistente = buco muto riconosciuto', () => {
  const a = AF.analyzeReply(SPIEGAZIONE_MANUALE, [], CHIESTO, CAPS);
  assert.equal(a.kind, 'capability-uncommandable');
  assert.equal(a.capabilityId, 'reload');
  assert.equal(a.capabilityTitle, 'Ricarica la pagina');
});

// #2371: le voci che hanno uno strumento non sono «non sa azionare» (lì è il modello che doveva usarlo).
test('una voce con lo strumento della chat non diventa mai «non sa azionare»', () => {
  const casi = [
    ['metti Filo a schermo intero', 'Per andare a schermo intero clicca l\'icona con le due frecce in alto a destra '
      + 'nella barra di Filo, oppure premi F11: la finestra occupa tutto lo schermo e la barra si riduce.'],
    ['ingrandisci la pagina', 'Per ingrandire la pagina premi Ctrl e + sulla tastiera, oppure tieni premuto Ctrl '
      + 'e usa la rotella del mouse: la pagina si ingrandisce di un passo alla volta.'],
  ];
  for (const [u, r] of casi) assert.equal(AF.analyzeReply(r, [], u, CAPS).kind, null, u);
});

test('vale anche per altre capacità del manifesto', () => {
  const casi = [
    {
      user: 'traduci questa pagina in italiano',
      reply: 'Per tradurre la pagina apri il menu del tasto destro e scegli "Traduci pagina": '
        + 'la traduzione prende il posto del testo originale e puoi tornare indietro quando vuoi.',
      cap: 'translate-page',
    },
    {
      user: 'mostrami il qr code della pagina',
      reply: 'Il QR code della pagina lo trovi nella barra laterale: clicca l\'icona "QR code" '
        + 'e compare il codice da inquadrare col telefono per aprire la stessa pagina.',
      cap: 'qr-code',
    },
  ];
  for (const c of casi) {
    const a = AF.analyzeReply(c.reply, [], c.user, CAPS);
    assert.equal(a.kind, 'capability-uncommandable', c.user);
    assert.equal(a.capabilityId, c.cap, c.user);
  }
});

test('se nel turno l\'assistente ha AGITO non c\'è nessun buco', () => {
  const a = AF.analyzeReply(SPIEGAZIONE_MANUALE, [{ type: 'APRI_URL' }], CHIESTO, CAPS);
  assert.equal(a.kind, null);
});

test('a chi chiede istruzioni le istruzioni si danno: nessuna segnalazione', () => {
  const domande = [
    'come faccio a mettere Filo a schermo intero?',
    'dove si trova il pulsante per andare a schermo intero?',
    'si può mettere Filo a schermo intero?',
    'cosa sai fare?',
  ];
  for (const q of domande) {
    assert.equal(AF.analyzeReply(SPIEGAZIONE_MANUALE, [], q, CAPS).kind, null, q);
  }
});

// #474 — sulla risposta vera (lo zoom spiegato a parole) la proposta c'è solo se
// l'utente voleva che la cosa si facesse, non se chiedeva.
const ZOOM_A_PAROLE = 'Per ingrandire la pagina premi Ctrl e + sulla tastiera, oppure tieni premuto Ctrl '
  + 'e usa la rotella del mouse: la pagina si ingrandisce di un passo alla volta.';

test('#474: le domande comuni, con ogni grafia, non fanno partire la proposta', () => {
  const domande = [
    'è possibile ingrandire la pagina?',
    'c\'è un modo per ingrandire la pagina?',
    'qual è il modo per ingrandire la pagina?',
    'sai ingrandire la pagina?',
    'puoi dirmi come ingrandire la pagina?',
    'dimmi come ingrandire la pagina',
    // le tre già riconosciute e la variante con l'apostrofo
    'come faccio a ingrandire la pagina?',
    'dove si trova lo zoom della pagina?',
    'cosa sai fare?',
    'e\' possibile ingrandire la pagina?',
    // grafie equivalenti: apostrofo tipografico, maiuscole, «qual'è», accento acuto
    'C’è un modo per ingrandire la pagina?',
    'E’ POSSIBILE ingrandire la pagina?',
    'qual\'è il modo per ingrandire la pagina?',
    'é possibile ingrandire la pagina?',
    'c\'e\' un modo per ingrandire la pagina?',
  ];
  for (const q of domande) {
    assert.equal(AF.analyzeReply(ZOOM_A_PAROLE, [], q, CAPS).kind, null, q);
  }
});

test('#474: chi segnala un guasto vero riceve ancora la proposta', () => {
  const guasti = [
    'non funziona lo zoom',
    'la pagina non si ingrandisce',
    'non riesco a ingrandire la pagina',
    'non è possibile ingrandire la pagina',
    'non si può ingrandire la pagina',
    'non sai ingrandire la pagina',
    'ingrandisci la pagina',
  ];
  for (const u of guasti) {
    const a = AF.analyzeReply(ZOOM_A_PAROLE, [], u, CAPS);
    assert.equal(a.kind, 'capability-uncommandable', u);
    assert.equal(a.capabilityId, 'page-zoom', u);
  }
});

test('una risposta senza indicazioni manuali non diventa un buco', () => {
  const risposte = [
    'Lo schermo intero di Filo nasconde la barra delle schede e lascia solo la pagina: '
      + 'è comodo quando guardi un video o leggi un articolo lungo senza distrazioni.',
    'Ci sono tre schede aperte in questo momento: due su Wikipedia e una su GitHub, '
      + 'e nessuna di queste sta riproducendo audio adesso.',
  ];
  for (const r of risposte) {
    assert.equal(AF.analyzeReply(r, [], CHIESTO, CAPS).kind, null, r);
  }
});

test('l\'ammissione esplicita resta il caso di prima (non viene scavalcata)', () => {
  const reply = 'Non sono in grado di mettere Filo a schermo intero da qui: puoi farlo tu '
    + 'cliccando l\'icona in alto a destra nella barra.';
  assert.equal(AF.analyzeReply(reply, [], CHIESTO, CAPS).kind, 'capability-gap');
});

test('composeProposal → segnalazione già scritta che dice "esiste ma non l\'ha fatta"', () => {
  const a = AF.analyzeReply(SPIEGAZIONE_MANUALE, [], CHIESTO, CAPS);
  const p = AF.composeProposal(a, { userMessage: CHIESTO, textReply: SPIEGAZIONE_MANUALE });
  assert.ok(p, 'nessuna proposta composta');
  assert.equal(p.type, 'INVIA_FEEDBACK');
  // Cita la richiesta dell'utente: senza, la segnalazione non è azionabile.
  assert.match(p.testo, /schermo intero/i);
  // Dice il punto: la funzione c'è, è l'assistente che non la sa azionare.
  assert.match(p.testo, /sa fare questa cosa/i);
  assert.ok(p.titolo && p.titolo.length <= 60, `titolo strano: ${p.titolo}`);
});

test('la segnalazione anonima resta generica e distinta dai buchi "non esiste"', () => {
  const a = AF.analyzeReply(SPIEGAZIONE_MANUALE, [], CHIESTO, CAPS);
  const auto = AF.compose(a);
  assert.ok(auto, 'nessun auto-feedback composto');
  // Nessun testo dell'utente nella segnalazione che parte senza chiedere.
  assert.doesNotMatch(auto.text, /metti Filo/i);
  assert.match(auto.clientId, /^auto:capability-gap:uncommandable-fullscreen$/);
  assert.equal(auto.capabilityGapId, 'uncommandable-fullscreen');
});

test('una parola sola in comune non basta a dire "è questa capacità"', () => {
  // "pagina" compare, ma non identifica nessuna capacità: nessun falso positivo.
  const reply = 'Questa pagina parla di alberi da frutto; se vuoi te la riassumo, '
    + 'oppure dimmi tu quale parte ti interessa e la guardiamo insieme adesso.';
  assert.equal(AF.analyzeReply(reply, [], 'di cosa parla?', CAPS).kind, null);
});
