// Verifica di #813, terzo giro: una pagina in lista raggiunta dentro lo stesso sito senza ricaricare (history.pushState).
import { test, expect } from '../../fixtures/electron.mjs';

async function preparaGoogle(app, espressioni) {
  await app.evaluate(async (_e, lista) => {
    const crypto = process.getBuiltinModule('crypto');
    const voci = lista.map((expr) => crypto.createHash('sha256').update(expr, 'latin1').digest());
    const vera = globalThis.__fetchVero813c || (globalThis.__fetchVero813c = globalThis.fetch);
    globalThis.__richieste813c = [];
    globalThis.fetch = async (url, opts) => {
      const u = String(url);
      if (/rdap\.org|crt\.sh/.test(u)) return { ok: false, status: 404, async json() { return {}; } };
      if (!u.startsWith('https://safebrowsing.googleapis.com/')) return vera(url, opts);
      globalThis.__richieste813c.push(u);
      const chiesti = new URL(u).searchParams.getAll('hashPrefixes');
      const fullHashes = voci
        .filter((v) => chiesti.includes(v.subarray(0, 4).toString('base64')))
        .map((v) => ({ fullHash: v.toString('base64'), fullHashDetails: [{ threatType: 'SOCIAL_ENGINEERING' }] }));
      return { ok: true, status: 200, async json() { return { fullHashes, cacheDuration: '300s' }; } };
    };
    const SB = globalThis.SN_SAFEBROWSE;
    SB._gsbLookup.clear();
    SB.configure({ gsbKey: () => 'chiave-di-prova', enableSandbox: false, enableNetwork: false });
  }, espressioni);
}

test('una pagina in lista raggiunta senza ricaricare, dopo una pagina pulita dello stesso sito, mostra l\'avviso', async ({ app, openTab, testServer }) => {
  const pulita = testServer.html('<title>NEGOZIO</title><p>catalogo</p>');
  const u = new URL(pulita);
  await preparaGoogle(app, [`${u.hostname}${u.pathname}/accedi`]);

  const page = await openTab(pulita);
  await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 8000 });
  await page.waitForTimeout(3000);
  await expect(page.getByText('Sito segnalato come pericoloso')).toHaveCount(0);

  await page.evaluate(() => {
    history.pushState({}, '', location.pathname + '/accedi');
    document.body.innerHTML = '<form><input type="password" placeholder="password"></form>';
  });
  await expect(page).toHaveURL(/\/accedi$/);
  await expect(page.getByText('Sito segnalato come pericoloso')).toBeVisible({ timeout: 8000 });
});
