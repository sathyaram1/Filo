// Esplorazione #1065 giro 2: la pagina Cronologia AI con migliaia di voci, ora che il tetto non c'è più.
import { test, expect } from '../../fixtures/electron.mjs';

const N = Number(process.env.VOCI || 6000);

test('pagina con molte voci: tempi di apertura e di ricerca', async ({ app, openTab }) => {
  test.setTimeout(300_000);
  const tAppend = await app.evaluate(async (_e, { n }) => {
    const risposta = 'Questa è la risposta del modello, abbastanza lunga come quelle vere. '.repeat(25);
    const pagina = 'testo della pagina letta dal modello '.repeat(200);
    const t0 = Date.now();
    for (let i = 0; i < n; i++) {
      await globalThis.SN_HISTORY.append({
        action: i % 2 ? 'explain_selection' : 'filo_chat', provider: 'openrouter', model: 'deepseek/deepseek-v4-pro',
        input: { selection: `domanda ${i}`, pageText: pagina }, output: `${risposta} ${i}`,
        origin: 'https://esempio.test/', costEur: 0.001,
      });
    }
    const t1 = Date.now();
    await globalThis.SN_HISTORY.append({ action: 'explain_selection', input: { selection: 'ultima' }, output: 'x' });
    return { totale: t1 - t0, ultima: Date.now() - t1 };
  }, { n: N });
  console.log('append', JSON.stringify(tAppend));

  const t0 = Date.now();
  const page = await openTab('filo://history/history.html');
  await expect(page.locator('.sn-history-item')).toHaveCount(N + 1, { timeout: 120_000 });
  console.log('apertura pagina ms', Date.now() - t0);

  const ricerca = await page.evaluate(async () => {
    const s = document.getElementById('search');
    const t = performance.now();
    s.value = 'd';
    s.dispatchEvent(new Event('input'));
    const d1 = performance.now() - t;
    await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
    return { sincrono: d1, conDisegno: performance.now() - t };
  });
  console.log('un tasto nella ricerca', JSON.stringify(ricerca));
  const memoria = await page.evaluate(() => performance.memory ? performance.memory.usedJSHeapSize : null);
  console.log('heap pagina MB', memoria && Math.round(memoria / 1e6));
});
