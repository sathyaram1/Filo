// VERIFIER #405 — "non c'è il correttore mentre scrivi in un campo incorporato".
// I dizionari Hunspell reali non producono suggerimenti in questo ambiente
// headless, quindi iniettiamo l'evento NATIVO di Electron esattamente come lo
// emette il sistema quando l'utente clicca destro su una parola errata,
// puntandolo al frame del riquadro. Verifica il cammino vero end-to-end.

import { test, expect } from './fixtures/electron.mjs';

const CHILD = `<!doctype html><body style="margin:0;padding:16px">
  <p id="p">testo</p>
  <textarea id="pta" rows="3" cols="40">quii</textarea></body>`;

const PARENT = (u) => `<!doctype html><body style="margin:0;padding:20px">
  <textarea id="mta" rows="2" cols="40">quii</textarea>
  <iframe id="f" src="${u}" width="600" height="260"></iframe></body>`;

async function frameByUrl(page, url) {
  const d = Date.now() + 10000;
  while (Date.now() < d) {
    const f = page.frames().find((x) => x.url() === url && x !== page.mainFrame());
    if (f) return f;
    await page.waitForTimeout(100);
  }
  throw new Error('frame non trovato');
}

// Emette l'evento nativo di Electron sul webContents della scheda, puntato al
// sottoframe: è ciò che accade davvero al click destro su una parola errata
// dentro un riquadro.
async function emitNativeSpell(app, pageUrl, childUrl, word, suggestions) {
  return app.evaluate(({ webContents }, { pageUrl, childUrl, word, suggestions }) => {
    const wc = webContents.getAllWebContents().find((w) => w.getURL() === pageUrl);
    if (!wc) return 'no-wc';
    const sub = (wc.mainFrame.frames || []).find((f) => f.url === childUrl);
    if (!sub) return 'no-subframe';
    wc.emit('context-menu', {}, { misspelledWord: word, dictionarySuggestions: suggestions, frame: sub });
    return 'ok:' + sub.url;
  }, { pageUrl, childUrl, word, suggestions });
}

test('#405 il suggerimento del correttore arriva nel campo dentro il riquadro', async ({ app, openTab, testServer }) => {
  const childUrl = testServer.html(CHILD);
  const page = await testServer.openReady(openTab, PARENT(childUrl));
  const fr = await frameByUrl(page, childUrl);

  // sveglia Filo nel riquadro e mettiti nel campo, come l'utente che scrive
  await fr.locator('#p').click();
  await page.waitForTimeout(500);
  await fr.locator('#pta').click();
  await page.waitForTimeout(300);

  const r = await emitNativeSpell(app, page.url(), childUrl, 'quii', ['qui', 'quiz']);
  console.log('[EMIT] ' + r);
  expect(r.startsWith('ok:'), 'non sono riuscito a emettere l\'evento nativo sul riquadro').toBe(true);
  await page.waitForTimeout(400);

  await fr.locator('#pta').click({ button: 'right', position: { x: 14, y: 10 } });

  const corr = fr.locator('.sn-menu .sn-menu-correction');
  await expect(corr, 'nessuna correzione nel campo dentro il riquadro').toBeVisible({ timeout: 6000 });
  await expect(corr.locator('.sn-menu-label').first()).toHaveText('qui');

  // e cliccandola corregge davvero il testo nel campo incorporato
  await corr.locator('.sn-menu-correction-main').click();
  await page.waitForTimeout(700);
  const val = await fr.locator('#pta').inputValue();
  console.log('[CORRETTO] "' + val + '"');
  expect(val, 'la correzione scelta non ha modificato il campo dentro il riquadro').toContain('qui');
  expect(val).not.toContain('quii');
});

test('#405 il suggerimento NON finisce nel frame sbagliato', async ({ app, openTab, testServer }) => {
  const childUrl = testServer.html(CHILD);
  const page = await testServer.openReady(openTab, PARENT(childUrl));
  const fr = await frameByUrl(page, childUrl);
  await fr.locator('#p').click();
  await page.waitForTimeout(500);
  await fr.locator('#pta').click();
  await emitNativeSpell(app, page.url(), childUrl, 'quii', ['qui', 'quiz']);
  await page.waitForTimeout(500);

  // il campo della PAGINA non deve mostrare una correzione che non gli spetta
  await page.locator('#mta').click();
  await page.locator('#mta').click({ button: 'right', position: { x: 14, y: 10 } });
  await page.waitForTimeout(1200);
  const visible = await page.locator('.sn-menu .sn-menu-correction').first()
    .evaluate((n) => getComputedStyle(n).display !== 'none').catch(() => false);
  console.log('[CROSS-TALK] correzione sulla pagina=' + visible);
  expect(visible, 'il suggerimento destinato al riquadro è comparso nel campo della pagina').toBe(false);
});
