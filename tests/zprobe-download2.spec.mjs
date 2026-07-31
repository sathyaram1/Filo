// PROBE TEMPORANEO (audit prober) — download aperto in nuova scheda.
import { test, expect } from './fixtures/electron.mjs';
import { createServer } from 'node:http';

test('link di download con target=_blank: resta una scheda vuota?', async ({ app, shell, openTab }) => {
  const srv = createServer((req, res) => {
    if (req.url.startsWith('/dl')) {
      const body = Buffer.alloc(20000, 0x41);
      res.writeHead(200, {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': 'attachment; filename="allegato.zip"',
        'Content-Length': String(body.length),
      });
      res.end(body);
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<h1>Allegati</h1><p><a id="dl" href="/dl" target="_blank" rel="noopener">Scarica (nuova scheda)</a></p>');
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port;

  await app.evaluate(({ session }) => {
    globalThis.__dl = [];
    session.defaultSession.on('will-download', (e, item) => {
      globalThis.__dl.push({ f: item.getFilename() });
    });
  });

  const page = await openTab(`http://127.0.0.1:${port}/p`);
  await page.waitForTimeout(800);

  const dump = () => app.evaluate(() => {
    const tm = globalThis.__filoTabs || null;
    return null;
  }).catch(() => null);
  const tabsBefore = await shell.evaluate(() => Array.from(document.querySelectorAll('.tab')).map((t) => ({ text: (t.innerText || '').trim(), id: t.dataset.id || t.getAttribute('data-tab-id') || '' })));
  await page.click('#dl');
  await page.waitForTimeout(4000);
  const tabsAfter = await shell.evaluate(() => Array.from(document.querySelectorAll('.tab')).map((t) => ({ text: (t.innerText || '').trim(), id: t.dataset.id || t.getAttribute('data-tab-id') || '' })));
  const dl = await app.evaluate(() => globalThis.__dl);

  console.log('TABS PRIMA:', JSON.stringify(tabsBefore));
  console.log('TABS DOPO :', JSON.stringify(tabsAfter));
  console.log('DOWNLOAD  :', JSON.stringify(dl));
  console.log('URLS      :', JSON.stringify(app.windows().map((w) => w.url())));
  const snap = await shell.evaluate(() => window.filoShell.tabs.snapshot());
  console.log('SNAPSHOT  :', JSON.stringify(snap, null, 2).slice(0, 2500));
  await shell.screenshot({ path: 'tests/.shots/probe-download-blanktab.png' });

  await new Promise((r) => srv.close(r));
});

test('CONTROLLO: target=_blank verso una pagina normale non lascia schede vuote', async ({ app, shell, openTab }) => {
  const srv = createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    if (req.url.startsWith('/other')) { res.end('<title>Altra pagina</title><h1>Altra</h1>'); return; }
    res.end('<title>Base</title><p><a id="go" href="/other" target="_blank" rel="noopener">Vai</a></p>');
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port;
  const page = await openTab(`http://127.0.0.1:${port}/p`);
  await page.waitForTimeout(800);
  await page.click('#go');
  await page.waitForTimeout(3000);
  const snap = await shell.evaluate(() => window.filoShell.tabs.snapshot());
  console.log('CONTROLLO TABS:', JSON.stringify((snap.tabs || snap).map ? (snap.tabs || snap).map((t) => ({ t: t.title, u: t.url })) : snap));
  await new Promise((r) => srv.close(r));
});
