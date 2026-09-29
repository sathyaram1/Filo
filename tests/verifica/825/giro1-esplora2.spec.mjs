import { test, expect } from '../../fixtures/electron.mjs';

for (const N of [6000, 20000]) {
  test(`cronologia con ${N} schede: tempi della pagina e della cancellazione`, async ({ app, openTab }) => {
    test.setTimeout(240_000);
    const t = await app.evaluate(async (_e, N) => {
      const A = globalThis.SN_ARCHIVED_TABS;
      const base = Date.UTC(2026, 8, 1);
      const voci = [];
      for (let i = 0; i < N; i++) {
        voci.push({
          id: `t${i}`, url: i % 10 === 0 ? 'https://mail.test/' : `https://sito-${i}.test/p`, title: `Scheda ${i}`,
          closedAt: new Date(base - i * 1800e3).toISOString(), reason: 'manual',
          coOpenUrls: ['https://mail.test/', 'https://altro.test/'],
          summary: 'parole '.repeat(150), snippet: 'snip',
          embedding: Array.from({ length: 256 }, (_, k) => (k * i) % 127), embedModel: 'm',
        });
      }
      const t0 = Date.now();
      await A.importa(voci);
      const t1 = Date.now();
      await A.list();
      const t2 = Date.now();
      const m = await A.listMeta();
      const t3 = Date.now();
      return { importa: t1 - t0, list: t2 - t1, listMeta: t3 - t2, bytesMeta: JSON.stringify(m).length };
    }, N);
    console.log(N, JSON.stringify(t));
    const t0 = Date.now();
    const page = await openTab('filo://archive/archive.html');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('.arc-tab').first()).toBeVisible({ timeout: 120_000 });
    console.log(N, 'pagina visibile ms', Date.now() - t0, 'chip', await page.locator('.arc-tab').count());
    const d = await app.evaluate(async () => {
      const A = globalThis.SN_ARCHIVED_TABS;
      const ids = (await A.list()).filter((x) => x.url === 'https://mail.test/').map((x) => x.id);
      const t0 = Date.now();
      const r = await A.removeMany(ids);
      const t1 = Date.now();
      const t2s = Date.now();
      const e = await A.archive({ url: 'https://dopo.test/', title: 'dopo' });
      return { tolte: r.removed, ms: t1 - t0, archivia: Date.now() - t2s };
    });
    console.log(N, 'removeMany url comune', JSON.stringify(d));
  });
}
