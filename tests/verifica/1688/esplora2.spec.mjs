import { test, expect } from '../../fixtures/electron.mjs';

async function patch(app, p) {
  return app.evaluate(({ BrowserWindow }, p) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
    p.forEach((q, i) => { if (q && w._filoTabs.tabs[i]) Object.assign(w._filoTabs.tabs[i], q); });
    w._filoTabs._broadcast();
    return w._filoTabs.tabs.map((t) => t.id);
  }, p);
}

async function schede(shell, app, n, larga, extra) {
  await app.evaluate(({ BrowserWindow }, larga) => BrowserWindow.getAllWindows().find((x) => x._filoTabs).setSize(larga, 700), larga);
  await shell.evaluate(async (k) => { for (let i = 0; i < k; i++) await window.filoShell.tabs.open('filo://newtab/'); }, n - 1);
  await expect(shell.locator('#tabs .tab')).toHaveCount(n, { timeout: 20_000 });
  await expect(shell.locator('#tabs .tab .spinner')).toHaveCount(0, { timeout: 20_000 });
  return patch(app, Array.from({ length: n }, (_, i) => ({ url: `https://esempio${i}.test/p`, title: `Sito numero ${i} con un titolo lungo`, ...(extra(i) || {}) })));
}

const geo = (shell, id) => shell.evaluate((id) => {
  const t = document.querySelector(`#tabs .tab[data-id="${id}"]`);
  const r = (e) => { if (!e || getComputedStyle(e).display === 'none') return null; const q = e.getBoundingClientRect(); return [Math.round(q.left), Math.round(q.right)]; };
  return { tab: r(t), ico: r(t.querySelector('.favicon')), title: r(t.querySelector('.title')), illeg: t.querySelector('.title').classList.contains('illeggibile'), perm: r(t.querySelector('.tab-permessi')), alert: r(t.querySelector('.tab-alert')), close: r(t.querySelector('.close')) };
}, id);

test('permessi e audio, hover', async ({ shell, app }) => {
  const ids = await schede(shell, app, 9, 1280, (i) => (i === 2 ? { audible: true, permessi: { usati: ['audio', 'video'], negati: [] } } : i === 3 ? { audible: true, permessi: { usati: [], negati: ['notifiche'] } } : null));
  await shell.waitForTimeout(400);
  for (const k of [2, 3]) {
    await shell.locator(`#tabs .tab[data-id="${ids[k]}"] .title`).hover();
    await shell.waitForTimeout(300);
    console.log('GEO', k, JSON.stringify(await geo(shell, ids[k])));
    await shell.screenshot({ path: `tests/.shots/1688-g2-perm-${k}.png`, clip: { x: 0, y: 0, width: 700, height: 50 } });
  }
});

for (const n of [15, 16, 17, 18]) {
  test(`stretta ${n} con audio, hover vicino a favicon`, async ({ shell, app }) => {
    const ids = await schede(shell, app, n, 1280, (i) => (i === 2 ? { audible: true } : null));
    await shell.waitForTimeout(400);
    await shell.locator(`#tabs .tab[data-id="${ids[2]}"]`).hover();
    await shell.waitForTimeout(300);
    console.log('GEO', n, JSON.stringify(await geo(shell, ids[2])));
    await shell.screenshot({ path: `tests/.shots/1688-g2-n${n}.png`, clip: { x: 0, y: 0, width: 500, height: 50 } });
  });
}

test('9 schede: X e altoparlante sulla scheda dietro che suona, tema scuro', async ({ shell, app }) => {
  await shell.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
  const ids = await schede(shell, app, 9, 1280, (i) => (i === 2 ? { audible: true } : null));
  await shell.waitForTimeout(400);
  const tab = shell.locator(`#tabs .tab[data-id="${ids[2]}"]`);
  await tab.hover();
  await shell.waitForTimeout(300);
  console.log('GEO9', JSON.stringify(await geo(shell, ids[2])));
  await shell.screenshot({ path: 'tests/.shots/1688-g2-dark.png', clip: { x: 0, y: 0, width: 700, height: 50 } });
  await tab.locator('.tab-alert').click();
  await expect.poll(() => app.evaluate(({ BrowserWindow }, id) => !!BrowserWindow.getAllWindows().find((x) => x._filoTabs)._filoTabs.tabs.find((t) => t.id === id).muted, ids[2])).toBe(true);
  await expect(tab).not.toHaveClass(/active/);
  await tab.hover();
  await tab.locator('.close').click();
  await expect(shell.locator('#tabs .tab')).toHaveCount(8);
});
