import { test, expect } from '../../fixtures/electron.mjs';

test('sonda: dopo il rilascio delle larghezze ferme', async ({ shell }) => {
  await shell.evaluate(async () => { for (let i = 0; i < 15; i++) await window.filoShell.tabs.open('filo://newtab/'); });
  await expect(shell.locator('#tabs .tab')).toHaveCount(16, { timeout: 15_000 });
  await shell.waitForTimeout(1500);
  const r = await shell.evaluate(() => {
    const el = document.querySelectorAll('#tabs .tab')[5].querySelector('.close').getBoundingClientRect();
    return { x: (el.left + el.right) / 2, y: (el.top + el.bottom) / 2 };
  });
  await shell.mouse.move(r.x, r.y);
  await shell.mouse.click(r.x, r.y);
  await shell.waitForTimeout(800);
  const dur = () => shell.evaluate(() => [...document.querySelectorAll('#tabs .tab')].map((el) => ({
    w: Math.round(el.getBoundingClientRect().width), nat: el.style.getPropertyValue('--tab-naturale'),
    inl: el.style.maxWidth, segno: !!el.__segno,
  })));
  await shell.evaluate(() => document.querySelectorAll('#tabs .tab').forEach((el) => { el.__segno = 1; }));
  console.log('FERME', JSON.stringify((await dur()).slice(0, 4)));
  await shell.mouse.move(r.x, 300);
  await shell.waitForTimeout(2000);
  console.log('RILASCIO', JSON.stringify((await dur()).slice(0, 4)));
  const strip = await shell.evaluate(() => ({ s: document.getElementById('tabs').getBoundingClientRect().width, row: document.querySelector('.tab-row')?.getBoundingClientRect().width }));
  console.log('STRISCIA', JSON.stringify(strip));
});
