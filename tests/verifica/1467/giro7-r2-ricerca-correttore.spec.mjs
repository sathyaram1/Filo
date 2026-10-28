// Verifica #1467, giro 7, rilievo 2: la ricerca web che il correttore fa per riempire un segnaposto (dopo Wikipedia) è
// una ricerca web di Filo come quelle della chat e dell'Aiuto, e si conta.

import { test, expect } from '../../fixtures/electron.mjs';

const ricercheContate = (app) => app.evaluate(async () => {
  const s = await globalThis.SN_CONTATORI_MAIN.letto();
  let n = 0;
  for (const ora of Object.values(s.ore || {})) for (const v of Object.values(ora.ricercaWeb || {})) n += v;
  return n;
});

test('r2 la ricerca web di un segnaposto del correttore si conta fra le ricerche web', async ({ app }) => {
  test.setTimeout(60_000);
  await app.evaluate(() => {
    const vero = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
      if (String(url).startsWith('https://html.duckduckgo.com/')) {
        const voce = (n) => `<a rel="nofollow" class="result__a" href="https://esempio.it/${n}">Fonte ${n}</a><a class="result__snippet" href="x">dato ${n}</a>`;
        return new Response(`<html><body>${voce(1)}${voce(2)}</body></html>`, { status: 200, headers: { 'content-type': 'text/html' } });
      }
      return vero(url, init);
    };
  });
  const prima = await ricercheContate(app);
  const fonti = await app.evaluate(() => globalThis.SN_FONTI_SEGNAPOSTO.web('in che anno è nato Dante', ''));
  expect(fonti.length).toBe(2);
  await expect.poll(() => ricercheContate(app), { timeout: 5_000 }).toBe(prima + 1);
});
