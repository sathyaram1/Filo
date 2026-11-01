// Verifica #1562 giro 2, rilievo 1: una pagina delicata (o della rete di casa) fra le cose successe prima del primo
// messaggio del tratto che esce dalla finestra dei giorni non deve riscrivere quel messaggio a cache calda: una pagina
// normale non lo fa. Logica pura sul filo vero in una cartella temporanea, come tests/unit/richiestaChat.test.mjs.

import { test, expect } from '../../fixtures/electron.mjs';
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
require('../../../src/shared/filoAccaduti.js');
require('../../../src/shared/urlNav.js');
require('../../../src/main/services/providers/openrouter.js');
globalThis.SN_CONST = { ...globalThis.SN_CONST, STORAGE_KEYS: { ...globalThis.SN_CONST.STORAGE_KEYS, FILO_CHATS: 'filo_chats' } };
globalThis.chrome = { storage: { local: { async get(k) { return { [k]: undefined }; }, async set() {}, async remove() {} } } };

const { creaFilo } = require('../../../src/main/services/ilFilo.js');
require('../../../src/main/services/filoChats.js');
require('../../../src/main/services/conversazioniApp.js');
const Contesto = require('../../../src/main/services/contestoFilo.js');

const C = globalThis.SN_CONST;
const { ACTIONS, PROMPTS } = C;
const E = globalThis.SN_FILO_EVENTI;
const FC = globalThis.SN_FILO_CONTESTO;
const TV = globalThis.SN_TRATTO_VIVO;
const OR = globalThis.SN_PROVIDER_OPENROUTER;
const Tools = globalThis.SN_ACTION_TOOLS;
const Chats = globalThis.SN_FILO_CHATS;
const HAIKU = 'anthropic/claude-haiku-5.5';
const CAPS = globalThis.SN_CAPABILITIES.renderIndexForPrompt();
const TETTI = { giorni: 3, token: 100000 };
const STRUMENTI = Tools.definitions();

const cartelle = [];
test.afterAll(() => { for (const c of cartelle) togliCartella(c); });

const json = (x) => JSON.stringify(x);
const sezioni = TV.sezioniUtente({ sistema: 'linux', capacita: CAPS, profilo: 'Si chiama Mario.', statoSezioni: [{ chiave: 'TAB APERTE', testo: 'TAB APERTE\n1. Gmail' }] });
const H = 3600e3;
const realNow = Date.now.bind(Date);
async function turno(chat, testo, t) {
  Date.now = () => t;
  try {
    await Chats.append(chat, { role: 'user', text: testo, ts: new Date(t).toISOString() });
    const componi = () => Contesto.componi({ chatId: chat, userMessage: testo, storia: [], tetti: TETTI, osserva: () => '', incognito: false, ora: t });
    let c = await componi();
    const foto = Contesto.fotografa({ incognito: false, sezioni, ancora: c.ancora, durata: '1h', ora: t });
    if (foto.epoca !== c.epoca) c = await componi();
    const domanda = c.domanda({ stato: foto.cambiate, epoca: foto.epoca });
    const messages = FC.richiesta({ sistema: PROMPTS.filoChatStatic() + foto.testo, tratto: c.messaggi, domanda });
    await Chats.append(chat, { role: 'filo', text: `Risposta a ${testo}`, ts: new Date(t + 20000).toISOString() });
    return { messages, foto };
  } finally { Date.now = realNow; }
}

test('r1 la finestra dei giorni che passa una pagina delicata davanti al primo messaggio non riscrive il tratto a cache calda', async () => {
  const prima = globalThis.SN_DELICATE;
  globalThis.SN_DELICATE = { filtro: async () => (url) => (/mail\.example/.test(url) ? 'posta' : null) };
  try {
    const cartella = cartellaTemporanea('giro2-r1-');
    cartelle.push(cartella);
    globalThis.SN_IL_FILO = creaFilo({ cartella });
    Contesto.dimentica(null);
    Contesto.azzeraAncore();
    const f = globalThis.SN_IL_FILO;
    // Il taglio dei giorni si sposta a scatti di sei ore: la posta sta nello scatto prima del primo messaggio.
    const P = 6 * H;
    const B = Math.floor(realNow() / P) * P - 4 * 24 * H;
    await f.registraVisita({ url: 'https://mail.example/inbox', titolo: 'Posta', ts: new Date(B + 1 * H).toISOString() });
    await f.registraVisita({ url: 'https://it.wikipedia.org/wiki/Foca', titolo: 'Foca', ts: new Date(B + 7 * H - 60000).toISOString() });
    await turno('ab12', 'ciao', B + 7 * H);
    const D = 3 * 24 * H;
    await turno('ab12', 'come va', B + D - 20 * 60000);
    const tre = await turno('ab12', 'bene', B + D - 10 * 60000);
    // Venti minuti dopo il taglio passa la posta: il primo messaggio resta nel tratto, la cache è calda.
    const quattro = await turno('ab12', 'ancora', B + D + 10 * 60000);
    expect(quattro.foto.nuova).toBe(false);
    expect(json(quattro.messages.slice(0, tre.messages.length)), 'il tratto si è riscritto dal primo messaggio').toBe(json(tre.messages));
  } finally { globalThis.SN_DELICATE = prima; }
});
