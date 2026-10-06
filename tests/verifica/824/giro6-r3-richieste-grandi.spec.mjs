// #824 giro 6, rilievo 3: le richieste grandi di una scheda con del testo scritto non fermano Filo
// (il controllo del testo partito non deve occupare il processo principale per centinaia di ms).

import { test, expect } from '../../fixtures/electron.mjs';
import { createServer } from 'node:http';

async function apriEsatta(app, shell, url) {
  await shell.evaluate((u) => window.filoShell.tabs.open(u), url);
  let page = null;
  await expect.poll(() => {
    page = app.windows().find((w) => { try { return w.url() === url; } catch (_) { return false; } });
    return !!page;
  }, { timeout: 10_000 }).toBe(true);
  await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 8000 });
  return page;
}

const moduloDi = (shell, title) => shell.evaluate(async (t) => {
  const s = await window.filoShell.tabs.snapshot();
  const tab = s.tabs.find((x) => x.title === t);
  return tab ? tab.formDirty : null;
}, title);

test('r3 una scheda con una bozza che manda richieste grandi non ferma Filo', async ({ app, shell }) => {
  test.setTimeout(60_000);
  let html = '';
  const server = createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      if (req.url.startsWith('/api/')) { res.writeHead(200); res.end('ok'); return; }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    html = `<!doctype html><html><head><title>Grande</title></head><body>
      <textarea id="t" style="width:400px;height:100px"></textarea>
      <script>window.manda = async (ms) => { const s = 'a<b>c</b>&amp;%41 '.repeat(120000); const fine = Date.now() + ms;
        const uno = async () => { while (Date.now() < fine) await fetch('/api/salva', { method: 'POST', body: s }); };
        await Promise.all([uno(), uno(), uno(), uno()]); };</script>
      </body></html>`;
    const page = await apriEsatta(app, shell, `http://127.0.0.1:${server.address().port}/grande`);
    await page.locator('#t').click();
    await page.keyboard.type('Didascalia della foto');
    await expect.poll(() => moduloDi(shell, 'Grande'), { timeout: 8_000 }).toBe(true);

    await app.evaluate(() => {
      globalThis.__ritardo = 0;
      let ult = Date.now();
      clearInterval(globalThis.__ritardoT);
      globalThis.__ritardoT = setInterval(() => { const ora = Date.now(); globalThis.__ritardo = Math.max(globalThis.__ritardo, ora - ult - 20); ult = ora; }, 20);
    });
    await page.evaluate(() => window.manda(5000));
    const ritardo = await app.evaluate(() => { clearInterval(globalThis.__ritardoT); return globalThis.__ritardo; });
    expect(ritardo).toBeLessThan(250);
  } finally {
    try { server.closeAllConnections(); } catch (_) {}
    await new Promise((r) => server.close(r));
  }
});
