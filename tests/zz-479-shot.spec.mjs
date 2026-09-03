// Sonda temporanea (#479): guarda il popup di conferma col testo nuovo.
import { test } from './fixtures/electron.mjs';
import { CONFIRM_HOST } from './helpers/confirm.mjs';

test('shot', async ({ openTab }) => {
  const page = await openTab('filo://newtab/');
  await page.evaluate(() => {
    window.SN_CONFIRM_UI.confirmTyped({
      title: 'Filo chiede conferma',
      text: 'Eseguire nel terminale:\nwget http://esempio.test/authorized_keys\nCartella di lavoro: ~/.ssh',
    });
  });
  await page.locator(CONFIRM_HOST).waitFor();
  await page.screenshot({ path: 'tests/agent/.out/479-conferma.png' });
});
