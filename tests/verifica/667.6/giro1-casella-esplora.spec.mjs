// Esplorazione del giro 1 del #667.6: la casella della chat dell'editor, col microfono accanto, in condizioni insolite.
import { test, expect } from '../../fixtures/electron.mjs';
import { mkdirSync } from 'node:fs';

const SHOTS = 'tests/.shots';

async function apri(shell, openTab) {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const ed = await openTab('filo://editor/editor.html');
  await ed.waitForSelector('.ed-module[data-type="switch"]');
  await ed.locator('.ed-switch-icon').nth(1).click();
  const chat = ed.locator('.ed-module[data-type="chat"]');
  await expect(chat.locator('.sn-voce-btn')).toBeVisible();
  const casella = chat.locator('[data-chat="input"]');
  const misura = () => casella.evaluate((i) => ({ sh: i.scrollHeight, ch: i.clientHeight, h: i.offsetHeight }));
  return { ed, chat, casella, misura };
}

test('casella: tema scuro, cinque righe, emoji e parola lunga', async ({ app, shell, openTab }) => {
  test.setTimeout(60_000);
  await app.evaluate(({ nativeTheme }) => { nativeTheme.themeSource = 'dark'; });
  const { chat, casella, misura } = await apri(shell, openTab);
  mkdirSync(SHOTS, { recursive: true });
  await casella.fill(Array.from({ length: 5 }, (_, i) => `riga ${i + 1} 😀`).join('\n'));
  const cinque = await misura();
  console.log('cinque', JSON.stringify(cinque));
  expect(cinque.sh).toBeLessThanOrEqual(cinque.ch);
  await chat.screenshot({ path: `${SHOTS}/667-6-scuro-cinque.png` });
  await casella.fill('x'.repeat(400));
  const lunga = await misura();
  console.log('parola', JSON.stringify(lunga));
  const [c, mod] = await Promise.all([casella.boundingBox(), chat.boundingBox()]);
  expect(c.x + c.width).toBeLessThanOrEqual(mod.x + mod.width + 1);
  expect(c.y + c.height).toBeLessThanOrEqual(mod.y + mod.height + 1);
  await chat.screenshot({ path: `${SHOTS}/667-6-scuro-parola.png` });
});

test('casella: finestra bassa, il suggerimento si legge e il testo lungo non trabocca', async ({ app, shell, openTab }) => {
  test.setTimeout(60_000);
  const { ed, chat, casella, misura } = await apri(shell, openTab);
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    const b = w.getBounds();
    w.setBounds({ ...b, height: 420 });
  });
  await ed.waitForTimeout(500);
  const vuota = await misura();
  console.log('bassa vuota', JSON.stringify(vuota), JSON.stringify(await chat.boundingBox()));
  expect(vuota.sh).toBeLessThanOrEqual(vuota.ch);
  await casella.fill('una domanda lunghissima sul documento '.repeat(30));
  const [c, mod, reg] = await Promise.all([casella.boundingBox(), chat.boundingBox(), chat.locator('[data-chat="log"]').boundingBox()]);
  console.log('bassa lunga', JSON.stringify({ c, mod, reg }));
  mkdirSync(SHOTS, { recursive: true });
  await chat.screenshot({ path: `${SHOTS}/667-6-bassa-lunga.png` });
  expect(c.y + c.height).toBeLessThanOrEqual(mod.y + mod.height + 1);
});
