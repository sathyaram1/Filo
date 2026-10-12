// #1084 — i dizionari del correttore nativo viaggiano con Filo: all'avvio sono già dove Chromium li cerca, e nessuna
// lingua inclusa viene chiesta alla rete. Su Mac il correttore è del sistema e non c'è niente da guardare.

import { test, expect } from './fixtures/electron.mjs';

test('i dizionari inclusi si caricano dalla cartella dei dati, senza chiederli alla rete, e correggono l\'italiano', async ({ app, openTab }) => {
  const prima = await app.evaluate(async ({ app: a }) => {
    const fs = require('node:fs');
    const path = require('node:path');
    const dir = path.join(a.getPath('sessionData'), 'Dictionaries');
    return {
      piattaforma: process.platform,
      inclusi: globalThis.__filoDizionari.inclusi(),
      lingue: globalThis.__filoDizionari.lingue(),
      presenti: fs.existsSync(dir) ? fs.readdirSync(dir).sort() : [],
    };
  }).catch(async () => app.evaluate(async ({ app: a }) => ({
    piattaforma: process.platform,
    inclusi: globalThis.__filoDizionari.inclusi(),
    lingue: globalThis.__filoDizionari.lingue(),
    presenti: null,
    dati: a.getPath('sessionData'),
  })));
  test.skip(prima.piattaforma === 'darwin', 'su Mac il correttore è quello del sistema');
  expect(prima.inclusi).toEqual(['en-GB-10-1.bdic', 'en-US-10-1.bdic', 'it-IT-3-0.bdic']);
  if (prima.presenti) expect(prima.presenti).toEqual(expect.arrayContaining(prima.inclusi));

  const page = await openTab('data:text/html,' + encodeURIComponent('<!doctype html><meta charset="utf-8"><textarea id="t" spellcheck="true" style="font-size:28px;width:500px;height:120px"></textarea>'));
  await expect.poll(() => app.evaluate(() => globalThis.__filoDizionari.stato().inizializzati), { timeout: 20_000 })
    .toContain('it-IT');
  const stato = await app.evaluate(() => globalThis.__filoDizionari.stato());
  expect(stato.chiesti.filter((l) => prima.lingue.includes(l))).toEqual([]);

  // La prova che il dizionario c'è davvero: la parola sbagliata ha i suggerimenti italiani.
  await page.locator('#t').click();
  await page.keyboard.type('funzion ');
  const suggerimenti = await app.evaluate(async ({ webContents }) => {
    const wc = webContents.getAllWebContents().find((w) => w.getURL().startsWith('data:text/html'));
    return new Promise((ok) => {
      const fine = setTimeout(() => ok(null), 8000);
      wc.once('context-menu', (_e, p) => { clearTimeout(fine); ok({ parola: p.misspelledWord, voci: p.dictionarySuggestions }); });
      setTimeout(() => {
        wc.sendInputEvent({ type: 'mouseDown', x: 40, y: 22, button: 'right', clickCount: 1 });
        wc.sendInputEvent({ type: 'mouseUp', x: 40, y: 22, button: 'right', clickCount: 1 });
      }, 1500);
    });
  });
  expect(suggerimenti).not.toBeNull();
  expect(suggerimenti.parola).toBe('funzion');
  expect(suggerimenti.voci).toContain('funzione');
});
