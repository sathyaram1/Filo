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

import { test, expect } from './fixtures/electron.mjs';

const EDITOR = 'filo://editor/editor.html';

// Scrive un appunto passando dal MAIN, esattamente come fa l'azione SALVA_APPUNTO
// della chat: scrive nel file dell'editor e avvisa le superfici aperte.
async function filoWritesNote(app, { text, topic, forceNew }) {
  return app.evaluate(async ({ app: electronApp }, args) => {
    const path = require('path');
    const EF = require(path.join(electronApp.getAppPath(), 'src', 'main', 'services', 'editorFiles.js'));
    const H = require(path.join(electronApp.getAppPath(), 'src', 'main', 'services', 'handlers.js'));
    const r = await EF.writeNote(args);
    if (r && r.wrote) H.broadcastLiveUpdate();
    return r;
  }, { text, topic, forceNew: !!forceNew });
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

  const NOTE = 'AUDIT_appunto_riunione_alle_10';
  const r = await filoWritesNote(app, { text: NOTE, topic: 'lavoro' });
  expect(r?.wrote, 'l’appunto deve essere scritto').toBe(true);

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

  const A = 'AUDIT_progetto_idea_uno';
  const B = 'AUDIT_progetto_idea_due';
  const C = 'AUDIT_spesa_comprare_latte';

  await filoWritesNote(app, { text: A, topic: 'progetto alfa' });
  await filoWritesNote(app, { text: B, topic: 'progetto alfa' });

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
  await filoWritesNote(app, { text: C, topic: 'spesa' });
  await expect.poll(async () => {
    const col = await readCollection(page);
    if (!col) return null;
    const withC = col.files.find((f) => fileText(f).includes(C));
    if (!withC) return null;
    return withC.id !== projFile.id ? withC.meta.title : null;
  }, { timeout: 8_000 }).toBe('Spesa');
});
