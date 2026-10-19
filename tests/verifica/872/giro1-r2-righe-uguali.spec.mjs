// Verifica #872 giro 1, rilievo 2: due righe uguali nello stesso argomento si vedono e si tolgono come due righe.

import { test, expect } from '../../fixtures/electron.mjs';

const QUADERNO = 'filo://quaderno/quaderno.html';

test('r2 correggo una riga nel testo di un\'altra: il quaderno mostra quello che Filo ricorda, e togliere la riga la toglie', async ({ app, shell, openTab }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  await app.evaluate(() => globalThis.SN_FILO_MEMORY.setMemory({ PROFILO: '', PREFERENZE: 'Ama il tè\nAma il caffè' }));
  const page = await openTab(QUADERNO);
  await expect(page.locator('.qd-riga')).toHaveCount(2, { timeout: 8_000 });
  await page.locator('.qd-riga', { hasText: 'Ama il caffè' }).locator('.qd-testo').dblclick();
  await page.locator('.qd-campo').fill('Ama il tè');
  await page.locator('.qd-campo').press('Enter');
  await expect(page.locator('#esito')).toBeVisible();
  await page.waitForTimeout(500);
  const righe = (await app.evaluate(() => globalThis.SN_FILO_MEMORY.getMemory())).PREFERENZE.split('\n').filter(Boolean);
  // Il conteggio del gruppo e le righe a schermo dicono la stessa cosa della memoria che entra nel prompt.
  await expect(page.locator('.qd-gruppo .qd-riga')).toHaveCount(righe.length);
  await expect(page.locator('.qd-gruppo h2 .qd-conto').first()).toHaveText(String(righe.length));

  // L'utente toglie la riga che vede: non deve restare in memoria.
  const vista = page.locator('.qd-riga', { hasText: 'Ama il tè' }).first();
  await vista.hover();
  await vista.locator('.qd-tasto[title="Togli dalla memoria"]').click();
  await expect(page.locator('#esito')).toContainText('Tolta');
  await expect.poll(async () => (await app.evaluate(() => globalThis.SN_FILO_MEMORY.getMemory())).PREFERENZE).not.toContain('Ama il tè');
});
