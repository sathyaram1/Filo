// Una regola «questo sito sempre da <paese>» salvata si vede: nel filo della home è un cambio col dominio e il paese,
// e da lì si toglie. Prima questa prova asseriva il difetto (la regola invisibile ovunque) e la riga del cambio,
// arrivata dopo, la faceva cadere a caso (#1569). Frasi dei cambi: src/shared/cambi.js.

import { test, expect } from './fixtures/electron.mjs';
import { home } from './helpers/chatFinta.mjs';

const DOMAIN = 'audit-test-proxy-rules.example.com';

const regole = (app) => app.evaluate(async ({ BrowserWindow }) => {
  const tm = BrowserWindow.getAllWindows().map((w) => w._filoTabs).find(Boolean);
  return { salvate: await globalThis.SN_FILO_MEMORY.listProxyRules(), vive: { ...((tm && tm._proxyRules) || {}) } };
});

test('una regola proxy dominio salvata si vede nella home col dominio e il paese, e da lì si toglie', async ({ app }) => {
  test.setTimeout(60_000);
  const casa = await home(app);

  // Lo stesso salvataggio che fa «apri sempre questo sito dalla Francia», con la tabella delle schede ricaricata.
  await app.evaluate(async (_e, domain) => {
    await globalThis.SN_FILO_MEMORY.setProxyRule(domain, { country: 'fr' });
    await globalThis.SN_HANDLERS_TEST?.aggiornaRegoleProxy?.();
  }, DOMAIN);
  expect((await regole(app)).salvate[DOMAIN]?.country).toBe('fr');

  const riga = casa.locator('.dash-cambio', { hasText: DOMAIN });
  await expect(riga).toHaveCount(1, { timeout: 10_000 });
  await expect(riga.locator('.dash-cambio-testo')).toContainText(`${DOMAIN} sempre da Francia`);

  await riga.hover();
  await riga.locator('.dash-cambio-annulla', { hasText: 'annulla' }).click();
  await expect.poll(async () => {
    const r = await regole(app);
    return [DOMAIN in r.salvate, DOMAIN in r.vive];
  }, { timeout: 10_000 }).toEqual([false, false]);
  await expect(riga).toHaveClass(/dash-cambi-annullato/);
});
