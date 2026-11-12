// I contatori della sicurezza (#1474) nell'app vera: il verdetto della pagina e i controlli di rete che l'hanno dato, le
// scelte sull'avviso, la pagina delicata che ferma il riassunto della scheda chiusa. Si conta nell'ora in corso, e mai il
// sito. Forma, spedizione e regole: tests/unit/contatoriSicurezza.test.mjs e firestoreRulesContatoriSicurezza.test.mjs.

import { test, expect } from './fixtures/electron.mjs';
import { vistaAvviso, copertura, scriviDallaTastiera } from './helpers/avvisoSito.mjs';

// Le ore di oggi sommate, misura per misura.
const sicurezza = (app) => app.evaluate(async () => {
  const s = await globalThis.SN_CONTATORI_MAIN.letto();
  const g = globalThis.SN_CONTATORI.giornoDi(Date.now());
  const out = {};
  for (const [k, ora] of Object.entries(s.ore || {})) {
    if (!k.startsWith(`${g}T`) || !ora.sicurezza) continue;
    for (const [m, conti] of Object.entries(ora.sicurezza)) {
      for (const [chiave, n] of Object.entries(conti || {})) (out[m] = out[m] || {})[chiave] = ((out[m] || {})[chiave] || 0) + n;
    }
  }
  return out;
});
const voce = async (app, misura, chiave) => ((await sicurezza(app))[misura] || {})[chiave] || 0;
const durate = async (app, prefisso) => Object.entries((await sicurezza(app)).sito_approfondito || {})
  .filter(([k]) => k.startsWith(prefisso)).reduce((n, [, v]) => n + v, 0);
const statoContatori = (app) => app.evaluate(async () => JSON.stringify(await globalThis.SN_CONTATORI_MAIN.letto()));

// Le pagine dei siti finti le serve la sessione stessa; Safe Browsing e il giudizio del modello sono finti.
async function servi(app, pagine, { gsbListed = false } = {}) {
  await app.evaluate(async ({ session, net }, { pg, gsbListed: lista }) => {
    const risposta = (req) => {
      const u = new URL(req.url);
      const html = pg[u.hostname + u.pathname];
      if (html) return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } });
      return net.fetch(req, { bypassCustomProtocolHandlers: true });
    };
    for (const s of ['http', 'https']) {
      try { session.defaultSession.protocol.unhandle(s); } catch (_) {}
      session.defaultSession.protocol.handle(s, risposta);
    }
    globalThis.SN_SAFEBROWSE.setProviders({
      gsb: lista ? async () => ({ listed: true, category: 'phishing' }) : null,
      rdap: null, ct: null, sandbox: null,
      llm: async () => ({ suspicious: false, reason: null }),
    });
  }, { pg: pagine, gsbListed });
}

async function apri(app, shell, url) {
  const host = new URL(url).hostname;
  await shell.evaluate((u) => window.filoShell.tabs.open(u), url);
  const fine = Date.now() + 10_000;
  while (Date.now() < fine) {
    const p = app.windows().find((w) => { try { return new URL(w.url()).hostname === host; } catch (_) { return false; } });
    if (p) {
      await app.evaluate(({ BrowserWindow }) => {
        const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
        const tm = win._filoTabs;
        win.focus();
        tm.tabs.find((t) => t.id === tm.activeId).view.webContents.focus();
      });
      return p;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`nessuna scheda per ${url}`);
}

const MODULO = '<title>Accedi</title><form><input name="email" placeholder="Email">'
  + '<input type="password" id="pw" name="pw" placeholder="Password"><button>Accedi</button></form>';

test('una pagina in lista nera: il verdetto, il controllo che l’ha dato e «Procedi» con «confermo» si contano, mai il sito', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await servi(app, { 'conto-verifica-contatori.com/login': MODULO }, { gsbListed: true });
  await apri(app, shell, 'https://conto-verifica-contatori.com/login');
  const avviso = await vistaAvviso(app);
  await expect(avviso.getByText('Sito segnalato come pericoloso')).toBeVisible({ timeout: 8_000 });
  await expect.poll(() => voce(app, 'sito_verdetto', 'pericoloso:gsb_phishing'), { timeout: 8_000 }).toBe(1);
  await expect.poll(() => durate(app, 'gsb:ok:'), { timeout: 8_000 }).toBeGreaterThan(0);

  // «Procedi» senza «confermo» non fa niente e non si conta; con «confermo» sì, una volta.
  const procedi = avviso.getByRole('button', { name: 'Procedi comunque' });
  await expect(procedi).toBeDisabled();
  await scriviDallaTastiera(app, 'confermo');
  await procedi.click();
  await expect.poll(async () => (await copertura(app)).coperta).toBe(false);
  await expect.poll(() => voce(app, 'avviso_scelta', 'procedi:pericoloso:dopo'), { timeout: 8_000 }).toBe(1);

  const s = await sicurezza(app);
  expect(s.sito_verdetto.pericoloso, 'una pagina, un verdetto').toBe(1);
  expect(s.sito_verdetto.safe || 0, 'il verdetto di prima della lista nera non resta contato').toBe(0);
  expect(await statoContatori(app)).not.toContain('conto-verifica-contatori');
});

test('un sito sospetto: «Continua» si conta col livello dell’avviso', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await servi(app, { 'area-riservata-contatori.it/accesso': MODULO });
  const page = await apri(app, shell, 'http://area-riservata-contatori.it/accesso');
  const avviso = await vistaAvviso(app);
  await expect(avviso.getByText('Sito potenzialmente sospetto')).toBeVisible({ timeout: 8_000 });
  const continua = avviso.getByRole('button', { name: 'Continua' });
  await expect(continua).toBeEnabled({ timeout: 3_000 });
  await continua.click();
  await expect.poll(async () => (await copertura(app)).coperta).toBe(false);
  await expect.poll(() => voce(app, 'avviso_scelta', 'continua:sospetto:dopo'), { timeout: 8_000 }).toBe(1);
  expect(await voce(app, 'sito_verdetto', 'sospetto')).toBe(1);
  expect(await voce(app, 'sito_verdetto', 'sospetto:insecure_transport')).toBe(1);
  await page.locator('#pw').fill('ok');
  expect(await statoContatori(app)).not.toContain('area-riservata-contatori');
});

test('chiusa una pagina con un campo password, il riassunto fermato si conta sotto «campi»', async ({ app, shell, openTab, testServer }) => {
  await testServer.openReady(openTab,
    '<!doctype html><html><head><title>Il mio conto</title></head><body><p>Saldo</p><form><input name="u"><input type="password" name="pw"></form></body></html>',
    { pubblico: true });
  await expect.poll(() => app.evaluate(() => globalThis.SN_DELICATE.haCampi('sito-pubblico.test')), { timeout: 8_000 }).toBe(true);
  const id = await shell.evaluate(async () => (await window.filoShell.tabs.snapshot()).activeId);
  await shell.evaluate(async (i) => window.filoShell.tabs.close(i), id);
  await expect.poll(() => voce(app, 'pagina_delicata', 'campi:riassunto_schede'), { timeout: 8_000 }).toBe(1);
  expect(await statoContatori(app)).not.toContain('sito-pubblico');
});
