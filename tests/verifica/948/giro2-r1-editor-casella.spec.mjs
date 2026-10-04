// Verifica #948 giro 2: nella chat del documento dell'Editor, alla misura di partenza, il microfono non deve
// stringere la casella fino a spezzare il suggerimento su due righe con la barra di scorrimento.
import { test, expect } from '../../fixtures/electron.mjs';

test('editor: la casella della chat col microfono non scorre già da vuota', async ({ shell, openTab }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const ed = await openTab('filo://editor/editor.html');
  await ed.waitForSelector('.ed-module[data-type="switch"]');
  await ed.locator('.ed-switch-icon').nth(1).click();
  await ed.waitForSelector('.ed-module[data-type="chat"] .sn-voce-btn');
  await ed.waitForTimeout(300);
  const m = await ed.evaluate(() => {
    const i = document.querySelector('.ed-module[data-type="chat"] [data-chat="input"]');
    return { sh: i.scrollHeight, ch: i.clientHeight, barra: i.offsetWidth - i.clientWidth };
  });
  expect(m.sh).toBeLessThanOrEqual(m.ch);
  expect(m.barra).toBeLessThan(6);
});
