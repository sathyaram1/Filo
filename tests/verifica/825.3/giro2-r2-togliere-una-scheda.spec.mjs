// Verifica #825.3, giro 2, rilievo 2: il pannello di cancellazione è tutto o
// niente; una scheda proposta per sbaglio non si può togliere dall'elenco.

import { test, expect } from '../../fixtures/electron.mjs';
import { clickConfirm, fillConfirmInput } from '../../helpers/confirm.mjs';
import { newtabPage, prepara, chiedi } from './_comune.mjs';

test('una scheda proposta per sbaglio si toglie dall\'elenco e resta in archivio', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  // «Gattopardo» è un romanzo: il giudice finto lo prende per sbaglio.
  await prepara(app, [
    { title: 'Gatti persiani', gatto: true },
    { title: 'Il Gattopardo, recensione', gatto: true },
    { title: 'Ricetta della torta', gatto: false },
  ]);
  await chiedi(page);
  const panel = page.locator('.dash-delete-panel');
  await expect(panel.locator('.dash-delete-list li')).toHaveCount(2, { timeout: 15_000 });
  const daTenere = panel.locator('.dash-delete-list li', { hasText: 'Gattopardo' });
  await daTenere.getByRole('checkbox').uncheck({ timeout: 3_000 });
  await panel.locator('.dash-action-btn-danger').click();
  await fillConfirmInput(page, 'conferma');
  await clickConfirm(page, 'danger');
  await expect(panel.locator('.dash-delete-note')).toContainText('Eliminata', { timeout: 5_000 });
  const rimaste = await app.evaluate(async () => (await globalThis.SN_ARCHIVED_TABS.list()).map((x) => x.title));
  expect(rimaste.sort()).toEqual(['Il Gattopardo, recensione', 'Ricetta della torta']);
});
