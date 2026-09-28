// #592 giro 20, rilievo 1: nell'Aiuto una conferma da digitare che si apre da
// sola poco dopo l'invio di un messaggio prende «conferma» nel suo campo, non
// nel campo della chat (l'Invio che ha spedito non vuol dire «sta scrivendo»).

import { test, expect } from '../../fixtures/electron.mjs';
import { CONFIRM_HOST, confirmState } from '../../helpers/confirm.mjs';

test('nell’Aiuto, dopo l’invio, «conferma» battuto nel popup da digitare finisce nel suo campo', async ({ openTab }) => {
  test.setTimeout(60_000);
  const page = await openTab('filo://newtab/');
  await page.evaluate(() => window.SN_SIDEBAR.open());
  const area = page.locator('.sn-sidebar-input textarea');
  await expect(area).toBeVisible();
  await area.click();
  await page.keyboard.type('cancella tutta la memoria', { delay: 20 });
  await page.keyboard.press('Enter');
  await page.waitForTimeout(800);
  const corsa = page.evaluate(() => window.__filoSidebarTest.runFiloAction({ type: 'CANCELLA_MEMORIA' }));
  await expect(page.locator(CONFIRM_HOST)).toBeVisible({ timeout: 10_000 });
  const s0 = await confirmState(page);
  expect(s0.hasInput).toBe(true);
  await page.waitForTimeout(300);
  await page.keyboard.type('conferma', { delay: 60 });
  const s1 = await confirmState(page);
  const chat = await area.inputValue();
  await page.keyboard.press('Escape');
  await corsa;
  expect(chat, '«conferma» è finito nel campo della chat').toBe('');
  expect(s1.okDisabled, '«conferma» non è arrivato al campo del popup').toBe(false);
});

test('nell’Aiuto, dopo un popup confermato da tastiera, «conferma» battuto nel popup da digitare che segue finisce nel suo campo', async ({ openTab }) => {
  test.setTimeout(60_000);
  const page = await openTab('filo://newtab/');
  await page.evaluate(() => window.SN_SIDEBAR.open());
  const area = page.locator('.sn-sidebar-input textarea');
  await expect(area).toBeVisible();
  await area.click();
  await page.waitForTimeout(2500);
  await page.evaluate(() => {
    window.__esito = undefined;
    window.SN_CONFIRM_UI.confirm({ title: 'Filo chiede conferma', text: 'Procedo?' })
      .then(() => window.SN_CONFIRM_UI.confirmTyped({ title: 'Filo chiede conferma', text: 'Eliminare tutta la memoria.' }))
      .then((r) => { window.__esito = r; });
  });
  await expect(page.locator(CONFIRM_HOST)).toBeVisible();
  await page.waitForTimeout(700);
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await confirmState(page))?.hasInput).toBe(true);
  await page.waitForTimeout(300);
  await page.keyboard.type('conferma', { delay: 60 });
  const s1 = await confirmState(page);
  const chat = await area.inputValue();
  await page.keyboard.press('Escape');
  expect(chat, '«conferma» è finito nel campo della chat').toBe('');
  expect(s1.okDisabled, '«conferma» non è arrivato al campo del popup').toBe(false);
});
