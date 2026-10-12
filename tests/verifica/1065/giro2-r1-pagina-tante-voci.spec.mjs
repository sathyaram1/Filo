// #1065 giro 2, rilievo 1: senza tetto la Cronologia AI arriva a migliaia di voci, e la pagina deve restare usabile.
// Misurato nel contenitore: con 3000 voci un tasto nella ricerca blocca la pagina per circa 1,7 s, con 6000 per 3 s.
import { test, expect } from '../../fixtures/electron.mjs';

const N = 3000;

test('r1 con 3000 voci in cronologia un tasto nella ricerca risponde in meno di mezzo secondo', async ({ app, openTab }) => {
  test.setTimeout(120_000);
  await app.evaluate(async (_e, { n }) => {
    const risposta = 'Questa è la risposta del modello, lunga come quelle vere. '.repeat(25);
    for (let i = 0; i < n; i++) {
      await globalThis.SN_HISTORY.append({
        action: i % 2 ? 'explain_selection' : 'filo_chat', provider: 'openrouter', model: 'deepseek/deepseek-v4-pro',
        input: { selection: `domanda ${i}` }, output: `${risposta} ${i}`, origin: 'https://esempio.test/', costEur: 0.001,
      });
    }
  }, { n: N });

  const page = await openTab('filo://history/history.html');
  await expect(page.locator('.sn-history-item').first()).toContainText(`domanda ${N - 1}`, { timeout: 60_000 });

  // Il tempo dal tasto al primo disegno successivo: quello che l'utente sente come blocco della pagina.
  const ms = await page.evaluate(async () => {
    const s = document.getElementById('search');
    s.focus();
    const t = performance.now();
    s.value = 'd';
    s.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
    return performance.now() - t;
  });
  expect(ms, `un tasto nella ricerca ha bloccato la pagina per ${Math.round(ms)} ms`).toBeLessThan(500);
  // Tutte le voci restano raggiungibili: la ricerca della più vecchia la trova.
  await page.locator('#search').fill('domanda 0');
  await expect(page.locator('.sn-history-item')).toHaveCount(1, { timeout: 20_000 });
  await expect(page.locator('.sn-history-item')).toContainText('domanda 0');
});
