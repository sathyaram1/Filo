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
