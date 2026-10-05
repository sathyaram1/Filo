// Verifica #756 giro 2: cambiare l'elenco dei fidati con la scheda del sito aperta non deve far uscire dal sito al clic dopo.
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

const sito = (p) => `http://sito-pubblico.test:${port}${p}`;
const attendi = (ms) => new Promise((r) => setTimeout(r, ms));

async function privacy(app, shell, trustedSites, margine = 800) {
  await shell.evaluate((t) => window.filoShell.message({
    type: 'update_settings', settings: { security: { cookies: { mode: 'privacy', trustedSites: t } } },
  }), trustedSites);
  await expect.poll(() => app.evaluate(({ BrowserWindow }, t) => BrowserWindow.getAllWindows()
    .some((w) => w._filoTabs && w._filoTabs.cookieMode === 'privacy' && w._filoTabs.trustedSites.join() === t.join()), trustedSites),
  { timeout: 5000 }).toBe(true);
  await app.evaluate((_e, ms) => globalThis.__filoCookies.impostaMargineUscita(ms), margine);
}

async function stato(app, id) {
  return app.evaluate(({ BrowserWindow }, tabId) => {
    for (const w of BrowserWindow.getAllWindows()) {
      const t = w._filoTabs && w._filoTabs.tabs.find((x) => x.id === tabId);
      if (t) return { url: t.view.webContents.getURL(), titolo: t.view.webContents.getTitle(), carica: t.view.webContents.isLoading() };
    }
    return null;
  }, id);
}
async function vede(app, id, url) {
  let s = null;
  await expect.poll(async () => { s = await stato(app, id); return !!s && s.url === url && !s.carica && s.titolo.startsWith('C='); },
    { timeout: 10_000 }).toBe(true);
  return s.titolo;
}
async function apri(app, shell, url) {
  const { id } = await shell.evaluate((u) => window.filoShell.tabs.open(u), url);
  await vede(app, id, url);
  return id;
}
async function naviga(app, shell, id, url) {
  await shell.evaluate(([t, u]) => window.filoShell.tabs.navigate(t, u), [id, url]);
  return vede(app, id, url);
}

test('accedo, poi segno il sito fra i fidati con la scheda aperta: al clic dopo sono ancora dentro', async ({ app, shell }) => {
  const host = await app.evaluate((_e, u) => globalThis.__filoCookies.registrableOf(u), sito('/'));
  await privacy(app, shell, []);
  const a = await apri(app, shell, sito('/accedi'));
  await privacy(app, shell, [host]);
  expect(await naviga(app, shell, a, sito('/posta'))).toBe('C=sess=abc');
  await attendi(2500);
  expect(await naviga(app, shell, a, sito('/ancora'))).toBe('C=sess=abc');
});

test('tolgo il sito dai fidati con la scheda aperta: al clic dopo nello stesso sito non vengo buttato fuori', async ({ app, shell }) => {
  const host = await app.evaluate((_e, u) => globalThis.__filoCookies.registrableOf(u), sito('/'));
  await privacy(app, shell, [host]);
  const a = await apri(app, shell, sito('/accedi'));
  await privacy(app, shell, []);
  expect(await naviga(app, shell, a, sito('/posta'))).toBe('C=sess=abc');
});
