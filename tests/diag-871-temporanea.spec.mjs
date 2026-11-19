// Diagnosi temporanea di #871.5: chi prende il fuoco dopo il ritorno sulla scheda coperta. Da togliere.
import { test, expect } from './fixtures/electron.mjs';
import { vistaAvviso, copertura, COPERTA } from './helpers/avvisoSito.mjs';

const MODULO = '<title>Accedi</title><form><input type="password" id="pw"></form>';

test('diagnosi fuoco Ctrl+W', async ({ app, shell }) => {
  await app.evaluate(({ session, webContents, app: a }, html) => {
    globalThis.__log = [];
    const t0 = Date.now();
    const nome = (wc) => { try { return wc.getURL().slice(0, 40) || `(vuoto ${wc.id})`; } catch (_) { return '?'; } };
    globalThis.__nome = nome;
    globalThis.__l = (s) => globalThis.__log.push(`${Date.now() - t0} ${s}`);
    const segui = (wc) => {
      wc.on('focus', () => globalThis.__l(`focus ${wc.id} ${nome(wc)}`));
      wc.on('did-start-loading', () => globalThis.__l(`start ${wc.id} ${nome(wc)}`));
      wc.on('did-finish-load', () => globalThis.__l(`finish ${wc.id} ${nome(wc)}`));
    };
    for (const wc of webContents.getAllWebContents()) segui(wc);
    a.on('web-contents-created', (_e, wc) => segui(wc));
    for (const s of ['http', 'https']) {
      try { session.defaultSession.protocol.unhandle(s); } catch (_) {}
      session.defaultSession.protocol.handle(s, (req) => {
        const u = new URL(req.url);
        if (u.hostname === 'conto-schede.com') return new Response(html, { headers: { 'content-type': 'text/html' } });
        return Response.error();
      });
    }
    globalThis.SN_SAFEBROWSE.setProviders({ gsb: async () => ({ listed: true, category: 'phishing' }), rdap: null, ct: null, sandbox: null, llm: async () => ({ suspicious: false }) });
  }, MODULO);
  await shell.evaluate((u) => window.filoShell.tabs.open(u), 'https://conto-schede.com/login');
  await expect.poll(() => app.windows().some((w) => { try { return new URL(w.url()).hostname === 'conto-schede.com'; } catch (_) { return false; } })).toBe(true);
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
    win.focus();
    win._filoTabs.tabs.find((t) => t.id === win._filoTabs.activeId).view.webContents.focus();
  });
  await vistaAvviso(app);
  await expect.poll(() => copertura(app)).toEqual(COPERTA);
  const schede = () => app.evaluate(({ BrowserWindow }) => {
    const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
    return { n: tm.tabs.length, attiva: tm.tabs.find((t) => t.id === tm.activeId).view.webContents.getURL() };
  });
  const prima = (await schede()).n;
  const tasto = (key, mod) => app.evaluate(({ webContents }, { key, mod }) => {
    const wc = webContents.getFocusedWebContents();
    globalThis.__l(`TASTO ${key} -> ${wc.id} ${globalThis.__nome(wc)}`);
    wc.sendInputEvent({ type: 'keyDown', keyCode: key, modifiers: [mod] });
    wc.sendInputEvent({ type: 'keyUp', keyCode: key, modifiers: [mod] });
  }, { key, mod });
  await tasto('T', 'control');
  await expect.poll(async () => (await schede()).n).toBe(prima + 1);
  await expect.poll(async () => (await copertura(app)).tastiera).toBe('pagina');
  await app.evaluate(({ BrowserWindow }) => {
    const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
    globalThis.__l('ATTIVA conto-schede');
    tm.activate(tm.tabs.find((t) => /conto-schede/.test(t.view.webContents.getURL())).id);
  });
  await expect.poll(() => copertura(app)).toEqual(COPERTA);
  await app.evaluate(() => globalThis.__l('COPERTA vista'));
  await tasto('W', 'control');
  await expect.poll(async () => (await schede()).n).toBe(prima);
  const log = await app.evaluate(() => globalThis.__log.join('\n'));
  expect((await schede()).attiva, log).not.toContain('conto-schede');
});
