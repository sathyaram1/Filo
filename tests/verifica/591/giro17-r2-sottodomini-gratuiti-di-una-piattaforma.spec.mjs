// Verifica #591, giro 17 — sulle piattaforme dove ogni sotto-indirizzo è un sito a sé (surge.sh, vercel.app, netlify.app…)
// una pagina che si porta da sola da un sotto-indirizzo gratuito all'altro fa un giudizio del modello e una finestra
// nascosta per ogni salto: il tetto per proprietario non la tocca. La stessa catena su un dominio solo resta nel tetto.

import { test, expect, _electron as electron } from '@playwright/test';
import { rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';
import { argomentiScala } from '../../helpers/scala.mjs';
import { chiudiApp } from '../../fixtures/electron.mjs';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

let server;
let porta;
test.beforeAll(async () => {
  server = createServer((req, res) => {
    const host = String(req.headers.host || '').split(':')[0];
    const [primo, ...resto] = host.split('.');
    const n = Number(primo.replace(/\D/g, '')) || 0;
    const prossimo = `http://s${n + 1}.${resto.join('.')}:${porta}/accesso`;
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<!doctype html><meta charset="utf-8"><title>Accesso</title>
<form><input name="utente"><input type="password" name="parola"></form>
<script>setTimeout(() => { location.href = ${JSON.stringify(prossimo)}; }, 500);</script>`);
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  porta = server.address().port;
});
test.afterAll(async () => {
  try { server.closeAllConnections?.(); } catch (_) {}
  await new Promise((ok) => server.close(ok));
});

async function controlliPer(suffisso) {
  const userData = cartellaTemporanea('filo-verifica-591-');
  const app = await electron.launch({
    args: [...argomentiScala, `--host-resolver-rules=MAP *.${suffisso} 127.0.0.1`, '.'],
    cwd: APP_ROOT,
    env: { ...process.env, FILO_USER_DATA: userData, NODE_ENV: 'test' },
  });
  try {
    const shell = await app.firstWindow();
    await shell.waitForLoadState('domcontentloaded');
    await app.evaluate(async () => {
      const T = globalThis.SN_TEST_MODELS;
      await globalThis.SN_STORAGE.updateSettings({
        useDefaultModels: false,
        apiKeys: { openrouter: 'k-test' },
        models: { ...T.models },
        modelRegistry: T.registry,
        monthlyLimitEur: 0,
      });
      globalThis.__giro17 = { giudizi: 0, finestre: 0 };
      const finto = async ({ attempts, messages }) => {
        if (JSON.stringify(messages || []).includes('METADATI')) globalThis.__giro17.giudizi++;
        return { text: '{"suspicious":false,"reason":null,"confidence":"low"}', provider: attempts[0].provider, model: attempts[0].model, servedBy: 'DeepInfra', usage: { promptTokens: 200, completionTokens: 5, costUsd: 0.0005 } };
      };
      globalThis.SN_PROVIDERS.completeWithFallback = finto;
      globalThis.SN_PROVIDERS.streamCompleteWithFallback = finto;
    });
    await new Promise((ok) => setTimeout(ok, 500));
    await app.evaluate(() => {
      globalThis.SN_SAFEBROWSE.setProviders({
        gsb: null, rdap: null, ct: null,
        sandbox: async (u) => { globalThis.__giro17.finestre++; return { verdict: 'clean', finalUrl: u, redirects: [] }; },
      });
    });
    await shell.evaluate((u) => window.filoShell.tabs.open(u), `http://s0.${suffisso}:${porta}/accesso`);
    await new Promise((ok) => setTimeout(ok, 15_000));
    return await app.evaluate(() => ({ ...globalThis.__giro17, tetto: globalThis.SN_SAFEBROWSE.DEEP_BUDGET, llm: globalThis.SN_SAFEBROWSE.activeProviders().llm }));
  } finally {
    await chiudiApp(app);
    try { rmSync(userData, { recursive: true, force: true }); } catch (_) {}
  }
}

test('una pagina che salta da sola fra sotto-indirizzi gratuiti di surge.sh resta dentro il tetto dei controlli profondi', async () => {
  test.setTimeout(60_000);
  const n = await controlliPer('surge.sh');
  expect(n.llm, 'il giudice del modello è acceso').toBe(true);
  expect(n.giudizi, 'giudizi del modello in quindici secondi').toBeLessThanOrEqual(n.tetto);
  expect(n.finestre, 'finestre nascoste in quindici secondi').toBeLessThanOrEqual(n.tetto);
});

test('caso di riscontro: la stessa catena sui sotto-indirizzi di un dominio solo resta dentro il tetto', async () => {
  test.setTimeout(60_000);
  const n = await controlliPer('dominio-giro17.test');
  expect(n.llm).toBe(true);
  expect(n.giudizi).toBeGreaterThanOrEqual(1);
  expect(n.giudizi).toBeLessThanOrEqual(n.tetto);
  expect(n.finestre).toBeLessThanOrEqual(n.tetto);
});
