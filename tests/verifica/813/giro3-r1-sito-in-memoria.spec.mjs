// Verifica di #813, terzo giro, rilievo 1: un sito già riconosciuto in lista resta riconosciuto sulle sue altre pagine
// anche quando Google non risponde o risponde tardi. Rete finta limitata a Safe Browsing.
import { test, expect } from '../../fixtures/electron.mjs';

// Tutto il sito di prova (127.0.0.1/) è in lista. `stato.modo`: 'su', 'giu' (rete che cade) o un ritardo in millisecondi.
async function preparaGoogle(app) {
  await app.evaluate(async () => {
    const crypto = process.getBuiltinModule('crypto');
    const full = crypto.createHash('sha256').update('127.0.0.1/', 'latin1').digest();
    const vera = globalThis.__fetchVero813r1 || (globalThis.__fetchVero813r1 = globalThis.fetch);
    globalThis.__g813r1 = { modo: 'su', richieste: 0 };
    globalThis.fetch = async (url, opts) => {
      const u = String(url);
      if (/rdap\.org|crt\.sh/.test(u)) return { ok: false, status: 404, async json() { return {}; } };
      if (!u.startsWith('https://safebrowsing.googleapis.com/')) return vera(url, opts);
      const st = globalThis.__g813r1;
      st.richieste++;
      if (st.modo === 'giu') throw new TypeError('fetch failed');
      if (typeof st.modo === 'number') await new Promise((r) => setTimeout(r, st.modo));
      const chiesti = new URL(u).searchParams.getAll('hashPrefixes');
      const hit = chiesti.includes(full.subarray(0, 4).toString('base64'));
      const fullHashes = hit ? [{ fullHash: full.toString('base64'), fullHashDetails: [{ threatType: 'SOCIAL_ENGINEERING' }] }] : [];
      return { ok: true, status: 200, async json() { return { fullHashes, cacheDuration: '1800s' }; } };
    };
    const SB = globalThis.SN_SAFEBROWSE;
    SB._gsbLookup.clear();
    SB.configure({ gsbKey: () => 'chiave-di-prova', enableSandbox: false, enableNetwork: false });
  });
}

const modo = (app, m) => app.evaluate((_e, m) => { globalThis.__g813r1.modo = m; }, m);

async function primaPagina(openTab, testServer) {
  const page = await openTab(testServer.html('<title>ACCEDI</title><form><input type="password"></form>'));
  await expect(page.getByText('Sito segnalato come pericoloso')).toBeVisible({ timeout: 8000 });
  return page;
}

// La scheda passa alla pagina dopo del sito, come dopo l'invio di un modulo.
async function paginaDopo(page, url, titolo) {
  await page.evaluate((u) => location.assign(u), url);
  await page.waitForFunction((t) => document.title === t && document.documentElement.dataset.filoReady === '1', titolo, { timeout: 8000 });
}

test('con Google irraggiungibile, un\'altra pagina di un sito appena riconosciuto in lista mostra ancora l\'avviso', async ({ app, openTab, testServer }) => {
  await preparaGoogle(app);
  const page = await primaPagina(openTab, testServer);

  await modo(app, 'giu');
  await paginaDopo(page, testServer.html('<title>CONFERMA</title><form><input placeholder="numero della carta"></form>'), 'CONFERMA');
  await expect.poll(() => app.evaluate(() => globalThis.__g813r1.richieste), { timeout: 5000 }).toBeGreaterThan(1);
  await expect(page.getByText('Sito segnalato come pericoloso')).toBeVisible({ timeout: 5000 });
});

test('con Google lento, un\'altra pagina di un sito appena riconosciuto in lista mostra l\'avviso senza aspettarlo', async ({ app, openTab, testServer }) => {
  await preparaGoogle(app);
  const page = await primaPagina(openTab, testServer);

  await modo(app, 4000);
  await paginaDopo(page, testServer.html('<title>CONFERMA2</title><form><input type="password"></form>'), 'CONFERMA2');
  await expect(page.getByText('Sito segnalato come pericoloso')).toBeVisible({ timeout: 1500 });
});
