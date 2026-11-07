// #2095 giro 2, rilievo 1: un'etichetta che il codice toglie mentre il puntatore è sopra torna al suo posto all'uscita,
// vecchia. Il seguito «In attesa» della home, letto da Filo, resta per sempre «In attesa» al passaggio del mouse.
import { test, expect } from '../../fixtures/electron.mjs';
import { newtabPage, configureModel, copione, ripristina } from '../../helpers/copione.mjs';

const fumetto = (page) => page.locator('[data-sn-fumetto] .tip');
const LENTO = { pensa: ['Ci penso. ', 'Ancora. ', 'Quasi. ', 'Ecco. '], ogni: 700, testo: 'Prima risposta.' };

test('r1 home: il seguito letto da Filo non dice più «In attesa», anche se il puntatore ci stava sopra', async ({ app, shell }) => {
  test.setTimeout(60_000);
  try {
    await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
    const page = await newtabPage(app);
    await page.waitForFunction(() => !!window.SN_SUGGERIMENTO, null, { timeout: 15_000 });
    await configureModel(app);
    await copione(app, [LENTO, { testo: 'Risposta al seguito.' }]);
    await page.locator('#input').fill('prima domanda');
    await page.locator('#input').press('Enter');
    await expect(page.locator('#stopBtn')).toBeVisible({ timeout: 5_000 });
    await page.locator('#input').fill('seguito da leggere');
    await page.locator('#input').press('Enter');
    const bolla = page.locator('.dash-bubble-user.dash-bubble-attesa', { hasText: 'seguito da leggere' });
    await expect(bolla).toBeVisible({ timeout: 2_000 });
    await bolla.hover();
    await expect(fumetto(page)).toHaveText('In attesa');
    // Filo legge il seguito: la bolla non è più in attesa.
    const letta = page.locator('.dash-bubble-user', { hasText: 'seguito da leggere' });
    await expect(letta).not.toHaveClass(/dash-bubble-attesa/, { timeout: 20_000 });
    await expect.soft(fumetto(page), 'col puntatore sopra, il fumetto non dice più «In attesa»').not.toHaveText('In attesa', { timeout: 2_000 });
    await page.mouse.move(2, 2);
    await page.waitForTimeout(300);
    expect(await letta.evaluate((el) => el.getAttribute('title')), 'la bolla letta non ha più l\'etichetta «In attesa»').toBeNull();
  } finally {
    await ripristina(app);
  }
});

test('r1 Preferenze: un title tolto dal codice durante il passaggio non torna all\'uscita', async ({ openTab }) => {
  const page = await openTab('filo://preferences/preferences.html');
  await page.waitForFunction(() => !!window.SN_SUGGERIMENTO);
  await page.evaluate(() => {
    const b = document.createElement('button');
    b.id = 'pTolto';
    b.textContent = 'Prova';
    b.title = 'Spento finché manca la chiave';
    b.style.cssText = 'position:fixed;left:200px;top:200px;z-index:2147480000;font-size:30px';
    document.body.appendChild(b);
  });
  const tasto = page.locator('#pTolto');
  await tasto.hover();
  await expect(fumetto(page)).toHaveText('Spento finché manca la chiave');
  // Come un tasto che si riaccende mentre lo si guarda: il codice toglie la spiegazione.
  await tasto.evaluate((el) => el.removeAttribute('title'));
  await expect(fumetto(page)).toBeHidden({ timeout: 2_000 });
  await page.mouse.move(2, 2);
  await page.waitForTimeout(300);
  expect(await tasto.evaluate((el) => el.getAttribute('title'))).toBeNull();
});
