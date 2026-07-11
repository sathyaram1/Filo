// AUDIT (prober) — riproduzione: un timer di ore viene mostrato come "120:00".
//
// La card del timer nella colonna live della nuova scheda formatta il residuo
// come mm:ss senza mai passare alle ore: "timer di 2 ore" → "120:00",
// "timer di 8 ore" → "480:00". Documenta il comportamento attuale (passa oggi).

import { test, expect } from './fixtures/electron.mjs';

const NEWTAB = 'filo://newtab/';

test('timer di 2 ore: la card mostra 120:00 invece di 2:00:00', async ({ app, openTab }) => {
  const page = await openTab(NEWTAB);
  await page.waitForLoadState('domcontentloaded');

  const r = await app.evaluate((_e, action) =>
    globalThis.SN_EXECUTE_FILO_ACTION(action, {}), { type: 'TIMER', seconds: 7200, label: 'Forno' });
  expect(r.executed).toBe(true);

  const card = page.locator('.dash-live-card', { hasText: 'Forno' });
  await expect(card).toBeVisible({ timeout: 10_000 });
  const txt = await card.innerText();
  // Comportamento attuale (bug): minuti totali, niente ore.
  expect(txt).toMatch(/1[12][09]:\d\d/); // ~120:00 (119:5x subito dopo la creazione)
  expect(txt).not.toMatch(/2:00:00/);

  await page.screenshot({ path: 'tests/.shots/audit-timer-hours.png' });
});
