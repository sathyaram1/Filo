// Verifica #585, giro 1 — la porta rimasta aperta: chi invia un percorso non
// si presenta.
//
// Il feedback chiede che un percorso entri nella raccolta solo passando dal
// cammino che lo ripulisce: «autenticazione o, se i mittenti restano anonimi,
// scrittura mediata dal server che applica la pulizia E LIMITI DI FREQUENZA PER
// IDENTITÀ». La prima metà è fatta: dalle regole non scrive più nessun client.
// La seconda no. Quando Filo manda un percorso al server:
//
//   • l'ID token che allega è quello del LOGIN GOOGLE, che è opzionale e che
//     quasi nessuno ha fatto: senza login `google-auth.getIdToken()` risponde
//     null, e la richiesta parte senza `Authorization`;
//   • il `clientId`, che nei commenti del codice è «l'identità per i limiti di
//     frequenza», la sidebar lo manda sempre vuoto.
//
// Risultato: al server arriva una richiesta senza niente da limitare, tranne
// l'IP. E l'identità ci sarebbe: ogni copia di Filo ha già un account Firebase
// anonimo (`src/main/auth/anon-auth.js`, quello del portafoglio), con un token
// che il server VERIFICA. Costa una riga e non chiede nessun login.
//
// Questa prova è ROSSA finché l'invio non allega quell'identità. È la porta:
// chi corregge la richiude e la prova diventa verde.

import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

const googleAuth = require(join(ROOT, 'src', 'main', 'auth', 'google-auth.js'));
const anonAuth = require(join(ROOT, 'src', 'main', 'auth', 'anon-auth.js'));

require(join(ROOT, 'src', 'shared', 'capabilities.js'));
require(join(ROOT, 'src', 'shared', 'constants.js'));
require(join(ROOT, 'src', 'shared', 'messages.js'));

const MSG = globalThis.SN_MSG || globalThis.SN_MESSAGES;

// Fa partire il solo handler che ci interessa (SAVE_PATH) con tutto il resto
// finto, e restituisce quello che è arrivato alla pipeline di invio.
async function inviaUnPercorso() {
  const handlers = new Map();
  const on = (tipo, fn) => handlers.set(tipo, fn);

  let ricevuto = null;
  globalThis.SN_PATHS_COLLECTOR = {
    collectAndSave: async (args) => { ricevuto = args; return { saved: true, id: 'x' }; },
  };
  globalThis.SN_PROVIDERS = globalThis.SN_PROVIDERS || {};
  globalThis.SN_COSTS = globalThis.SN_COSTS || {};
  globalThis.SN_WEB_SEARCH = globalThis.SN_WEB_SEARCH || {};

  const register = require(join(ROOT, 'src', 'main', 'services', 'handlers', 'ai.js'));
  register(on, {
    MSG: MSG.MSG || MSG,
    handleAIRequest: async () => ({ text: 'ok' }),
    getEffectiveSettings: async () => ({ provider: 'openrouter', apiKeys: { openrouter: 'k' } }),
    modelForAction: () => '', buildAttemptChain: () => [], providerRouting: () => ({}),
    openWeightsBlockReason: () => null, auditServedByLater: () => {}, applyLimitToChain: (c) => c,
    Defaults: {}, isAdmin: () => false, broadcastToTabs: () => {},
  });

  const tipo = (MSG.MSG || MSG).SAVE_PATH;
  const handler = handlers.get(tipo);
  expect(handler, 'l’handler che salva un percorso non è registrato').toBeTruthy();

  await handler({
    type: tipo,
    payload: {
      clientId: '',
      session: {
        rawUrl: 'https://esempio.it/conto',
        rawSteps: [{ selector: '#fatture', action: 'click' }],
        rawUserMessages: ['dove sono le fatture?'],
        success: true,
      },
    },
  }, {}, 'filo://sidebar');

  // L'handler non aspetta: la raccolta è telemetria best-effort.
  for (let i = 0; i < 200 && !ricevuto; i++) await new Promise((r) => setTimeout(r, 10));
  return ricevuto;
}

test("chi non ha fatto il login Google manda comunque un'identità che il server può verificare", async () => {
  const vecchioGoogle = googleAuth.getIdToken;
  const vecchioAnon = anonAuth.getIdToken;
  // Lo scenario normale: nessun login Google (è opzionale), ma l'installazione
  // la sua identità ce l'ha — è quella con cui funzionano crediti e portafoglio.
  googleAuth.getIdToken = async () => null;
  anonAuth.getIdToken = async () => 'token-della-installazione';
  try {
    const inviato = await inviaUnPercorso();
    expect(inviato, 'il percorso non è nemmeno arrivato alla pipeline di invio').toBeTruthy();
    const identita = `${inviato.idToken || ''}${inviato.clientId || ''}`;
    expect(identita,
      'il percorso parte senza nessuna identità: il limite di frequenza per identità chiesto dal feedback non ha su cosa appoggiarsi')
      .not.toBe('');
    expect(inviato.idToken).toBe('token-della-installazione');
  } finally {
    googleAuth.getIdToken = vecchioGoogle;
    anonAuth.getIdToken = vecchioAnon;
  }
});

test("l'identità dell'installazione vale anche per chi il login Google l'ha fatto", async () => {
  // Il login Google si collega all'identità dell'installazione, quindi è la
  // stessa persona: quella dell'installazione però c'è sempre, e per un limite
  // di frequenza conta avere un'identità sola e stabile.
  const vecchioGoogle = googleAuth.getIdToken;
  const vecchioAnon = anonAuth.getIdToken;
  googleAuth.getIdToken = async () => 'token-di-chi-e-loggato';
  anonAuth.getIdToken = async () => 'token-della-installazione';
  try {
    const inviato = await inviaUnPercorso();
    expect(inviato).toBeTruthy();
    expect(inviato.idToken).toBe('token-della-installazione');
  } finally {
    googleAuth.getIdToken = vecchioGoogle;
    anonAuth.getIdToken = vecchioAnon;
  }
});

test("se l'identità dell'installazione non risponde si ripiega sul login Google", async () => {
  const vecchioGoogle = googleAuth.getIdToken;
  const vecchioAnon = anonAuth.getIdToken;
  googleAuth.getIdToken = async () => 'token-di-chi-e-loggato';
  anonAuth.getIdToken = async () => { throw new Error("l'identità di questa installazione è stata annullata sul server"); };
  try {
    const inviato = await inviaUnPercorso();
    expect(inviato).toBeTruthy();
    expect(inviato.idToken).toBe('token-di-chi-e-loggato');
  } finally {
    googleAuth.getIdToken = vecchioGoogle;
    anonAuth.getIdToken = vecchioAnon;
  }
});

test("un'identità irraggiungibile non fa saltare la raccolta", async () => {
  // Offline, o identità annullata sul server: il percorso non deve esplodere né
  // bloccare l'utente. Al massimo non viene salvato.
  const vecchioGoogle = googleAuth.getIdToken;
  const vecchioAnon = anonAuth.getIdToken;
  googleAuth.getIdToken = async () => { throw new Error('offline'); };
  anonAuth.getIdToken = async () => { throw new Error('nessuna connessione a internet'); };
  try {
    const inviato = await inviaUnPercorso();
    expect(inviato, 'un errore di identità ha fermato tutta la pipeline').toBeTruthy();
  } finally {
    googleAuth.getIdToken = vecchioGoogle;
    anonAuth.getIdToken = vecchioAnon;
  }
});
