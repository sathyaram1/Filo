import { test, expect } from '../../fixtures/electron.mjs';

async function patch(app, p) {
  return app.evaluate(({ BrowserWindow }, p) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
    p.forEach((q, i) => { if (q && w._filoTabs.tabs[i]) Object.assign(w._filoTabs.tabs[i], q); });
    w._filoTabs._broadcast();
    return w._filoTabs.tabs.map((t) => t.id);
  }, p);
}

test('foto', async ({ shell, app }) => {
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((x) => x._filoTabs).setSize(1280, 800));
  await shell.evaluate(async () => { for (let i = 0; i < 8; i++) await window.filoShell.tabs.open('filo://newtab/'); });
  await expect(shell.locator('#tabs .tab')).toHaveCount(9, { timeout: 20_000 });
  let ids = await patch(app, Array.from({ length: 9 }, (_, i) => ({ url: `https://esempio${i}.test/p`, title: `Sito numero ${i} con un titolo lungo`, audible: i === 2 || i === 8, muted: i === 4 })));
  await shell.waitForTimeout(400);
  await shell.screenshot({ path: 'tests/.shots/1688-b-9.png', clip: { x: 0, y: 0, width: 1280, height: 50 } });
  await shell.locator(`#tabs .tab[data-id="${ids[2]}"] .title`).hover();
  await shell.waitForTimeout(300);
  await shell.screenshot({ path: 'tests/.shots/1688-b-9-hover.png', clip: { x: 0, y: 0, width: 640, height: 50 } });
  await shell.mouse.move(600, 400);
  await shell.evaluate(async () => { for (let i = 0; i < 4; i++) await window.filoShell.tabs.open('filo://newtab/'); });
  await expect(shell.locator('#tabs .tab')).toHaveCount(13, { timeout: 20_000 });
  ids = await patch(app, Array.from({ length: 13 }, (_, i) => ({ url: `https://esempio${i}.test/p`, title: `Sito numero ${i} con un titolo lungo`, audible: i === 2 || i === 12 })));
  await shell.waitForTimeout(400);
  await shell.screenshot({ path: 'tests/.shots/1688-b-13.png', clip: { x: 0, y: 0, width: 1280, height: 50 } });
  const att = await shell.evaluate(() => { const t = document.querySelector('#tabs .tab.active'); const ti = t.querySelector('.title'); return { w: t.getBoundingClientRect().width, ti: ti.offsetWidth, cls: ti.className }; });
  console.log('ATTIVA', JSON.stringify(att));
});
