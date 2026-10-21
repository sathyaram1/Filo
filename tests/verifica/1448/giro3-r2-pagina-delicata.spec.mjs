// Verifica #1448 giro 3, rilievo 2: in un sito dove si è fatto l'accesso (o nella posta) un dato da cercare non deve
// finire in «Non ho trovato questo dato.» senza che nessuna ricerca sia partita: o lo cerca, o lo dice e lascia cercare.

import { test, expect } from '../../fixtures/electron.mjs';
import { menuDi } from '../../helpers/menuContestuale.mjs';
import { riquadroDelSegno } from '../../helpers/segniDelCorrettore.mjs';
import { apri, valore, ocra } from './giro3-aiuto.mjs';

test('r2 sito con l accesso fatto: il p/e di Google si può avere, e Filo non dice di non averlo trovato', async ({ app, openTab, testServer }) => {
  const page = await apri(app, openTab, testServer);
  await app.evaluate(async (_e, u) => { await globalThis.SN_DELICATE.segnaCampi(u); }, page.url());
  await page.locator('#ta').click();
  await page.keyboard.type('Google ha un p/e di soli xx, davvero basso. ');
  await expect(ocra(page, 'xx')).toHaveCount(1, { timeout: 8000 });
  await expect.poll(() => app.evaluate(() => globalThis.__letture), { timeout: 8000 }).toBeGreaterThan(0);
  await page.waitForTimeout(2500);
  if (await valore(page, '27').count()) return;
  const b = await riquadroDelSegno(ocra(page, 'xx'));
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2, { button: 'right' });
  const menu = menuDi(page);
  await expect(menu.pannelli.first()).toBeVisible({ timeout: 5000 });
  await expect(menu.pannelli.first()).not.toContainText('Non ho trovato questo dato');
  await menu.pannelli.first().getByText(/^Cerca/).first().click();
  await expect(valore(page, '27')).toBeVisible({ timeout: 8000 });
});
