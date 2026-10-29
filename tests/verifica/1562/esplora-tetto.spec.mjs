// Esplorazione #1562 giro 2: quanti turni restano com'erano prima che la memoria dei giri li dimentichi.

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
const Tools = globalThis.SN_ACTION_TOOLS;
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

async function turno({ chat = 'ab12', testo, minutiFa, conGiro = false }) {
  await Chats.append(chat, { role: 'user', text: testo, ts: fa(minutiFa) });
  const componi = () => Contesto.componi({ chatId: chat, userMessage: testo, storia: [], tetti: TETTI, osserva: () => '', incognito: false });
  let c = await componi();
  const foto = Contesto.fotografa({ incognito: false, sezioni: SEZIONI, ancora: c.ancora, durata: '1h' });
  if (foto.epoca !== c.epoca) c = await componi();
  const domanda = c.domanda({ stato: foto.cambiate, epoca: foto.epoca });
  const messages = FC.richiesta({ sistema: PROMPTS.filoChatStatic() + foto.testo, tratto: c.messaggi, domanda });
  const r = await Chats.append(chat, { role: 'filo', text: `Fatto ${testo}.`, ts: fa(minutiFa - 0.2) });
  const risposta = r.messages.at(-1);
  const rd = [{ type: 'reasoning.text', text: `pensiero ${testo}`, signature: `firma ${testo}`, format: 'anthropic-claude-v1', index: 0 }];
  const extra = conGiro
    ? [Tools.assistantMessage({ text: '', toolCalls: [{ id: `c${testo}`, name: 'TIMER', arguments: '{"minuti":5}' }], reasoningDetails: rd }), Tools.toolMessage(`c${testo}`, 'timer messo')]
    : [];
  Contesto.ricordaEsiti(chat, risposta.ts, { azioni: [], reasoningDetails: rd });
  Contesto.ricordaGiro(chat, risposta.ts, { messaggi: extra, testo: risposta.text, reasoningDetails: rd, azioni: [], seguiti: [] });
  return messages;
}

function riscritto(prima, dopo) {
  return prima.findIndex((m, i) => JSON.stringify(m) !== JSON.stringify(dopo[i]));
}

test('esplora: trecentoventi turni brevi in tre giorni', async () => {
  test.setTimeout(600000);
  azzera();
  const rotture = [];
  let prima = null;
  for (let i = 0; i < 320; i++) {
    const r = await turno({ testo: `t${i}`, minutiFa: 2000 - i * 6, conGiro: i % 2 === 0 });
    if (prima) { const k = riscritto(prima, r); if (k !== -1) rotture.push(`${i}@${k}/${prima.length}`); }
    prima = r;
  }
  console.log('rotture', rotture.length, rotture.slice(0, 30).join(' '));
  console.log('ultimo', prima.length, 'messaggi', Math.round(JSON.stringify(prima).length / 3.5), 'token circa');
  expect(rotture.length).toBe(0);
});
