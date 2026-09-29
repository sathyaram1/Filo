// Verifica di #813, primo giro, rilievo 1: un indirizzo lunghissimo costruito apposta non deve fermare Filo.
// Col controllo di Google spento lo stesso indirizzo lascia il processo principale fermo meno di 200 ms.
import { test, expect } from '../../fixtures/electron.mjs';

test('aprire un indirizzo lunghissimo costruito apposta non blocca Filo per secondi', async ({ app, shell, testServer }) => {
  const base = testServer.html('<title>LUNGA</title><p>pagina</p>');
  await app.evaluate(() => {
    const SB = globalThis.SN_SAFEBROWSE;
    SB._gsbLookup.clear();
    SB.configure({ gsbKey: () => 'chiave-di-prova', enableSandbox: false, enableNetwork: false });
    globalThis.fetch = async () => ({ ok: true, status: 200, async json() { return { cacheDuration: '300s' }; } });
    // Il fermo più lungo del processo principale, misurato da dentro: una chiamata di prova durante il fermo non tornerebbe.
    globalThis.__fermo813 = { max: 0, last: Date.now() };
    setInterval(() => {
      const n = Date.now();
      globalThis.__fermo813.max = Math.max(globalThis.__fermo813.max, n - globalThis.__fermo813.last);
      globalThis.__fermo813.last = n;
    }, 50);
  });
  // 1,5 milioni di caratteri e mille livelli di %25: Chromium li accetta (il tetto è 2 MB). Costruito nella shell, non passato da qui.
  await shell.evaluate((b) => window.filoShell.tabs.open(`${b}?${'a'.repeat(1_500_000)}%25${'25'.repeat(1000)}`), base);
  await new Promise((r) => setTimeout(r, 20_000));
  const r = await app.evaluate(({ BrowserWindow }) => ({
    fermo: globalThis.__fermo813.max,
    aperta: BrowserWindow.getAllWindows().some((w) => (w._filoTabs ? w._filoTabs.tabs : [])
      .some((t) => (t.view?.webContents?.getURL?.() || '').length > 1_000_000)),
  }));
  expect(r.aperta).toBe(true);
  expect(r.fermo).toBeLessThan(1000);
});
