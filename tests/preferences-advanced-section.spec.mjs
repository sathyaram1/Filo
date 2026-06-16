// Preferenze: i controlli estetici di basso livello (token estetici + colore
// identità delle tab) vivono in fondo alla pagina, raggruppati sotto
// "Impostazioni avanzate" con un testo introduttivo.
//
// Feedback: "queste devono essere tutte impostazioni avanzate. mettile a fine
// della pagina come «impostazioni avanzate» sotto «qui puoi modificare ogni
// aspetto estetico di filo, ricorda però che puoi sempre chiedere a filo di
// fare modifiche…»".

import { test, expect } from './fixtures/electron.mjs';

test('le impostazioni estetiche stanno in fondo, sotto "Impostazioni avanzate"', async ({ openTab }) => {
  const page = await openTab('filo://preferences/preferences.html');
  await page.waitForSelector('#sec-advanced', { timeout: 8000 });

  // La sezione avanzata esiste, ha il titolo e il testo introduttivo richiesti.
  const adv = page.locator('#sec-advanced');
  await expect(adv.locator('> h2')).toHaveText('Impostazioni avanzate');
  await expect(adv.locator('> p.sn-muted')).toContainText('puoi sempre chiedere a Filo');
  await expect(adv.locator('> p.sn-muted')).toContainText('ogni aspetto estetico');

  // I due gruppi estetici sono DENTRO la sezione avanzata (non più sparsi su).
  await expect(adv.locator('#sec-tokens')).toHaveCount(1);
  await expect(adv.locator('#sec-tabcolor')).toHaveCount(1);

  // È in fondo alla pagina: è l'ultima <section> della pagina.
  const lastSectionId = await page.evaluate(() => {
    const secs = document.querySelectorAll('main.sn-page > section');
    return secs[secs.length - 1].id;
  });
  expect(lastSectionId).toBe('sec-advanced');

  // I controlli interni continuano a funzionare (gli ID sono preservati):
  // l'editor dei token e dei parametri colore è popolato.
  await expect(page.locator('#tokenCode')).toBeVisible();
  await expect(page.locator('#tabColorCode')).toBeVisible();
  await expect(page.locator('#resetAllTokens')).toBeVisible();
  await expect(page.locator('#resetAllTabColor')).toBeVisible();
});
