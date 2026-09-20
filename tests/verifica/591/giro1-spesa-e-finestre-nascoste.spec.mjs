// Verifica #591 — giro 1. Quello che la richiesta chiedeva, provato dal di
// fuori: il tetto di spesa ferma le chiamate che Filo fa da solo, e il
// controllo profondo sui siti sospetti non può più farsi aprire finestre
// nascoste a volontà.
//
// Niente Electron: il cancello e il rilevatore sono logica pura, e il
// fornitore, il conto e Electron sono finti.

import { test, expect } from '@playwright/test';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const require_ = createRequire(join(REPO, 'package.json'));

require_(join(REPO, 'src/shared/constants.js'));
const { ACTIONS } = globalThis.SN_CONST;
const Gate = require_(join(REPO, 'src/main/services/modelGate.js'));
const Classifier = require_(join(REPO, 'src/main/services/geoBlockClassifier.js'));
const SB = require_(join(REPO, 'src/main/services/safebrowse/index.js'));
const sandbox = require_(join(REPO, 'src/main/services/safebrowse/sandbox.js'));

const attendi = (ms) => new Promise((r) => setTimeout(r, ms));
const SETTINGS = { monthlyLimitEur: 5, usdToEur: 0.92, pricing: {}, excludedProviders: [] };

function banco({ oltreIlLimite = false } = {}) {
  const toccato = [];
  const conto = [];
  globalThis.SN_PROVIDERS = {
    completeWithFallback: async () => {
      toccato.push('completeWithFallback');
      return { text: 'geo_block', usage: { promptTokens: 200, completionTokens: 4 } };
    },
    streamCompleteWithFallback: async () => {
      toccato.push('streamCompleteWithFallback');
      return { text: 'ok', usage: { promptTokens: 1, completionTokens: 1 } };
    },
    getProvider: () => ({ transcribe: async () => { toccato.push('transcribe'); return { text: 'ciao' }; } }),
  };
  globalThis.SN_COSTS = {
    isOverLimit: async () => oltreIlLimite,
    record: async (r) => { conto.push(r); return 0.0004; },
  };
  Gate.configure({
    modelForAction: () => 'economico',
    buildAttemptChain: () => [{ provider: 'finto', apiKey: 'k', model: 'modello-economico' }],
    providerRouting: () => null,
    noteServedProvider: () => ({ servedBy: 'HostFinto', violation: false }),
  });
  return { toccato, conto };
}

// ─── Il tetto di spesa vale anche per quello che Filo fa da solo ────────────

test('col mese esaurito il riconoscimento del blocco geografico non chiama nessuno', async () => {
  const b = banco({ oltreIlLimite: true });
  const esito = await Classifier.classify(
    { statusCode: 403, host: 'video.esempio.com', url: 'https://video.esempio.com/g/1', title: 'Accesso negato', text: 'Non disponibile.' },
    {
      cache: Classifier.createCache(),
      complete: async ({ messages, signal }) => {
        const r = await Gate.complete({ settings: SETTINGS, action: ACTIONS.GEOBLOCK_CLASSIFY, messages, signal });
        return r.text;
      },
    },
  );
  expect(b.toccato, 'nessuna chiamata al fornitore oltre il tetto').toEqual([]);
  expect(b.conto, 'niente spesa per una chiamata mai partita').toEqual([]);
  // Per chi naviga: nessuna azione, la pagina resta com'è.
  expect(esito.route.proxy).toBe(false);
});

test('sotto il tetto la stessa chiamata parte e compare nel conto col suo nome', async () => {
  const b = banco();
  await Classifier.classify(
    { statusCode: 403, host: 'video.esempio.com', url: 'https://video.esempio.com/g/1', title: 'Accesso negato', text: 'Non disponibile.' },
    {
      cache: Classifier.createCache(),
      complete: async ({ messages }) => (await Gate.complete({
        settings: SETTINGS, action: ACTIONS.GEOBLOCK_CLASSIFY, messages,
      })).text,
    },
  );
  expect(b.toccato).toEqual(['completeWithFallback']);
  expect(b.conto.length).toBe(1);
  expect(b.conto[0].action).toBe(ACTIONS.GEOBLOCK_CLASSIFY);
});

test('col mese esaurito il giudizio sui siti pericolosi si ferma prima del fornitore', async () => {
  const b = banco({ oltreIlLimite: true });
  await expect(Gate.complete({
    settings: SETTINGS, action: ACTIONS.SAFEBROWSE_JUDGE, messages: [{ role: 'user', content: 'metadati' }],
  })).rejects.toThrow(/[Ll]imite/);
  expect(b.toccato).toEqual([]);
});

// ─── Il freno del controllo profondo sta sul dominio, non sull'host ─────────

test('duecento sottodomini dello stesso dominio non fanno duecento controlli', async () => {
  let giudizi = 0;
  let finestre = 0;
  SB.setProviders({
    gsb: null,
    rdap: null,
    ct: null,
    llm: async () => { giudizi++; await attendi(20); return { verdict: 'boh' }; },
    sandbox: async () => { finestre++; await attendi(20); return { verdict: 'clean' }; },
  });
  for (let i = 0; i < 200; i++) {
    SB.analyze(`http://paypa1-accedi-${i}.esempio-verifica-591.tk/login`,
      { linkOrigin: 'email', hasPassword: true }, () => {});
  }
  await attendi(400);
  expect(giudizi, 'un solo giudizio del modello per dominio registrabile').toBe(1);
  expect(finestre, 'una sola finestra nascosta per dominio registrabile').toBe(1);
});

// ─── Le finestre nascoste: quante insieme, e per quanto ─────────────────────

// Electron minimo. La pagina non finisce MAI di caricare: l'unica cosa che può
// chiudere la finestra è il tetto di vita. Tiene il conto delle sessioni
// isolate create, che sono l'altra risorsa che ogni finestra si porta dietro.
function electronFinto() {
  const stato = { aperte: 0, picco: 0, distrutte: 0, sessioni: new Set() };
  class Wc {
    on() {}
    setWindowOpenHandler() {}
    loadURL() { return new Promise(() => {}); }
  }
  class Win {
    constructor() { this.webContents = new Wc(); this._morta = false; stato.aperte++; stato.picco = Math.max(stato.picco, stato.aperte); }
    isDestroyed() { return this._morta; }
    destroy() { if (this._morta) return; this._morta = true; stato.aperte--; stato.distrutte++; }
  }
  return {
    stato,
    el: {
      BrowserWindow: Win,
      session: {
        fromPartition: (nome) => {
          stato.sessioni.add(nome);
          return { on() {}, clearStorageData: () => Promise.resolve() };
        },
      },
    },
  };
}

test('una finestra nascosta viene chiusa anche se la pagina non finisce mai', async () => {
  const { el, stato } = electronFinto();
  const esito = await sandbox.detonate('http://sospetto-591.tk/', null,
    { electron: el, timeoutMs: 10_000, hardLifetimeMs: 120 });
  expect(esito, 'senza verdetto non si finge un "pulito"').toBe(null);
  expect(stato.aperte, 'nessuna finestra resta aperta').toBe(0);
  expect(stato.distrutte).toBe(1);
});

test('più indirizzi insieme non aprono più finestre del tetto', async () => {
  const { el, stato } = electronFinto();
  const corse = [];
  for (let i = 0; i < 12; i++) {
    corse.push(sandbox.detonate(`http://sospetto-591-${i}.tk/`, null,
      { electron: el, timeoutMs: 10_000, hardLifetimeMs: 60 }));
  }
  await Promise.all(corse);
  expect(stato.picco, 'mai più di due finestre nascoste insieme').toBeLessThanOrEqual(2);
  expect(stato.aperte, 'alla fine non ne resta nessuna').toBe(0);
});

test('le sessioni isolate delle finestre nascoste non si accumulano', async () => {
  // Ogni controllo profondo si fabbrica una sessione nuova, con un nome che non
  // si ripete mai. La finestra adesso ha un tetto e muore; la sessione no:
  // resta registrata in Electron per tutto il tempo in cui Filo è aperto. Con
  // un tetto di due finestre insieme ne bastano due riusate, svuotate fra un
  // controllo e l'altro come già si fa.
  const { el, stato } = electronFinto();
  const corse = [];
  for (let i = 0; i < 12; i++) {
    corse.push(sandbox.detonate(`http://sospetto-591-sess-${i}.tk/`, null,
      { electron: el, timeoutMs: 10_000, hardLifetimeMs: 60 }));
  }
  await Promise.all(corse);
  expect(stato.sessioni.size,
    'dodici controlli non devono lasciarsi dietro dodici sessioni').toBeLessThanOrEqual(2);
});
