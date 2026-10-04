// Esplorazione del verificatore #945 giro 1: chiusura dell'ultima scheda col + fermo a vari conti di schede.

import { test, expect } from '../../fixtures/electron.mjs';

async function apriSchede(shell, n) {
  await shell.evaluate(async (k) => {
    for (let i = 0; i < k; i++) await window.filoShell.tabs.open('filo://newtab/');
  }, n - 1);
  await expect(shell.locator('#tabs .tab')).toHaveCount(n, { timeout: 15_000 });
  await expect(shell.locator('#tabs .tab .spinner')).toHaveCount(0, { timeout: 15_000 });
}

for (const n of [10, 14, 17, 19]) {
  test(`${n} schede: chiusa l'ultima inattiva con la X, il + resta e il secondo clic non apre`, async ({ shell }) => {
    await apriSchede(shell, n);
    await shell.evaluate(async () => {
      const id = document.querySelectorAll('#tabs .tab')[0].dataset.id;
      await window.filoShell.tabs.activate(id);
    });
    await expect(shell.locator('#tabs .tab').first()).toHaveClass(/active/);
    const info = await shell.evaluate(() => {
      const t = document.querySelector('#tabs .tab:last-child');
      const x = t.querySelector('.close');
      const vis = getComputedStyle(x).display !== 'none';
      const r = (vis ? x : t).getBoundingClientRect();
      return { w: t.getBoundingClientRect().width, vis, x: (r.left + r.right) / 2, y: (r.top + r.bottom) / 2,
        piu: document.getElementById('tab-new').getBoundingClientRect().left };
    });
    console.log(n, JSON.stringify(info));
    await shell.mouse.move(info.x, info.y);
    if (info.vis) await shell.mouse.click(info.x, info.y);
    else await shell.mouse.click(info.x, info.y, { button: 'middle' });
    await expect(shell.locator('#tabs .tab')).toHaveCount(n - 1, { timeout: 8_000 });
    await shell.waitForTimeout(300);
    const piu = await shell.evaluate(() => document.getElementById('tab-new').getBoundingClientRect().left);
    expect(Math.abs(piu - info.piu)).toBeLessThan(0.5);
    await shell.mouse.click(info.x, info.y);
    await shell.waitForTimeout(600);
    await expect(shell.locator('#tabs .tab')).toHaveCount(n - 1);
  });
}

test('22 schede: il tasto destro su una scheda stretta la chiude', async ({ shell }) => {
  await apriSchede(shell, 22);
  const id = await shell.evaluate(() => document.querySelectorAll('#tabs .tab')[3].dataset.id);
  const vis = await shell.evaluate((i) => getComputedStyle(document.querySelector(`#tabs .tab[data-id="${i}"] .close`)).display, id);
  expect(vis).toBe('none');
  await shell.locator(`#tabs .tab[data-id="${id}"]`).click({ button: 'right' });
  await shell.waitForTimeout(800);
  await shell.screenshot({ path: 'tests/.shots/945-menu.png' });
});

for (const tema of ['light', 'dark']) {
  test(`aspetto 22 schede tema ${tema}`, async ({ app, shell }) => {
    await app.evaluate(({ nativeTheme }, t) => { nativeTheme.themeSource = t; }, tema);
    await apriSchede(shell, 22);
    await shell.locator('#tabs .tab').nth(4).hover();
    await shell.waitForTimeout(400);
    await shell.screenshot({ path: `tests/.shots/945-${tema}.png`, clip: { x: 0, y: 0, width: 1280, height: 60 } });
  });
}
