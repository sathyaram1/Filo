// Le pagine interne filo:// devono finire nella cache del codice V8 del profilo (#1091): senza, ogni apertura ricompila i loro script.
// La regola sui privilegi dello schema la tiene tests/unit/protocol.test.mjs; qui si guarda la cartella vera, l'unica prova che Chromium la usi.
import { test, expect } from './fixtures/electron.mjs';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

// Ogni voce della cache su disco porta in chiaro la chiave, che contiene l'indirizzo dello script.
function scriptInCache(dir) {
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

test('aprire più volte Preferenze e Modelli lascia i loro script nella cache del codice', async ({ app, shell, openTab }) => {
  const userData = await app.evaluate(({ app: a }) => a.getPath('userData'));
  const cache = join(userData, 'Code Cache', 'js');
  for (let giro = 0; giro < 3; giro++) {
    await apriEChiudi(shell, openTab, 'filo://preferences/preferences.html');
    await apriEChiudi(shell, openTab, 'filo://options/options.html');
  }
  await expect.poll(() => scriptInCache(cache), { timeout: 20_000 }).toEqual(expect.arrayContaining([
    'filo://preferences/preferences.js',
    'filo://options/options.js',
  ]));
});
