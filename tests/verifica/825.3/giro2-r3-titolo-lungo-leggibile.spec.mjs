// Verifica #825.3, giro 2, rilievo 3: il titolo lungo accorciato coi puntini non
// si legge per intero da nessuna parte (al passaggio compare solo l'indirizzo).

import { test, expect } from '../../fixtures/electron.mjs';
import { newtabPage, prepara, chiedi } from './_comune.mjs';

test('titolo accorciato nell\'elenco: al passaggio si legge intero', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  const lungo = 'Gatti persiani: carattere, cura del pelo e alimentazione, guida completa per chi vuole adottarne uno';
  await prepara(app, [{ title: lungo, gatto: true }, { title: 'Ricetta della torta', gatto: false }]);
  await chiedi(page);
  const li = page.locator('.dash-delete-panel .dash-delete-list li');
  await expect(li).toHaveCount(1, { timeout: 15_000 });
  expect(await li.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
  expect(await li.getAttribute('title')).toContain(lungo);
});
