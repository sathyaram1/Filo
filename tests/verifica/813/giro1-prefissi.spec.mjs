// Verifica di #813, primo giro: il controllo dei siti pericolosi avvisa come prima, ma a Google escono solo prefissi.
// Rete di Google finta nel processo principale: nessuna prova parla col servizio vero.
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
      if (!u.includes('googleapis.com')) return stato.prima(url, opts);
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
  const pulita = testServer.html('<title>PULITA</title><p>niente da vedere</p>');
  const listata = testServer.html('<title>ESCA</title><form><input type="password"></form>');
  await preparaGoogle(app, { lista: { [espressione(listata)]: 'SOCIAL_ENGINEERING' } });

  const page = await openTab(pulita);
  await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 8000 });
  await page.waitForTimeout(800);
  await expect(page.getByText('Sito segnalato come pericoloso')).toHaveCount(0);

  await page.evaluate((u) => location.assign(u), listata);
  await page.waitForURL(listata);
  await expect(page.getByText('Sito segnalato come pericoloso')).toBeVisible({ timeout: 8000 });
  await expect(page.getByText(/phishing/)).toBeVisible();
  await page.screenshot({ path: 'tests/.shots/verifica-813-phishing.png' });

  const id = new URL(listata).pathname.slice(1);
  soloPrefissi(await richieste(app), ['127.0.0.1', `/${id}`, 'ESCA', testServer.origin]);
});

test('una pagina di malware con i parametri nell\'indirizzo mostra l\'avviso di malware, e i parametri non escono', async ({ app, openTab, testServer }) => {
  const base = testServer.html('<title>SCARICA</title><p>programma</p>');
  const listata = `${base}?codice=segreto-RESET-123`;
  await preparaGoogle(app, { lista: { [espressione(listata)]: 'MALWARE' } });

  const page = await openTab(listata);
  await expect(page.getByText('Sito segnalato come pericoloso')).toBeVisible({ timeout: 8000 });
  await expect(page.getByText(/malware/)).toBeVisible();
  soloPrefissi(await richieste(app), ['segreto', 'RESET', 'codice', '127.0.0.1']);
});

test('un errore del servizio non resta ricordato come «pulito»: alla visita dopo l\'avviso compare', async ({ app, openTab, testServer }) => {
  const listata = testServer.html('<title>ESCA2</title><p>accedi</p>');
  await preparaGoogle(app, { lista: { [espressione(listata)]: 'SOCIAL_ENGINEERING' }, guasti: 1 });

  const page = await openTab(listata);
  await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 8000 });
  await expect.poll(async () => (await richieste(app)).length, { timeout: 5000 }).toBeGreaterThan(0);
  await page.reload();
  await expect(page.getByText('Sito segnalato come pericoloso')).toBeVisible({ timeout: 8000 });
});

test('una pagina che ha in comune con una in lista solo il prefisso dell\'impronta resta pulita', async ({ app, openTab, testServer }) => {
  const pulita = testServer.html('<title>OMONIMA</title><p>niente</p>');
  await preparaGoogle(app, { falsi: { [espressione(pulita)]: 'SOCIAL_ENGINEERING' } });

  const page = await openTab(pulita);
  await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 8000 });
  await expect.poll(async () => (await richieste(app)).length, { timeout: 5000 }).toBeGreaterThan(0);
  await page.waitForTimeout(2500);
  await expect(page.getByText('Sito segnalato come pericoloso')).toHaveCount(0);
});

test('un indirizzo lunghissimo costruito apposta non blocca Filo mentre la pagina si apre', async ({ app, shell, testServer }) => {
  await preparaGoogle(app, {});
  const base = testServer.html('<title>LUNGA</title><p>pagina</p>');
  // 1,5 milioni di caratteri e mille livelli di %25: Chromium li accetta (il tetto è 2 MB).
  const lunga = `${base}?${'a'.repeat(1_500_000)}%25${'25'.repeat(1000)}`;
  await shell.evaluate((u) => window.filoShell.tabs.open(u), lunga);

  // Filo risponde: il processo principale non resta fermo più di un secondo di fila.
  let peggiore = 0;
  const fine = Date.now() + 8000;
  while (Date.now() < fine) {
    const t = Date.now();
    await app.evaluate(() => 1);
    peggiore = Math.max(peggiore, Date.now() - t);
    await new Promise((r) => setTimeout(r, 100));
  }
  expect(peggiore).toBeLessThan(1000);
});
