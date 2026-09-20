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

test('chiedendo alla pagina una sezione non scritta, l\'indirizzo e il contenuto non devono dire due cose diverse', async ({ app, openTab }) => {
  const esistenti = await app.evaluate(() => globalThis.SN_TRANSPARENCY.ids());
  const previsti = await app.evaluate(() => globalThis.SN_TRANSPARENCY.NAV.map((n) => n.id));
  const mancante = previsti.find((i) => !esistenti.includes(i));
  test.skip(!mancante, 'tutte le sezioni hanno il loro documento');

  const page = await openTab(`${PAGINA}?doc=${mancante}`);
  await expect(page.locator('#title')).toBeVisible({ timeout: 10_000 });
  const titolo = (await page.locator('#title').textContent() || '').trim();
  const url = page.url();
  await page.screenshot({ path: 'tests/.shots/515-giro1-pagina-doc-mancante.png' });

  // O la pagina dice che quella sezione non c'è, o porta altrove correggendo
  // l'indirizzo: quello che non deve fare è mostrare un documento diverso
  // tenendo nell'indirizzo il nome di quello chiesto.
  expect(url, `l'indirizzo continua a dire "${mancante}" mentre la pagina mostra «${titolo}»`)
    .not.toMatch(new RegExp(`doc=${mancante}`));
});
