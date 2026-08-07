// Feedback #401: quando un'immagine è ANCHE un collegamento (le miniature degli
// articoli, le schede prodotto, i risultati di una ricerca per immagini) il tasto
// destro mostrava solo le azioni sull'immagine e PERDEVA quelle sul link («Apri in
// nuova tab», «Copia URL», «Salva link per dopo», «Condividi link»). Il ramo
// immagine di buildContextualItems ritornava prima che venisse valutato quello del
// link. In un browser normale le due famiglie compaiono insieme.
//
// I test asseriscono il SUCCESSO: le voci del link ci sono ED eseguono davvero
// l'azione sul link (Copia URL mette negli appunti l'href del collegamento, non
// quello dell'immagine). Senza il fix la voce non esiste → il click fallisce → rosso.

import { test, expect } from './fixtures/electron.mjs';

// Un PNG 1×1 come sorgente dell'immagine (data URI: nessuna rete).
const PX = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

function pageHtml(linkHref) {
  return `<!doctype html><html><body style="padding:24px;font:16px sans-serif">
    <h1>Homepage con miniature</h1>
    <a id="card" href="${linkHref}"><img id="thumb" src="${PX}" width="120" height="120" style="background:#e07b39"></a>
    <p id="testo">Un paragrafo sotto la miniatura.</p>
  </body></html>`;
}

async function openMenuOn(page, selector) {
  await page.locator(selector).click({ button: 'right', position: { x: 8, y: 8 } });
  const menu = page.locator('.sn-menu');
  await expect(menu).toBeVisible();
  return menu;
}

test('tasto destro su una miniatura-link: compaiono sia le azioni immagine sia quelle del link', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, pageHtml('https://example.com/articolo'));
  const menu = await openMenuOn(page, '#thumb');
  await page.screenshot({ path: 'tests/.shots/context-menu-image-link.png' }).catch(() => {});

  // Famiglia immagine (era già presente).
  for (const label of ['Copia immagine', 'Salva immagine come', 'Copia URL immagine', 'Cerca immagine']) {
    await expect(menu.getByText(label, { exact: false }).first()).toBeVisible();
  }
  // Famiglia link (prima del fix spariva del tutto).
  for (const label of ['Apri in nuova tab', 'Copia URL', 'Salva link per dopo', 'Condividi link']) {
    await expect(menu.getByText(label, { exact: false }).first()).toBeVisible();
  }
});

test('"Copia URL" su una miniatura-link copia l\'href del COLLEGAMENTO, non quello dell\'immagine', async ({ app, openTab, testServer }) => {
  const linkHref = 'https://example.com/articolo-di-prova';
  const page = await testServer.openReady(openTab, pageHtml(linkHref));
  const menu = await openMenuOn(page, '#thumb');

  // Prima del fix questa voce non esisteva sul menu di un'immagine-link → il click
  // non troverebbe nulla e il test fallirebbe.
  await menu.locator('button', { hasText: 'Copia URL' }).filter({ hasNotText: 'immagine' }).first().click();

  await expect
    .poll(() => app.evaluate(({ clipboard }) => clipboard.readText()), { timeout: 8000 })
    .toBe(linkHref);
});

test('un link SENZA immagine mostra ancora le sue azioni (nessuna regressione)', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="padding:24px;font:16px sans-serif">
    <a id="plain" href="https://example.com/pagina">Un collegamento di solo testo</a>
  </body></html>`);
  const menu = await openMenuOn(page, '#plain');
  for (const label of ['Apri in nuova tab', 'Copia URL', 'Salva link per dopo', 'Condividi link']) {
    await expect(menu.getByText(label, { exact: false }).first()).toBeVisible();
  }
  // Non essendoci un'immagine, le voci immagine NON compaiono.
  await expect(menu.getByText('Copia immagine', { exact: false })).toHaveCount(0);
});
