// Appunti di Filo, ora DENTRO l'editor (#379.3 — fine dell'archivio separato).
//
// Quando l'utente dice "prendi nota che…", Filo NON riempie più un elenco a
// parte: scrive l'appunto come testo in un file dell'editor. Questo spec
// asserisce il SUCCESSO della feature (non l'assenza di errori):
//   1) un appunto scritto da Filo compare COME TESTO in un file dell'editor, e
//      un editor già aperto lo mostra da solo (ricarica live);
//   2) restando sullo stesso argomento i due appunti finiscono nello STESSO
//      file; cambiando argomento si apre un file NUOVO.
//
// Senza il fix (appunto nell'archivio separato) il testo non comparirebbe in
// nessun file dell'editor → rosso.
//
// #379.12 chiude il cerchio lato UI: l'accesso agli appunti passa SOLO
// dall'editor (niente più pannello/icona "Appunti" nella home) e l'editor porta
// proprio l'icona degli appunti, ovunque compaia. Gli ultimi tre test qui sotto
// asseriscono quell'invariante:
//   3) i controlli in alto a destra nella home sono ESATTAMENTE quelli del
//      browser — nessuna voce che apra un elenco appunti separato;
//   4) la voce Editor del menu App e l'icona Editor del menu tasto destro
//      disegnano il foglio degli appunti (stesso SVG), non più la penna;
//   5) da lì l'editor si apre davvero.

import { test, expect } from './fixtures/electron.mjs';

const EDITOR = 'filo://editor/editor.html';

// Tratto distintivo dell'SVG "appunti" (foglio con l'angolo piegato) — vive in
// src/shared/icons.js (`note`) e, in copia, nel registro del popup del menu App
// (src/main/popup-menu.js). Se questo path non compare, l'icona disegnata è
// un'altra.
const NOTE_PATH = 'M6 3.5h8l4 4v13H6z';

// Scrive un appunto passando dal VERO percorso di runtime: l'azione SALVA_APPUNTO
// (come la emette la chat) inviata al main, che la esegue scrivendo nel file
// dell'editor e avvisa le superfici aperte. Restituisce la risposta del main.
async function filoWritesNote(page, { text, topic, forceNew }) {
  return page.evaluate(([t, c, n]) => new Promise((resolve) => {
    chrome.runtime.sendMessage({
      type: window.SN_MSG.MSG.FILO_RUN_ACTION,
      action: { type: 'SALVA_APPUNTO', text: t, context: c, nuovo: n },
    }, (r) => resolve(r));
  }), [text, topic, !!forceNew]);
}

// Aspetta che l'editor abbia rispecchiato la sua collezione sull'archivio
// condiviso (storage.json) — così la scrittura di Filo, che legge di lì, parte
// da uno stato stabile e non viene poi sovrascritta dal mirror di boot.
async function waitCollectionMirrored(app) {
  await expect.poll(async () => app.evaluate(async () => {
    try {
      const r = await chrome.storage.local.get('filo.editor.collection');
      const c = r && r['filo.editor.collection'];
      return !!(c && Array.isArray(c.files) && c.files.length);
    } catch (_) { return false; }
  }), { timeout: 8_000 }).toBe(true);
}

// Legge la collezione dei file come la vede l'editor (dopo il merge locale↔archivio).
async function readCollection(page) {
  return page.evaluate(() => {
    try { return JSON.parse(localStorage.getItem('filo.editor.collection')); } catch (_) { return null; }
  });
}

// Testo concatenato di un file serializzato.
function fileText(file) {
  const out = [];
  const walk = (n) => {
    if (!n) return;
    if (n.type === 'text' && n.text) out.push(n.text);
    if (Array.isArray(n.content)) n.content.forEach(walk);
  };
  walk(file && file.content);
  return out.join('\n');
}

test('un appunto di Filo compare come testo in un file dell’editor (e l’editor aperto si aggiorna)', async ({ app, openTab }) => {
  const page = await openTab(EDITOR);
  await page.waitForSelector('#doc');
  await page.evaluate(() => window.__filoEditorVersions.ready());
  await waitCollectionMirrored(app);

  const NOTE = 'AUDIT_appunto_riunione_alle_10';
  const r = await filoWritesNote(page, { text: NOTE, topic: 'lavoro' });
  expect(r?.executed, 'l’appunto deve essere eseguito e scritto').toBe(true);

  // L'editor aperto ricarica da solo: compare un file "Lavoro" col testo.
  await expect.poll(async () => {
    const col = await readCollection(page);
    if (!col || !Array.isArray(col.files)) return null;
    const f = col.files.find((x) => fileText(x).includes(NOTE));
    return f ? f.meta.title : null;
  }, { timeout: 8_000 }).toBe('Lavoro');
});

test('stesso argomento → stesso file; argomento diverso → file nuovo', async ({ app, openTab }) => {
  const page = await openTab(EDITOR);
  await page.waitForSelector('#doc');
  await page.evaluate(() => window.__filoEditorVersions.ready());
  await waitCollectionMirrored(app);

  const A = 'AUDIT_progetto_idea_uno';
  const B = 'AUDIT_progetto_idea_due';
  const C = 'AUDIT_spesa_comprare_latte';

  await filoWritesNote(page, { text: A, topic: 'progetto alfa' });
  await filoWritesNote(page, { text: B, topic: 'progetto alfa' });

  // I due appunti dello stesso argomento stanno in UN solo file, entrambi.
  await expect.poll(async () => {
    const col = await readCollection(page);
    if (!col) return null;
    const withA = col.files.filter((f) => fileText(f).includes(A));
    const sameHasBoth = withA.length === 1 && fileText(withA[0]).includes(B);
    return sameHasBoth ? withA[0].id : null;
  }, { timeout: 8_000 }).not.toBeNull();

  const colBefore = await readCollection(page);
  const projFile = colBefore.files.find((f) => fileText(f).includes(A));

  // Argomento diverso → un file DIVERSO col nuovo testo.
  await filoWritesNote(page, { text: C, topic: 'spesa' });
  await expect.poll(async () => {
    const col = await readCollection(page);
    if (!col) return null;
    const withC = col.files.find((f) => fileText(f).includes(C));
    if (!withC) return null;
    return withC.id !== projFile.id ? withC.meta.title : null;
  }, { timeout: 8_000 }).toBe('Spesa');
});

// ─── #379.12: l'unica porta d'accesso agli appunti è l'editor ───────────────

const PAGE_HTML = `<!doctype html><html><body style="padding:40px;font:16px sans-serif">
  <h1>Filo test page</h1><p>Click destro qui.</p></body></html>`;

// La newtab (home) è aperta dal main subito dopo il load della shell.
async function newtabPage(app) {
  const deadline = Date.now() + 10_000;
  let win = null;
  while (Date.now() < deadline) {
    win = app.windows().find((w) => w.url().startsWith('filo://newtab'));
    if (win) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  expect(win, 'newtab non trovata entro 10s').toBeTruthy();
  await win.waitForLoadState('domcontentloaded');
  return win;
}

// Il menu App del launcher è una BrowserWindow a parte (data:text/html).
async function openLauncherPopup(shell, app) {
  await shell.evaluate(() => document.getElementById('nav-apps')?.click());
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const win = app.windows().find((w) => w.url().startsWith('data:text/html'));
    if (win) {
      await win.waitForSelector('.item, .row', { timeout: 2_000 }).catch(() => {});
      return win;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('popup del menu App non aperto');
}

test('nella home i controlli sono solo quelli del browser: nessuna porta agli appunti', async ({ app, shell }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  const controls = page.locator('#dashControls .dash-ctrl');
  await expect(controls.first()).toBeVisible({ timeout: 8_000 });

  // Assert POSITIVO sull'insieme completo: se tornasse una voce "Appunti"
  // (o qualsiasi altra porta separata) l'elenco non combacerebbe più.
  await expect(controls).toHaveText(['', '', '', '', '', '']);
  const labels = await controls.evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')));
  expect(labels).toEqual(['Red-team', 'Home', 'Cronologia', 'Impostazioni', 'App', 'Profilo']);

  // E nessun overlay appunti può aprirsi: il pannello non esiste più.
  await expect(page.locator('.dash-notes-overlay')).toHaveCount(0);

  await page.screenshot({ path: 'tests/.shots/379-12-home-controlli.png' }).catch(() => {});
});

test('l’Editor porta l’icona degli appunti nel menu App e nel menu tasto destro', async ({ shell, app, openTab, testServer }) => {
  // 1) Menu App (launcher della shell) — registro icone di popup-menu.js.
  const popup = await openLauncherPopup(shell, app);
  const item = popup.locator('.item', { hasText: 'Editor' }).first();
  await expect(item).toBeVisible();
  const launcherSvg = await item.locator('.ico svg').first().innerHTML();
  expect(launcherSvg, 'la voce Editor del menu App non disegna il foglio appunti').toContain(NOTE_PATH);
  await popup.keyboard.press('Escape').catch(() => {});

  // 2) Menu tasto destro su una pagina esterna — registro src/shared/icons.js.
  const page = await testServer.openReady(openTab, PAGE_HTML);
  await page.locator('p').click({ button: 'right' });
  const menu = page.locator('.sn-menu').first();
  await expect(menu).toBeVisible();
  const overflow = menu.locator('.sn-menu-row-overflow').first();
  await expect(overflow).toBeVisible();
  await overflow.hover();
  const grid = page.locator('.sn-menu-icon-grid');
  await expect(grid).toBeVisible({ timeout: 2_000 });
  const btn = grid.locator('.sn-menu-icon-btn[data-sn-icon-id="editorApp"]');
  await expect(btn).toBeVisible();
  const menuSvg = await btn.locator('svg').first().innerHTML();
  expect(menuSvg, 'l’icona Editor del menu tasto destro non disegna il foglio appunti').toContain(NOTE_PATH);

  // Le due superfici devono disegnare la STESSA icona (registri diversi, un
  // solo significato): niente editor "penna" da una parte e "foglio" dall'altra.
  const norm = (s) => s.replace(/\s+/g, ' ').trim();
  expect(norm(launcherSvg)).toBe(norm(menuSvg));
});

test('dal menu App l’Editor si apre normalmente', async ({ shell, app }) => {
  const popup = await openLauncherPopup(shell, app);
  await popup.locator('.item', { hasText: 'Editor' }).first().click();

  const deadline = Date.now() + 8_000;
  let win = null;
  while (Date.now() < deadline) {
    win = app.windows().find((w) => w.url().startsWith('filo://editor'));
    if (win) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  expect(win, 'l’Editor non si è aperto dal menu App').toBeTruthy();
  await win.waitForSelector('#doc', { timeout: 10_000 });
});
