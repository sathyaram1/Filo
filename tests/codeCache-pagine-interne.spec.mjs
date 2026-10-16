// Le pagine interne filo:// devono usare la cache del codice V8 del profilo (#1091): senza, ogni apertura ricompila i loro script.
// La regola sui privilegi dello schema la tiene tests/unit/protocol.test.mjs; qui si guarda Chromium, l'unica prova che la cache serva davvero.
import { test, expect } from './fixtures/electron.mjs';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SCRIPT = ['filo://preferences/preferences.js', 'filo://options/options.js'];

// Ogni voce della cache su disco porta in chiaro la chiave, che contiene l'indirizzo dello script.
function scriptSuDisco(dir) {
  if (!existsSync(dir)) return [];
  const trovati = new Set();
  for (const nome of readdirSync(dir)) {
    const f = join(dir, nome);
    try {
      if (!statSync(f).isFile()) continue;
      for (const m of readFileSync(f).toString('latin1').matchAll(/filo:\/\/[\w.-]+\/[\w./-]+\.js/g)) trovati.add(m[0]);
    } catch (_) {}
  }
  return [...trovati];
}

async function apriEChiudi(shell, openTab, url) {
  const page = await openTab(url);
  await page.waitForLoadState('load');
  const id = await shell.evaluate(async () => (await window.filoShell.tabs.snapshot()).activeId);
  await shell.evaluate(async (i) => window.filoShell.tabs.close(i), id);
  await expect.poll(() => page.isClosed(), { timeout: 10_000 }).toBe(true);
}

async function apriTutte(shell, openTab) {
  await apriEChiudi(shell, openTab, 'filo://preferences/preferences.html');
  await apriEChiudi(shell, openTab, 'filo://options/options.html');
}

test('dalla terza apertura Preferenze e Modelli non ricompilano più i loro script', async ({ app, shell, openTab }) => {
  const userData = await app.evaluate(({ app: a }) => a.getPath('userData'));
  // V8 crea la cache in modo pigro: la prima apertura lascia solo un segno, la seconda il codice compilato.
  await apriTutte(shell, openTab);
  await apriTutte(shell, openTab);

  await app.evaluate(({ contentTracing }) => contentTracing.startRecording({ included_categories: ['devtools.timeline'] }));
  await apriTutte(shell, openTab);
  await apriTutte(shell, openTab);
  const traccia = await app.evaluate(({ contentTracing }) => contentTracing.stopRecording());
  const json = JSON.parse(readFileSync(traccia, 'utf8'));
  const dallaCache = new Set((json.traceEvents || json)
    .filter((e) => e.name === 'v8.compile' && e.args?.data?.consumedCacheSize > 0 && !e.args.data.cacheRejected)
    .map((e) => e.args.data.url));
  expect([...dallaCache]).toEqual(expect.arrayContaining(SCRIPT));

  await expect.poll(() => scriptSuDisco(join(userData, 'Code Cache', 'js')), { timeout: 10_000 })
    .toEqual(expect.arrayContaining(SCRIPT));
});
