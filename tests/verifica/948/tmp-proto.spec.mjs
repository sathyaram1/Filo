import { test, expect } from '../../fixtures/electron.mjs';
test('proto', async ({ shell, openTab }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const ed = await openTab('filo://editor/editor.html');
  await ed.waitForSelector('.ed-module[data-type="switch"]');
  await ed.locator('.ed-switch-icon').nth(1).click();
  await ed.waitForSelector('.ed-module[data-type="chat"] .sn-voce-btn');
  console.log(await ed.evaluate(() => {
    const i = document.querySelector('.ed-module[data-type="chat"] [data-chat="input"]');
    const c = document.createElement('canvas').getContext('2d'); c.font = getComputedStyle(i).font;
    const b = i.parentElement.querySelectorAll('button');
    return JSON.stringify({ ph: c.measureText(i.placeholder).width, row: i.parentElement.clientWidth, btns: [...b].map((x) => x.offsetWidth), pad: getComputedStyle(i).paddingLeft });
  }));
});
