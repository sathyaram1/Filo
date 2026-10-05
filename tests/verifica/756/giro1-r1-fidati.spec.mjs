// Verifica #756: cosa resta del jar persistente di un sito tolto dai "siti fidati" in Privacy.
import { test, expect } from '../../fixtures/electron.mjs';
import { createServer } from 'node:http';

let server, port;
test.beforeAll(async () => {
  server = createServer((req, res) => {
    const imposta = req.url.startsWith('/accedi');
    const head = { 'Content-Type': 'text/html; charset=utf-8' };
    if (imposta) head['Set-Cookie'] = 'sess=abc; Max-Age=86400; Path=/';
    res.writeHead(200, head);
    res.end(`<!doctype html><title>C=${req.headers.cookie || '-'}</title>`);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r)); port = server.address().port;
});
test.afterAll(async () => { server.closeAllConnections?.(); await new Promise((r) => server.close(r)); });

const fidato = (p) => `http://sito-pubblico.test:${port}${p}`;
const attendi = (ms) => new Promise((r) => setTimeout(r, ms));

async function impostaFidati(app, shell, lista) {
  await shell.evaluate((t) => window.filoShell.message({
    type: 'update_settings', settings: { security: { cookies: { mode: 'privacy', trustedSites: t } } },
  }), lista);
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()
    .some((w) => w._filoTabs && w._filoTabs.cookieMode === 'privacy' && JSON.stringify([...(w._filoTabs.trustedSites || [])]))), { timeout: 5000 }).toBeTruthy();
  await attendi(600);
}

async function apri(app, shell, url) {
  const { id } = await shell.evaluate((u) => window.filoShell.tabs.open(u), url);
  let s = null;
  await expect.poll(async () => {
    s = await app.evaluate(({ BrowserWindow }, tabId) => {
      for (const w of BrowserWindow.getAllWindows()) {
        const t = w._filoTabs && w._filoTabs.tabs.find((x) => x.id === tabId);
        if (t) return { url: t.view.webContents.getURL(), titolo: t.view.webContents.getTitle(), carica: t.view.webContents.isLoading(), partizione: t.partition || null };
      }
      return null;
    }, id);
    return !!s && s.url === url && !s.carica && s.titolo.startsWith('C=');
  }, { timeout: 10_000 }).toBe(true);
  return { id, ...s };
}

test('tolto dai siti fidati e rimesso, la vecchia sessione non deve tornare', async ({ app, shell }) => {
  const host = await app.evaluate((_e, u) => globalThis.__filoCookies.registrableOf(u), fidato('/'));
  await impostaFidati(app, shell, [host]);
  await app.evaluate(() => globalThis.__filoCookies.impostaMargineUscita(500));
  const a = await apri(app, shell, fidato('/accedi'));
  expect(a.partizione).toMatch(/^persist:/);
  await shell.evaluate((t) => window.filoShell.tabs.close(t), a.id);
  await attendi(1500);

  // L'utente toglie il sito dai fidati: da qui in poi è usa-e-getta.
  await impostaFidati(app, shell, []);
  const b = await apri(app, shell, fidato('/dopo'));
  expect(b.partizione).not.toMatch(/^persist:/);
  expect(b.titolo).toBe('C=-');
  await shell.evaluate((t) => window.filoShell.tabs.close(t), b.id);
  await attendi(1500);

  // Rimesso fra i fidati: non deve ritrovare l'accesso di prima.
  await impostaFidati(app, shell, [host]);
  const c = await apri(app, shell, fidato('/ritorno'));
  expect(c.titolo).toBe('C=-');
});
