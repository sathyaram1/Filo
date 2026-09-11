// #581 — un'installazione appena fatta funziona con le chiavi di fabbrica, e
// non chiede mai il documento dei segreti.
//
// Il caso. `config/secrets` (chiavi OpenRouter e Tavily che pagano le chiamate
// di tutti, più la chiave Google Safe Browsing) si leggeva con la sola
// condizione «loggato con email verificata». Il login accetta qualunque account
// Google e la chiave web di Firebase sta in un repo pubblico: chiunque, senza
// nemmeno installare Filo, si autenticava e con una GET REST si portava via il
// documento intero. La regola adesso è admin-only.
//
// Chiuderla e basta non sarebbe un fix: i tester devono poter usare Filo senza
// mettere chiavi proprie. Questo spec prova proprio quello, sull'app vera —
// Filo avviato da zero (nessun profilo, nessuna chiave scritta a mano) e le
// chiavi che arrivano comunque fino al punto in cui parte una richiesta.
//
// Senza il fix il terzo test è rosso: la chiave Safe Browsing non esisteva
// nella distribuzione del build, quindi con l'app chiusa al documento remoto il
// primo stadio del rilevamento siti pericolosi restava spento.

import { test, expect, _electron as electron } from '@playwright/test';
import { rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea } from './helpers/percorsi.mjs';
import { argomentiScala } from './helpers/scala.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = resolve(__dirname, '..');

// Le chiavi che in produzione la CI incastona nell'eseguibile. Qui passano per
// l'ambiente, che è il ripiego dichiarato di default-keys.js: stessa strada,
// stesso codice, senza dover costruire un pacchetto.
const FABBRICA = {
  openrouter: 'or-di-fabbrica-581',
  tavily: 'tav-di-fabbrica-581',
  safeBrowsing: 'gsb-di-fabbrica-581',
};

let app;
let userData;

test.beforeAll(async () => {
  userData = cartellaTemporanea('filo-test-581-');
  app = await electron.launch({
    args: [...argomentiScala, '.'],
    cwd: APP_ROOT,
    env: {
      ...process.env,
      FILO_USER_DATA: userData,
      FILO_DOWNLOAD_DIR: join(userData, 'downloads'),
      NODE_ENV: 'test',
      FILO_DEFAULT_OPENROUTER_KEY: FABBRICA.openrouter,
      FILO_DEFAULT_TAVILY_KEY: FABBRICA.tavily,
      FILO_DEFAULT_SAFEBROWSING_KEY: FABBRICA.safeBrowsing,
    },
  });
  await app.firstWindow();
});

test.afterAll(async () => {
  try { await app.close(); } catch (_) {}
  try { rmSync(userData, { recursive: true, force: true }); } catch (_) {}
});

test('installazione nuova senza login: la richiesta parte con le chiavi di fabbrica', async () => {
  const eff = await app.evaluate(async () => {
    const s = await globalThis.__filoHandlers.getEffectiveSettings();
    return { openrouter: s.apiKeys.openrouter || '', tavily: s.apiKeys.tavily || '' };
  });
  // Sono le chiavi che finiscono davvero al provider: se qui c'è una stringa
  // vuota, in chat l'utente vede "configura una chiave".
  expect(eff.openrouter).toBe(FABBRICA.openrouter);
  expect(eff.tavily).toBe(FABBRICA.tavily);
});

test('il documento dei segreti non viene mai chiesto da un’installazione normale', async () => {
  const urls = await app.evaluate(async () => {
    const Defaults = globalThis.__filoDefaults;
    const vero = global.fetch;
    const viste = [];
    global.fetch = async (u) => {
      viste.push(String(u));
      // 404 = documento mai scritto. Nessuna rete, nessun override.
      return { ok: false, status: 404, async json() { return {}; }, async text() { return ''; } };
    };
    try { await Defaults.refresh(); } finally { global.fetch = vero; }
    return viste;
  });
  expect(urls.some((u) => u.includes('config/secrets'))).toBe(false);
  // Il refresh non è stato disattivato in blocco: la config NON segreta si legge.
  expect(urls.some((u) => u.includes('config/models'))).toBe(true);
});

test('il rilevamento siti pericolosi si accende anche per chi non ha fatto login', async () => {
  // Prima la chiave Safe Browsing viveva SOLO nel documento remoto: chi non
  // aveva un profilo restava scoperto, e chiuderlo agli admin avrebbe spento lo
  // stadio per tutti. Ora viaggia col build e arriva fin qui da sola.
  const acceso = await app.evaluate(async () => {
    await globalThis.__filoHandlers.wireSafebrowse();
    return globalThis.SN_SAFEBROWSE.activeProviders().gsb;
  });
  expect(acceso).toBe(true);
});
