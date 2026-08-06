// DIAGNOSTICA TEMPORANEA — traccia gli eventi del DownloadItem su server che tronca.
import { test, expect } from './fixtures/electron.mjs';
import { createServer } from 'node:http';

test.setTimeout(120_000);

test('diag: eventi di un download troncato', async ({ app, shell }) => {
  let hits = 0;
  const server = createServer((req, res) => {
    if (req.url.startsWith('/p')) {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<a id="dl0" href="/rotto.bin">x</a>');
      return;
    }
    hits++;
    console.log('[server] richiesta', hits, 'range=', req.headers.range);
    res.writeHead(200, {
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(5 * 1024 * 1024),
      'Content-Disposition': 'attachment; filename="rotto.bin"',
    });
    res.write(Buffer.alloc(32 * 1024, 1));
    setTimeout(() => { try { res.socket.destroy(); } catch (_) {} }, 200);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${server.address().port}`;

  // Traccia grezza dal main: agganciamo il nostro listener a will-download.
  await app.evaluate(({ session }) => {
    globalThis.__diag = [];
    session.defaultSession.on('will-download', (_e, item) => {
      globalThis.__diag.push({ t: Date.now(), ev: 'will-download', state: item.getState() });
      item.on('updated', (_ev, st) => {
        globalThis.__diag.push({ t: Date.now(), ev: 'updated', arg: st, state: item.getState(), recv: item.getReceivedBytes(), canResume: item.canResume(), paused: item.isPaused() });
      });
      item.once('done', (_ev, st) => {
        globalThis.__diag.push({ t: Date.now(), ev: 'done', arg: st, recv: item.getReceivedBytes() });
      });
    });
  });

  await shell.evaluate((u) => window.filoShell.tabs.open(u), `${origin}/p`);
  await shell.waitForTimeout(1500);
  const page = app.windows().find((w) => { try { return new URL(w.url()).hostname === '127.0.0.1'; } catch (_) { return false; } });
  await page.click('#dl0');

  await shell.waitForTimeout(60_000);
  const diag = await app.evaluate(() => globalThis.__diag);
  const t0 = diag[0]?.t || 0;
  console.log('EVENTI:', JSON.stringify(diag.map((d) => ({ ...d, t: d.t - t0 })), null, 1));
  console.log('richieste al server:', hits);
  const items = await shell.evaluate(() => window.filoShell.downloads.list());
  console.log('cronologia:', JSON.stringify(items.items));
  server.close();
  expect(1).toBe(1);
});
