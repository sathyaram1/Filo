// #405 — Filo dentro i riquadri incorporati (iframe): video, mappe, moduli,
// blocchi commenti.
//
// Prima di questo lavoro i content script venivano montati SOLO nel frame
// principale della scheda: dentro un riquadro il tasto destro non produceva
// nulla (né il menu di Filo né un menu di sistema), non c'era il correttore,
// non c'erano Copia/Cerca/Spiegazione. Questi spec asseriscono il SUCCESSO —
// che il menu compare davvero dentro il riquadro, con le voci giuste — non
// l'assenza di un errore. Togliendo nodeIntegrationInSubFrames (o il
// montaggio pigro nel page-preload) tornano tutti rossi.

import { test, expect } from './fixtures/electron.mjs';

const INNER = `<!doctype html><html><body style="margin:0;padding:16px;font:16px sans-serif">
  <p id="inner-text">Testo dentro il riquadro incorporato, lungo abbastanza da poterlo selezionare e spiegare.</p>
  <a id="inner-link" href="https://example.com/pagina">un collegamento nel riquadro</a>
  <textarea id="inner-field" rows="2" cols="24">campo dentro il riquadro</textarea>
</body></html>`;

function outer(src, { width = 600, height = 420 } = {}) {
  return `<!doctype html><html><body style="margin:0;padding:12px;font:16px sans-serif">
    <p id="outer-text">Testo della pagina, fuori dal riquadro.</p>
    <iframe id="embed" src="${src}" width="${width}" height="${height}"
            style="border:1px solid #333"></iframe>
  </body></html>`;
}

test('tasto destro DENTRO il riquadro incorporato: compare il menu di Filo', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, outer(testServer.html(INNER)));
  const frame = page.frameLocator('#embed');
  await frame.locator('#inner-text').click({ button: 'right' });
  const menu = frame.locator('.sn-menu');
  await expect(menu).toBeVisible();
  // Non un menu vuoto: dentro il riquadro ci sono le stesse voci di sempre.
  await expect(menu.getByText('Invia feedback', { exact: true })).toBeVisible();
});

test('il riquadro di un ALTRO sito (origine diversa) ha comunque il menu', async ({ openTab, testServer }) => {
  // blocked.test è mappato su 127.0.0.1 dal fixture: stesso server, ORIGINE
  // diversa — cioè il caso vero (il video di YouTube dentro l'articolo).
  const innerUrl = testServer.html(INNER).replace('127.0.0.1', 'blocked.test');
  const page = await testServer.openReady(openTab, outer(innerUrl));
  const frame = page.frameLocator('#embed');
  await frame.locator('#inner-text').click({ button: 'right' });
  await expect(frame.locator('.sn-menu')).toBeVisible();
});

test('nel riquadro il menu porta le azioni sul testo selezionato (Copia, Cerca, Spiegazione)', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, outer(testServer.html(INNER)));
  const frameLoc = page.frameLocator('#embed');
  // Selezione DENTRO il riquadro.
  const frame = page.frames().find((f) => f.url().includes('/') && f !== page.mainFrame());
  await frame.evaluate(() => {
    const p = document.querySelector('#inner-text');
    const range = document.createRange();
    range.selectNodeContents(p);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  });
  await frameLoc.locator('#inner-text').click({ button: 'right' });
  const menu = frameLoc.locator('.sn-menu');
  await expect(menu).toBeVisible();
  // La zona contestuale del testo selezionato: Copia + Cerca + la spiegazione
  // inline (la sezione AI). Senza content script nel riquadro non esisteva
  // nemmeno il menu, figurarsi queste voci.
  await expect(menu.locator('.sn-menu-inline')).toBeVisible();
  const txt = (await menu.textContent()) || '';
  expect(txt).toContain('Copia');
});

test('nel riquadro il menu sul collegamento porta le azioni del collegamento', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, outer(testServer.html(INNER)));
  const frame = page.frameLocator('#embed');
  await frame.locator('#inner-link').click({ button: 'right' });
  const menu = frame.locator('.sn-menu');
  await expect(menu).toBeVisible();
  const txt = (await menu.textContent()) || '';
  expect(txt).toContain('Copia URL');
  // "Apri in nuova tab" è la voce cardine del menu su un collegamento.
  expect(txt.toLowerCase()).toContain('apri in nuova tab');
});

// L'invariante di #405: in un riquadro basso NESSUNA voce va perduta. DOVE
// venga disegnato il menu è cambiato con #445 (lo disegna la pagina, sopra al
// riquadro, così ha tutta l'altezza della finestra — vedi
// tests/iframe-menu-projection.spec.mjs); la promessa all'utente no.
test('in un riquadro basso il menu resta tutto raggiungibile', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, outer(testServer.html(INNER), { width: 420, height: 180 }));
  await page.frameLocator('#embed').locator('#inner-text').click({ button: 'right' });
  const menu = page.locator('.sn-menu, #embed >>> nothing').first();
  await expect(page.locator('.sn-menu')).toBeVisible({ timeout: 8000 });
  const fits = await menu.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return r.top >= -1 && r.bottom <= window.innerHeight + 1;
  });
  expect(fits).toBe(true);
  await expect(menu.getByText('Invia feedback', { exact: true })).toBeVisible();
});

test('la pagina attorno al riquadro continua a funzionare come prima', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, outer(testServer.html(INNER)));
  await page.locator('#outer-text').click({ button: 'right' });
  await expect(page.locator('.sn-menu')).toBeVisible();
});

test('un riquadro mai toccato non carica nulla (il costo si paga solo all\'uso)', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, outer(testServer.html(INNER)));
  await page.waitForTimeout(800);
  const frame = page.frames().find((f) => f !== page.mainFrame());
  const readyBefore = await frame.evaluate(() => document.documentElement.dataset.filoReady || '');
  expect(readyBefore).toBe('');
  // …ma appena lo si tocca, Filo c'è.
  await page.frameLocator('#embed').locator('#inner-text').click({ button: 'right' });
  await expect(page.frameLocator('#embed').locator('.sn-menu')).toBeVisible();
  const readyAfter = await frame.evaluate(() => document.documentElement.dataset.filoReady || '');
  expect(readyAfter).toBe('1');
});

test('Alt+E sul testo selezionato DENTRO il riquadro arriva al riquadro', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, outer(testServer.html(INNER)));
  const frameLoc = page.frameLocator('#embed');
  const frame = page.frames().find((f) => f !== page.mainFrame());
  // Interagisci col riquadro (monta Filo lì dentro) e seleziona il suo testo.
  await frameLoc.locator('#inner-text').click();
  await frame.evaluate(() => {
    const p = document.querySelector('#inner-text');
    const range = document.createRange();
    range.selectNodeContents(p);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  });
  // Stessa strada della scorciatoia globale Alt+E.
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
    globalThis.__filoShortcuts.dispatch('explain-selection', win);
  });
  // La spiegazione si apre DENTRO il riquadro, sul testo selezionato lì.
  // Prima la scorciatoia finiva sempre nel frame principale, che non ha
  // nessuna selezione: non succedeva nulla.
  await expect(frameLoc.locator('.sn-popup')).toBeVisible({ timeout: 8000 });
});

test('un solo menu alla volta: aprirlo nel riquadro chiude quello della pagina', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, outer(testServer.html(INNER)));
  await page.locator('#outer-text').click({ button: 'right' });
  await expect(page.locator('.sn-menu')).toBeVisible();
  await page.frameLocator('#embed').locator('#inner-text').click({ button: 'right' });
  await expect(page.frameLocator('#embed').locator('.sn-menu')).toBeVisible();
  await expect(page.locator('.sn-menu')).toHaveCount(0);
});
