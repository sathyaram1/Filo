// Appunti storici → file "Appunti" dell'editor (#379.11 — ritiro dell'archivio
// note separato).
//
// Chi usava Filo prima che gli appunti diventassero file dell'editor ha ancora
// le sue note nel VECCHIO archivio (`filo_notes`). Non devono sparire: al primo
// avvio dopo l'aggiornamento vanno spostate dentro un file "Appunti" dell'editor,
// e il vecchio archivio va svuotato.
//
// Questo spec asserisce il SUCCESSO (le note VECCHIE compaiono davvero nel file
// dell'editor), non l'assenza di errori. Senza migrazione i tre testi non
// esisterebbero in nessun file della collezione → rosso.
//
// Serve un avvio "sporco" (archivio già popolato PRIMA che il main parta), quindi
// non si può usare il fixture `app`: lanciamo Electron a mano su un userData
// seminato, e lo rilanciamo una seconda volta sullo STESSO userData per la
// verifica di idempotenza (il secondo avvio non deve duplicare nulla).

import { test, expect } from '@playwright/test';
import { _electron as electron } from '@playwright/test';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { argomentiScala } from './fixtures/electron.mjs';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const EDITOR = 'filo://editor/editor.html';

// Tre appunti come li scriveva il vecchio archivio: più recente in cima.
const OLD_NOTES = [
  { id: 'n3', ts: '2026-01-03T10:00:00.000Z', text: 'MIGRA_terzo_chiamare_il_dentista', context: 'salute' },
  { id: 'n2', ts: '2026-01-02T10:00:00.000Z', text: 'MIGRA_secondo_rinnovare_abbonamento', context: 'casa' },
  { id: 'n1', ts: '2026-01-01T10:00:00.000Z', text: 'MIGRA_primo_comprare_il_pane', context: 'spesa' },
];

function seedUserData() {
  const userData = mkdtempSync(join(tmpdir(), 'filo-migra-'));
  writeFileSync(
    join(userData, 'storage.json'),
    JSON.stringify({ filo_notes: OLD_NOTES }),
    'utf8',
  );
  return userData;
}

function launch(userData) {
  return electron.launch({
    args: [...argomentiScala, '.'],
    cwd: APP_ROOT,
    env: { ...process.env, FILO_USER_DATA: userData, NODE_ENV: 'test' },
  });
}

// Apre l'editor come tab e ritorna la Page del WebContentsView.
async function openEditor(app) {
  const shell = await app.firstWindow();
  await shell.waitForLoadState('domcontentloaded');
  await shell.evaluate((u) => window.filoShell.tabs.open(u), EDITOR);
  const deadline = Date.now() + 15_000;
  let page = null;
  while (Date.now() < deadline) {
    page = app.windows().find((w) => {
      try { return new URL(w.url()).hostname === 'editor'; } catch (_) { return false; }
    });
    if (page) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  if (!page) throw new Error('editor non aperto');
  await page.waitForLoadState('domcontentloaded');
  await page.waitForSelector('#doc');
  return page;
}

// Collezione come la vede l'editor (dopo il merge archivio ↔ locale).
function readCollection(page) {
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

// Quante volte un testo compare nell'INTERA collezione (per l'idempotenza).
function countInCollection(collection, needle) {
  const files = (collection && Array.isArray(collection.files)) ? collection.files : [];
  return files.reduce((acc, f) => acc + (fileText(f).split(needle).length - 1), 0);
}

// Il vecchio archivio, letto dal main (è lì che vive `chrome.storage.local`).
function readOldNotes(app) {
  return app.evaluate(async () => {
    try {
      const r = await chrome.storage.local.get('filo_notes');
      return (r && r.filo_notes) || [];
    } catch (_) { return null; }
  });
}

test('gli appunti del vecchio archivio finiscono nel file "Appunti" dell’editor, e l’archivio resta vuoto', async () => {
  const userData = seedUserData();
  const app = await launch(userData);
  try {
    const page = await openEditor(app);

    // I tre testi storici sono in UN file dell'editor, che si chiama "Appunti".
    await expect.poll(async () => {
      const col = await readCollection(page);
      const files = (col && Array.isArray(col.files)) ? col.files : [];
      const f = files.find((x) => fileText(x).includes('MIGRA_primo_comprare_il_pane'));
      if (!f) return null;
      const txt = fileText(f);
      const all = OLD_NOTES.every((n) => txt.includes(n.text));
      return all ? (f.meta && f.meta.title) : 'file trovato ma incompleto';
    }, { timeout: 15_000 }).toBe('Appunti');

    // Ordine cronologico: il più vecchio in cima (l'archivio era al contrario).
    const col = await readCollection(page);
    const notesFile = col.files.find((f) => fileText(f).includes('MIGRA_primo_comprare_il_pane'));
    const txt = fileText(notesFile);
    expect(txt.indexOf('MIGRA_primo_comprare_il_pane'))
      .toBeLessThan(txt.indexOf('MIGRA_terzo_chiamare_il_dentista'));

    // …e soprattutto: l'UTENTE lo trova. "Appunti" è nell'elenco documenti e
    // aprendolo il foglio mostra davvero i suoi vecchi appunti.
    await page.click('#docSwitch');
    const voce = page.locator('.ed-doc-item', { hasText: 'Appunti' });
    await expect(voce).toHaveCount(1);
    await voce.click();
    for (const n of OLD_NOTES) {
      await expect(page.locator('#doc')).toContainText(n.text);
    }
    // Traccia visiva della run (cartella gitignorata): il foglio "Appunti" con
    // dentro i vecchi appunti, come lo vede l'utente.
    await page.screenshot({ path: 'tests/.shots/editor-appunti-migrati.png' }).catch(() => {});

    // Il vecchio archivio è stato svuotato: gli appunti vivono in un posto solo.
    await expect.poll(() => readOldNotes(app), { timeout: 10_000 }).toEqual([]);
  } finally {
    try { await app.close(); } catch (_) {}
    rmSync(userData, { recursive: true, force: true });
  }
});

test('il secondo avvio non riduplica gli appunti già migrati', async () => {
  const userData = seedUserData();

  // Primo avvio: migra.
  const first = await launch(userData);
  try {
    await openEditor(first);
    await expect.poll(() => readOldNotes(first), { timeout: 15_000 }).toEqual([]);
  } finally {
    try { await first.close(); } catch (_) {}
  }

  // Secondo avvio sullo stesso profilo: nessun file "Appunti" in più, nessun
  // testo ripetuto.
  const second = await launch(userData);
  try {
    const page = await openEditor(second);
    await expect.poll(async () => {
      const col = await readCollection(page);
      return countInCollection(col, 'MIGRA_primo_comprare_il_pane');
    }, { timeout: 15_000 }).toBe(1);

    const col = await readCollection(page);
    for (const n of OLD_NOTES) {
      expect(countInCollection(col, n.text), `"${n.text}" duplicato al secondo avvio`).toBe(1);
    }
    const appunti = col.files.filter((f) => (f.meta && f.meta.title) === 'Appunti');
    expect(appunti.length, 'un solo file "Appunti"').toBe(1);
  } finally {
    try { await second.close(); } catch (_) {}
    rmSync(userData, { recursive: true, force: true });
  }
});
