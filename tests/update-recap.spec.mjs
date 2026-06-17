// Recap aggiornamento (C4): popup all'avvio dopo un update. Asserisce il SUCCESSO
// della feature — il popup elenca le NOVITÀ in alto e le CORREZIONI in basso, con
// l'header "vecchia → nuova", e alla chiusura non riappare.
//
// Senza il fix la pagina home non mostra alcun recap: il primo test fallisce
// perché #recapOverlay non compare mai. Le note sono forzate in modo
// deterministico (indipendenti dal changelog reale) sovrascrivendo SN_PATCH_NOTES
// nel processo main.

import { test, expect } from './fixtures/electron.mjs';

// Forza note deterministiche con la versione corrente (così since() le include)
// e imposta la versione "vista l'ultima volta". lastSeen === null ⇒ rimuove la
// chiave (simula il primissimo avvio).
async function seed(app, lastSeen) {
  await app.evaluate(async ({ app }, ls) => {
    const v = app.getVersion();
    const PN = globalThis.SN_PATCH_NOTES;
    PN.NOTES.length = 0;
    PN.NOTES.push({
      version: v,
      date: '2026-06-17',
      features: ['Novità di test alfa', 'Seconda novità di test'],
      fixes: ['Correzione di test'],
    });
    const KEY = globalThis.SN_CONST.STORAGE_KEYS.LAST_SEEN_VERSION;
    if (ls === null) await globalThis.chrome.storage.local.remove(KEY);
    else await globalThis.SN_STORAGE.setRaw(KEY, ls);
  }, lastSeen);
}

function readLastSeen(app) {
  return app.evaluate(() => globalThis.SN_STORAGE.getRaw(
    globalThis.SN_CONST.STORAGE_KEYS.LAST_SEEN_VERSION, null));
}

test('il recap mostra le novità in alto e le correzioni in basso', async ({ app, openTab }) => {
  const page = await openTab('filo://newtab/');
  await page.waitForLoadState('domcontentloaded');
  // Seed DOPO il boot (il newtab d'avvio ha già fatto girare il suo init), poi
  // reload così init rilegge lo stato forzato.
  await seed(app, '0.0.1');
  await page.reload();
  await page.waitForLoadState('domcontentloaded');

  const overlay = page.locator('#recapOverlay');
  await expect(overlay).toBeVisible();

  // Header: vecchia → nuova.
  const current = await app.evaluate(({ app }) => app.getVersion());
  await expect(page.locator('.dash-recap-old')).toHaveText('0.0.1');
  await expect(page.locator('.dash-recap-new')).toHaveText(current);

  // Novità: due voci, nell'ordine atteso.
  const features = page.locator('.dash-recap-features .dash-recap-list li');
  await expect(features).toHaveCount(2);
  await expect(features.nth(0)).toHaveText('Novità di test alfa');
  await expect(features.nth(1)).toHaveText('Seconda novità di test');

  // Correzioni: una voce.
  const fixes = page.locator('.dash-recap-fixes .dash-recap-list li');
  await expect(fixes).toHaveCount(1);
  await expect(fixes.first()).toHaveText('Correzione di test');

  // Le Novità precedono le Correzioni nel DOM.
  const order = await page.locator('.dash-recap-section').evaluateAll(
    (els) => els.map((e) => e.dataset.kind));
  expect(order).toEqual(['features', 'fixes']);
});

test('chiudere il recap lo marca come visto e non riappare', async ({ app, openTab }) => {
  const page = await openTab('filo://newtab/');
  await page.waitForLoadState('domcontentloaded');
  await seed(app, '0.0.1');
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('#recapOverlay')).toBeVisible();

  await page.locator('.dash-recap-done').click();
  await expect(page.locator('#recapOverlay')).toHaveCount(0);

  // La versione corrente è ora quella "vista".
  const current = await app.evaluate(({ app }) => app.getVersion());
  await expect.poll(() => readLastSeen(app)).toBe(current);

  // Reload: con lastSeen === current non ci sono note → niente popup.
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(300);
  await expect(page.locator('#recapOverlay')).toHaveCount(0);
});

test('al primissimo avvio non mostra il recap ma marca la versione', async ({ app, openTab }) => {
  const page = await openTab('filo://newtab/');
  await page.waitForLoadState('domcontentloaded');
  await seed(app, null); // nessuna versione vista prima
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(300);

  await expect(page.locator('#recapOverlay')).toHaveCount(0);
  const current = await app.evaluate(({ app }) => app.getVersion());
  await expect.poll(() => readLastSeen(app)).toBe(current);
});
