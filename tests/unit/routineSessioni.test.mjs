// Unit test di src/shared/routineSessioni.js (SN_ROUTINE_SESSIONI): le regole
// su quante sessioni delle routine partono insieme, da quale account e quali
// account sono esclusi. Le applicano sia la pagina di gestione sia il main.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('../../src/shared/constants.js');
require('../../src/shared/routineSessioni.js');
const RS = globalThis.SN_ROUTINE_SESSIONI;
const A = globalThis.SN_CONST.AUTOMATION;

test('l\'intervallo delle sessioni è suo, non quello dei bilanci', () => {
  assert.equal(A.MAX_SESSIONS_MIN, 1, 'zero sarebbe un interruttore master di nascosto');
  assert.equal(A.MAX_SESSIONS_MAX, 20);
  assert.equal(A.MAX_SESSIONS_DEFAULT, 1);
  assert.notEqual(A.MAX_SESSIONS_MIN, A.CAP_MIN, 'i bilanci partono da 0, le sessioni no');
  assert.notEqual(A.MAX_SESSIONS_MAX, A.CAP_MAX);
});

test('un documento senza i campi vale come il comportamento di oggi', () => {
  assert.deepEqual(RS.leggiDoc({}), {
    maxSessions: 1, priorityAccount: '', accountAOff: false, accountBOff: false,
  });
  assert.deepEqual(RS.leggiDoc(null), RS.leggiDoc({}));
  assert.deepEqual(RS.leggiDoc(undefined), RS.leggiDoc({}));
});

test('il documento si legge com\'è, e un valore storto non fa esplodere la pagina', () => {
  assert.deepEqual(RS.leggiDoc({
    maxSessions: 7, priorityAccount: 'B', accountAOff: true, accountBOff: false,
  }), { maxSessions: 7, priorityAccount: 'B', accountAOff: true, accountBOff: false });
  // Firestore rende gli interi come stringhe: «5» è cinque, non un guasto.
  assert.equal(RS.leggiDoc({ maxSessions: '5' }).maxSessions, 5);
  assert.equal(RS.leggiDoc({ maxSessions: 99 }).maxSessions, 20, 'in lettura si riporta nell\'intervallo');
  assert.equal(RS.leggiDoc({ maxSessions: 0 }).maxSessions, 1);
  assert.equal(RS.leggiDoc({ maxSessions: 'tante' }).maxSessions, 1);
  assert.equal(RS.leggiDoc({ priorityAccount: 'C' }).priorityAccount, '');
  assert.equal(RS.leggiDoc({ accountAOff: 'sì' }).accountAOff, false, 'solo un vero booleano esclude');
});

test('si scrivono SOLO i campi ricevuti', () => {
  assert.deepEqual(RS.valida({}), { ok: true, valori: {} });
  assert.deepEqual(RS.valida({ accountBOff: true }), { ok: true, valori: { accountBOff: true } });
  assert.deepEqual(RS.valida({ maxSessions: 4 }), { ok: true, valori: { maxSessions: 4 } });
  const tutti = RS.valida({ maxSessions: 3, priorityAccount: 'A', accountAOff: false, accountBOff: true });
  assert.deepEqual(tutti.valori, { maxSessions: 3, priorityAccount: 'A', accountAOff: false, accountBOff: true });
});

test('le sessioni fuori intervallo si rifiutano dicendo l\'intervallo, senza correggere', () => {
  for (const storto of [0, -3, 21, 100, 1.5, '', '   ', 'tre', '1e400', NaN, true]) {
    const esito = RS.valida({ maxSessions: storto });
    assert.equal(esito.ok, false, `${String(storto)} non deve passare`);
    assert.match(esito.testo, /da 1 a 20/, 'il rifiuto dice qual è l\'intervallo');
    assert.equal(esito.valori, undefined, 'niente valore = niente scrittura');
  }
  // Gli estremi sono validi, e la virgola all'italiana si legge.
  assert.equal(RS.valida({ maxSessions: 1 }).valori.maxSessions, 1);
  assert.equal(RS.valida({ maxSessions: '20' }).valori.maxSessions, 20);
  assert.equal(RS.valida({ maxSessions: ' 6 ' }).valori.maxSessions, 6);
  assert.equal(RS.valida({ maxSessions: '2,0' }).valori.maxSessions, 2);
});

test('l\'account prioritario è A, B o nessuno dei due', () => {
  for (const buono of ['', 'A', 'B']) {
    assert.equal(RS.valida({ priorityAccount: buono }).valori.priorityAccount, buono);
  }
  for (const storto of ['a', 'C', 'AB', 1, true, ' ']) {
    const esito = RS.valida({ priorityAccount: storto });
    assert.equal(esito.ok, false, `${String(storto)} non è un account`);
    assert.match(esito.testo, /Non salvato/);
  }
});

test('un interruttore vuole un booleano vero, non «true» scritto a mano', () => {
  assert.deepEqual(RS.valida({ accountAOff: false }).valori, { accountAOff: false });
  for (const storto of ['true', 1, 0, 'off']) {
    assert.equal(RS.valida({ accountAOff: storto }).ok, false);
    assert.equal(RS.valida({ accountBOff: storto }).ok, false);
  }
});

test('esclusi tutti e due: nessuna sessione parte, e si può sapere', () => {
  assert.equal(RS.nessunAccount({ accountAOff: true, accountBOff: true }), true);
  assert.equal(RS.nessunAccount({ accountAOff: true, accountBOff: false }), false);
  assert.equal(RS.nessunAccount(RS.leggiDoc({})), false);
  // Escludere il prioritario non è un caso da segnalare: il server passa all'altro.
  assert.equal(RS.nessunAccount(RS.leggiDoc({ priorityAccount: 'A', accountAOff: true })), false);
});

test('escluso il prioritario, si sa quale account resta (verifica giro 1)', () => {
  // Due controlli che dicono il contrario vanno spiegati: la pillola «Prima A»
  // accesa e l'interruttore di A spento non si leggono insieme.
  assert.equal(RS.prioritarioIgnorato({ priorityAccount: 'A', accountAOff: true }), 'B');
  assert.equal(RS.prioritarioIgnorato({ priorityAccount: 'B', accountBOff: true }), 'A');
  // La priorità vale ancora: niente da dire.
  assert.equal(RS.prioritarioIgnorato({ priorityAccount: 'A', accountBOff: true }), '');
  assert.equal(RS.prioritarioIgnorato({ priorityAccount: 'A' }), '');
  assert.equal(RS.prioritarioIgnorato({ accountAOff: true }), '', 'senza priorità non c\'è niente da ignorare');
  assert.equal(RS.prioritarioIgnorato({}), '');
  // Esclusi tutti e due non «resta» nessuno: lo dice l'altro avviso.
  assert.equal(RS.prioritarioIgnorato({ priorityAccount: 'A', accountAOff: true, accountBOff: true }), '');
});

// ── Le pause in corso, a parole (#996) ─────────────────────────────────────
const ORA = new Date(2026, 9, 17, 10, 0).getTime();
const ORE = 60 * 60 * 1000;

test('una pausa per un rifiuto dice fino a quando e perché, col messaggio di claude.ai', () => {
  const p = RS.pausaInParole('Account B', { finoMs: ORA + 3 * ORE, perche: 'http_429', dettaglio: 'Daily routine run limit reached', strikes: 1, oggi: 16 }, ORA);
  assert.equal(p.testo, 'Account B in pausa fino alle 13:00: troppe accensioni per claude.ai (HTTP 429). «Daily routine run limit reached»');
  assert.match(p.dettaglio, /raddoppia a ogni rifiuto di fila, fino a un giorno/);
  assert.match(p.dettaglio, /Accensioni di oggi su quell'account: 16\./);
});

test('il motivo per ogni esito: crediti, token, rete, giro nato morto, codici sconosciuti', () => {
  assert.equal(RS.motivoPausa('http_402'), 'crediti finiti (HTTP 402)');
  assert.equal(RS.motivoPausa('http_401'), 'claude.ai rifiuta il token di accensione (HTTP 401)');
  assert.equal(RS.motivoPausa('network'), 'claude.ai non raggiungibile');
  assert.equal(RS.motivoPausa('dead_round'), 'accesa, ma la sessione non è partita');
  assert.equal(RS.motivoPausa('http_418'), 'claude.ai ha rifiutato l\'accensione (HTTP 418)');
  assert.equal(RS.motivoPausa('http_503'), 'claude.ai in errore (HTTP 503)');
  assert.equal(RS.motivoPausa(undefined), 'accensione non riuscita');
  assert.equal(RS.motivoPausa('<b>x</b>'), 'accensione non riuscita', 'un esito sconosciuto non arriva sullo schermo');
});

test('pause lunghe: domani, o la data; scadute o sporche non diventano una riga', () => {
  const sera = new Date(2026, 9, 17, 22, 0).getTime();
  assert.match(RS.pausaInParole('Account A', { finoMs: sera + 12 * ORE, perche: 'dead_round', strikes: 3 }, sera).testo,
    /^Account A in pausa fino a domani alle 10:00: accesa, ma la sessione non è partita\.$/);
  assert.match(RS.pausaInParole('Account A', { finoMs: ORA + 50 * ORE, perche: 'network' }, ORA).testo, /fino al 19 ottobre alle 12:00/);
  // Giri nati morti: claude.ai non ha rifiutato niente, e l'hover non lo dice.
  const morti = RS.pausaInParole('Account A', { finoMs: ORA + ORE, perche: 'dead_round', strikes: 3 }, ORA).dettaglio;
  assert.match(morti, /^3 accensioni di fila senza sessione/);
  assert.doesNotMatch(morti, /rifiut/i);
  assert.doesNotMatch(RS.pausaInParole('Account A', { finoMs: ORA + ORE, perche: 'dead_round', strikes: 1 }, ORA).dettaglio, /rifiut/i);
  assert.match(RS.pausaInParole('Account A', { finoMs: ORA + ORE, perche: 'http_429', strikes: 3 }, ORA).dettaglio, /^3 rifiuti di fila/);
  assert.equal(RS.pausaInParole('Account A', { finoMs: ORA - 1, perche: 'http_429' }, ORA), null);
  assert.equal(RS.pausaInParole('Account A', null, ORA), null);
  assert.equal(RS.pausaInParole('Account A', { finoMs: 'domani' }, ORA), null);
  // La routine server senza account noto non inventa un conto del giorno.
  assert.doesNotMatch(RS.pausaInParole('La routine server', { finoMs: ORA + ORE, perche: 'http_429', account: '', oggi: 0 }, ORA).dettaglio, /Accensioni di oggi/);
  assert.match(RS.pausaInParole('La routine server (account B)', { finoMs: ORA + ORE, perche: 'http_429', account: 'B', oggi: 4 }, ORA).dettaglio, /oggi su quell'account: 4/);
});
