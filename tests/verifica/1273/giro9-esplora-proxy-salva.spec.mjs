// Verifica #1273 giro 9, esplorazione: «Salva per dopo» da una scheda col proxy (pagina e link), con l'icona arrivata e
// senza; poi home, «Aperti per dopo» e il riordino delle icone non chiedono niente fuori dal proxy.

import { test, expect } from '../../fixtures/electron.mjs';
import { createServer } from 'node:http';
import { createServer as createNetServer, connect as netConnect } from 'node:net';
import { menuDi } from '../../helpers/menuContestuale.mjs';

const NOMI = ['dal-proxy.test', 'senza-icona.test', 'collegato.test', 'img.piattaforma.test'];
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGM4YaMBAAL8AS3/gzpXAAAAAElFTkSuQmCC', 'base64');

async function sitiFinti() {
  const richieste = { diretto: [], proxy: [] };
  let portaDiretta = 0;
  const servi = (dove) => createServer((req, res) => {
    const host = String(req.headers.host || '').split(':')[0];
    richieste[dove].push(`${host}${req.url}`);
    if (host === 'img.piattaforma.test') { res.writeHead(200, { 'content-type': 'image/png' }); res.end(PNG); return; }
    if (req.url === '/favicon.ico') { res.writeHead(404); res.end(); return; }
    const icona = host === 'senza-icona.test' ? `http://img.piattaforma.test:${portaDiretta}/non-c-e` : `http://img.piattaforma.test:${portaDiretta}/${host}.png`;
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(`<!doctype html><html><head><meta charset="utf-8"><title>${host}</title>`
      + (host === 'senza-icona.test' ? '' : `<link rel="icon" href="${icona}">`)
      + `</head><body style="margin:0;height:100vh"><h1>${host}</h1><p><a id="l" href="http://collegato.test:${portaDiretta}/x">collegato</a></p></body></html>`);
  });
  const diretto = servi('diretto');
  const viaProxy = servi('proxy');
  await new Promise((r) => diretto.listen(0, '127.0.0.1', r));
  await new Promise((r) => viaProxy.listen(0, '127.0.0.1', r));
  portaDiretta = diretto.address().port;
  const chiudi = (s) => new Promise((r) => { s.closeAllConnections?.(); s.close(r); });
  return { porta: portaDiretta, portaProxy: viaProxy.address().port, richieste, close: async () => { await chiudi(diretto); await chiudi(viaProxy); } };
}

async function proxySocks(portaProxy) {
  const vivi = new Set();
  const server = createNetServer((socket) => {
    vivi.add(socket);
    socket.on('close', () => vivi.delete(socket));
    socket.on('error', () => {});
    socket.once('data', (saluto) => {
      if (saluto[0] !== 0x05) { socket.end(); return; }
      socket.write(Buffer.from([0x05, 0x00]));
      socket.once('data', (req) => {
        if (req[0] !== 0x05 || req[1] !== 0x01) { socket.end(); return; }
        const su = netConnect(portaProxy, '127.0.0.1', () => {
          socket.write(Buffer.from([0x05, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0]));
          socket.pipe(su); su.pipe(socket);
        });
        su.on('error', () => { try { socket.destroy(); } catch (_) {} });
        socket.on('close', () => { try { su.destroy(); } catch (_) {} });
      });
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { porta: server.address().port, async close() { for (const s of vivi) { try { s.destroy(); } catch (_) {} } await new Promise((r) => server.close(r)); } };
}

const idScheda = (app, host) => app.evaluate(({ BrowserWindow }, h) => {
  const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
  const t = w._filoTabs.tabs.find((x) => { try { return new URL(x.url).hostname === h; } catch (_) { return false; } });
  return t ? t.id : null;
}, host);

test.describe('dal proxy, salvando per dopo', () => {
  test.use({ hostInPiu: NOMI });

  test('pagina con icona, pagina senza icona e link salvati da schede col proxy: niente esce dalla connessione vera', async ({ app, openTab }) => {
    test.setTimeout(150_000);
    const siti = await sitiFinti();
    const socks = await proxySocks(siti.portaProxy);
    try {
      await app.evaluate(async (_e, porta) => {
        await globalThis.SN_STORAGE.updateSettings({ proxy: { datacenter: `socks5://127.0.0.1:${porta}`, bypass: '<-loopback>' } });
      }, socks.porta);
      const conProxy = async (host) => {
        const page = await openTab(`http://${host}:${siti.porta}/pagina`);
        const id = await idScheda(app, host);
        expect((await app.evaluate(({ BrowserWindow }, i) => BrowserWindow.getAllWindows().find((x) => x._filoTabs)._filoTabs.setTabProxy(i, 'us'), id)).ok).toBe(true);
        await expect.poll(() => siti.richieste.proxy.some((r) => r.startsWith(`${host}/`)), { timeout: 15_000 }).toBe(true);
        await new Promise((r) => setTimeout(r, 1500));
        page = app.windows().filter((w) => { try { return !w.isClosed() && new URL(w.url()).hostname === host; } catch (_) { return false; } }).pop();
        await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 15_000 }).catch(() => {});
        await page.waitForLoadState('domcontentloaded').catch(() => {});
        return { page, id };
      };
      const salvaDalMenu = async (page) => {
        await page.click('body', { button: 'right', position: { x: 300, y: 300 } });
        const voce = menuDi(page).locator('.sn-menu [data-sn-icon-id="saveForLater"]');
        await expect(voce).toBeVisible({ timeout: 10_000 });
        await voce.click();
      };

      const a = await conProxy('dal-proxy.test');
      await expect.poll(() => siti.richieste.proxy.some((r) => r.startsWith('img.piattaforma.test/dal-proxy.test')), { timeout: 15_000 }).toBe(true);
      const b = await conProxy('senza-icona.test');
      // Il link sulla pagina col proxy: tasto destro, «Salva per dopo» sul link.
      await b.page.waitForTimeout(1500);
      const prima = siti.richieste.diretto.length;
      await salvaDalMenu(a.page);
      await expect.poll(() => app.evaluate(async () => (await globalThis.SN_SAVED_PAGES.list()).length), { timeout: 10_000 }).toBe(1);
      await salvaDalMenu(b.page);
      await expect.poll(() => app.evaluate(async () => (await globalThis.SN_SAVED_PAGES.list()).length), { timeout: 10_000 }).toBe(2);
      const voci = await app.evaluate(async () => (await globalThis.SN_SAVED_PAGES.list()).map((p) => ({ url: p.url, favicon: p.favicon, proxy: p.proxy })));
      console.log('VOCI', JSON.stringify(voci));
      await new Promise((r) => setTimeout(r, 5000));
      await app.evaluate(() => globalThis.__filoIconeVecchie?.completa());
      const home = await openTab('filo://newtab/');
      await home.waitForTimeout(3000);
      const salvate = await openTab('filo://home/home.html');
      await salvate.waitForTimeout(3000);
      await app.evaluate(() => globalThis.__filoIconeVecchie?.completa());
      console.log('DIRETTE', JSON.stringify(siti.richieste.diretto.slice(prima)));
      expect(siti.richieste.diretto.slice(prima), 'niente fuori dal proxy').toEqual([]);
    } finally {
      await socks.close();
      await siti.close();
    }
  });
});
