// La raccolta dei percorsi dell'Aiuto è spenta fino a dopo il lancio (#897): la
// funzione del server che li riceve non esiste. Una sessione che finisce con
// passi eseguiti non chiede «Ha funzionato?», non paga i due modelli di
// pulizia, e la coda rimasta da una versione precedente si butta all'avvio.
// La lettura invece resta: i percorsi del sito entrano ancora nel prompt.
//
// Il sito ha un nome da Internet che porta al server di prova: da 127.0.0.1 la
// raccolta non partirebbe comunque, e la prova non direbbe niente.

import { test as base, expect, chiudiApp, argomentiScala } from './fixtures/electron.mjs';
import { _electron as electron } from '@playwright/test';
import { rmSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea } from './helpers/percorsi.mjs';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SITO = 'negozio-felice.it';
const DOMANDA = 'dove sono le impostazioni avanzate?';
const INTENTO_ALTRUI = 'aprire le impostazioni avanzate del negozio';

const test = base.extend({
  semeDisco: [null, { option: true }],
  app: async ({ semeDisco }, use) => {
    const userData = cartellaTemporanea('filo-test-');
    if (semeDisco) writeFileSync(join(userData, 'storage.json'), JSON.stringify(semeDisco));
    const app = await electron.launch({
      args: [...argomentiScala, `--host-resolver-rules=MAP ${SITO} 127.0.0.1`, '.'],
      cwd: APP_ROOT,
      env: { ...process.env, FILO_USER_DATA: userData, NODE_ENV: 'test' },
    });
    await use(app);
    await chiudiApp(app);
    try { rmSync(userData, { recursive: true, force: true }); } catch (_) {}
  },
});

const PAGINA = `<!doctype html><html><head><title>Negozio felice</title></head><body>
  <h1>Il tuo account</h1>
  <details id="avanzate"><summary>Impostazioni avanzate</summary><p>Lingua, notifiche, privacy.</p></details>
</body></html>`;

// Modello finto nel processo principale: l'agente Aiuto apre la sezione e
// chiude la sessione; i due modelli della pulizia si riconoscono dal prompt.
// I percorsi «di altri» per il sito arrivano dalla lettura, sostituita qui.
async function preparaMain(app) {
  await app.evaluate(async (_e, { sito, intento }) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: {
        [C.ACTIONS.HELP]: 'deepseek-flash',
        [C.ACTIONS.HELP_INTENT_GUESS]: 'deepseek-flash',
        [C.ACTIONS.HELP_INTENT_JUDGE]: 'deepseek-flash',
      },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    globalThis.SN_PATHS.listByDomain = async (d) => (d === sito ? [{
      domain: sito, initialUrl: '/account', intent: intento,
      steps: [{ selector: '#avanzate', action: 'reveal' }], success: true,
    }] : []);
    globalThis.__chiamate = [];
    const finto = async ({ messages }) => {
      const testo = JSON.stringify(messages);
      const pulizia = /Sei un classificatore|Sei un giudice di sicurezza/.test(testo);
      globalThis.__chiamate.push({ pulizia, testo });
      const risposta = pulizia
        ? (testo.includes('Sei un giudice') ? '{"ok":true}' : intento)
        : JSON.stringify({ text: 'Eccole, le ho aperte.', status: 'done', highlight: { selector: '#avanzate', action: 'reveal', note: 'Qui' } });
      return { text: risposta, model: 'finto', provider: 'finto', costEur: 0, usage: {} };
    };
    globalThis.SN_PROVIDERS.completeWithFallback = finto;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = finto;
  }, { sito: SITO, intento: INTENTO_ALTRUI });
}

async function apriSito(openTab, testServer) {
  const u = new URL(testServer.html(PAGINA));
  u.hostname = SITO;
  const page = await openTab(u.href);
  await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 8000 });
  await page.waitForFunction(() => typeof window.SN_SIDEBAR?.open === 'function', null, { timeout: 8000 });
  return page;
}

test('una sessione dell’Aiuto finita con un passo eseguito non chiede «Ha funzionato?» e non paga la pulizia', async ({ app, openTab, testServer }) => {
  await preparaMain(app);
  const page = await apriSito(openTab, testServer);
  await page.evaluate(() => {
    window.__porta = [];
    window.__salvati = 0;
    const orig = chrome.runtime.sendMessage.bind(chrome.runtime);
    chrome.runtime.sendMessage = (msg, ...rest) => {
      if (msg && msg.type === 'save_path') window.__salvati += 1;
      const p = orig(msg, ...rest);
      if (msg && msg.type === 'path_collectable') Promise.resolve(p).then((r) => window.__porta.push(r));
      return p;
    };
    window.SN_SIDEBAR.open();
  });
  await page.waitForSelector('.sn-sidebar-input textarea', { timeout: 8000 });
  await page.fill('.sn-sidebar-input textarea', DOMANDA);
  await page.press('.sn-sidebar-input textarea', 'Enter');

  // il passo c'è stato davvero: la sezione si è aperta e la chat lo dice
  await expect(page.locator('#avanzate')).toHaveAttribute('open', '', { timeout: 15000 });
  await expect(page.locator('.sn-sidebar-log').last()).toContainText('sezione aperta');
  await expect(page.locator('.sn-sidebar-msg, .sn-sidebar-conv').filter({ hasText: 'Eccole, le ho aperte.' }).first()).toBeVisible();

  // la sessione è finita e la porta ha risposto: a raccolta spenta, no
  await page.waitForFunction(() => window.__porta.length > 0, null, { timeout: 10000 });
  expect(await page.evaluate(() => window.__porta[0].raccoglibile)).toBe(false);
  await page.waitForTimeout(300);
  await expect(page.locator('.sn-sidebar-feedback')).toHaveCount(0);
  await expect(page.getByText('Ha funzionato?')).toHaveCount(0);
  expect(await page.evaluate(() => window.__salvati)).toBe(0);

  const chiamate = await app.evaluate(() => globalThis.__chiamate);
  expect(chiamate.filter((c) => c.pulizia), 'nessuna chiamata HELP_INTENT_GUESS né HELP_INTENT_JUDGE').toEqual([]);

  // la lettura resta: i percorsi del sito sono nel prompt dell'agente
  const agente = chiamate.filter((c) => !c.pulizia).map((c) => c.testo);
  expect(agente.some((t) => t.includes('<<<PERCORSI_CONDIVISI>>>') && t.includes(INTENTO_ALTRUI))).toBe(true);

  await page.screenshot({ path: 'tests/.shots/897-aiuto-senza-domanda.png' });
});

test('un save_path arrivato comunque non paga nessun modello e non mette niente in coda', async ({ app, openTab, testServer }) => {
  await preparaMain(app);
  const page = await apriSito(openTab, testServer);
  const risposta = await page.evaluate((domanda) => chrome.runtime.sendMessage({
    type: 'save_path',
    payload: { session: {
      rawUrl: location.href,
      rawSteps: [{ selector: '#avanzate', action: 'reveal' }],
      rawUserMessages: [domanda],
      success: true,
    } },
  }), DOMANDA);
  expect(risposta && risposta.ok).toBe(true);
  // la raccolta gira in sottofondo dopo la risposta: le si lascia il tempo
  await page.waitForTimeout(1000);
  const esito = await app.evaluate(async () => ({
    chiamate: globalThis.__chiamate.length,
    coda: globalThis.SN_PATHS_COLLECTOR.inCoda(),
    disco: await globalThis.SN_STORAGE.getRaw('pathsOutbox', []),
  }));
  expect(esito.chiamate).toBe(0);
  expect(esito.coda).toBe(0);
  expect(esito.disco).toEqual([]);
});

test.describe('con dei percorsi in coda da una versione precedente', () => {
  const ora = Date.now();
  test.use({ semeDisco: { pathsOutbox: [1, 2, 3].map((i) => ({
    id: `p_${i}`, domain: 'negoziofelice.it', initialUrl: '/account', intent: 'vedere gli ordini',
    steps: [{ selector: '#ordini', action: 'click' }], success: true,
    accodatoIl: ora - i * 3600_000, nonPrimaDi: ora - 60_000,
  })) } });

  test('all’avvio la coda si svuota, sul disco compreso', async ({ app }) => {
    await expect.poll(
      () => app.evaluate(() => globalThis.SN_STORAGE.getRaw('pathsOutbox', null)),
      { timeout: 10000 },
    ).toEqual([]);
    expect(await app.evaluate(() => globalThis.SN_PATHS_COLLECTOR.inCoda())).toBe(0);
  });
});
