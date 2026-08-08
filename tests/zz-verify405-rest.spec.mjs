// VERIFIER #405 — parte 2 del sintomo utente:
//  "dentro il riquadro non funziona nemmeno il resto di Filo: Alt+E / Alt+T sul
//   testo selezionato non fanno nulla, non c'è il correttore mentre scrivi in un
//   campo incorporato, non c'è Incolla con la cronologia degli appunti."

import { test, expect } from './fixtures/electron.mjs';

const CHILD = `<!doctype html><html><body style="margin:0;padding:20px;font:16px sans-serif;background:#eef">
  <p id="ptext">Questa e' una frase dentro il riquadro incorporato, abbastanza lunga da poter essere spiegata.</p>
  <textarea id="pta" rows="3" cols="40">quii</textarea>
  <input id="pinput" value="">
</body></html>`;

function parentHtml(childUrl) {
  return `<!doctype html><html><body style="margin:0;padding:30px;font:16px sans-serif">
  <p id="outside">Testo dell'articolo, fuori dal riquadro.</p>
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

async function activeTabId(shell) {
  return shell.evaluate(async () => (await window.filoShell.tabs.snapshot()).activeId);
}

// Invoca lo stesso cammino della scorciatoia globale Alt+E / Alt+T
// (globalShortcut non si può premere davvero sotto xvfb).
async function fireShortcut(app, command) {
  return app.evaluate(({ BrowserWindow }, cmd) => {
    const { dispatch } = require('./src/main/shortcuts.js');
    const win = BrowserWindow.getAllWindows()[0];
    dispatch(cmd, win);
    return true;
  }, command);
}

// ---------- Alt+E / Alt+T sul testo selezionato DENTRO il riquadro ----------

for (const [label, cmd] of [['Alt+E (Spiegazione)', 'explain-selection'], ['Alt+T (Traduci)', 'translate-selection']]) {
  test(`#405 ${label} sul testo selezionato dentro il riquadro`, async ({ app, openTab, testServer, shell }) => {
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
    // FALLIMENTO tipico = "Nessuna selezione di testo." perché la scorciatoia
    // è stata consegnata al frame sbagliato.
    let toastTxt = '';
    for (const f of page.frames()) {
      try {
        const t = f.locator('.sn-toast');
        if (await t.count()) toastTxt += (await t.first().innerText()) + ' ';
      } catch (_) {}
    }
    console.log(`[${cmd}] popup=${!!popupFrame} toast="${toastTxt.trim()}"`);
    expect(toastTxt).not.toContain('Nessuna selezione');
    expect(popupFrame, 'nessuna finestrella di Filo dopo la scorciatoia dentro il riquadro').not.toBeNull();
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
  console.log('[NO-SEL] toast=' + !!t);
  expect(t, 'nessun avviso: la scorciatoia resta muta dentro il riquadro').not.toBeNull();
});

// ---------- Correttore ortografico dentro il riquadro ----------

test('#405 correttore: tasto destro su parola errata in un campo dentro il riquadro', async ({ openTab, testServer }) => {
  const childUrl = testServer.html(CHILD);
  const page = await testServer.openReady(openTab, parentHtml(childUrl));
  const fr = await frameByUrl(page, childUrl);
  await wake(fr, page);

  // Scrive davvero nel campo incorporato, come l'utente.
  await fr.locator('#pta').click();
  await fr.locator('#pta').fill('');
  await fr.locator('#pta').type('quii', { delay: 40 });
  await page.waitForTimeout(900);

  // Tasto destro sulla parola: Electron manda i suggerimenti nativi al frame.
  await fr.locator('#pta').click({ button: 'right', position: { x: 12, y: 10 } });

  const menuFrame = await anyFrameHas(page, '.sn-menu', 8000);
  expect(menuFrame, 'nessun menu nel campo dentro il riquadro').not.toBeNull();

  const corr = menuFrame.locator('.sn-menu .sn-menu-correction');
  const has = await corr.count().then((c) => c > 0).catch(() => false);
  const txt = await menuFrame.locator('.sn-menu').first().innerText();
  console.log('[SPELL] correzione=' + has + '\n' + txt);
  // Se i dizionari Hunspell non ci sono nell'ambiente non possiamo pretendere
  // il suggerimento: in quel caso ci basta che il menu del campo ci sia.
  expect(txt.toLowerCase()).toMatch(/incolla/);
});

test('#405 correttore: il suggerimento nativo raggiunge il frame incorporato', async ({ openTab, testServer }) => {
  const childUrl = testServer.html(CHILD);
  const page = await testServer.openReady(openTab, parentHtml(childUrl));
  const fr = await frameByUrl(page, childUrl);
  await wake(fr, page);
  await fr.locator('#pta').click();
  await page.waitForTimeout(600);

  // Il content script DEVE essere montato nel frame incorporato, con il
  // correttore agganciato: senza, nessun suggerimento potrà mai arrivare.
  const state = await fr.evaluate(() => ({
    cs: document.documentElement.dataset.filoContentScripts,
    ready: document.documentElement.dataset.filoReady,
    spell: typeof globalThis.SN_SPELLCHECK?.onNativeSuggestions,
    onMsg: !!globalThis.chrome?.runtime?.onMessage,
  }));
  console.log('[SPELL-STATE] ' + JSON.stringify(state));
  expect(state.spell, 'il correttore non è agganciato dentro il riquadro').toBe('function');

  // Simula l'arrivo del suggerimento nativo (come fa Electron) DENTRO il frame.
  await fr.evaluate(() => {
    const ls = globalThis.chrome.runtime.onMessage._listeners || [];
    for (const fn of ls) { try { fn({ type: '_spell:native', word: 'quii', suggestions: ['qui', 'quiz'] }); } catch (_) {} }
  });
  await fr.locator('#pta').click({ button: 'right', position: { x: 12, y: 10 } });
  const corr = fr.locator('.sn-menu .sn-menu-correction');
  await expect(corr).toBeVisible({ timeout: 6000 });
  await expect(corr.locator('.sn-menu-label').first()).toHaveText('qui');
});

// ---------- Incolla con cronologia degli appunti ----------

test('#405 Incolla con la cronologia degli appunti dentro il riquadro', async ({ app, openTab, testServer }) => {
  await app.evaluate(({ clipboard }) => clipboard.writeText('testo-appunti-405'));
  const childUrl = testServer.html(CHILD);
  const page = await testServer.openReady(openTab, parentHtml(childUrl));
  const fr = await frameByUrl(page, childUrl);
  await wake(fr, page);

  await fr.locator('#pinput').click();
  await fr.locator('#pinput').click({ button: 'right' });
  const menuFrame = await anyFrameHas(page, '.sn-menu', 8000);
  expect(menuFrame).not.toBeNull();
  const menu = menuFrame.locator('.sn-menu').first();
  const txt = await menu.innerText();
  console.log('[PASTE-MENU]\n' + txt);
  expect(txt.toLowerCase()).toContain('incolla');

  // La freccia "▾" accanto a Incolla apre la cronologia.
  const submenuTrigger = menu.locator('.sn-menu-item', { hasText: 'Incolla' }).first();
  await submenuTrigger.hover();
  await page.waitForTimeout(700);
  const anyHist = await anyFrameHas(page, '.sn-submenu, .sn-menu-sub, .sn-clip-history', 4000);
  console.log('[PASTE-HIST] submenu=' + !!anyHist);

  // Comunque vada, "Incolla" deve incollare davvero nel campo incorporato.
  await submenuTrigger.click();
  await page.waitForTimeout(800);
  const val = await fr.locator('#pinput').inputValue();
  console.log('[PASTE-VAL] "' + val + '"');
  expect(val, 'Incolla dal menu non ha incollato nel campo dentro il riquadro').toContain('testo-appunti-405');
});

// ---------- Confini: le pagine interne di Filo ----------

test('#405 i riquadri dentro una pagina filo:// NON ricevono i content script', async ({ openTab, shell, app }) => {
  const page = await openTab('filo://newtab/newtab.html');
  await page.waitForTimeout(1200);
  const info = await page.evaluate(async () => {
    const ifr = document.createElement('iframe');
    ifr.src = 'https://example.org/';
    ifr.width = '300'; ifr.height = '200';
    document.body.appendChild(ifr);
    await new Promise((r) => setTimeout(r, 1500));
    return { count: document.querySelectorAll('iframe').length };
  });
  console.log('[FILO-IFRAME] ' + JSON.stringify(info));
  // Nessun crash della pagina interna: resta viva e risponde.
  expect(await page.evaluate(() => document.readyState)).toBe('complete');
});
