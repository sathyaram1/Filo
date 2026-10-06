// Verifica #756: finché il sito è aperto da qualche parte (scheda in secondo piano, altra finestra) la sessione non si butta.
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

const sito = (p) => `http://127.0.0.1:${port}${p}`;
const altro = (p) => `http://sito-pubblico.test:${port}${p}`;
const attendi = (ms) => new Promise((r) => setTimeout(r, ms));

async function privacy(app, shell, margine) {
  await shell.evaluate(() => window.filoShell.message({
    type: 'update_settings', settings: { security: { cookies: { mode: 'privacy', trustedSites: [] } } },
  }));
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()
    .some((w) => w._filoTabs && w._filoTabs.cookieMode === 'privacy')), { timeout: 5000 }).toBe(true);
  await app.evaluate((_e, ms) => globalThis.__filoCookies.impostaMargineUscita(ms), margine);
}

async function statoScheda(app, id) {
  return app.evaluate(({ BrowserWindow }, tabId) => {
    for (const w of BrowserWindow.getAllWindows()) {
      const t = w._filoTabs && w._filoTabs.tabs.find((x) => x.id === tabId);
      if (t) return { url: t.view.webContents.getURL(), titolo: t.view.webContents.getTitle(), carica: t.view.webContents.isLoading() };
    }
    return null;
  }, id);
}

async function apriIn(app, shell, url, { finestra = 0 } = {}) {
  const id = await app.evaluate(({ BrowserWindow }, [u, i]) => {
    const ws = BrowserWindow.getAllWindows().filter((w) => w._filoTabs && !w._filoIncognito);
    return ws[i]._filoTabs.openTab(u, { activate: true });
  }, [url, finestra]);
  let s = null;
  await expect.poll(async () => {
    s = await statoScheda(app, id);
    return !!s && s.url === url && !s.carica && s.titolo.startsWith('C=');
  }, { timeout: 10_000 }).toBe(true);
  return { id, ...s };
}

test('il sito resta connesso se una sua scheda è solo in secondo piano', async ({ app, shell }) => {
  await privacy(app, shell, 800);
  const a = await apriIn(app, shell, sito('/accedi'));
  // Scheda attiva su un altro sito: quella del sito resta in secondo piano.
  await apriIn(app, shell, altro('/altro'));
  await attendi(2500);
  expect((await apriIn(app, shell, sito('/ancora'))).titolo).toBe('C=sess=abc');

});
