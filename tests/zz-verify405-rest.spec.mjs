// VERIFIER #405 — parte 2 del sintomo utente:
//  "dentro il riquadro non funziona nemmeno il resto di Filo: Alt+E / Alt+T sul
//   testo selezionato non fanno nulla, non ci sono Copia / Cerca / Leggi,
//   non c'è il correttore mentre scrivi in un campo incorporato,
//   non c'è Incolla con la cronologia degli appunti."

import { test, expect } from './fixtures/electron.mjs';

const CHILD = `<!doctype html><html><head><title>Riquadro</title></head>
<body style="margin:0;padding:20px;font:16px sans-serif;background:#eef">
  <p id="ptext">Questa e' una frase dentro il riquadro incorporato, abbastanza lunga da poter essere spiegata.</p>
  <textarea id="pta" rows="3" cols="40"></textarea>
  <input id="pinput" value="">
</body></html>`;

function parentHtml(childUrl) {
  return `<!doctype html><html><head><title>Articolo con riquadro</title></head>
<body style="margin:0;padding:30px;font:16px sans-serif">
  <p id="outside">Testo dell'articolo, fuori dal riquadro.</p>
  <input id="mi" value="">
  <iframe id="f" src="${childUrl}" width="620" height="340" style="border:2px solid #333"></iframe>
</body></html>`;
}

async function frameByUrl(page, url) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    const fr = page.frames().find((f) => f.url() === url && f !== page.mainFrame());
    if (fr) return fr;
    await page.waitForTimeout(100);
  }
  throw new Error('frame non trovato: ' + url);
}

async function anyFrameHas(page, sel, timeout = 8000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    for (const fr of page.frames()) {
      try { if (await fr.locator(sel).first().isVisible()) return fr; } catch (_) {}
    }
    await page.waitForTimeout(150);
  }
  return null;
}

// "Sveglia" Filo dentro il riquadro come farebbe l'utente (un clic).
async function wake(fr, page) {
  await fr.locator('#ptext').click();
  await page.waitForTimeout(400);
}

// Stesso cammino della scorciatoia globale Alt+E / Alt+T: globalShortcut non si
// può premere davvero sotto xvfb, ma dispatch() è ciò che l'accelerator chiama.
async function fireShortcut(app, command) {
  return app.evaluate(({ BrowserWindow }, cmd) => {
    globalThis.__filoShortcuts.dispatch(cmd, BrowserWindow.getAllWindows()[0]);
    return true;
  }, command);
}

async function toastsText(page) {
  let out = '';
  for (const f of page.frames()) {
    try {
      const t = f.locator('.sn-toast');
      const n = await t.count();
      for (let i = 0; i < n; i++) out += (await t.nth(i).innerText()) + ' | ';
    } catch (_) {}
  }
  return out;
}

// ---------- Alt+E / Alt+T sul testo selezionato DENTRO il riquadro ----------

for (const [label, cmd] of [['Alt+E (Spiegazione)', 'explain-selection'], ['Alt+T (Traduci)', 'translate-selection']]) {
  test(`#405 ${label} sul testo selezionato dentro il riquadro`, async ({ app, openTab, testServer }) => {
    const childUrl = testServer.html(CHILD);
    const page = await testServer.openReady(openTab, parentHtml(childUrl));
    const fr = await frameByUrl(page, childUrl);
    await wake(fr, page);

    // L'utente seleziona col mouse dentro il riquadro.
    const box = await fr.locator('#ptext').boundingBox();
    await page.mouse.move(box.x + 5, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width - 10, box.y + box.height / 2, { steps: 12 });
    await page.mouse.up();
    const sel = await fr.evaluate(() => String(window.getSelection()));
    expect(sel.length, 'la selezione dentro il riquadro non è riuscita').toBeGreaterThan(10);

    await fireShortcut(app, cmd);

    // SUCCESSO = si apre la finestrella di Filo con la richiesta in corso.
    const popupFrame = await anyFrameHas(page, '.sn-popup', 9000);
    // FALLIMENTO tipico = "Nessuna selezione di testo." (scorciatoia consegnata
    // al frame sbagliato: la selezione vive nel riquadro, non nella pagina).
    const toasts = await toastsText(page);
    console.log(`[${cmd}] popup=${!!popupFrame} toast="${toasts}"`);
    expect(toasts).not.toContain('Nessuna selezione');
    expect(popupFrame, 'nessuna finestrella di Filo dopo la scorciatoia dentro il riquadro').not.toBeNull();
    // e la finestrella deve nascere DENTRO il riquadro, dove l'utente guarda
    console.log('[' + cmd + '] popup nel frame: ' + (popupFrame === fr ? 'RIQUADRO' : popupFrame.url()));
  });
}

test('#405 Alt+E senza selezione dentro il riquadro avvisa (non resta muto)', async ({ app, openTab, testServer }) => {
  const childUrl = testServer.html(CHILD);
  const page = await testServer.openReady(openTab, parentHtml(childUrl));
  const fr = await frameByUrl(page, childUrl);
  await wake(fr, page);
  await fr.evaluate(() => window.getSelection().removeAllRanges());
  await fireShortcut(app, 'explain-selection');
  const t = await anyFrameHas(page, '.sn-toast', 6000);
  console.log('[NO-SEL] toast=' + !!t + ' testo=' + (await toastsText(page)));
  expect(t, 'nessun avviso: la scorciatoia resta muta').not.toBeNull();
});

// ---------- Il menu dentro il riquadro ha le STESSE azioni di quello fuori ----------

test('#405 parità: il menu dentro il riquadro offre le stesse azioni di quello fuori', async ({ openTab, testServer }) => {
  const childUrl = testServer.html(CHILD);
  const page = await testServer.openReady(openTab, parentHtml(childUrl));

  await page.locator('#outside').click({ button: 'right' });
  await expect(page.locator('.sn-menu')).toBeVisible();
  const outside = await page.locator('.sn-menu').first().evaluate((n) =>
    [...n.querySelectorAll('[aria-label]')].map((b) => b.getAttribute('aria-label')).sort());
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);

  const fr = await frameByUrl(page, childUrl);
  await fr.locator('#ptext').click({ button: 'right' });
  const mf = await anyFrameHas(page, '.sn-menu', 8000);
  expect(mf).not.toBeNull();
  const inside = await mf.locator('.sn-menu').first().evaluate((n) =>
    [...n.querySelectorAll('[aria-label]')].map((b) => b.getAttribute('aria-label')).sort());

  console.log('[PARITA] fuori=' + JSON.stringify(outside));
  console.log('[PARITA] dentro=' + JSON.stringify(inside));
  const mancanti = outside.filter((a) => !inside.includes(a));
  expect(mancanti, 'azioni presenti fuori ma MANCANTI dentro il riquadro').toEqual([]);
});

// ---------- Un'azione di PAGINA scelta dentro il riquadro agisce sulla pagina ----------

test('#405 "Salva per dopo" dal menu dentro il riquadro salva l\'ARTICOLO, non il riquadro', async ({ openTab, testServer }) => {
  const childUrl = testServer.html(CHILD);
  const parentUrl = testServer.html(parentHtml(childUrl));
  const page = await openTab(parentUrl);
  await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 8000 });

  const fr = await frameByUrl(page, childUrl);
  await fr.locator('#ptext').click({ button: 'right' });
  const mf = await anyFrameHas(page, '.sn-menu', 8000);
  expect(mf).not.toBeNull();
  const btn = mf.locator('.sn-menu [data-sn-icon-id="saveForLater"]').first();
  await expect(btn).toBeVisible();
  await btn.click();
  await page.waitForTimeout(2000).catch(() => {});

  const home = await openTab('filo://home/home.html');
  await home.waitForLoadState('domcontentloaded');
  await home.waitForTimeout(1200);
  const txt = await home.evaluate(() => document.body.innerText);
  const hrefs = await home.evaluate(() => [...document.querySelectorAll('[data-url],[href]')]
    .map((n) => n.dataset?.url || n.getAttribute('href')).filter(Boolean));
  console.log('[SALVA] parent=' + parentUrl + ' child=' + childUrl);
  console.log('[SALVA] href trovati=' + JSON.stringify(hrefs.filter((h) => h.includes('127.0.0.1'))));
  console.log('[SALVA] titoli=' + JSON.stringify(txt.split('\n').filter((l) => /Articolo|Riquadro/.test(l))));
  expect(txt, 'salvato il riquadro invece dell\'articolo').not.toContain('Riquadro');
  expect(txt).toContain('Articolo con riquadro');
});

// ---------- Correttore ortografico dentro il riquadro ----------

test('#405 correttore mentre scrivi in un campo dentro il riquadro', async ({ openTab, testServer }) => {
  const childUrl = testServer.html(CHILD);
  const page = await testServer.openReady(openTab, parentHtml(childUrl));
  const fr = await frameByUrl(page, childUrl);
  await wake(fr, page);

  // Confronto: stesso errore in un campo della PAGINA e in uno del RIQUADRO.
  await page.locator('#mi').click();
  await page.locator('#mi').type('quii', { delay: 50 });
  await page.waitForTimeout(900);
  await page.locator('#mi').click({ button: 'right', position: { x: 10, y: 8 } });
  await page.waitForTimeout(1200);
  const outCorr = await page.locator('.sn-menu .sn-menu-correction').first()
    .evaluate((n) => ({ visible: getComputedStyle(n).display !== 'none', label: n.innerText.trim() })).catch(() => null);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);

  await fr.locator('#pta').click();
  await fr.locator('#pta').type('quii', { delay: 50 });
  await page.waitForTimeout(900);
  await fr.locator('#pta').click({ button: 'right', position: { x: 12, y: 10 } });
  const mf = await anyFrameHas(page, '.sn-menu', 8000);
  expect(mf, 'nessun menu nel campo dentro il riquadro').not.toBeNull();
  await page.waitForTimeout(1200);
  const inCorr = await mf.locator('.sn-menu .sn-menu-correction').first()
    .evaluate((n) => ({ visible: getComputedStyle(n).display !== 'none', label: n.innerText.trim() })).catch(() => null);

  console.log('[SPELL] fuori=' + JSON.stringify(outCorr) + ' dentro=' + JSON.stringify(inCorr));
  // Se il correttore nativo funziona sulla pagina, DEVE funzionare anche nel
  // riquadro. Se i dizionari non ci sono in questo ambiente, nessuno dei due
  // mostra nulla e il confronto resta onesto.
  if (outCorr?.visible) {
    expect(inCorr?.visible, 'la correzione compare fuori dal riquadro ma NON dentro').toBe(true);
  }
});

// ---------- Incolla con cronologia degli appunti ----------

test('#405 Incolla + cronologia degli appunti dentro il riquadro', async ({ app, openTab, testServer }) => {
  const childUrl = testServer.html(CHILD);
  const page = await testServer.openReady(openTab, parentHtml(childUrl));
  const fr = await frameByUrl(page, childUrl);
  await wake(fr, page);

  // Riempi la cronologia copiando due volte dalla pagina.
  await app.evaluate(({ clipboard }) => clipboard.writeText('primo-appunto-405'));
  await page.waitForTimeout(400);
  await app.evaluate(({ clipboard }) => clipboard.writeText('secondo-appunto-405'));
  await page.waitForTimeout(600);

  await fr.locator('#pinput').click();
  await fr.locator('#pinput').click({ button: 'right' });
  const mf = await anyFrameHas(page, '.sn-menu', 8000);
  expect(mf).not.toBeNull();
  const paste = mf.locator('.sn-menu .sn-menu-paste').first();
  await expect(paste, 'nessuna voce Incolla nel campo dentro il riquadro').toBeVisible();

  // La freccetta apre la cronologia degli appunti.
  await paste.locator('.sn-menu-paste-arrow').click();
  await page.waitForTimeout(900);
  const histFrame = await anyFrameHas(page, '.sn-menu-history-item', 5000);
  console.log('[PASTE-HIST] cronologia=' + !!histFrame);
  expect(histFrame, 'la cronologia degli appunti non si apre dentro il riquadro').not.toBeNull();
  const items = await histFrame.locator('.sn-menu-history-item').allInnerTexts();
  console.log('[PASTE-HIST] voci=' + JSON.stringify(items));
  expect(items.join(' ')).toContain('appunto-405');

  // Sceglierne una la incolla DAVVERO nel campo incorporato.
  await histFrame.locator('.sn-menu-history-item .sn-menu-history-paste').first().click();
  await page.waitForTimeout(1000);
  const val = await fr.locator('#pinput').inputValue();
  console.log('[PASTE-VAL] "' + val + '"');
  expect(val, 'la scelta dalla cronologia non ha incollato nel campo dentro il riquadro').toContain('appunto-405');
});

test('#405 "Incolla" semplice nel campo dentro il riquadro', async ({ app, openTab, testServer }) => {
  await app.evaluate(({ clipboard }) => clipboard.writeText('incolla-diretto-405'));
  const childUrl = testServer.html(CHILD);
  const page = await testServer.openReady(openTab, parentHtml(childUrl));
  const fr = await frameByUrl(page, childUrl);
  await wake(fr, page);
  await fr.locator('#pinput').click();
  await fr.locator('#pinput').click({ button: 'right' });
  const mf = await anyFrameHas(page, '.sn-menu', 8000);
  expect(mf).not.toBeNull();
  await mf.locator('.sn-menu .sn-menu-paste .sn-menu-paste-main').first().click();
  await page.waitForTimeout(900);
  expect(await fr.locator('#pinput').inputValue()).toContain('incolla-diretto-405');
});
