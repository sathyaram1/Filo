// Verifica #591, giro 16 — nell'app vera una pagina vuota ospitata su un secchio di archiviazione si riscrive l'indirizzo
// (senza navigare) e si ricarica: il blocco geografico conta ogni indirizzo scritto dalla pagina come un proprietario
// nuovo e chiama il modello oltre il tetto. La stessa pagina su un dominio qualunque resta dentro il tetto.

import { test, expect, _electron as electron } from '@playwright/test';
import { rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';
import { argomentiScala } from '../../helpers/scala.mjs';
import { chiudiApp } from '../../fixtures/electron.mjs';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

// Nomi di secchio di sole lettere: il raggruppamento dei percorsi della cache non li confonde fra loro.
const PAGINA = `<!doctype html><meta charset="utf-8"><title></title><body></body>
<script>
  const lettere = () => Array.from({ length: 9 }, () => String.fromCharCode(97 + Math.floor(Math.random() * 26))).join('');
  const qui = location.pathname;
  const n = Number(new URLSearchParams(location.search).get('n') || 0);
  history.pushState(null, '', '/' + lettere() + '/vuota.html');
  setTimeout(() => history.pushState(null, '', '/' + lettere() + '/vuota.html'), 1000);
  setTimeout(() => { location.href = qui + '?n=' + (n + 1); }, 2700);
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

async function chiamatePer(url) {
  const userData = cartellaTemporanea('filo-verifica-591-');
  const app = await electron.launch({
    args: [...argomentiScala, '--host-resolver-rules=MAP s3.amazonaws.com 127.0.0.1, MAP sito-ostile-giro16.test 127.0.0.1', '.'],
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
      globalThis.__giro16 = { geo: 0 };
      const finto = async ({ attempts, messages }) => {
        if (JSON.stringify(messages || []).includes('geo_block')) globalThis.__giro16.geo++;
        return { text: 'errore_generico', provider: attempts[0].provider, model: attempts[0].model, servedBy: 'DeepInfra', usage: { promptTokens: 300, completionTokens: 3, costUsd: 0.0004 } };
      };
      globalThis.SN_PROVIDERS.completeWithFallback = finto;
      globalThis.SN_PROVIDERS.streamCompleteWithFallback = finto;
    });
    await new Promise((ok) => setTimeout(ok, 500));
    await shell.evaluate((u) => window.filoShell.tabs.open(u), url);
    await new Promise((ok) => setTimeout(ok, 22_000));
    return await app.evaluate(() => ({ ...globalThis.__giro16, tetto: globalThis.SN_SAFEBROWSE.DEEP_BUDGET }));
  } finally {
    await chiudiApp(app);
    try { rmSync(userData, { recursive: true, force: true }); } catch (_) {}
  }
}

test('una pagina vuota su un secchio che si riscrive l’indirizzo e si ricarica resta dentro il tetto del blocco geografico', async () => {
  test.setTimeout(70_000);
  const n = await chiamatePer(`http://s3.amazonaws.com:${porta}/secchio-ostile/vuota.html`);
  expect(n.geo, 'chiamate del blocco geografico').toBeLessThanOrEqual(n.tetto);
});

test('caso di riscontro: la stessa pagina su un dominio qualunque chiama il modello e resta dentro il tetto', async () => {
  test.setTimeout(70_000);
  const n = await chiamatePer(`http://sito-ostile-giro16.test:${porta}/secchio-ostile/vuota.html`);
  expect(n.geo).toBeGreaterThanOrEqual(1);
  expect(n.geo).toBeLessThanOrEqual(n.tetto);
});
