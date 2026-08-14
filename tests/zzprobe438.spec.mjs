import { test, expect } from './fixtures/electron.mjs';
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';

const CACHE = '/tmp/filo-dict';

function dictServer() {
  mkdirSync(CACHE, { recursive: true });
  const srv = createServer((req, res) => {
    const name = req.url.replace(/^\/+/, '').split('?')[0];
    console.log('DICT REQ', name);
    const local = `${CACHE}/${name}`;
    try {
      if (!existsSync(local)) {
        execFileSync('curl', ['-sSL', '--max-time', '60', '-o', local,
          `https://redirector.gvt1.com/edgedl/chrome/dict/${name}`], { stdio: 'ignore' });
      }
      const buf = readFileSync(local);
      if (buf.length < 1000) { res.writeHead(404); res.end('nope'); return; }
      res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': buf.length });
      res.end(buf);
      console.log('DICT SERVED', name, buf.length);
    } catch (e) {
      console.log('DICT FAIL', name, String(e).slice(0, 100));
      res.writeHead(404); res.end('nope');
    }
  });
  return srv;
}

test('probe: dizionario servito in locale → il correttore nativo marca?', async ({ app, openTab, testServer }) => {
  test.setTimeout(180_000);
  const srv = dictServer();
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port;

  await app.evaluate(({ session }, url) => {
    const ses = session.defaultSession;
    ses.setSpellCheckerDictionaryDownloadURL(url);
    ses.setSpellCheckerLanguages(['en-US']);
  }, `http://127.0.0.1:${port}/`);

  const page = await testServer.openReady(openTab, `<!doctype html><body style="padding:24px">
    <div id="ed" contenteditable="true" spellcheck="true" style="border:1px solid #999;min-height:60px;padding:8px;font:18px sans-serif"></div>
  </body>`);
  await page.waitForTimeout(4000);

  await app.evaluate(({ webContents }) => {
    globalThis.__ctx = [];
    for (const wc of webContents.getAllWebContents()) {
      wc.on('context-menu', (_e, p) => {
        globalThis.__ctx.push({ mis: p.misspelledWord, sug: p.dictionarySuggestions });
      });
    }
  });

  for (const txt of ['wrlod ciao', 'helo world']) {
    await page.evaluate(() => { const e = document.getElementById('ed'); e.textContent = ''; e.focus(); });
    await page.keyboard.type(txt, { delay: 25 });
    await page.waitForTimeout(1500);
    const r = await page.evaluate(() => {
      const ed = document.getElementById('ed');
      const node = ed.firstChild;
      const m = /\S+/.exec(node.data);
      const rg = document.createRange();
      rg.setStart(node, m.index); rg.setEnd(node, m.index + m[0].length);
      const b = rg.getBoundingClientRect();
      return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
    });
    await page.mouse.click(r.x, r.y, { button: 'right' });
    await page.waitForTimeout(1500);
    const ctx = await app.evaluate(() => { const a = globalThis.__ctx.slice(); globalThis.__ctx.length = 0; return a; });
    const menu = await page.evaluate(() => {
      const m = document.querySelector('.sn-menu');
      if (!m || m.style.display === 'none') return null;
      return Array.from(m.children)
        .filter((c) => !c.classList.contains('sn-menu-sep') && c.style.display !== 'none')
        .map((c) => (c.querySelector('.sn-menu-label')?.textContent || c.textContent).trim());
    });
    console.log('TXT', JSON.stringify(txt), 'CTX', JSON.stringify(ctx), 'MENU', JSON.stringify(menu));
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
  }
  await new Promise((r) => srv.close(r));
  expect(true).toBe(true);
});
