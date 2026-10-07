// Verifica #592.6 — giro 6, rilievo 1: la proposta «Attivo i cookie di … per questo contenuto?» sta nel documento
// del sito, che la rende invisibile e disegna sotto la sua domanda finta: il clic su «Sì» del finto attiva i cookie.

import { test, expect } from '../../fixtures/electron.mjs';
import { createServer } from 'node:http';

async function serve() {
  const server = createServer((req, res) => {
    const porta = server.address().port;
    const u = new URL(req.url, 'http://x');
    const cookie = String(req.headers.cookie || '');
    const html = (corpo, extra = {}) => {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', ...extra });
      res.end(`<!doctype html><meta charset="utf-8"><body style="margin:0;font:15px sans-serif">${corpo}`);
    };
    const conCookie = { 'Set-Cookie': ['vista=1; Max-Age=86400; Path=/; SameSite=None; Secure'] };
    if (u.pathname === '/ostile') {
      // La pagina ostile: la proposta di Filo trasparente, e sotto di lei una domanda innocua scritta dal sito.
      html(`<style>[data-filo-riquadro-cookie]{opacity:0 !important}
        #finto{position:absolute;left:0;top:0;width:420px;height:300px;z-index:2147483645;background:#fff;
          display:flex;align-items:flex-start;justify-content:center;gap:10px;padding-top:40px;box-sizing:border-box}</style>
        <p>articolo</p><div style="position:relative">
        <iframe id="ri" width="420" height="300" style="border:0" src="http://b.localhost:${porta}/post"></iframe>
        <div id="finto">Chiudo la pubblicità? <b>Sì</b> <b>No</b></div></div>`);
      return;
    }
    if (u.pathname === '/post') {
      if (/vista=1/.test(cookie)) html('<p id="ok">Il post</p>', conCookie);
      else html('<p>Accedi per vedere il post</p>', conCookie);
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const porta = server.address().port;
  return {
    url: `http://a.localhost:${porta}/ostile`,
    async chiudi() { try { server.closeAllConnections?.(); } catch (_) {} await new Promise((r) => server.close(r)); },
  };
}

test('r1 la pagina rende invisibile la proposta dei cookie e il «Sì» sulla sua domanda finta li attiva', async ({ app, openTab }) => {
  const srv = await serve();
  try {
    await app.evaluate(async () => {
      globalThis.__filoRiquadriRotti.servizioTest({ nome: 'Fotogrammi', domini: ['b.localhost'], segnaposto: ['accedi per vedere il post'] });
      globalThis.SN_URL_NAV.isHomeNetworkUrl = () => false;
    });
    const page = await openTab(srv.url);
    const proposte = () => app.evaluate(async ({ BrowserWindow }) => {
      for (const w of BrowserWindow.getAllWindows()) {
        for (const t of (w._filoTabs && w._filoTabs.tabs) || []) {
          const wc = t.view && t.view.webContents;
          if (!wc || wc.isDestroyed() || !wc.getURL().includes('a.localhost')) continue;
          return wc.executeJavaScriptInIsolatedWorld(999, [{ code: 'globalThis.SN_RIQUADRO_COOKIE?._test?.proposte() ?? []' }]);
        }
      }
      return [];
    });
    let lista = [];
    await expect.poll(async () => { lista = await proposte(); return lista.length; }, { timeout: 25_000 }).toBe(1);
    const p = lista[0];
    // Quello che l'utente vede: la domanda del sito, e la proposta di Filo trasparente sopra.
    await expect(page.locator('#finto')).toBeVisible();
    expect(await page.evaluate(() => getComputedStyle(document.querySelector('[data-filo-riquadro-cookie]')).opacity)).toBe('0');
    await page.waitForTimeout(600);
    await page.mouse.click(p.si.x, p.si.y);
    await page.waitForTimeout(1500);
    // Il «Sì» premuto sulla domanda del sito non deve attivare i cookie del servizio.
    const attivi = await app.evaluate(async () => (await globalThis.SN_STORAGE.getSettings()).security.cookies.embedSites);
    expect(attivi).toEqual([]);
  } finally {
    await srv.chiudi();
  }
});
