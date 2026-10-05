// Privacy: il jar effimero di un sito si butta quando nessuna scheda ce l'ha più aperto, passato un margine (#756).
// Il sito «vede» la sessione dal cookie che gli arriva e dalla memoria della pagina: la pagina li scrive nel titolo.

import { test, expect } from './fixtures/electron.mjs';
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
    res.end(`<!doctype html><meta charset="utf-8"><body><script>
      var ls = localStorage.getItem('k');
      ${imposta ? "localStorage.setItem('k', 'v');" : ''}
      document.title = 'C=' + ${cookie} + ';L=' + (ls || '-');
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
const fidato = (p) => `http://sito-pubblico.test:${port}${p}`;
const CONNESSO = 'C=sess=abc;L=v';
const PULITO = 'C=-;L=-';

async function privacy(app, shell, { trustedSites = [], margine }) {
  await shell.evaluate((t) => window.filoShell.message({
    type: 'update_settings', settings: { security: { cookies: { mode: 'privacy', trustedSites: t } } },
  }), trustedSites);
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

// Quello che il sito vede alla pagina `url` della scheda `id`, a caricamento finito.
async function vede(app, id, url) {
  let s = null;
  await expect.poll(async () => {
    s = await scheda(app, id);
    return !!s && s.url === url && !s.carica && s.titolo.startsWith('C=');
  }, { timeout: 10_000 }).toBe(true);
  return s;
}

async function apri(app, shell, url) {
  const { id } = await shell.evaluate((u) => window.filoShell.tabs.open(u), url);
  return { id, ...(await vede(app, id, url)) };
}

async function chiudi(shell, id) {
  await shell.evaluate((t) => window.filoShell.tabs.close(t), id);
}

async function naviga(app, shell, id, url) {
  await shell.evaluate(([t, u]) => window.filoShell.tabs.navigate(t, u), [id, url]);
  return vede(app, id, url);
}

const attendi = (ms) => new Promise((r) => setTimeout(r, ms));

test('chiusa l\'ultima scheda del sito e passato il margine, il sito riparte pulito; finché una scheda è aperta resta connesso', async ({ app, shell }) => {
  await privacy(app, shell, { margine: 800 });
  const a = await apri(app, shell, sito('/accedi'));
  expect(a.titolo).toBe(PULITO);
  expect(a.partizione).toMatch(/^filo-priv-/);

  const b = await apri(app, shell, sito('/b'));
  expect(b.titolo).toBe(CONNESSO);
  await chiudi(shell, b.id);
  await attendi(2500);
  expect((await naviga(app, shell, a.id, sito('/ancora'))).titolo).toBe(CONNESSO);

  await chiudi(shell, a.id);
  await attendi(2500);
  const c = await apri(app, shell, sito('/dopo'));
  expect(c.titolo).toBe(PULITO);

  // Il jar nuovo funziona come il primo: si accede, e un'altra scheda dello stesso sito lo condivide.
  await naviga(app, shell, c.id, sito('/accedi'));
  expect((await apri(app, shell, sito('/di-nuovo'))).titolo).toBe(CONNESSO);
});

test('chiusa e riaperta prima del margine, la sessione del sito c\'è ancora', async ({ app, shell }) => {
  await privacy(app, shell, { margine: 60_000 });
  const a = await apri(app, shell, sito('/accedi'));
  await chiudi(shell, a.id);
  await attendi(1500);
  expect((await apri(app, shell, sito('/riaperta'))).titolo).toBe(CONNESSO);
});

test('uscire dal sito navigando altrove nella stessa scheda conta come uscita', async ({ app, shell }) => {
  await privacy(app, shell, { margine: 800 });
  const a = await apri(app, shell, sito('/accedi'));
  await naviga(app, shell, a.id, fidato('/altrove'));
  await attendi(2500);
  expect((await naviga(app, shell, a.id, sito('/torno'))).titolo).toBe(PULITO);
});

test('un sito fidato («resta connesso») conserva la sessione anche dopo il margine', async ({ app, shell }) => {
  const host = await app.evaluate((_e, u) => globalThis.__filoCookies.registrableOf(u), fidato('/'));
  await privacy(app, shell, { trustedSites: [host], margine: 800 });
  const a = await apri(app, shell, fidato('/accedi'));
  expect(a.partizione).toMatch(/^persist:filo-priv-/);
  await chiudi(shell, a.id);
  await attendi(2500);
  expect((await apri(app, shell, fidato('/riaperta'))).titolo).toBe(CONNESSO);
});

test('tolto dai «siti fidati», quello che il sito aveva salvato se ne va: non torna rimettendolo fra i fidati', async ({ app, shell }) => {
  const host = await app.evaluate((_e, u) => globalThis.__filoCookies.registrableOf(u), fidato('/'));
  await privacy(app, shell, { trustedSites: [host], margine: 800 });
  const a = await apri(app, shell, fidato('/accedi'));
  expect(a.partizione).toMatch(/^persist:filo-priv-/);
  await chiudi(shell, a.id);
  await attendi(1500);

  await privacy(app, shell, { trustedSites: [], margine: 800 });
  const b = await apri(app, shell, fidato('/dopo'));
  expect(b.partizione).not.toMatch(/^persist:/);
  expect(b.titolo).toBe(PULITO);
  await chiudi(shell, b.id);
  await attendi(2500);

  await privacy(app, shell, { trustedSites: [host], margine: 800 });
  expect((await apri(app, shell, fidato('/ritorno'))).titolo).toBe(PULITO);
});

test('il sito tolto dai fidati mentre è aperto non perde la sessione sotto le mani; rimesso prima di chiudere, resta connesso', async ({ app, shell }) => {
  const host = await app.evaluate((_e, u) => globalThis.__filoCookies.registrableOf(u), fidato('/'));
  await privacy(app, shell, { trustedSites: [host], margine: 800 });
  const a = await apri(app, shell, fidato('/accedi'));

  // Tolto dai fidati con la scheda aperta: la pagina che l'utente sta usando non viene svuotata.
  await privacy(app, shell, { trustedSites: [], margine: 800 });
  await attendi(2500);
  expect(await nellaPagina(app, a.id, 'document.cookie')).toContain('sess=abc');

  // Rimesso fra i fidati prima di chiudere: l'utente ha disdetto, e quello che il sito aveva salvato resta.
  await privacy(app, shell, { trustedSites: [host], margine: 800 });
  await chiudi(shell, a.id);
  await attendi(2500);
  expect((await apri(app, shell, fidato('/riaperta'))).titolo).toBe(CONNESSO);
});

async function nellaPagina(app, id, codice) {
  return app.evaluate(({ BrowserWindow }, [tabId, js]) => {
    for (const w of BrowserWindow.getAllWindows()) {
      const t = w._filoTabs && w._filoTabs.tabs.find((x) => x.id === tabId);
      if (t) return t.view.webContents.executeJavaScript(js, true);
    }
    return null;
  }, [id, codice]);
}
