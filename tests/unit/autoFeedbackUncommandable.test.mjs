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

const CHIESTO = 'metti Filo a schermo intero';
const SPIEGAZIONE_MANUALE =
  'Per andare a schermo intero clicca l\'icona con le due frecce in alto a destra '
  + 'nella barra di Filo, oppure premi F11: la finestra occupa tutto lo schermo e la '
  + 'barra si riduce.';

test('spiegazione manuale di una capacità esistente = buco muto riconosciuto', () => {
  const a = AF.analyzeReply(SPIEGAZIONE_MANUALE, [], CHIESTO, CAPS);
  assert.equal(a.kind, 'capability-uncommandable');
  assert.equal(a.capabilityId, 'fullscreen');
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
      user: 'salva questa pagina per dopo',
      reply: 'Puoi salvare la pagina per dopo dal menu del tasto destro, alla voce "Salva per dopo": '
        + 'la ritrovi poi nell\'elenco delle pagine salvate quando ti serve.',
      cap: 'save-for-later',
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
  const reply = 'Non posso mettere Filo a schermo intero da qui: puoi farlo tu cliccando '
    + 'l\'icona in alto a destra nella barra.';
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
