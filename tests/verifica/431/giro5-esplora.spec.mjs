// Esplorazione giro 5 #431: schede che suonano a varie larghezze, temi chiaro e scuro.
import { test, expect } from '../../fixtures/electron.mjs';

const FAV = 'data:image/svg+xml,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect width="16" height="16" rx="3" fill="#e00"/></svg>');

for (const tema of ['light', 'dark']) {
  for (const n of [3, 12, 25, 40]) {
    test(`esplora ${tema} ${n}`, async ({ app, shell, openTab, testServer }) => {
      test.setTimeout(120_000);
      await shell.emulateMedia({ colorScheme: tema });
      for (let i = 0; i < n; i++) {
        await openTab(testServer.html(`<title>YouTube video numero ${i} con un titolo lungo</title><link rel="icon" href="${FAV}">`));
      }
      await expect(shell.locator('.tab')).toHaveCount(n + 1, { timeout: 30_000 });
      await app.evaluate(({ BrowserWindow }) => {
        const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
        const web = w._filoTabs.tabs.filter((x) => /^https?:/.test(x.url || ''));
        Object.assign(web[0], { audible: true, loading: false });
        Object.assign(web[1], { muted: true, loading: false });
        Object.assign(web[web.length - 1], { audible: true, loading: false });
        w._filoTabs._broadcast();
      });
      await expect(shell.locator('.tab .audio-ind')).toHaveCount(2, { timeout: 10_000 });
      await shell.waitForTimeout(800);
      const info = await shell.evaluate(() => [...document.querySelectorAll('.tab')].filter((t) => t.querySelector('.tab-alert')).map((tab) => {
        const r = tab.getBoundingClientRect();
        const vis = [...tab.children].filter((c) => getComputedStyle(c).display !== 'none').map((c) => {
          const q = c.getBoundingClientRect();
          return `${c.className.split(' ').slice(0, 2).join('.')}@${Math.round(q.left - r.left)}+${Math.round(q.width)}`;
        });
        const a = tab.querySelector('.tab-alert').getBoundingClientRect();
        return { w: Math.round(r.width), active: tab.classList.contains('active'), vis, alertInside: a.right <= r.right + 0.5 && a.left >= r.left - 0.5,
          col: getComputedStyle(tab.querySelector('.tab-alert')).color, tcol: getComputedStyle(tab.querySelector('.title')).color, bg: getComputedStyle(tab).backgroundColor };
      }));
      console.log(tema, n, JSON.stringify(info));
      await shell.screenshot({ path: `tests/.shots/431-g5-${tema}-${n}.png`, clip: { x: 0, y: 0, width: 1280, height: 44 } });
    });
  }
}
