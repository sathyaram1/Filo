// Verifica #756 giro 1: porte dell'«uscita dal sito» in Privacy oltre a quelle dello spec del lavoro.
import { test, expect } from '../../fixtures/electron.mjs';
import { createServer } from 'node:http';

let server;
let port;

test.beforeAll(async () => {
  server = createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    const imposta = u.pathname === '/accedi';
    const cookie = JSON.stringify(req.headers.cookie || '-');
    const head = { 'Content-Type': 'text/html; charset=utf-8' };
    if (imposta) head['Set-Cookie'] = 'sess=abc; Max-Age=86400; Path=/';
    res.writeHead(200, head);
    const vai = u.searchParams.get('vai') || '';
    res.end(`<!doctype html><meta charset="utf-8"><body><a id="l" href="${vai}">vai</a><script>
      document.title = 'C=' + ${cookie};
    </script>`);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  port = server.address().port;
});

test.afterAll(async () => {
  try { server.closeAllConnections?.(); } catch (_) {}
  await new Promise((r) => server.close(r));
});

const sito = (p) => `http://127.0.0.1:${port}${p}`;
const altro = (p) => `http://localhost:${port}${p}`;
const CONNESSO = 'C=sess=abc';
const PULITO = 'C=-';
const attendi = (ms) => new Promise((r) => setTimeout(r, ms));

async function privacy(app, shell, margine) {
  await shell.evaluate(() => window.filoShell.message({
    type: 'update_settings', settings: { security: { cookies: { mode: 'privacy', trustedSites: [] } } },
  }));
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()
    .some((w) => w._filoTabs && w._filoTabs.cookieMode === 'privacy')), { timeout: 5000 }).toBe(true);
  await app.evaluate((_e, ms) => globalThis.__filoCookies.impostaMargineUscita(ms), margine);
}

async function scheda(app, id) {
  return app.evaluate(({ BrowserWindow }, tabId) => {
    for (const w of BrowserWindow.getAllWindows()) {
      const t = w._filoTabs && w._filoTabs.tabs.find((x) => x.id === tabId);
      if (!t) continue;
      const wc = t.view.webContents;
      return { url: wc.getURL(), titolo: wc.getTitle(), carica: wc.isLoading(), partizione: t.partition || null };
    }
    return null;
  }, id);
}

async function vede(app, id, prefisso) {
  let s = null;
  await expect.poll(async () => {
    s = await scheda(app, id);
    return !!s && s.url.startsWith(prefisso) && !s.carica && s.titolo.startsWith('C=');
  }, { timeout: 10_000 }).toBe(true);
  return s;
}

async function apri(app, shell, url) {
  const { id } = await shell.evaluate((u) => window.filoShell.tabs.open(u), url);
  return { id, ...(await vede(app, id, url)) };
}

async function nellaPagina(app, id, js) {
  return app.evaluate(({ BrowserWindow }, [tabId, code]) => {
    for (const w of BrowserWindow.getAllWindows()) {
      const t = w._filoTabs && w._filoTabs.tabs.find((x) => x.id === tabId);
      if (t) return t.view.webContents.executeJavaScript(code, true);
    }
    return null;
  }, [id, js]);
}

test('clic su un collegamento verso un altro sito: è un\'uscita, al ritorno dopo il margine il sito è pulito', async ({ app, shell }) => {
  await privacy(app, shell, 800);
  const a = await apri(app, shell, sito('/accedi?vai=' + encodeURIComponent(altro('/b'))));
  await nellaPagina(app, a.id, 'document.getElementById("l").click()');
  await vede(app, a.id, altro('/b'));
  await attendi(2500);
  const c = await apri(app, shell, sito('/dopo'));
  expect(c.titolo).toBe(PULITO);
});

test('chiusa e riaperta di corsa molte volte attorno al margine: ogni riapertura carica, e alla fine dopo il margine è pulito', async ({ app, shell }) => {
  await privacy(app, shell, 30);
  for (let i = 0; i < 6; i++) {
    const a = await apri(app, shell, sito('/accedi'));
    await shell.evaluate((t) => window.filoShell.tabs.close(t), a.id);
    await attendi(i % 2 ? 0 : 40);
  }
  await attendi(500);
  const c = await apri(app, shell, sito('/fine'));
  expect(c.titolo).toBe(PULITO);
  await shell.evaluate((t) => window.filoShell.tabs.close(t), c.id);
});

