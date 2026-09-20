// Unit test del magazzino delle chat con Filo (#525,
// src/main/services/filoChats.js): quello che scrive davvero su disco.
//
// Due cose che il magazzino deve garantire e che la logica pura non può:
//   • due scritture che partono insieme non si mangiano a vicenda (ogni
//     scrittura rilegge tutto e riscrive tutto: senza una fila, la seconda
//     cancella la prima);
//   • una domanda riprovata dopo un errore non finisce scritta due volte.
//
// Niente Electron: `chrome.storage.local` è un finto in memoria, con la
// scrittura volutamente lenta per allargare la finestra in cui due scritture
// si accavallano. Senza quel ritardo la prova passerebbe per fortuna.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import '../../src/shared/chatArchive.js';

const require = createRequire(import.meta.url);

globalThis.SN_CONST = { STORAGE_KEYS: { FILO_CHATS: 'filo_chats' } };

let disco = {};
let ritardoScrittura = 0;
globalThis.chrome = {
  storage: {
    local: {
      // Lettura immediata, come il magazzino vero (i dati stanno già in
      // memoria); la SCRITTURA invece ci mette un attimo. È in quell'attimo
      // che una seconda scrittura rilegge una lista vecchia e poi ci scrive
      // sopra: la finestra del guasto, resa larga abbastanza da vedersi.
      async get(key) {
        return { [key]: disco[key] };
      },
      async set(obj) {
        if (ritardoScrittura) await new Promise((r) => setTimeout(r, ritardoScrittura));
        Object.assign(disco, obj);
      },
    },
  },
};

require('../../src/main/services/filoChats.js');
const Store = globalThis.SN_FILO_CHATS;

function azzera() {
  disco = {};
  ritardoScrittura = 0;
}

const turno = (role, text, ts) => ({ role, text, ts });

// ── Le scritture si mettono in fila ──────────────────────────────────────────

test('tre chat che nascono insieme si salvano tutte e tre', async () => {
  azzera();
  ritardoScrittura = 5; // la finestra in cui due scritture si accavallano
  // Archivio vuoto: è il caso di chi usa Filo da poco, e quello in cui la
  // scrittura non condivide nemmeno la lista con le altre.
  await Promise.all([
    Store.append('a', turno('user', 'Prima domanda', '2026-09-20T10:00:00.000Z')),
    Store.append('b', turno('user', 'Seconda domanda', '2026-09-20T10:00:01.000Z')),
    Store.append('c', turno('user', 'Terza domanda', '2026-09-20T10:00:02.000Z')),
  ]);
  const chats = await Store.list();
  assert.deepEqual(chats.map((c) => c.id).sort(), ['a', 'b', 'c']);
});

test('domanda e risposta che arrivano insieme nella stessa chat restano tutte e due', async () => {
  azzera();
  ritardoScrittura = 5;
  await Store.append('x', turno('user', 'Apro la chat', '2026-09-20T10:00:00.000Z'));
  await Promise.all([
    Store.append('x', turno('user', 'Una domanda', '2026-09-20T10:00:01.000Z')),
    Store.append('x', turno('filo', 'Una risposta', '2026-09-20T10:00:02.000Z')),
  ]);
  const chat = await Store.get('x');
  assert.equal(chat.messages.length, 3, 'un messaggio è andato perso');
});

test('una cancellazione partita insieme a una scrittura non resuscita la chat cancellata', async () => {
  azzera();
  ritardoScrittura = 5;
  await Store.append('viva', turno('user', 'Resto qui', '2026-09-20T10:00:00.000Z'));
  await Store.append('morta', turno('user', 'Vado via', '2026-09-20T10:00:01.000Z'));
  await Promise.all([
    Store.remove('morta'),
    Store.append('viva', turno('filo', 'Va bene', '2026-09-20T10:00:02.000Z')),
  ]);

  const chats = await Store.list();
  assert.deepEqual(chats.map((c) => c.id), ['viva']);
  assert.equal(chats[0].messages.length, 2);
});

// ── «Riprova» dopo un errore ─────────────────────────────────────────────────

test('la stessa domanda riprovata subito dopo un turno fallito si scrive una volta sola', async () => {
  azzera();
  await Store.append('r', turno('user', 'Spiegami la fotosintesi', '2026-09-20T10:00:00.000Z'));
  // Il turno è fallito: nessuna risposta. L'utente preme «Riprova».
  await Store.append('r', turno('user', 'Spiegami la fotosintesi', '2026-09-20T10:00:09.000Z'));
  await Store.append('r', turno('filo', 'Ecco come funziona.', '2026-09-20T10:00:12.000Z'));

  const chat = await Store.get('r');
  assert.deepEqual(chat.messages.map((m) => m.text), [
    'Spiegami la fotosintesi',
    'Ecco come funziona.',
  ]);
});

test('la stessa frase ripetuta DOPO una risposta è un messaggio nuovo e resta', async () => {
  azzera();
  await Store.append('r', turno('user', 'continua', '2026-09-20T10:00:00.000Z'));
  await Store.append('r', turno('filo', 'Vado avanti.', '2026-09-20T10:00:01.000Z'));
  await Store.append('r', turno('user', 'continua', '2026-09-20T10:00:02.000Z'));
  await Store.append('r', turno('filo', 'Ancora avanti.', '2026-09-20T10:00:03.000Z'));

  const chat = await Store.get('r');
  assert.deepEqual(chat.messages.map((m) => m.text), [
    'continua', 'Vado avanti.', 'continua', 'Ancora avanti.',
  ]);
});

test('due domande diverse di fila restano due', async () => {
  azzera();
  await Store.append('r', turno('user', 'Prima', '2026-09-20T10:00:00.000Z'));
  await Store.append('r', turno('user', 'Seconda', '2026-09-20T10:00:01.000Z'));
  const chat = await Store.get('r');
  assert.deepEqual(chat.messages.map((m) => m.text), ['Prima', 'Seconda']);
});

// ── La targa dell'intervista di benvenuto ────────────────────────────────────

test('la targa dell’intervista la dice un posto solo, e non cambia a ogni lettura', async () => {
  require('../../src/shared/onboarding.js');
  const O = globalThis.SN_ONBOARDING;
  assert.equal(typeof O.chatId, 'function');
  const stato = { startedAt: '2026-09-20T09:00:00.000Z' };
  assert.equal(O.chatId(stato), O.chatId({ ...stato }));
  // Intervista mai cominciata: una targa c'è lo stesso, e non è "undefined".
  assert.equal(O.chatId({}), 'onb-prima');
  assert.equal(O.chatId(null), 'onb-prima');
  assert.notEqual(O.chatId(stato), O.chatId({ startedAt: '2026-09-21T09:00:00.000Z' }));
});

// ── Una chat chiusa la riapre solo l'utente ─────────────────────────────────
//
// Se l'utente chiede qualcosa e se ne va prima di leggere (torna alla home,
// chiude la scheda), la risposta arriva quando la chat è già chiusa. Quella
// risposta si salva, ma non è una conversazione ripresa: rimettendo la chat
// «in corso» restava aperta per sempre, senza titolo generato e invisibile a
// Filo, che quando gli si chiede di riprendere una discussione guarda solo le
// chat finite.

test('la risposta che arriva a chat chiusa si salva e la chat resta chiusa', async () => {
  azzera();
  await Store.append('t', turno('user', 'Domanda lunga', '2026-09-20T10:00:00.000Z'));
  const chiusa = await Store.close('t');
  assert.ok(chiusa.closedAt);

  await Store.append('t', turno('filo', 'Risposta in ritardo', '2026-09-20T10:00:09.000Z'));
  const dopo = await Store.get('t');
  assert.deepEqual(dopo.messages.map((m) => m.text), ['Domanda lunga', 'Risposta in ritardo']);
  assert.equal(dopo.closedAt, chiusa.closedAt);
  // E va riclassificata: il titolo di mezza conversazione non vale per tutta.
  assert.equal(Store.needsTriage(dopo), true);
});

test('l’utente che scrive di nuovo in una chat chiusa la riapre', async () => {
  azzera();
  await Store.append('t', turno('user', 'Prima', '2026-09-20T10:00:00.000Z'));
  await Store.close('t');
  await Store.append('t', turno('user', 'Ci ripenso', '2026-09-20T11:00:00.000Z'));
  const dopo = await Store.get('t');
  assert.equal(dopo.closedAt, null);
});
