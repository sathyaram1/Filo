// Verifica #591, giro 15 — nell'app vera una pagina di accesso ospitata su un secchio di archiviazione cambia il proprio
// indirizzo senza navigare (e aggiunge un riquadro vuoto): ogni indirizzo nuovo è un giudizio del modello e una finestra
// nascosta. La stessa pagina su un dominio qualunque fa un controllo solo.

import { test, expect, _electron as electron } from '@playwright/test';
import { rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';
import { argomentiScala } from '../../helpers/scala.mjs';
import { chiudiApp } from '../../fixtures/electron.mjs';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

const PAGINA = `<!doctype html><meta charset="utf-8"><title>Accesso</title>
<form><input name="utente"><input type="password" name="parola"></form>
<script>
  let i = 0;
  setInterval(() => {
    i++;
    const qui = location.pathname.split('/').slice(0, 2).join('/');
    history.pushState(null, '', qui + '/accesso-' + i + '.html');
    const f = document.createElement('iframe');
    f.srcdoc = '<p>.</p>';
    document.body.appendChild(f);
  }, 900);
</script>`;

let server;
let porta;
test.beforeAll(async () => {
  server = createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(PAGINA);
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  porta = server.address().port;
});
test.afterAll(async () => {
  try { server.closeAllConnections?.(); } catch (_) {}
  await new Promise((ok) => server.close(ok));
});

async function giudiziPer(url) {
  const userData = cartellaTemporanea('filo-verifica-591-');
  const app = await electron.launch({
    args: [...argomentiScala, '--host-resolver-rules=MAP s3.amazonaws.com 127.0.0.1, MAP sito-ostile-giro15.test 127.0.0.1', '.'],
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
      globalThis.__giro15 = { giudizi: 0, finestre: 0 };
      const finto = async ({ attempts, messages }) => {
        if (JSON.stringify(messages || []).includes('METADATI')) globalThis.__giro15.giudizi++;
        return { text: '{"suspicious":false,"reason":null,"confidence":"low"}', provider: attempts[0].provider, model: attempts[0].model, servedBy: 'DeepInfra', usage: { promptTokens: 200, completionTokens: 5, costUsd: 0.0005 } };
      };
      globalThis.SN_PROVIDERS.completeWithFallback = finto;
      globalThis.SN_PROVIDERS.streamCompleteWithFallback = finto;
    });
    await new Promise((ok) => setTimeout(ok, 500));
    await app.evaluate(() => {
      globalThis.SN_SAFEBROWSE.setProviders({
        gsb: null, rdap: null, ct: null,
        sandbox: async (u) => { globalThis.__giro15.finestre++; return { verdict: 'clean', finalUrl: u, redirects: [] }; },
      });
    });
    await shell.evaluate((u) => window.filoShell.tabs.open(u), url);
    await new Promise((ok) => setTimeout(ok, 14_000));
    return await app.evaluate(() => ({ ...globalThis.__giro15, tetto: globalThis.SN_SAFEBROWSE.DEEP_BUDGET, llm: globalThis.SN_SAFEBROWSE.activeProviders().llm }));
  } finally {
    await chiudiApp(app);
    try { rmSync(userData, { recursive: true, force: true }); } catch (_) {}
  }
}

test('una pagina di accesso su un secchio di archiviazione che cambia indirizzo da sola fa qualche controllo profondo, non uno per indirizzo', async () => {
  test.setTimeout(60_000);
  const n = await giudiziPer(`http://s3.amazonaws.com:${porta}/secchio-ostile/accesso.html`);
  expect(n.llm, 'il giudice del modello è acceso').toBe(true);
  expect(n.giudizi, 'giudizi del modello').toBeLessThanOrEqual(n.tetto);
  expect(n.finestre, 'finestre nascoste').toBeLessThanOrEqual(n.tetto);
});

test('caso di riscontro: la stessa pagina su un dominio qualunque fa un controllo solo', async () => {
  test.setTimeout(60_000);
  const n = await giudiziPer(`http://sito-ostile-giro15.test:${porta}/secchio-ostile/accesso.html`);
  expect(n.llm).toBe(true);
  expect(n.giudizi).toBeGreaterThanOrEqual(1);
  expect(n.giudizi).toBeLessThanOrEqual(n.tetto);
});
