// #2136 giro 1: schede aperte dal processo principale nel primo istante utile dopo l'avvio, senza aspettare la home,
// a raffica, come faceva l'aiuto della prova prima della pezza: ogni apertura deve dare una scheda.
import { test, expect } from '../../fixtures/electron.mjs';

for (const giro of [1, 2, 3]) {
  test(`avvio ${giro}: le schede aperte subito dopo l'avvio nascono tutte`, async ({ app, testServer }) => {
    const url = testServer.html('<title>Subito</title><p>subito');
    const esiti = [];
    const t0 = Date.now();
    while (esiti.length < 12 && Date.now() - t0 < 20_000) {
      const raffica = await Promise.all(Array.from({ length: 4 }, () => app.evaluate(({ BrowserWindow }, u) => {
        const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
        if (!w) return null;
        try { return { id: w._filoTabs.openTab(u, { activate: false, allowDuplicate: true }) }; } catch (e) { return { errore: String(e && e.stack || e) }; }
      }, url).catch((e) => ({ errore: String(e) }))));
      esiti.push(...raffica.filter(Boolean));
    }
    expect(esiti.length).toBeGreaterThanOrEqual(12);
    expect(esiti.filter((e) => e.errore)).toEqual([]);
    expect(esiti.every((e) => typeof e.id === 'string')).toBe(true);
    const ids = esiti.map((e) => e.id);
    await expect.poll(() => app.evaluate(({ BrowserWindow }, ids) => {
      const tm = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito)._filoTabs;
      return ids.filter((id) => tm.tabs.some((t) => t.id === id)).length;
    }, ids), { timeout: 15_000 }).toBe(ids.length);
  });
}
