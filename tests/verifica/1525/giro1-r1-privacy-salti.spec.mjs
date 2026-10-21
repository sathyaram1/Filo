// #1525 giro 1 — in modalità privacy una pagina che salta da sola fra due siti non deve riempire il filo:
// ogni salto fra siti diversi ricrea la vista della scheda, e il freno non deve ripartire da zero.

import { test, expect } from '../../fixtures/electron.mjs';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const eventi = (userData) => {
  const f = join(userData, 'filo', 'eventi.jsonl');
  return existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter(Boolean).map((r) => JSON.parse(r)) : [];
};

test('r1 in privacy una pagina che salta da sola fra due siti lascia al più 30 visite dopo la prima', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(120_000);
  const userData = await app.evaluate(() => process.env.FILO_USER_DATA);
  await shell.evaluate(() => window.filoShell.message({
    type: 'update_settings', settings: { security: { cookies: { mode: 'privacy', trustedSites: [] } } },
  }));
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()
    .some((w) => w._filoTabs && w._filoTabs.cookieMode === 'privacy')), { timeout: 5000 }).toBe(true);
  const locale = testServer.origin;
  const pubblico = testServer.originPubblico;
  const url = testServer.html('<!doctype html><title>Salto</title><p>salto</p><script>'
    + `const n=Number(new URLSearchParams(location.search).get('n')||0);document.title='Salto '+n;`
    + `setTimeout(()=>{location.href=(location.hostname==='127.0.0.1'?${JSON.stringify(pubblico)}:${JSON.stringify(locale)})+location.pathname+'?n='+(n+1)},250);`
    + '</script>');
  const percorso = new URL(url).pathname;
  await openTab(url);
  await new Promise((r) => setTimeout(r, 25_000));
  const salti = await app.evaluate(({ BrowserWindow }) => {
    for (const w of BrowserWindow.getAllWindows()) {
      const t = w._filoTabs && w._filoTabs.tabs.find((x) => /[?&]n=/.test(x.url || ''));
      if (t) return Number(new URL(t.url).searchParams.get('n')) || 0;
    }
    return 0;
  });
  expect(salti).toBeGreaterThan(40);
  await app.evaluate(() => globalThis.SN_IL_FILO.quandoFermo());
  const visite = eventi(userData).filter((e) => e.tipo === 'navigazione' && new URL(e.url).pathname === percorso);
  // La prima visita, aperta da Filo, più trenta senza gesto: come nella stessa vista.
  expect(visite.length).toBeLessThanOrEqual(31);
});
