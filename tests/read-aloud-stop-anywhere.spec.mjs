// Feedback alpha (tkaVKHmhHw23SDdwcSMv):
//   1. mentre una lettura è in corso, QUALSIASI menu del tasto destro deve
//      contenere "Interrompi lettura", anche senza testo selezionato;
//   2. la voce di lettura usa un'icona SVG coerente con lo stile di Filo,
//      non più l'emoji 🔊.
//   3. (riapertura 18/06) "Interrompi lettura" deve comparire anche in un'ALTRA
//      scheda, non solo in quella dove la lettura è partita; e da lì si deve
//      poter fermare la lettura in corso nella scheda originale.
//
// Asserisce il SUCCESSO: la voce "Interrompi lettura" compare in un menu aperto
// su un'area SENZA selezione mentre la sintesi è attiva. Prima del fix lo stop
// esisteva solo nei due rami "testo selezionato".

import { test, expect } from './fixtures/electron.mjs';

const HTML = `<!doctype html><html><body style="padding:40px;font:18px sans-serif">
  <h1 id="title">Pagina di prova</h1>
  <p id="target">Questo è un testo lungo abbastanza da tenere occupata la sintesi vocale per qualche istante mentre proviamo ad aprire un altro menu.</p>
  <div id="empty" style="height:200px"></div>
</body></html>`;

test('la voce "Leggi" usa un\'icona SVG, non un\'emoji', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, HTML);

  await page.evaluate(() => {
    const el = document.getElementById('target');
    const range = document.createRange();
    range.selectNodeContents(el);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  });
  await page.locator('#target').click({ button: 'right' });
  const menu = page.locator('.sn-menu').first();
  await expect(menu).toBeVisible();

  // L'item "Leggi" ha un'icona SVG e la sua etichetta NON contiene emoji.
  const readItem = menu.locator('.sn-menu-item', { hasText: 'Leggi' }).first();
  await expect(readItem).toBeVisible();
  await expect(readItem.locator('.sn-menu-item-icon svg')).toBeVisible();
  const label = await readItem.locator('.sn-menu-label').innerText();
  expect(label.trim()).toBe('Leggi');
  expect(label).not.toMatch(/[\u{1F500}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
});

test('durante la lettura, un menu senza selezione mostra "Interrompi lettura"', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, HTML);

  // Abilita il seam TTS canned (opt-in): in headless non c'è motore vocale né
  // chiave, quindi senza questo il modello fallisce e la lettura non parte mai.
  // Col flag, MSG.TTS_SYNTH torna qualche secondo di PCM silenzioso → un <audio>
  // reale suona → ttsBusy() è true → la voce di stop compare nei menu.
  await app.evaluate(() => { globalThis.__filoTestTtsCanned = true; });

  // Avvia la lettura dal menu sulla selezione.
  await page.evaluate(() => {
    const el = document.getElementById('target');
    const range = document.createRange();
    range.selectNodeContents(el);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  });
  await page.locator('#target').click({ button: 'right' });
  await expect(page.locator('.sn-menu').first()).toBeVisible();
  await page.locator('.sn-menu-item', { hasText: 'Leggi' }).first().click();

  // Azzera la selezione: il prossimo menu sarà "senza contesto di testo".
  await page.evaluate(() => window.getSelection().removeAllRanges());

  // Riapre il menu su un'area vuota (nessuna selezione) e attende che la voce
  // di stop compaia mentre la sintesi è attiva. Poll perché l'avvio lettura è
  // asincrono (prova modello → fallback voce browser).
  await expect.poll(async () => {
    // chiudi eventuale menu aperto
    await page.keyboard.press('Escape').catch(() => {});
    await page.locator('#empty').click({ button: 'right' });
    const menu = page.locator('.sn-menu').first();
    const visible = await menu.isVisible().catch(() => false);
    if (!visible) return false;
    return await menu.locator('.sn-menu-item', { hasText: 'Interrompi lettura' }).count();
  }, { timeout: 8000, intervals: [200, 300, 500, 800] }).toBeGreaterThan(0);
});

// Apre un secondo tab sulla stessa origin (stesso hostname → l'helper openTab
// per-hostname sarebbe ambiguo) trovandolo per URL ESATTO, e aspetta i content
// script. Restituisce la Page del WebContentsView.
async function openTabByExactUrl(app, shell, url) {
  await shell.evaluate((u) => window.filoShell.tabs.open(u), url);
  const deadline = Date.now() + 10_000;
  let page = null;
  while (Date.now() < deadline) {
    page = app.windows().find((w) => { try { return w.url() === url; } catch (_) { return false; } });
    if (page) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  if (!page) throw new Error(`openTabByExactUrl: nessuna window per ${url}`);
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  await page.waitForFunction(
    () => document.documentElement.dataset.filoReady === '1', null, { timeout: 8000 },
  ).catch(() => {});
  return page;
}

test('durante la lettura, "Interrompi lettura" compare e ferma anche da un\'ALTRA scheda', async ({ app, shell, openTab, testServer }) => {
  await app.evaluate(() => { globalThis.__filoTestTtsCanned = true; });

  // Scheda A: avvia la lettura.
  const urlA = testServer.html(HTML);
  const pageA = await openTab(urlA);
  await pageA.waitForFunction(
    () => document.documentElement.dataset.filoReady === '1', null, { timeout: 8000 },
  );
  await pageA.evaluate(() => {
    const el = document.getElementById('target');
    const range = document.createRange();
    range.selectNodeContents(el);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  });
  await pageA.locator('#target').click({ button: 'right' });
  await expect(pageA.locator('.sn-menu').first()).toBeVisible();
  await pageA.locator('.sn-menu-item', { hasText: 'Leggi' }).first().click();

  // Scheda B: un'altra pagina, altra scheda. NESSUNA lettura parte qui.
  const urlB = testServer.html(HTML);
  const pageB = await openTabByExactUrl(app, shell, urlB);

  // In B, su un'area senza selezione, "Interrompi lettura" deve comparire perché
  // una lettura è attiva ALTROVE (prima del fix non comparirebbe mai in B).
  const stopVisibleInB = async () => {
    await pageB.keyboard.press('Escape').catch(() => {});
    await pageB.locator('#empty').click({ button: 'right' });
    const menu = pageB.locator('.sn-menu').first();
    if (!(await menu.isVisible().catch(() => false))) return 0;
    return await menu.locator('.sn-menu-item', { hasText: 'Interrompi lettura' }).count();
  };
  await expect.poll(stopVisibleInB, { timeout: 8000, intervals: [200, 300, 500, 800] }).toBeGreaterThan(0);

  // Cliccando lo stop da B la lettura in A si ferma: lo stato globale torna
  // inattivo e la voce sparisce dai menu di B.
  await pageB.locator('.sn-menu-item', { hasText: 'Interrompi lettura' }).first().click();

  await expect.poll(stopVisibleInB, { timeout: 8000, intervals: [200, 300, 500, 800] }).toBe(0);
});
