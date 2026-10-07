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

function readFoto(app) {
  return app.evaluate(() => globalThis.SN_STORAGE.getRaw(
    globalThis.SN_CONST.STORAGE_KEYS.LAST_SEEN_NOTES, null));
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
  await expect.poll(() => readFoto(app).then((f) => f && f.versione)).toBe(current);
});

// Una versione esce dal commit provato dalla suite: una riga fusa nel frattempo sta nel blocco di quella versione
// ma arriva con la seguente, e chi aveva quella versione deve trovarla nel recap dopo (#860).
test('le righe arrivate dopo nel blocco della versione vista compaiono al recap seguente', async ({ app, openTab }) => {
  const page = await openTab('filo://newtab/');
  await page.waitForLoadState('domcontentloaded');
  await app.evaluate(async ({ app }) => {
    const PN = globalThis.SN_PATCH_NOTES;
    const KEYS = globalThis.SN_CONST.STORAGE_KEYS;
    PN.NOTES.length = 0;
    PN.NOTES.push(
      { version: app.getVersion(), date: '2026-10-01', features: ['Novità della versione nuova'], fixes: [] },
      { version: '0.0.5', date: '2026-09-30', features: ['Già vista con la 0.0.5'], fixes: [] });
    await globalThis.SN_STORAGE.setRaw(KEYS.LAST_SEEN_NOTES, PN.fotografia('0.0.5'));
    await globalThis.SN_STORAGE.setRaw(KEYS.LAST_SEEN_VERSION, '0.0.5');
    PN.NOTES[1].fixes.push('Fusa mentre la suite provava la 0.0.5');
  });
  await page.reload();
  await page.waitForLoadState('domcontentloaded');

  await expect(page.locator('#recapOverlay')).toBeVisible();
  await expect(page.locator('.dash-recap-features .dash-recap-list li')).toHaveText(['Novità della versione nuova']);
  await expect(page.locator('.dash-recap-fixes .dash-recap-list li')).toHaveText(['Fusa mentre la suite provava la 0.0.5']);
  await expect(page.locator('#recapOverlay')).not.toContainText('Già vista');

  await page.locator('.dash-recap-done').click();
  const current = await app.evaluate(({ app }) => app.getVersion());
  await expect.poll(() => readFoto(app).then((f) => f && f.versione)).toBe(current);
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(300);
  await expect(page.locator('#recapOverlay')).toHaveCount(0);
});

// Sui dati veri del registro: chi aveva la 0.2.228 e passa alla versione dopo trova le righe scritte dall'11/09 (#860).
test('chi aggiorna dalla 0.2.228 vede le novità scritte dopo la sua uscita', async ({ app, openTab }) => {
  const page = await openTab('filo://newtab/');
  await page.waitForLoadState('domcontentloaded');
  await app.evaluate(async ({ app }) => {
    app.getVersion = () => '0.2.229';
    const KEYS = globalThis.SN_CONST.STORAGE_KEYS;
    await globalThis.chrome.storage.local.remove(KEYS.LAST_SEEN_NOTES);
    await globalThis.SN_STORAGE.setRaw(KEYS.LAST_SEEN_VERSION, '0.2.228');
  });
  await page.reload();
  await page.waitForLoadState('domcontentloaded');

  const overlay = page.locator('#recapOverlay');
  await expect(overlay).toBeVisible();
  await expect(page.locator('.dash-recap-old')).toHaveText('0.2.228');
  await expect(overlay).toContainText('anche per Linux');
  await expect(overlay).toContainText('Un invito adesso è un link');
  await expect(overlay).toContainText('aprire un sito da un altro paese');
  await page.screenshot({ path: 'tests/.shots/update-recap-0.2.228.png' }).catch(() => {});
});
