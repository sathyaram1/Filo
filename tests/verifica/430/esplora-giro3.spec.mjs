import { createServer } from 'node:http';
import { test, expect } from '../../fixtures/electron.mjs';
import { pagina, schede, carta } from './giro2-carta.mjs';

test('esplora: carta aperta su scheda lenta', async ({ app, shell, openTab, testServer }) => {
  const server = createServer((req, res) => {
    setTimeout(() => {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(pagina('#10b010', 'Lenta'));
    }, 2500);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const lenta = `http://localhost:${server.address().port}/lenta`;
  try {
    const uA = testServer.html(pagina('#1030d0', 'Blu', `<a id="vai" href="${lenta}">vai</a>`));
    const pA = await openTab(uA);
    await pA.click('#vai', { modifiers: ['Control'] });
    let d = null;
    await expect.poll(async () => { d = (await schede(app)).tutte.find((t) => /localhost/.test(t.url))?.id; return !!d; }, { timeout: 5000 }).toBe(true);
    await shell.mouse.move(600, 500);
    await shell.waitForTimeout(900);
    await shell.locator(`.tab[data-id="${d}"]`).hover();
    const t0 = Date.now();
    for (let i = 0; i < 30; i++) {
      const s = (await schede(app)).tutte.find((t) => t.id === d);
      const c = await carta(app);
      const dbg = await app.evaluate(({ BrowserWindow }) => {
        const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
        const t = w._filoTabs;
        const tab = t.tabs.find((x) => /localhost/.test(x.url));
        const f = tab && t.anteprime.get(tab.id);
        return { attesa: tab && tab._anteprimaAttesa, ripresa: tab && tab._anteprimaRipresa, coda: t.anteprime.coda, sotto: t.anteprime.sotto, lav: t.anteprime.lavorando, fw: f && f.w, fh: f && f.h, flen: f && f.src.length };
      });
      console.log(Date.now() - t0, JSON.stringify({ loading: s.loading, foto: s.foto, title: s.title, vis: c.visibile, mostrata: c.mostrata, tit: c.titolo, img: !!c.foto, col: c.colore, b: c.bounds, dbg }));
      await shell.waitForTimeout(350);
    }
  } finally {
    server.closeAllConnections?.();
    await new Promise((r) => server.close(r));
  }
});
