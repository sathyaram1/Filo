// Verifica #1725 giro 1: chiusa una finestrella d'accesso SENZA accedere, la scheda che l'ha aperta non si ricarica,
// anche se nel frattempo il sito ha messo o rinnovato un cookie dal nome «d'accesso» (token anti-falsificazione, sessione anonima).
import { test, expect } from '../../fixtures/electron.mjs';
import { createServer } from 'node:http';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function sito() {
  const server = createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    const html = (corpo, extra = {}) => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', ...extra }); res.end(corpo); };
    // Come Laravel e molti framework: ogni risposta rinnova il token anti-falsificazione.
    if (u.pathname === '/ping') {
      res.writeHead(200, { 'Content-Type': 'text/plain', 'Set-Cookie': `XSRF-TOKEN=${Math.random().toString(36).slice(2)}; Path=/` });
      res.end('ok');
      return;
    }
    // La pagina d'accesso nella finestrella: mette il token del modulo, come quasi ogni pagina d'accesso. Nessun accesso.
    if (u.pathname === '/oauth/authorize') {
      html('<!doctype html><title>Scegli un account</title><p>Account</p>', { 'Set-Cookie': `csrftoken=${Math.random().toString(36).slice(2)}; Path=/; HttpOnly` });
      return;
    }
    html(`<!doctype html><html><head><title>Benvenuto</title></head><body style="padding:30px">
      <button id="google" onclick="window.open('/oauth/authorize?client_id=x&redirect_uri=y', 'accesso', 'width=420,height=420')">Continua con Google</button>
      ${u.searchParams.get('vivo') ? '<script>setInterval(() => fetch(\'/ping\'), 300)</script>' : ''}
      </body></html>`);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return {
    base: `http://127.0.0.1:${server.address().port}`,
    chiudi: () => new Promise((r) => { try { server.closeAllConnections?.(); } catch (_) {} server.close(r); }),
  };
}

async function pagina(app, prefisso) {
  await expect.poll(() => app.windows().some((w) => { try { return w.url().startsWith(prefisso); } catch (_) { return false; } }), { timeout: 15_000 }).toBe(true);
  const p = app.windows().find((w) => { try { return w.url().startsWith(prefisso); } catch (_) { return false; } });
  await p.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 8000 }).catch(() => {});
  return p;
}

const segnata = async (app, prefisso) => {
  try { return await (await pagina(app, prefisso)).evaluate(() => window.__filoSegno === 1); } catch (_) { return null; }
};

async function apriEChiudiFinestrella(app, page) {
  await page.locator('#google').click();
  let w = null;
  await expect.poll(() => {
    w = app.windows().find((x) => { try { return x.url().includes('/oauth/authorize'); } catch (_) { return false; } });
    return !!w;
  }, { timeout: 10_000 }).toBe(true);
  // L'utente guarda la pagina d'accesso, ci ripensa e chiude.
  await sleep(1500);
  await w.evaluate(() => window.close()).catch(() => {});
  await expect.poll(() => app.windows().some((x) => { try { return x.url().includes('/oauth/authorize'); } catch (_) { return false; } }), { timeout: 10_000 }).toBe(false);
}

test('r1 la pagina d\'accesso nella finestrella mette il suo token del modulo; chiusa senza accedere, la scheda resta com\'era', async ({ app, shell }) => {
  test.setTimeout(90_000);
  const s = await sito();
  try {
    await shell.evaluate((u) => window.filoShell.tabs.open(u), `${s.base}/pubblica`);
    const page = await pagina(app, `${s.base}/pubblica`);
    await page.evaluate(() => { window.__filoSegno = 1; });
    await apriEChiudiFinestrella(app, page);
    await sleep(5000);
    expect(await segnata(app, `${s.base}/pubblica`), 'la scheda si è ricaricata senza nessun accesso').toBe(true);
  } finally {
    await s.chiudi();
  }
});

test('r1 il sito rinnova da sé un token mentre la finestrella è aperta; chiusa senza accedere, la scheda resta com\'era', async ({ app, shell }) => {
  test.setTimeout(90_000);
  const s = await sito();
  try {
    await shell.evaluate((u) => window.filoShell.tabs.open(u), `${s.base}/pubblica?vivo=1`);
    const page = await pagina(app, `${s.base}/pubblica`);
    await sleep(1000);
    await page.evaluate(() => { window.__filoSegno = 1; });
    await apriEChiudiFinestrella(app, page);
    await sleep(5000);
    expect(await segnata(app, `${s.base}/pubblica`), 'la scheda si è ricaricata senza nessun accesso').toBe(true);
  } finally {
    await s.chiudi();
  }
});
