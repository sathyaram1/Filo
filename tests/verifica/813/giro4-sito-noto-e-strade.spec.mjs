// Verifica di #813, quarto giro: le porte del giro 3 (sito già noto in lista) e le strade vicine alla navigazione.
// Google finto nel processo principale, solo per Safe Browsing: nessuna prova parla col servizio vero.
import http from 'node:http';
import { test, expect } from '../../fixtures/electron.mjs';

async function google(app, { lista = {}, modo = 'ok', ritardo = 0, senzaCache = false, chiave = 'chiave-di-prova', attributi = null } = {}) {
  await app.evaluate(async (_e, cfg) => {
    const crypto = process.getBuiltinModule('crypto');
    const sha = (s) => crypto.createHash('sha256').update(s, 'latin1').digest();
    const voci = Object.entries(cfg.lista).map(([expr, threatType]) => ({ full: sha(expr), threatType }));
    const stato = globalThis.__v813g4 || { prima: globalThis.fetch, richieste: [] };
    Object.assign(stato, { modo: cfg.modo, ritardo: cfg.ritardo });
    globalThis.__v813g4 = stato;
    const risposta = (status, corpo) => ({ ok: status === 200, status, async json() { return corpo; } });
    globalThis.fetch = async (url, opts = {}) => {
      const u = String(url);
      if (/rdap\.org|crt\.sh/.test(u)) return risposta(404, {});
      if (!u.startsWith('https://safebrowsing.googleapis.com/')) return stato.prima(url, opts);
      stato.richieste.push(u);
      if (stato.ritardo) await new Promise((r) => setTimeout(r, stato.ritardo));
      if (stato.modo === 'offline') throw new TypeError('fetch failed');
      if (stato.modo === 'errore') return risposta(503, { error: { code: 503 } });
      const chiesti = new URL(u).searchParams.getAll('hashPrefixes');
      const fullHashes = voci
        .filter((v) => chiesti.includes(v.full.subarray(0, 4).toString('base64')))
        .map((v) => ({ fullHash: v.full.toString('base64'), fullHashDetails: [{ threatType: v.threatType, ...(cfg.attributi ? { attributes: cfg.attributi } : {}) }] }));
      return risposta(200, cfg.senzaCache ? { fullHashes } : { fullHashes, cacheDuration: '300s' });
    };
    globalThis.SN_SAFEBROWSE.configure({ gsbKey: () => cfg.chiave, enableSandbox: false, enableNetwork: false });
  }, { lista, modo, ritardo, senzaCache, chiave, attributi });
}

const pulisci = (app) => app.evaluate(() => globalThis.SN_SAFEBROWSE._gsbLookup.clear());
const avviso = (page) => page.getByText('Sito segnalato come pericoloso');

function espressione(url) {
  const u = new URL(url);
  return u.hostname + u.pathname + (u.search || '');
}

for (const [nome, cfg] of [
  ['con Google irraggiungibile', { modo: 'offline' }],
  ['con Google che risponde dopo cinque secondi', { ritardo: 5000 }],
  ['con un errore del servizio', { modo: 'errore' }],
  ['senza più la chiave', { chiave: '' }],
]) {
  test(`sito in lista per intero: la pagina dopo avvisa subito ${nome}`, async ({ app, openTab, testServer }) => {
    const prima = testServer.html('<title>ESCA</title><form><input type="password"></form>');
    const dopo = testServer.html('<title>CARTA</title><form><input name="cc"></form>');
    await pulisci(app);
    await google(app, { lista: { [new URL(prima).hostname + '/']: 'SOCIAL_ENGINEERING' } });
    const page = await openTab(prima);
    await expect(avviso(page)).toBeVisible({ timeout: 8000 });
    await google(app, { lista: { [new URL(prima).hostname + '/']: 'SOCIAL_ENGINEERING' }, ...cfg });
    await page.evaluate((u) => location.assign(u), dopo);
    await page.waitForURL(dopo);
    await expect(avviso(page)).toBeVisible({ timeout: 2000 });
  });
}

test('una pagina in lista raggiunta con un reindirizzamento del server mostra l\'avviso', async ({ app, openTab, testServer }) => {
  const listata = testServer.html('<title>ESCA</title><form><input type="password"></form>');
  const srv = http.createServer((req, res) => { res.writeHead(302, { Location: listata }); res.end(); });
  await new Promise((r) => srv.listen(0, 'localhost', r));
  try {
    await pulisci(app);
    await google(app, { lista: { [espressione(listata)]: 'SOCIAL_ENGINEERING' } });
    const partenza = testServer.html(`<title>POSTA</title><a id="l" href="http://localhost:${srv.address().port}/corto">apri</a>`);
    const page = await openTab(partenza);
    await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 8000 });
    await page.click('#l');
    await page.waitForURL(listata);
    await expect(avviso(page)).toBeVisible({ timeout: 8000 });
  } finally {
    srv.close();
  }
});

test('una pagina in lista aperta con frammento e nome utente nell\'indirizzo mostra l\'avviso', async ({ app, openTab, testServer }) => {
  const listata = testServer.html('<title>ESCA</title><form><input type="password"></form>');
  const u = new URL(listata);
  await pulisci(app);
  await google(app, { lista: { [espressione(listata)]: 'SOCIAL_ENGINEERING' } });
  const page = await openTab(`http://mario:segreta@${u.host}${u.pathname}#accedi`);
  await expect(avviso(page)).toBeVisible({ timeout: 8000 });
});

test('una pagina di software indesiderato lo dice con la sua categoria', async ({ app, openTab, testServer }) => {
  const listata = testServer.html('<title>BARRA</title><p>scarica</p>');
  await pulisci(app);
  await google(app, { lista: { [espressione(listata)]: 'UNWANTED_SOFTWARE' } });
  const page = await openTab(listata);
  await expect(avviso(page)).toBeVisible({ timeout: 8000 });
  await expect(page.getByText(/software indesiderato/)).toBeVisible();
});

test('senza durata di cache nella risposta l\'avviso compare lo stesso, e di nuovo ricaricando', async ({ app, openTab, testServer }) => {
  const listata = testServer.html('<title>ESCA</title><form><input type="password"></form>');
  await pulisci(app);
  await google(app, { lista: { [espressione(listata)]: 'SOCIAL_ENGINEERING' }, senzaCache: true });
  const page = await openTab(listata);
  await expect(avviso(page)).toBeVisible({ timeout: 8000 });
  await page.reload();
  await expect(avviso(page)).toBeVisible({ timeout: 8000 });
});

test('un collegamento che apre una scheda nuova su una pagina in lista mostra l\'avviso lì', async ({ app, openTab, testServer }) => {
  const listata = testServer.html('<title>ESCA</title><form><input type="password"></form>');
  await pulisci(app);
  await google(app, { lista: { [espressione(listata)]: 'SOCIAL_ENGINEERING' } });
  const partenza = testServer.html(`<title>POSTA</title><a id="l" target="_blank" href="${listata}">apri</a>`);
  const page = await openTab(partenza);
  await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 8000 });
  await page.click('#l');
  let nuova = null;
  await expect.poll(() => {
    nuova = app.windows().find((w) => w.url() === listata) || null;
    return !!nuova;
  }, { timeout: 8000 }).toBe(true);
  await expect(avviso(nuova)).toBeVisible({ timeout: 8000 });
});
