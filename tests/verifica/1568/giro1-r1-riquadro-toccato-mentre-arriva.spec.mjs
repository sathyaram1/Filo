// #1568 giro 1, rilievo 1: un riquadro dello stesso sito ancora in arrivo perde Filo anche se lo tocca un altro pezzo
// di Filo, non solo il tracciatore dei moduli: il puntatore che si muove sulla pagina, una pubblicità bloccata.
import { test, expect } from '../../fixtures/electron.mjs';
import { menuDi } from '../../helpers/menuContestuale.mjs';
import { riquadriInRitardo } from '../../helpers/riquadriInRitardo.mjs';

const INNER = `<!doctype html><html><body style="margin:0;padding:16px;font:16px sans-serif">
  <p id="inner-text">Testo dentro il riquadro incorporato, lungo abbastanza da poterlo selezionare e spiegare.</p>
</body></html>`;
const CORNICE = `<!doctype html><html><body style="margin:0;padding:12px;font:16px sans-serif">
  <p id="outer-text">Testo della pagina.</p>
  <iframe id="embed" src="/riquadro/1" width="600" height="420" style="border:1px solid #333"></iframe>
</body></html>`;

async function nellaScheda(app, page, src) {
  const url = await page.evaluate(() => location.href);
  return app.evaluate(({ webContents }, { u, src }) => {
    const f = new Function('wc', src);
    for (const wc of webContents.getAllWebContents()) {
      let here = '';
      try { here = wc.getURL(); } catch (_) {}
      if (here === u) f(wc);
    }
  }, { u: url, src });
}

const strade = {
  'r1 il puntatore si muove sulla pagina mentre il riquadro arriva: il tasto destro nel riquadro apre il menu di Filo':
    `for (const [x, y] of [[5, 5], [100, 20], [200, 22]]) wc.sendInputEvent({ type: 'mouseMove', x, y });`,
  'r1 una pubblicità bloccata nella pagina mentre il riquadro arriva: il tasto destro nel riquadro apre il menu di Filo':
    `wc.send('filo:adblock-chiudi', ['http://127.0.0.1:9/ad.png']);`,
};
for (const [nome, gesto] of Object.entries(strade)) test(nome, async ({ app, openTab }) => {
  const sito = await riquadriInRitardo(CORNICE, INNER);
  try {
    const page = await openTab(sito.url);
    await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 15_000 });
    expect(sito.serviti()).toBe(0);
    await nellaScheda(app, page, gesto);
    await page.waitForTimeout(500);
    sito.apri();
    await expect.poll(async () => {
      const st = await Promise.all(page.frames().filter((f) => f.url().includes('/riquadro')).map((f) => f.evaluate(() => document.readyState).catch(() => '')));
      return st.filter((s) => s === 'complete').length;
    }, { timeout: 10_000 }).toBe(1);
    const frame = page.frameLocator('#embed');
    await frame.locator('#inner-text').click({ button: 'right' });
    const menu = menuDi(frame).locator('.sn-menu');
    await expect(menu).toBeVisible({ timeout: 8000 });
    await expect(menu.getByText('Invia feedback', { exact: true })).toBeVisible();
  } finally {
    await sito.chiudi();
  }
});
