// Verifica #515 — giro 1, la seconda strada per lo stesso materiale.
//
// L'agente non è l'unico posto dove Filo promette i documenti di trasparenza:
// c'è la pagina, con la sua barra di sezioni. Qui si guarda cosa vede chi ci
// arriva chiedendo una sezione che non è stata scritta.

import { test, expect } from '../../fixtures/electron.mjs';

const PAGINA = 'filo://transparency/transparency.html';

test('la barra dice quali sezioni non ci sono ancora, e non le fa cliccare', async ({ app, openTab }) => {
  const page = await openTab(PAGINA);
  await expect(page.locator('#nav .sn-nav-item').first()).toBeVisible({ timeout: 10_000 });

  const esistenti = await app.evaluate(() => globalThis.SN_TRANSPARENCY.ids());
  const previsti = await app.evaluate(() => globalThis.SN_TRANSPARENCY.NAV.map((n) => n.id));
  const mancanti = previsti.filter((i) => !esistenti.includes(i));
  test.skip(mancanti.length === 0, 'tutte le sezioni hanno il loro documento');

  // Le sezioni scritte sono link; quelle non scritte non lo sono.
  await expect(page.locator('#nav a.sn-nav-item')).toHaveCount(esistenti.length);
  await expect(page.locator('#nav .sn-nav-item.is-soon')).toHaveCount(mancanti.length);
  for (const el of await page.locator('#nav .sn-nav-item.is-soon').all()) {
    await expect(el).toHaveAttribute('title', /arrivo/i);
  }
  await page.screenshot({ path: 'tests/.shots/515-giro1-pagina-barra.png' });
});

test('chiedendo alla pagina una sezione non scritta, non ne compare un\'altra al suo posto', async ({ app, openTab }) => {
  const esistenti = await app.evaluate(() => globalThis.SN_TRANSPARENCY.ids());
  const previsti = await app.evaluate(() => globalThis.SN_TRANSPARENCY.NAV.map((n) => n.id));
  const mancante = previsti.find((i) => !esistenti.includes(i));
  test.skip(!mancante, 'tutte le sezioni hanno il loro documento');

  const page = await openTab(`${PAGINA}?doc=${mancante}`);
  await expect(page.locator('#title')).toBeVisible({ timeout: 10_000 });
  const titolo = (await page.locator('#title').textContent() || '').trim();
  const url = page.url();

  // Il difetto: l'indirizzo dice «privacy» e la pagina mostra la politica sui
  // modelli, senza avvisare. O l'indirizzo cambia, o la pagina dice che quella
  // sezione non c'è; quello che non può fare è metterne un'altra al suo posto.
  if (new RegExp(`doc=${mancante}`).test(url)) {
    const sottotitolo = (await page.locator('#subtitle').textContent() || '').trim();
    expect(titolo, `l'indirizzo dice "${mancante}" e la pagina mostra «${titolo}»`)
      .not.toBe('Politica sui modelli');
    expect(sottotitolo.toLowerCase()).toContain('non');
  }

  // E da qui si arriva a quello che invece c'è scritto: non è un vicolo cieco.
  await expect(page.locator('#doc-body a[href*="doc=models"]')).toHaveCount(1);
  await page.screenshot({ path: 'tests/.shots/515-giro1-pagina-doc-mancante.png' });

  // Tema scuro: la stessa pagina deve restare leggibile.
  await page.evaluate(() => window.SN_PAGE_BOOTSTRAP.applyTheme('dark'));
  await page.screenshot({ path: 'tests/.shots/515-giro1-pagina-doc-mancante-scuro.png' });
});
