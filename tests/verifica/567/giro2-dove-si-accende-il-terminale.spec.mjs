// #567.2, secondo giro — il primo giro ha verificato che il riquadro del
// comando bloccato spiega e che il bottone apre le Preferenze. Qui si guarda se
// l'utente ci ARRIVA davvero: chi non sa dell'interruttore deve trovarselo
// davanti, non cercarlo in una pagina lunga.

import { test, expect } from '../../fixtures/electron.mjs';
import { newtabPage, configureModel, fakeProvider, restore, chiedi } from './aiuto.mjs';

test('il bottone del comando bloccato porta l\'utente DAVANTI all\'interruttore', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await configureModel(app);
  await app.evaluate(async () => {
    await globalThis.SN_STORAGE.updateSettings({ terminal: { enabled: false } });
  });

  await fakeProvider(app, [
    { toolCalls: [{ id: 'g2t', name: 'ESEGUI_COMANDO', arguments: '{"comando":"ls -la"}' }] },
    { text: 'Non è partito.' },
  ], '__v567g2t');

  await chiedi(page, 'lancia ls -la');
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Non è partito.' })).toBeVisible({ timeout: 10_000 });

  const apri = page.locator('.dash-cmd-blocked-btn');
  await expect(apri).toBeVisible();
  await apri.click();

  const deadline = Date.now() + 10_000;
  let pref = null;
  while (Date.now() < deadline && !pref) {
    pref = app.windows().find((w) => w.url().includes('preferences'));
    if (!pref) await page.waitForTimeout(150);
  }
  expect(pref, 'le Preferenze non si sono aperte').toBeTruthy();
  await pref.waitForLoadState('domcontentloaded');
  const sw = pref.locator('#terminalEnabled');
  await expect(sw).toHaveCount(1);
  // Arrivare sulla pagina non basta: l'interruttore deve essere sotto gli occhi.
  await pref.waitForTimeout(600);
  const dentro = await sw.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return r.top >= 0 && r.bottom <= (window.innerHeight || 0);
  });
  expect(dentro, 'l\'interruttore della modalità terminale non è nella parte di pagina che si vede').toBe(true);

  await restore(app, '__v567g2t');
});
