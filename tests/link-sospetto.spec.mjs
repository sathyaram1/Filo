// #725 — l'avviso su un link sospetto, nel menu del tasto destro: deve essere
// una frase che chiunque capisce (prima usciva il codice interno
// «⚠️ Link sospetto: typosquatting:paypal.com») e deve esserci anche quando la
// spiegazione del modello non arriva.

import { test, expect } from './fixtures/electron.mjs';

const HTML = `<!doctype html><html><body style="padding:40px;font:16px sans-serif">
  <h1>Pagina di prova</h1>
  <p><a id="falso" href="https://paypa1.com/login">Accedi al tuo conto</a></p>
  <p><a id="pulito" href="https://esempio-tranquillo.test/articolo">Un articolo qualunque</a></p>
</body></html>`;

test('un link che imita un dominio noto lo dice a parole', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, HTML);
  await page.locator('#falso').click({ button: 'right' });

  const menu = page.locator('.sn-menu');
  await expect(menu).toBeVisible();

  const avviso = menu.locator('.sn-menu-link-warn');
  await expect(avviso).toBeVisible();
  const testo = ((await avviso.textContent()) || '').trim();

  // Il successo per chi legge: capisce cosa rischia e vede il dominio imitato,
  // senza che nessuno gli spieghi cos'è il typosquatting.
  expect(testo).toContain('paypal.com');
  expect(testo).toMatch(/imitazione/i);
  expect(testo).toMatch(/\.$/);
  expect(testo).not.toMatch(/typosquatting|side_effect|token_in_url|url_invalido/);

  await page.screenshot({ path: 'tests/.shots/725-link-sospetto.png' });
});

test('l’avviso c’è prima e a prescindere dalla spiegazione del modello', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, HTML);
  await page.locator('#falso').click({ button: 'right' });
  const avviso = page.locator('.sn-menu .sn-menu-link-warn');
  // Compare da subito: non aspetta il primo pezzo della risposta AI, che in un
  // ambiente senza provider non arriva mai.
  await expect(avviso).toBeVisible({ timeout: 3000 });
  // E resta lì mentre la sezione finisce come può.
  await page.waitForTimeout(1500);
  await expect(avviso).toBeVisible();
  expect(((await avviso.textContent()) || '')).toContain('paypal.com');
});

test('un link normale non si prende un avviso', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, HTML);
  await page.locator('#pulito').click({ button: 'right' });
  await expect(page.locator('.sn-menu')).toBeVisible();
  await expect(page.locator('.sn-menu .sn-menu-inline[data-subject="link"]')).toBeVisible();
  await page.waitForTimeout(800);
  await expect(page.locator('.sn-menu .sn-menu-link-warn')).toHaveCount(0);
});
