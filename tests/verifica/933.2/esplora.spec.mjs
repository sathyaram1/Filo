import { test, expect } from '../../fixtures/electron.mjs';
import { mkdirSync } from 'node:fs';

test('esplora misure', async ({ shell, openTab }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const ed = await openTab('filo://editor/editor.html');
  await ed.waitForSelector('.ed-module[data-type="switch"]');
  await ed.locator('.ed-switch-icon').nth(1).click();
  const chat = ed.locator('.ed-module[data-type="chat"]');
  await expect(chat.locator('.sn-voce-btn')).toBeVisible();
  const casella = chat.locator('[data-chat="input"]');
  const dump = async (tag) => {
    const m = await ed.evaluate(() => {
      const i = document.querySelector('.ed-module[data-type="chat"] [data-chat="input"]');
      const mod = document.querySelector('.ed-module[data-type="chat"]');
      const ec = i.closest('.ed-chat');
      const cs = getComputedStyle(i);
      return { dpr: devicePixelRatio, win: [innerWidth, innerHeight], mod: [mod.offsetWidth, mod.offsetHeight], edchat: ec && [ec.clientWidth, ec.clientHeight],
        ta: [i.offsetWidth, i.offsetHeight, i.clientHeight, i.scrollHeight], maxH: cs.maxHeight, font: cs.fontFamily, fs: cs.fontSize, ph: i.placeholder };
    });
    console.log(tag, JSON.stringify(m));
  };
  await dump('vuota');
  await casella.fill('riassumi il secondo paragrafo e dimmi se il tono è adatto a una lettera');
  await dump('piena');
  mkdirSync('tests/.shots', { recursive: true });
  await ed.screenshot({ path: `tests/.shots/933-2-${process.env.FILO_TEST_SCALE || '1'}.png` });
  await chat.screenshot({ path: `tests/.shots/933-2-chat-${process.env.FILO_TEST_SCALE || '1'}.png` });
});
