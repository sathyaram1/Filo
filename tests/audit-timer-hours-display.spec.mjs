// #323 — un timer di ore deve mostrarsi come conto alla rovescia da orologio
// (H:MM:SS), non come minuti totali giganti ("120:00" per 2 ore, "480:00" per 8).
//
// La card del timer nella colonna live della nuova scheda ora passa alle ore:
// "timer di 2 ore" → "2:00:00" (subito dopo la creazione ~"1:59:5x"). Il test
// asserisce il SUCCESSO: fallisce se torna il formato a minuti totali.

import { test, expect } from './fixtures/electron.mjs';

const NEWTAB = 'filo://newtab/';

test('timer di 2 ore: la card mostra H:MM:SS, non 120:00', async ({ app, openTab }) => {
  const page = await openTab(NEWTAB);
  await page.waitForLoadState('domcontentloaded');

  const r = await app.evaluate((_e, action) =>
    globalThis.SN_EXECUTE_FILO_ACTION(action, {}), { type: 'TIMER', seconds: 7200, label: 'Forno' });
  expect(r.executed).toBe(true);

  const card = page.locator('.dash-live-card', { hasText: 'Forno' });
  await expect(card).toBeVisible({ timeout: 10_000 });
  const txt = await card.innerText();
  // Corretto: ore:minuti:secondi (una cifra di ore, due di minuti/secondi).
  expect(txt).toMatch(/\b[12]:\d\d:\d\d\b/);
  // Regressione: mai minuti totali a tre cifre tipo "120:00".
  expect(txt).not.toMatch(/\b\d{3}:\d\d\b/);

  await page.screenshot({ path: 'tests/.shots/audit-timer-hours.png' });
});
