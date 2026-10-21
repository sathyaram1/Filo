// #1568 giro 2: esplorazione delle altre strade verso un riquadro dello stesso sito toccato mentre arriva.
import { test, expect } from '../../fixtures/electron.mjs';
import { menuDi } from '../../helpers/menuContestuale.mjs';
import { riquadriInRitardo } from '../../helpers/riquadriInRitardo.mjs';

const INNER = `<!doctype html><html><body style="margin:0;padding:16px;font:16px sans-serif">
  <p id="inner-text">Testo dentro il riquadro incorporato, lungo abbastanza da poterlo selezionare e spiegare.</p>
</body></html>`;

const cornici = {
  'src messo dopo': `<!doctype html><html><body style="margin:0;padding:12px;font:16px sans-serif">
  <p id="outer-text">Testo della pagina.</p>
  <iframe id="embed" width="600" height="420" style="border:1px solid #333"></iframe>
  <script>setTimeout(() => { document.getElementById('embed').src = '/riquadro/1'; }, 300);</script>
</body></html>`,
  'riquadro creato da script con src': `<!doctype html><html><body style="margin:0;padding:12px;font:16px sans-serif">
  <p id="outer-text">Testo della pagina.</p>
  <script>setTimeout(() => { const f = document.createElement('iframe'); f.id = 'embed'; f.width = 600; f.height = 420; document.body.appendChild(f); f.src = '/riquadro/1'; }, 300);</script>
</body></html>`,
  'window.open su nome': `<!doctype html><html><body style="margin:0;padding:12px;font:16px sans-serif">
  <p id="outer-text">Testo della pagina.</p>
  <iframe id="embed" name="dentro" width="600" height="420" style="border:1px solid #333"></iframe>
  <script>setTimeout(() => { window.open('/riquadro/1', 'dentro'); }, 300);</script>
</body></html>`,
};

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

for (const [nomeC, cornice] of Object.entries(cornici)) for (const muove of [false, true]) test(`${nomeC} ${muove ? 'col puntatore che si muove' : 'fermo'}`, async ({ app, openTab }) => {
  const sito = await riquadriInRitardo(cornice, INNER);
  try {
    const page = await openTab(sito.url);
    await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 15_000 });
    await page.waitForTimeout(800);
    expect(sito.serviti()).toBe(0);
    if (muove) await nellaScheda(app, page, `for (const [x, y] of [[5, 5], [100, 60], [200, 120], [300, 200]]) wc.sendInputEvent({ type: 'mouseMove', x, y });`);
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
