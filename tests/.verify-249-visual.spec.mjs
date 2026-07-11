import { test } from './fixtures/electron.mjs';

test.setTimeout(20_000);
const NEWTAB = 'filo://newtab/';

test('visual: livello 2 e livello 3 rendono dentro lo shadow closed', async ({ openTab }) => {
  const page = await openTab(NEWTAB);
  // Livello 2
  await page.evaluate(() => { window.SN_CONFIRM_UI.confirm({ title: 'Conferma invio', text: 'Vuoi inviare questo feedback agli sviluppatori?\n\n"Lo schermo intero lascia la barra."', okLabel: 'Invia', cancelLabel: 'Annulla' }); });
  await page.waitForTimeout(200);
  await page.screenshot({ path: 'tests/.shots/verify-249-level2.png' });
  await page.evaluate(() => window.SN_CONFIRM_UI._test.click('cancel'));
  await page.waitForTimeout(100);
  // Livello 3
  await page.evaluate(() => { window.SN_CONFIRM_UI.confirmTyped({ title: 'Azione irreversibile', text: 'Stai per eliminare tutto.', word: 'conferma' }); });
  await page.waitForTimeout(200);
  await page.screenshot({ path: 'tests/.shots/verify-249-level3.png' });
  await page.evaluate(() => window.SN_CONFIRM_UI._test.click('cancel'));
});
