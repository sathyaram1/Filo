// Verifica di #813, quarto giro: le porte del giro 3 (sito già noto in lista) e le strade vicine alla navigazione.
// Google finto nel processo principale, solo per Safe Browsing: nessuna prova parla col servizio vero. Le pagine hanno
// un nome da internet: la rete di casa resta fuori dal controllo (#591).
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
// L'avviso sta in una vista sopra la scheda, non nella pagina (patterns/un-avviso-su-una-pagina-non-sta-dentro-la-pagina.md):
// vale il livello della scheda attiva, con la pagina per cui è stato dato, e il testo nella vista.
const avvisoScheda = (app) => app.evaluate(({ BrowserWindow }) => {
  for (const w of BrowserWindow.getAllWindows()) {
    const tm = w._filoTabs;
    const t = tm && tm.tabs.find((x) => x.id === tm.activeId);
    if (t) return { livello: t.sbLevel || 'safe', url: (t.sbAvviso && t.sbAvviso.url) || null };
  }
  return null;
});

async function avvisoSu(app, url, testo = null, timeout = 8000) {
  const dove = new URL(url);
  await expect.poll(async () => {
    const a = await avvisoScheda(app);
    if (!a || !a.url) return a && a.livello;
    const u = new URL(a.url);
    return `${a.livello} ${u.hostname}${u.pathname}`;
  }, { timeout }).toBe(`pericoloso ${dove.hostname}${dove.pathname}`);
  // Dopo un ricaricamento la vista può essere nata di nuovo: vale quella che mostra l'avviso.
  const viste = () => app.windows().filter((w) => { try { return w.url().startsWith('filo://shell/avviso-sito.html'); } catch (_) { return false; } });
  const mostra = async (t) => {
    for (const v of viste()) { if (await v.getByText(t).first().isVisible().catch(() => false)) return true; }
    return false;
  };
  await expect.poll(() => mostra('Sito segnalato come pericoloso'), { timeout: 5000 }).toBe(true);
  if (testo) await expect.poll(() => mostra(testo), { timeout: 5000 }).toBe(true);
}

const senzaAvviso = async (app) => expect((await avvisoScheda(app)).livello).toBe('safe');

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
    const prima = testServer.html('<title>ESCA</title><form><input type="password"></form>', { pubblico: true });
    const dopo = testServer.html('<title>CARTA</title><form><input name="cc"></form>', { pubblico: true });
    await pulisci(app);
    await google(app, { lista: { [new URL(prima).hostname + '/']: 'SOCIAL_ENGINEERING' } });
    const page = await openTab(prima);
    await avvisoSu(app, prima);
    await google(app, { lista: { [new URL(prima).hostname + '/']: 'SOCIAL_ENGINEERING' }, ...cfg });
    await page.evaluate((u) => location.assign(u), dopo);
    await page.waitForURL(dopo);
    await avvisoSu(app, dopo, null, 2000);
  });
}

test('una pagina in lista raggiunta con un reindirizzamento del server mostra l\'avviso', async ({ app, openTab, testServer }) => {
  const listata = testServer.html('<title>ESCA</title><form><input type="password"></form>', { pubblico: true });
  const srv = http.createServer((req, res) => { res.writeHead(302, { Location: listata }); res.end(); });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  try {
    await pulisci(app);
    await google(app, { lista: { [espressione(listata)]: 'SOCIAL_ENGINEERING' } });
    const partenza = testServer.html(`<title>POSTA</title><a id="l" href="http://sito-pubblico.test:${srv.address().port}/corto">apri</a>`);
    const page = await openTab(partenza);
    await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 8000 });
    await page.click('#l');
    await page.waitForURL(listata);
    await avvisoSu(app, listata);
  } finally {
    srv.close();
  }
});

test('una pagina in lista aperta con frammento e nome utente nell\'indirizzo mostra l\'avviso', async ({ app, openTab, testServer }) => {
  const listata = testServer.html('<title>ESCA</title><form><input type="password"></form>', { pubblico: true });
  const u = new URL(listata);
  await pulisci(app);
  await google(app, { lista: { [espressione(listata)]: 'SOCIAL_ENGINEERING' } });
  await openTab(`http://mario:segreta@${u.host}${u.pathname}#accedi`);
  await avvisoSu(app, listata);
});

test('una pagina di software indesiderato lo dice con la sua categoria', async ({ app, openTab, testServer }) => {
  const listata = testServer.html('<title>BARRA</title><p>scarica</p>', { pubblico: true });
  await pulisci(app);
  await google(app, { lista: { [espressione(listata)]: 'UNWANTED_SOFTWARE' } });
  const page = await openTab(listata);
  await avvisoSu(app, listata, /software indesiderato/);
});

test('senza durata di cache nella risposta l\'avviso compare lo stesso, e di nuovo ricaricando', async ({ app, openTab, testServer }) => {
  const listata = testServer.html('<title>ESCA</title><form><input type="password"></form>', { pubblico: true });
  await pulisci(app);
  await google(app, { lista: { [espressione(listata)]: 'SOCIAL_ENGINEERING' }, senzaCache: true });
  const page = await openTab(listata);
  await avvisoSu(app, listata);
  await page.reload();
  await avvisoSu(app, listata);
});

test('un collegamento che apre una scheda nuova su una pagina in lista mostra l\'avviso lì', async ({ app, openTab, testServer }) => {
  const listata = testServer.html('<title>ESCA</title><form><input type="password"></form>', { pubblico: true });
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
  await avvisoSu(app, listata);
});
