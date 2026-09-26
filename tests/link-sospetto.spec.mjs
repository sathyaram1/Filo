// #725 — l'avviso su un link sospetto, nel menu del tasto destro: deve essere
// una frase che chiunque capisce (prima usciva il codice interno
// «⚠️ Link sospetto: typosquatting:paypal.com») e deve esserci anche quando la
// spiegazione del modello non arriva.

import { test, expect } from './fixtures/electron.mjs';

const HTML = `<!doctype html><html><body style="padding:40px;font:16px sans-serif">
  <h1>Pagina di prova</h1>
  <p><a id="falso" href="https://paypa1.com/login">Accedi al tuo conto</a></p>
  <p><a id="pulito" href="https://esempio-tranquillo.test/articolo">Un articolo qualunque</a></p>
  <p><a id="gitlab" href="https://gitlab.com/gitlab-org/gitlab">Il progetto su GitLab</a></p>
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

test('un indirizzo di tutti i giorni non si prende l’avviso', async ({ openTab, testServer }) => {
  // #725 — il confronto con i nomi famosi correva su tutto l'indirizzo con due
  // lettere fisse di tolleranza, e gitlab.com «imitava» github.com. Un avviso
  // rosso sui link di ogni giorno smette di essere letto quando serve.
  const page = await testServer.openReady(openTab, HTML);
  await page.locator('#gitlab').click({ button: 'right' });
  await expect(page.locator('.sn-menu .sn-menu-inline[data-subject="link"]')).toBeVisible();
  await page.waitForTimeout(800);
  await expect(page.locator('.sn-menu .sn-menu-link-warn')).toHaveCount(0);
});

test('la spiegazione arriva da sola: nel menu non c’è niente da cliccare', async ({ openTab, testServer }) => {
  // Il manifesto prometteva «Spiega link» e «Spiegazione», voci che non
  // esistono: la sezione si riempie da sola all'apertura del menu (#725).
  const page = await testServer.openReady(openTab, HTML);
  const menu = page.locator('.sn-menu');

  await page.locator('#falso').click({ button: 'right' });
  await expect(menu.locator('.sn-menu-inline[data-subject="link"]')).toBeVisible();
  await expect(menu.getByText(/^Spieg/)).toHaveCount(0);
  await page.keyboard.press('Escape');

  await page.locator('h1').evaluate((el) => {
    const r = document.createRange();
    r.selectNodeContents(el);
    const s = window.getSelection();
    s.removeAllRanges();
    s.addRange(r);
  });
  await page.locator('h1').click({ button: 'right' });
  await expect(menu.locator('.sn-menu-inline[data-subject="text"]')).toBeVisible();
  await expect(menu.getByText(/^Spiegazione$/)).toHaveCount(0);
});
