// Verifica di #813, primo giro: il controllo dei siti pericolosi avvisa come prima, ma a Google escono solo prefissi.
// Rete di Google finta nel processo principale: nessuna prova parla col servizio vero. Le pagine hanno un nome da
// internet: la rete di casa resta fuori dal controllo (#591).
import { test, expect } from '../../fixtures/electron.mjs';

// Google finto: ogni richiesta resta scritta; `lista` associa un'espressione del protocollo a una minaccia.
async function preparaGoogle(app, { lista = {}, falsi = {}, guasti = 0 } = {}) {
  await app.evaluate(async (_e, cfg) => {
    const crypto = process.getBuiltinModule('crypto');
    const sha = (s) => crypto.createHash('sha256').update(s, 'latin1').digest();
    const voci = [];
    for (const [expr, threatType] of Object.entries(cfg.lista)) voci.push({ full: sha(expr), threatType });
    // Un'impronta che ha in comune con l'espressione solo i primi 4 byte.
    for (const [expr, threatType] of Object.entries(cfg.falsi)) {
      voci.push({ full: Buffer.concat([sha(expr).subarray(0, 4), Buffer.alloc(28, 0xab)]), threatType });
    }
    const stato = globalThis.__v813 || { prima: globalThis.fetch };
    stato.richieste = [];
    stato.guasti = cfg.guasti;
    globalThis.__v813 = stato;
    const risposta = (status, corpo) => ({ ok: status === 200, status, async json() { return corpo; }, async text() { return JSON.stringify(corpo); } });
    globalThis.fetch = async (url, opts = {}) => {
      const u = String(url);
      if (/rdap\.org|crt\.sh/.test(u)) return risposta(404, {});
      // Solo Safe Browsing: gli altri servizi Google di Filo (l'accesso, il server) non portano indirizzi di pagine.
      if (!u.startsWith('https://safebrowsing.googleapis.com/')) return stato.prima(url, opts);
      stato.richieste.push({ url: u, method: opts.method || 'GET', body: opts.body ? String(opts.body) : '', headers: JSON.stringify(opts.headers || {}) });
      if (stato.guasti > 0) { stato.guasti--; return risposta(503, { error: { code: 503 } }); }
      const chiesti = new URL(u).searchParams.getAll('hashPrefixes');
      const fullHashes = voci
        .filter((v) => chiesti.includes(v.full.subarray(0, 4).toString('base64')))
        .map((v) => ({ fullHash: v.full.toString('base64'), fullHashDetails: [{ threatType: v.threatType }] }));
      return risposta(200, { fullHashes, cacheDuration: '300s' });
    };
    const SB = globalThis.SN_SAFEBROWSE;
    SB._gsbLookup.clear();
    SB.configure({ gsbKey: () => 'chiave-di-prova', enableSandbox: false, enableNetwork: false });
  }, { lista, falsi, guasti });
  expect(await app.evaluate(() => globalThis.SN_SAFEBROWSE.activeProviders().gsb)).toBe(true);
}

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

const richieste = (app) => app.evaluate(() => globalThis.__v813.richieste.slice());

// Ogni richiesta porta solo chiave, formato e prefissi di 4 byte: niente sito, niente percorso, niente parametri.
function soloPrefissi(elenco, vietati) {
  expect(elenco.length).toBeGreaterThan(0);
  for (const r of elenco) {
    const u = new URL(r.url);
    expect([...new Set([...u.searchParams.keys()])].sort()).toEqual(['alt', 'hashPrefixes', 'key']);
    for (const p of u.searchParams.getAll('hashPrefixes')) expect(Buffer.from(p, 'base64').length).toBe(4);
    for (const v of vietati) {
      expect(r.url).not.toContain(v);
      expect(r.body).not.toContain(v);
      expect(r.headers).not.toContain(v);
    }
  }
}

function espressione(url) {
  const u = new URL(url);
  return u.hostname + u.pathname + (u.search || '');
}

test('una pagina in lista dopo una pagina pulita dello stesso sito mostra l\'avviso di phishing, e a Google vanno solo prefissi', async ({ app, openTab, testServer }) => {
  const pulita = testServer.html('<title>PULITA</title><p>niente da vedere</p>', { pubblico: true });
  const listata = testServer.html('<title>ESCA</title><form><input type="password"></form>', { pubblico: true });
  await preparaGoogle(app, { lista: { [espressione(listata)]: 'SOCIAL_ENGINEERING' } });

  const page = await openTab(pulita);
  await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 8000 });
  await page.waitForTimeout(800);
  await senzaAvviso(app);

  await page.evaluate((u) => location.assign(u), listata);
  await page.waitForURL(listata);
  await avvisoSu(app, listata, /phishing/);
  await page.screenshot({ path: 'tests/.shots/verifica-813-phishing.png' });

  const id = new URL(listata).pathname.slice(1);
  soloPrefissi(await richieste(app), ['127.0.0.1', 'sito-pubblico', `/${id}`, 'ESCA', testServer.originPubblico]);
});

test('una pagina di malware con i parametri nell\'indirizzo mostra l\'avviso di malware, e i parametri non escono', async ({ app, openTab, testServer }) => {
  const base = testServer.html('<title>SCARICA</title><p>programma</p>', { pubblico: true });
  const listata = `${base}?codice=segreto-RESET-123`;
  await preparaGoogle(app, { lista: { [espressione(listata)]: 'MALWARE' } });

  const page = await openTab(listata);
  await avvisoSu(app, listata, /malware/);
  soloPrefissi(await richieste(app), ['segreto', 'RESET', 'codice', '127.0.0.1', 'sito-pubblico']);
});

test('un errore del servizio non resta ricordato come «pulito»: alla visita dopo l\'avviso compare', async ({ app, openTab, testServer }) => {
  const listata = testServer.html('<title>ESCA2</title><p>accedi</p>', { pubblico: true });
  await preparaGoogle(app, { lista: { [espressione(listata)]: 'SOCIAL_ENGINEERING' }, guasti: 1 });

  const page = await openTab(listata);
  await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 8000 });
  await expect.poll(async () => (await richieste(app)).length, { timeout: 5000 }).toBeGreaterThan(0);
  await page.reload();
  await avvisoSu(app, listata);
});

test('una pagina che ha in comune con una in lista solo il prefisso dell\'impronta resta pulita', async ({ app, openTab, testServer }) => {
  const pulita = testServer.html('<title>OMONIMA</title><p>niente</p>', { pubblico: true });
  await preparaGoogle(app, { falsi: { [espressione(pulita)]: 'SOCIAL_ENGINEERING' } });

  const page = await openTab(pulita);
  await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 8000 });
  await expect.poll(async () => (await richieste(app)).length, { timeout: 5000 }).toBeGreaterThan(0);
  await page.waitForTimeout(2500);
  await senzaAvviso(app);
});
