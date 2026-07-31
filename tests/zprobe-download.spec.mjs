// PROBE TEMPORANEO (audit prober) — scaricare un file da un sito.
import { test, expect } from './fixtures/electron.mjs';
import { createServer } from 'node:http';

test('scaricare un file da un link: cosa vede l\'utente', async ({ app, shell, openTab }) => {
  const srv = createServer((req, res) => {
    if (req.url.startsWith('/dl')) {
      const body = Buffer.alloc(400000, 0x41);
      res.writeHead(200, {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': 'attachment; filename="rapporto-2026.pdf"',
        'Content-Length': String(body.length),
      });
      res.end(body);
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<h1>Pagina con allegato</h1><p><a id="dl" href="/dl">Scarica il rapporto</a></p>');
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port;

  // Spia passiva su will-download: NON impostiamo savePath, così osserviamo il
  // comportamento reale di Filo.
  await app.evaluate(({ session }) => {
    globalThis.__dlEvents = [];
    globalThis.__dlListeners = session.defaultSession.listenerCount('will-download');
    session.defaultSession.on('will-download', (e, item) => {
      globalThis.__dlEvents.push({ url: item.getURL(), filename: item.getFilename(), total: item.getTotalBytes() });
    });
  });

  const page = await openTab(`http://127.0.0.1:${port}/p`);
  await page.waitForTimeout(1000);

  const winsBefore = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((w) => ({ t: w.getTitle(), modal: w.isModal?.() })));

  await page.click('#dl').catch((e) => console.log('click err', e.message));
  await page.waitForTimeout(4000);

  const ev = await app.evaluate(() => ({ events: globalThis.__dlEvents, preexistingListeners: globalThis.__dlListeners }));
  console.log('WILL-DOWNLOAD:', JSON.stringify(ev));

  const winsAfter = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((w) => ({ t: w.getTitle(), modal: w.isModal?.() })));
  console.log('WINDOWS before:', JSON.stringify(winsBefore));
  console.log('WINDOWS after :', JSON.stringify(winsAfter));

  // Cosa vede l'utente nella shell? notifiche? barra download?
  const shellState = await shell.evaluate(() => ({
    notifs: document.getElementById('shell-notifs')?.innerText || null,
    bodyHasDownload: /download|scaric/i.test(document.body.innerText || ''),
    tabs: Array.from(document.querySelectorAll('.tab, [class*=tab]')).slice(0, 12).map((e) => (e.innerText || '').slice(0, 40)),
  }));
  console.log('SHELL:', JSON.stringify(shellState, null, 2));

  const pageState = await page.evaluate(() => ({
    toast: document.querySelector('.sn-toast, .sn-popup, [class*=toast]')?.innerText || null,
    url: location.href,
  })).catch((e) => ({ err: e.message }));
  console.log('PAGE:', JSON.stringify(pageState));

  await shell.screenshot({ path: 'tests/.shots/probe-download-shell.png' }).catch(() => {});

  await new Promise((r) => srv.close(r));
});
