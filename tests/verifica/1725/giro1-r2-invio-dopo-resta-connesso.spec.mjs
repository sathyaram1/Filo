// Verifica #1725 giro 1: la scheda col testo scritto aspetta il cambio di pagina per passare al posto che resta; quando
// il cambio è l'invio stesso del modulo e il sito risponde con la pagina dell'esito, quella pagina deve restare.
import { test, expect } from '../../fixtures/electron.mjs';
import { createServer } from 'node:http';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function sito() {
  const sessioni = new Set();
  const visite = [];
  const server = createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    visite.push(`${req.method} ${u.pathname}`);
    const sid = ((req.headers.cookie || '').match(/(?:^|;\s*)sid=([^;]+)/) || [])[1];
    const dentro = !!sid && sessioni.has(sid);
    const html = (corpo) => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(corpo); };
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      if (req.method === 'POST' && u.pathname === '/login') {
        const nuovo = Math.random().toString(36).slice(2);
        sessioni.add(nuovo);
        res.writeHead(302, { 'Set-Cookie': `sid=${nuovo}; Max-Age=86400; Path=/; HttpOnly`, Location: '/home' });
        res.end();
        return;
      }
      // Il commento si pubblica e il sito risponde con l'esito, senza rimandare a un'altra pagina (molti siti fanno così).
      if (req.method === 'POST' && u.pathname === '/commenta') {
        const testo = new URLSearchParams(body).get('testo') || '';
        html(`<!doctype html><title>Pubblicato</title><p id="pubblicato">Commento pubblicato: ${testo.replace(/</g, '&lt;')}</p>`);
        return;
      }
      if (u.pathname === '/commenta') {
        html(`<!doctype html><title>Commenta</title><body style="padding:30px"><form method="post" action="/commenta">
          <input id="campo" name="testo" placeholder="Il tuo commento"> <button id="manda">Pubblica</button></form></body>`);
        return;
      }
      if (u.pathname === '/home' && dentro) { html('<!doctype html><title>Casa</title><h1 id="dentro">Ciao Sara</h1>'); return; }
      html(`<!doctype html><title>Accedi</title><body style="padding:30px"><form method="post" action="/login">
        <input name="u" value="sara"> <input id="pw" type="password" name="p"> <button id="entra">Entra</button></form></body>`);
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return {
    base: `http://127.0.0.1:${server.address().port}`,
    visite,
    chiudi: () => new Promise((r) => { try { server.closeAllConnections?.(); } catch (_) {} server.close(r); }),
  };
}

async function pagina(app, prefisso, timeout = 15_000) {
  await expect.poll(() => app.windows().some((w) => { try { return w.url().startsWith(prefisso); } catch (_) { return false; } }), { timeout }).toBe(true);
  const p = app.windows().find((w) => { try { return w.url().startsWith(prefisso); } catch (_) { return false; } });
  await p.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 8000 }).catch(() => {});
  return p;
}

const partizioneDi = (app, prefisso) => app.evaluate(({ BrowserWindow }, pre) => {
  for (const w of BrowserWindow.getAllWindows()) {
    for (const t of (w._filoTabs && w._filoTabs.tabs) || []) if (String(t.url || '').startsWith(pre)) return t.partition || null;
  }
  return undefined;
}, prefisso);

test('r2 scrivi un commento, dici «Resta connesso» e poi lo pubblichi: la pagina col commento pubblicato resta, senza essere richiesta di nuovo', async ({ app, shell }) => {
  test.setTimeout(120_000);
  const s = await sito();
  try {
    await app.evaluate(async () => {
      await globalThis.__filoHandlers.applySettingsUpdate({ security: { cookies: { mode: 'privacy' } } });
    });
    await shell.evaluate((u) => window.filoShell.tabs.open(u), `${s.base}/login`);
    const login = await pagina(app, `${s.base}/login`);
    await login.locator('#pw').fill('giusta');
    await login.locator('#entra').click();
    await expect((await pagina(app, `${s.base}/home`)).locator('#dentro')).toBeVisible({ timeout: 15_000 });

    await shell.evaluate((u) => window.filoShell.tabs.open(u), `${s.base}/commenta`);
    const commenta = await pagina(app, `${s.base}/commenta`);
    await commenta.locator('#campo').click();
    await commenta.keyboard.type('bellissimo articolo');
    await expect.poll(async () => (await shell.evaluate(() => window.filoShell.tabs.snapshot())).tabs
      .find((t) => String(t.url).startsWith(`${s.base}/commenta`))?.formDirty, { timeout: 8000 }).toBe(true);

    // «Resta connesso» da Sicurezza: la stessa strada comune del menu, della proposta e della chat.
    await app.evaluate(async () => {
      await globalThis.__filoHandlers.applySettingsUpdate({ security: { cookies: { trustedSites: ['127.0.0.1'] } } });
    });
    await expect.poll(() => partizioneDi(app, `${s.base}/home`), { timeout: 15_000 }).toBe('persist:filo-priv-127.0.0.1');
    expect(await commenta.locator('#campo').inputValue()).toBe('bellissimo articolo');

    await commenta.locator('#manda').click();
    await expect.poll(() => s.visite.includes('POST /commenta'), { timeout: 10_000 }).toBe(true);
    await sleep(5000);
    // Dopo un eventuale passaggio la vista è nuova: si ricerca.
    const pubblicato = async () => {
      try { return await (await pagina(app, `${s.base}/commenta`, 3000)).locator('#pubblicato').count(); } catch (_) { return -1; }
    };
    await expect.poll(pubblicato, { timeout: 10_000, message: 'la pagina dell\'esito è sparita, ricaricata come pagina vuota' }).toBe(1);
    expect(s.visite.filter((v) => v === 'GET /commenta').length, 'Filo ha richiesto di nuovo la pagina dopo l\'invio').toBe(1);
  } finally {
    await s.chiudi();
  }
});
