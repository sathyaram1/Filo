// #256.4 giro 1, rilievo 1: con la finestra più piccola la casella della chat dell'Editor, col microfono accanto,
// deve ancora mostrare per intero una richiesta di una riga e mezza invece di scorrere.
import { test, expect } from '../../fixtures/electron.mjs';

test('r1 finestra 1024x600: la casella della chat dell\'Editor mostra tutta la richiesta', async ({ app, shell, openTab }) => {
  test.setTimeout(60_000);
  await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].setSize(1024, 640); });
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const ed = await openTab('filo://editor/editor.html');
  await ed.waitForSelector('.ed-module[data-type="switch"]');
  await ed.locator('.ed-switch-icon').nth(1).click();
  const chat = ed.locator('.ed-module[data-type="chat"]');
  await expect(chat.locator('.sn-voce-btn')).toBeVisible();
  const casella = chat.locator('[data-chat="input"]');
  const misura = () => casella.evaluate((i) => ({ sh: i.scrollHeight, ch: i.clientHeight }));
  const vuota = await misura();
  expect(vuota.sh).toBeLessThanOrEqual(vuota.ch);
  await casella.fill('riassumi il secondo paragrafo e dimmi se il tono è adatto a una lettera');
  const piena = await misura();
  expect(piena.sh).toBeLessThanOrEqual(piena.ch);
});
