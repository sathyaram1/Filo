// Esplorazione del giro 7 di #813: verdetti di Google che arrivano tardi, dopo che la scheda è passata altrove.
import { test, expect } from '../../fixtures/electron.mjs';

async function google(app, { lista = {}, ritardo = 0 } = {}) {
  await app.evaluate(async (_e, cfg) => {
    const crypto = process.getBuiltinModule('crypto');
    const sha = (s) => crypto.createHash('sha256').update(s, 'latin1').digest();
    const voci = Object.entries(cfg.lista).map(([expr, threatType]) => ({ full: sha(expr), threatType }));
    const stato = globalThis.__v813g7 || { prima: globalThis.fetch, richieste: [] };
    Object.assign(stato, { ritardo: cfg.ritardo });
    globalThis.__v813g7 = stato;
    const risposta = (status, corpo) => ({ ok: status === 200, status, async json() { return corpo; } });
    globalThis.fetch = async (url, opts = {}) => {
      const u = String(url);
      if (/rdap\.org|crt\.sh/.test(u)) return risposta(404, {});
      if (!u.startsWith('https://safebrowsing.googleapis.com/')) return stato.prima(url, opts);
      stato.richieste.push(u);
      if (stato.ritardo) await new Promise((r) => setTimeout(r, stato.ritardo));
      const chiesti = new URL(u).searchParams.getAll('hashPrefixes');
      const fullHashes = voci
        .filter((v) => chiesti.includes(v.full.subarray(0, 4).toString('base64')))
        .map((v) => ({ fullHash: v.full.toString('base64'), fullHashDetails: [{ threatType: v.threatType }] }));
      return risposta(200, { fullHashes, cacheDuration: '300s' });
    };
    globalThis.SN_SAFEBROWSE._gsbLookup.clear();
    globalThis.SN_SAFEBROWSE.configure({ gsbKey: () => 'chiave-di-prova', enableSandbox: false, enableNetwork: false });
  }, { lista, ritardo });
}

const avvisoScheda = (app) => app.evaluate(({ BrowserWindow }) => {
  for (const w of BrowserWindow.getAllWindows()) {
    const tm = w._filoTabs;
    const t = tm && tm.tabs.find((x) => x.id === tm.activeId);
    if (t) return { livello: t.sbLevel || 'safe', url: (t.sbAvviso && t.sbAvviso.url) || null, coperta: !!tm.avvisoSito.coperta() };
  }
  return null;
});

const espressione = (url) => { const u = new URL(url); return u.hostname + u.pathname + (u.search || ''); };

test('verdetto lento di una pagina in lista lasciata subito: la pagina pulita dopo resta senza avviso; tornando indietro avvisa', async ({ app, openTab, testServer }) => {
  const listata = testServer.html('<title>ESCA</title><form><input type="password"></form>', { pubblico: true });
  const pulita = testServer.html('<title>PULITA</title><p>ok</p>', { pubblico: true });
  await google(app, { lista: { [espressione(listata)]: 'SOCIAL_ENGINEERING' }, ritardo: 3000 });
  const page = await openTab(listata);
  await page.waitForTimeout(300);
  await page.evaluate((u) => location.assign(u), pulita);
  await page.waitForURL(pulita);
  await page.waitForTimeout(5000);
  const a = await avvisoScheda(app);
  expect(a.livello).toBe('safe');
  expect(a.coperta).toBe(false);
  await page.goBack();
  await page.waitForURL(listata);
  await expect.poll(async () => (await avvisoScheda(app)).livello, { timeout: 6000 }).toBe('pericoloso');
  await page.goForward();
  await page.waitForURL(pulita);
  await expect.poll(async () => (await avvisoScheda(app)).coperta, { timeout: 6000 }).toBe(false);
});

test('due schede: verdetto lento della scheda dietro non copre quella davanti', async ({ app, openTab, testServer }) => {
  const listata = testServer.html('<title>ESCA2</title><form><input type="password"></form>', { pubblico: true });
  const pulita = testServer.html('<title>PULITA2</title><p>ok</p>', { pubblico: true });
  await google(app, { lista: { [espressione(listata)]: 'MALWARE' }, ritardo: 3000 });
  await openTab(listata);
  await openTab(pulita);
  await new Promise((r) => setTimeout(r, 5000));
  const a = await avvisoScheda(app);
  expect(a.livello).toBe('safe');
  expect(a.coperta).toBe(false);
});
