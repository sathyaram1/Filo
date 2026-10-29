// Verifica #1562 — giro 1, rilievo 1: un messaggio già mandato al modello torna diverso nei turni dopo, e il tratto
// vivo non cresce più solo in coda (cache rotta da lì, ragionamento delle risposte dopo non rimandato).
// Tre porte: la riga di una conversazione dell'Editor che conta i messaggi, un messaggio lunghissimo intero nel suo
// turno e accorciato dopo, la diciassettesima immagine che toglie la prima.

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
globalThis.SN_CONST = { ...globalThis.SN_CONST, STORAGE_KEYS: { ...globalThis.SN_CONST.STORAGE_KEYS, FILO_CHATS: 'filo_chats' } };
globalThis.chrome = { storage: { local: { async get(k) { return { [k]: undefined }; }, async set() {}, async remove() {} } } };
const { creaFilo } = require('../../../src/main/services/ilFilo.js');
require('../../../src/main/services/filoChats.js');
require('../../../src/main/services/conversazioniApp.js');
const Contesto = require('../../../src/main/services/contestoFilo.js');

const { PROMPTS } = globalThis.SN_CONST;
const FC = globalThis.SN_FILO_CONTESTO;
const TV = globalThis.SN_TRATTO_VIVO;
const Chats = globalThis.SN_FILO_CHATS;
const CA = globalThis.SN_CONVERSAZIONI_APP;
const TETTI = { giorni: 3, token: 100000 };
const SEZIONI = TV.sezioniUtente({ sistema: 'linux', capacita: globalThis.SN_CAPABILITIES.renderIndexForPrompt(), profilo: 'Si chiama Mario.' });

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

// Un turno come lo compone il main: domanda nel filo, tratto, fotografia, domanda resa; la risposta torna col suo giro.
async function turno({ chat = 'ab12', testo, minutiFa, immagini = null }) {
  const dopo = await Chats.append(chat, { role: 'user', text: testo, ts: fa(minutiFa), ...(immagini ? { images: immagini.length } : {}) });
  if (immagini) Contesto.ricordaImmagini(chat, dopo.messages.at(-1).ts, immagini);
  const componi = () => Contesto.componi({ chatId: chat, userMessage: testo, storia: [], tetti: TETTI, osserva: () => '', incognito: false });
  let c = await componi();
  const foto = Contesto.fotografa({ incognito: false, sezioni: SEZIONI, ancora: c.ancora, durata: '1h' });
  if (foto.epoca !== c.epoca) c = await componi();
  const domanda = c.domanda({ stato: foto.cambiate, epoca: foto.epoca, immagini });
  const messages = FC.richiesta({ sistema: PROMPTS.filoChatStatic() + foto.testo, tratto: c.messaggi, domanda });
  const r = await Chats.append(chat, { role: 'filo', text: `Risposta a ${testo.slice(0, 20)}.`, ts: fa(minutiFa - 0.5) });
  const risposta = r.messages.at(-1);
  Contesto.ricordaGiro(chat, risposta.ts, { messaggi: [], testo: risposta.text, reasoningDetails: [], azioni: [], seguiti: [] });
  return messages;
}

// Il primo messaggio della richiesta di prima che la richiesta dopo ha riscritto, -1 se è il suo prefisso.
function riscritto(prima, dopo) {
  return prima.findIndex((m, i) => JSON.stringify(m) !== JSON.stringify(dopo[i]));
}

test('r1 la riga di una conversazione dell\'Editor che continua non riscrive i turni già mandati', async () => {
  azzera();
  await turno({ testo: 'ciao', minutiFa: 30 });
  await CA.annota({ app: 'editor', rif: 'doc1', soggetto: 'Tesi', messaggi: [{ role: 'user', text: 'riassumi' }, { role: 'filo', text: 'ecco' }] });
  const due = await turno({ testo: 'secondo', minutiFa: -5 });
  await CA.annota({ app: 'editor', rif: 'doc1', soggetto: 'Tesi', messaggi: [{ role: 'user', text: 'accorcia' }, { role: 'filo', text: 'fatto' }] });
  const tre = await turno({ testo: 'terzo', minutiFa: -10 });
  expect(riscritto(due, tre), 'il turno 3 riscrive un messaggio del turno 2').toBe(-1);
});

test('r1 un messaggio lunghissimo mandato intero non torna accorciato al turno dopo', async () => {
  azzera();
  await turno({ testo: 'ciao', minutiFa: 30 });
  const due = await turno({ testo: `${'parola '.repeat(20000)}fine`, minutiFa: 20 });
  const tre = await turno({ testo: 'ok', minutiFa: 10 });
  expect(riscritto(due, tre), 'il turno 3 riscrive un messaggio del turno 2').toBe(-1);
});

test('r1 un\'immagine oltre il tetto non riscrive il tratto dal primo messaggio a ogni foto nuova', async () => {
  azzera();
  const img = (i) => `data:image/png;base64,${'A'.repeat(100)}${i}`;
  const richieste = [];
  for (let i = 0; i < 20; i++) richieste.push(await turno({ testo: `foto ${i}`, minutiFa: 60 - i * 2, immagini: [img(i)] }));
  // Una volta al tetto si può tagliare a scatti, come per i token: non a ogni messaggio con una foto.
  const rotture = [];
  for (let i = 1; i < richieste.length; i++) if (riscritto(richieste[i - 1], richieste[i]) !== -1) rotture.push(i);
  expect(rotture.length, `il tratto si riscrive ai turni ${rotture.join(', ')}`).toBeLessThanOrEqual(1);
});
