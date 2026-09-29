// Verifica di #813, secondo giro, rilievo 1: il nome utente scritto nell'indirizzo non è il sito.
// Un nome utente lunghissimo costruito apposta non deve fermare Filo, e il controllo all'arrivo guarda il sito vero.
import { test, expect } from '../../fixtures/electron.mjs';

test('un collegamento con un nome utente lunghissimo costruito apposta non blocca Filo per secondi', async ({ app, openTab, testServer }) => {
  const esca = testServer.html('<title>ESCA</title><p>pagina</p>');
  const u = new URL(esca);
  await app.evaluate(() => {
    const SB = globalThis.SN_SAFEBROWSE;
    SB._gsbLookup.clear();
    SB.configure({ gsbKey: () => 'chiave-di-prova', enableSandbox: false, enableNetwork: false });
    globalThis.fetch = async () => ({ ok: true, status: 200, async json() { return { cacheDuration: '300s' }; } });
    // Il fermo più lungo del processo principale, misurato da dentro.
    globalThis.__fermo813b = { max: 0, last: Date.now() };
    setInterval(() => {
      const n = Date.now();
      globalThis.__fermo813b.max = Math.max(globalThis.__fermo813b.max, n - globalThis.__fermo813b.last);
      globalThis.__fermo813b.last = n;
    }, 50);
  });
  // Centomila cifre dopo «0x» e una barra scritta in codice: Chromium apre la pagina di 127.0.0.1 e tiene il nome utente.
  const link = `http://0x${'1'.repeat(100_000)}z%2F@${u.host}${u.pathname}`;
  const partenza = testServer.html(`<title>POSTA</title><a id="l" href="${link}">apri</a>`);
  const page = await openTab(partenza);
  await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 8000 });
  await app.evaluate(() => { globalThis.__fermo813b.max = 0; globalThis.__fermo813b.last = Date.now(); });
  await page.click('#l', { noWaitAfter: true });
  await page.waitForFunction(() => document.title === 'ESCA', null, { timeout: 60_000 });
  await page.waitForTimeout(3000);
  expect(await app.evaluate(() => globalThis.__fermo813b.max)).toBeLessThan(1000);
});

test('all\'arrivo, un indirizzo con barra o punto di domanda in codice nel nome utente è riconosciuto come la pagina in lista', async ({ app, testServer }) => {
  const esca = testServer.html('<title>ESCA</title><form><input type="password"></form>');
  const u = new URL(esca);
  const esiti = await app.evaluate(async (_e, { expr, indirizzi }) => {
    const crypto = process.getBuiltinModule('crypto');
    const full = crypto.createHash('sha256').update(expr, 'latin1').digest();
    globalThis.fetch = async (url) => {
      const chiesti = new URL(String(url)).searchParams.getAll('hashPrefixes');
      const hit = chiesti.includes(full.subarray(0, 4).toString('base64'));
      return { ok: true, status: 200, async json() { return { fullHashes: hit ? [{ fullHash: full.toString('base64'), fullHashDetails: [{ threatType: 'SOCIAL_ENGINEERING' }] }] : [], cacheDuration: '300s' }; } };
    };
    const SB = globalThis.SN_SAFEBROWSE;
    SB.configure({ gsbKey: () => 'chiave-di-prova', enableSandbox: false, enableNetwork: false });
    const out = [];
    for (const x of indirizzi) { SB._gsbLookup.clear(); out.push(await SB._gsbLookup.check(x)); }
    return out;
  }, {
    expr: u.hostname + u.pathname,
    // Così li riporta la scheda all'arrivo sulla pagina: col nome utente, che la pagina stessa invece non vede.
    indirizzi: [`http://www.banca.it%2Faccedi@${u.host}${u.pathname}`, `http://accesso%3Fsicuro@${u.host}${u.pathname}`],
  });
  for (const e of esiti) expect(e).toMatchObject({ listed: true, category: 'phishing' });
});
