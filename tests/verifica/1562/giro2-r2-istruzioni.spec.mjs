// Verifica #1562 — giro 2, rilievo 2: con la richiesta nuova alcune istruzioni al modello descrivono la richiesta di
// prima: sezioni dello STATO che la chat non riceve più (TEMPO, CAMBI RECENTI) e una batteria «letta adesso» che è
// quella di quando il CONTESTO è stato scritto.

import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { cartellaTemporanea, togliCartella } from '../../helpers/percorsi.mjs';

const require = createRequire(import.meta.url);
require('../../../src/shared/capabilities.js');
require('../../../src/shared/constants.js');
require('../../../src/shared/contenutoEsterno.js');
require('../../../src/shared/chatArchive.js');
require('../../../src/shared/filoEventi.js');
require('../../../src/shared/filoApp.js');
require('../../../src/shared/filoContesto.js');
require('../../../src/shared/filoTrattoVivo.js');
require('../../../src/shared/cambi.js');
require('../../../src/shared/actionLevels.js');
require('../../../src/shared/actionTools.js');
require('../../../src/shared/sistema.js');
require('../../../src/shared/filoState.js');
globalThis.SN_CONST = { ...globalThis.SN_CONST, STORAGE_KEYS: { ...globalThis.SN_CONST.STORAGE_KEYS, FILO_CHATS: 'filo_chats' } };
globalThis.chrome = { storage: { local: { async get(k) { return { [k]: undefined }; }, async set() {}, async remove() {} } } };
const { creaFilo } = require('../../../src/main/services/ilFilo.js');
require('../../../src/main/services/filoChats.js');
const Contesto = require('../../../src/main/services/contestoFilo.js');

const { PROMPTS } = globalThis.SN_CONST;
const FC = globalThis.SN_FILO_CONTESTO;
const TV = globalThis.SN_TRATTO_VIVO;
const FS = globalThis.SN_FILO_STATE;
const Chats = globalThis.SN_FILO_CHATS;
const Tools = globalThis.SN_ACTION_TOOLS;
const TETTI = { giorni: 3, token: 100000 };

const cartelle = [];
test.afterAll(() => { for (const c of cartelle) togliCartella(c); });
function azzera() {
  const cartella = cartellaTemporanea('verifica-1562-');
  cartelle.push(cartella);
  globalThis.SN_IL_FILO = creaFilo({ cartella });
  Contesto.dimentica(null);
  Contesto.azzeraAncore();
}
const fa = (min) => new Date(Date.now() - min * 60000).toISOString();

// Lo STATO come lo riceve la chat (le sezioni del turno), con la batteria al livello dato.
const statoChat = (batteria) => FS.sezioni({
  tabs: [{ id: 1, title: 'Gmail', url: 'https://mail.google.com/', active: true }], timers: [], notifications: [],
  sistema: { batteria: { livello: batteria, inCarica: false, collegata: false }, rete: { online: true, tipo: 'cavo' } },
}, { perChat: true });
const sezioni = (batteria) => TV.sezioniUtente({ sistema: 'linux', profilo: 'Si chiama Mario.', statoSezioni: statoChat(batteria) });

async function turno({ chat = 'ab12', testo, minutiFa, batteria }) {
  await Chats.append(chat, { role: 'user', text: testo, ts: fa(minutiFa) });
  const componi = () => Contesto.componi({ chatId: chat, userMessage: testo, storia: [], tetti: TETTI, osserva: () => '', incognito: false });
  let c = await componi();
  const foto = Contesto.fotografa({ incognito: false, sezioni: sezioni(batteria), ancora: c.ancora, durata: '1h' });
  if (foto.epoca !== c.epoca) c = await componi();
  const domanda = c.domanda({ stato: foto.cambiate, epoca: foto.epoca });
  const messages = FC.richiesta({ sistema: PROMPTS.filoChatStatic() + foto.testo, tratto: c.messaggi, domanda });
  const r = await Chats.append(chat, { role: 'filo', text: 'Ok.', ts: fa(minutiFa - 0.2) });
  Contesto.ricordaGiro(chat, r.messages.at(-1).ts, { messaggi: [], testo: 'Ok.', reasoningDetails: [], azioni: [], seguiti: [] });
  return messages;
}
const testoDi = (m) => (typeof m.content === 'string' ? m.content : (m.content || []).map((p) => p.text || '').join(''));

test('r2 le sezioni dello STATO che gli strumenti nominano ci sono nello STATO della chat', () => {
  const strumenti = JSON.stringify(Tools.definitions());
  const chiavi = statoChat(80).map((s) => s.chiave);
  const nominate = ['TEMPO', 'CAMBI RECENTI'].filter((k) => strumenti.includes(`${k} dello STATO`));
  const mancano = nominate.filter((k) => !chiavi.includes(k));
  expect(mancano, `gli strumenti mandano il modello a sezioni che non riceve: ${mancano.join(', ')}`).toEqual([]);
});

test('r2 «quanta batteria ho?» un\'ora dopo: il modello ha davanti la batteria di adesso, non quella del CONTESTO', async () => {
  azzera();
  await turno({ testo: 'ciao', minutiFa: 50, batteria: 84 });
  const dopo = await turno({ testo: 'quanta batteria ho?', minutiFa: 0, batteria: 75 });
  const tutto = dopo.map(testoDi).join('\n');
  expect(tutto, 'il modello legge 84% come «letto dal computer adesso»').toContain('Batteria: 75%');
});
