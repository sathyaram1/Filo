// L'intervista di benvenuto rifatta vede solo la sua conversazione (#1398): con le chat degli ultimi giorni davanti e
// il prompt che dice «prima conversazione», il modello rispondeva «buona fortuna col test!» a chi non ne aveva parlato.
// Le chat normali non perdono niente: il punto d'inizio del tratto resta il loro.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { cartellaTemporanea, togliCartella } from '../helpers/percorsi.mjs';
import '../../src/shared/contenutoEsterno.js';
import '../../src/shared/chatArchive.js';
import '../../src/shared/filoEventi.js';
import '../../src/shared/filoApp.js';
import '../../src/shared/filoContesto.js';
import '../../src/shared/constants.js';

const require = createRequire(import.meta.url);
globalThis.SN_CONST = { ...(globalThis.SN_CONST || {}), STORAGE_KEYS: { ...((globalThis.SN_CONST || {}).STORAGE_KEYS || {}), FILO_CHATS: 'filo_chats' } };
globalThis.chrome = { storage: { local: { async get(k) { return { [k]: undefined }; }, async set() {}, async remove() {} } } };

const { creaFilo } = require('../../src/main/services/ilFilo.js');
require('../../src/main/services/filoChats.js');
const Contesto = require('../../src/main/services/contestoFilo.js');
const E = globalThis.SN_FILO_EVENTI;

const cartelle = [];
after(() => { for (const c of cartelle) togliCartella(c); });

const TETTI = { giorni: 3, token: 100000 };
const faMinuti = (m) => new Date(Date.now() - m * 60000).toISOString();
const osserva = (azioni) => azioni.map((a) => JSON.stringify(a._output || {})).join('\n');

function azzera() {
  const cartella = cartellaTemporanea('intervista-sola-');
  cartelle.push(cartella);
  globalThis.SN_IL_FILO = creaFilo({ cartella });
  Contesto.dimentica(null);
  Contesto.azzeraAncore();
  return globalThis.SN_IL_FILO;
}

const aperte = new Set();
async function scrivi(f, chat, role, text, minutiFa) {
  const ts = faMinuti(minutiFa);
  const ev = [];
  if (!aperte.has(chat)) { aperte.add(chat); ev.push(E.crea(E.TIPI.CHAT_APERTA, { chat }, { ts, dispositivo: 'd' })); }
  ev.push(E.crea(E.TIPI.MESSAGGIO, { chat, msg: { role, text } }, { ts, dispositivo: 'd' }));
  await f.importa(ev.map(E.riga).join(''));
}

const vede = async (chatId, userMessage, soloChat = false) => JSON.stringify((await Contesto.componi({
  chatId, userMessage, storia: [], tetti: TETTI, osserva, incognito: false, soloChat,
})).messaggi);

test('l’intervista vede solo sé stessa; la chat normale di prima e di dopo vede ancora tutto il filo', async () => {
  const f = azzera();
  await scrivi(f, 'lavoro', 'user', 'sto facendo un test del timer, mettine uno di prova', 2 * 24 * 60);
  await scrivi(f, 'lavoro', 'filo', 'Timer di prova messo: TIMER-DI-PROVA.', 2 * 24 * 60 - 1);
  await scrivi(f, 'altra', 'user', 'ricetta della carbonara', 60);
  await scrivi(f, 'altra', 'filo', 'Guanciale, uova, pecorino.', 59);
  const prima = await vede('altra', 'e per quattro?');
  assert.match(prima, /TIMER-DI-PROVA/, 'la chat normale ha davanti le altre conversazioni del filo');

  await scrivi(f, 'onb-1', 'filo', 'Ciao, sono Filo. Chi sei?', 5);
  await scrivi(f, 'onb-1', 'user', 'sono il creatore di Filo, ci lavoro con Claude Code', 4);
  const intervista = await vede('onb-1', 'sono il creatore di Filo, ci lavoro con Claude Code', true);
  assert.match(intervista, /Ciao, sono Filo/, 'l’intervista ha davanti la sua conversazione');
  assert.doesNotMatch(intervista, /TIMER-DI-PROVA|test del timer|carbonara|Guanciale/, 'l’intervista ha davanti le altre chat');

  const dopo = await vede('altra', 'e per sei?');
  assert.match(dopo, /TIMER-DI-PROVA/, 'dopo un turno dell’intervista la chat normale ha perso il filo di prima');
  assert.match(dopo, /Guanciale/);
});
