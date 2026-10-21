// #1084 — i dizionari del correttore nativo viaggiano con Filo: all'avvio sono già dove Chromium li cerca, e nessuna
// lingua inclusa viene chiesta alla rete. Su Mac il correttore è del sistema e non c'è niente da guardare.

import { test, expect } from './fixtures/electron.mjs';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { menuDi } from './helpers/menuContestuale.mjs';

test('i dizionari inclusi si caricano dalla cartella dei dati, senza chiederli alla rete, e correggono l\'italiano', async ({ app, openTab, testServer }) => {
  const prima = await app.evaluate(({ app: a }) => ({
    piattaforma: process.platform,
    dati: a.getPath('sessionData'),
    inclusi: globalThis.__filoDizionari.inclusi(),
    lingue: globalThis.__filoDizionari.lingue(),
  }));
  test.skip(prima.piattaforma === 'darwin', 'su Mac il correttore è quello del sistema');
  expect(prima.inclusi).toEqual(['en-GB-10-1.bdic', 'en-US-10-1.bdic', 'it-IT-3-0.bdic']);
  expect(readdirSync(join(prima.dati, 'Dictionaries'))).toEqual(expect.arrayContaining(prima.inclusi));

  const url = testServer.html(`<!doctype html><html><body style="margin:0">
    <div id="ce" contenteditable="true" spellcheck="true" style="font:16px monospace;padding:8px;width:400px;height:120px"></div>
  </body></html>`);
  const page = await openTab(url);
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
  await expect.poll(() => app.evaluate(() => globalThis.__filoDizionari.stato().inizializzati), { timeout: 20_000 })
    .toContain('it-IT');
  const stato = await app.evaluate(() => globalThis.__filoDizionari.stato());
  expect(stato.chiesti.filter((l) => prima.lingue.includes(l))).toEqual([]);

  // Il successo per chi scrive: senza chiave per i modelli, la correzione in cima al menu può venire solo dal dizionario.
  // Quale suggerimento sta in cima dipende dalla lingua del sistema (#169): l'italiano si cerca fra tutti.
  const host = new URL(url).host;
  await page.locator('#ce').click();
  await page.keyboard.type('funzion ciao ');
  const box = await page.locator('#ce').boundingBox();
  await expect.poll(async () => {
    await app.evaluate(({ webContents }, h) => {
      globalThis.__suggerimentiNativi = null;
      for (const wc of webContents.getAllWebContents()) {
        let qui = false;
        try { qui = new URL(wc.getURL()).host === h; } catch (_) {}
        if (qui) wc.once('context-menu', (_e, p) => { globalThis.__suggerimentiNativi = { parola: p.misspelledWord, voci: p.dictionarySuggestions }; });
      }
    }, host);
    await page.keyboard.press('Escape');
    await page.mouse.click(box.x + 20, box.y + 16, { button: 'right' });
    await page.waitForTimeout(300);
    return app.evaluate(() => globalThis.__suggerimentiNativi);
  }, { timeout: 15_000, intervals: [1000] }).toEqual({ parola: 'funzion', voci: expect.arrayContaining(['funzione']) });
  await expect(menuDi(page).locator('.sn-menu-correction:visible').first()).not.toBeEmpty({ timeout: 4000 });
});
