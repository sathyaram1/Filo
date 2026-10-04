// Verifica #951 dopo il riallineamento: da main è arrivato «Dai un nome sensato» (inizio del file o miniatura a un
// modello, anche da solo sugli scaricamenti se acceso). L'elenco Privacy di cosa va ai modelli deve dirlo.

import { test, expect } from '../../fixtures/electron.mjs';

test('Privacy elenca fra i dati che vanno ai modelli anche il file a cui Filo dà un nome', async ({ app, openTab }) => {
  const esiste = await app.evaluate(() => !!globalThis.SN_MODEL_USAGE.byId('file-name'));
  expect(esiste).toBe(true);

  const page = await openTab('filo://transparency/transparency.html?doc=privacy');
  await expect(page.locator('#doc-body h2').first()).toBeVisible();
  const elenco = await page.locator('#doc-body').evaluate((body) => {
    const h = [...body.querySelectorAll('h2')].find((x) => /modelli/i.test(x.textContent));
    let n = h && h.nextElementSibling;
    while (n && n.tagName !== 'UL') n = n.nextElementSibling;
    return n ? n.textContent : '';
  });
  expect(elenco.length).toBeGreaterThan(100);
  expect(elenco).toMatch(/nome (sensato )?(a|ai|al) (un )?file|rinomin|nomi dei file/i);
});
