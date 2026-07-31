// PROBE (audit prober, temporaneo) — due avvisi (toast) di Filo dentro una
// pagina web si sovrappongono nello stesso punto.
//
// .sn-toast è `position:fixed; bottom:20px; right:20px` senza contenitore che
// li impili: due avvisi vivi insieme finiscono uno SOPRA l'altro e il testo
// diventa illeggibile. Basta fare due azioni del tasto destro a distanza di
// meno di ~2 secondi.

import { test, expect } from './fixtures/electron.mjs';

test.setTimeout(60_000);

const HTML = `<!doctype html><html lang="it"><body style="font:16px sans-serif;padding:40px;background:#fff">
  <h1>Pagina di prova</h1>
  <p>Un paragrafo con un <a id="lnk" href="https://example.com/articolo-molto-interessante">link a un articolo</a> da salvare.</p>
</body></html>`;

async function menuItem(page, label) {
  const item = page.locator('.sn-menu .sn-menu-item', { hasText: label }).first();
  await expect(item).toBeVisible();
  return item;
}

test('due avvisi ravvicinati si sovrappongono nello stesso angolo', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, HTML);

  // 1ª azione: "Copia link" → toast "Copiato negli appunti" (2.2s di vita).
  await page.locator('#lnk').click({ button: 'right' });
  await (await menuItem(page, 'Copia URL')).click();

  // 2ª azione a distanza di poco: "Salva link per dopo" → secondo toast.
  await page.waitForTimeout(600);
  await page.locator('#lnk').click({ button: 'right' });
  await (await menuItem(page, 'Salva link per dopo')).click();

  // I due toast ora convivono.
  await expect.poll(async () => page.locator('.sn-toast').count(), { timeout: 5000 })
    .toBeGreaterThan(1);
  await page.waitForTimeout(350);
  await page.screenshot({ path: 'tests/.shots/probe-toast-overlap.png' });

  const boxes = await page.evaluate(() => Array.from(document.querySelectorAll('.sn-toast')).map((n) => {
    const r = n.getBoundingClientRect();
    return { text: n.textContent, x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
  }));
  console.log('[probe toast]', JSON.stringify(boxes, null, 1));

  // Invariante attesa: due avvisi contemporanei devono essere entrambi leggibili
  // → nessuna sovrapposizione verticale.
  const overlap = boxes.length > 1 && boxes.some((a, i) => boxes.some((b, j) =>
    j > i && !(a.y + a.h <= b.y || b.y + b.h <= a.y)));
  expect(overlap, `toast sovrapposti: ${JSON.stringify(boxes)}`).toBe(false);
});
