// #1084 — i dizionari del correttore nativo viaggiano con Filo: all'avvio sono già dove Chromium li cerca, e nessuna
// lingua inclusa viene chiesta alla rete (su Mac il correttore nativo è del sistema). #1585 — le parole sbagliate del
// correttore di Filo le dice il suo dizionario, anche dove il browser non vede l'italiano.

import { test, expect } from './fixtures/electron.mjs';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { menuDi, nelMondoDelMenu } from './helpers/menuContestuale.mjs';
import { riquadroDelSegno } from './helpers/segniDelCorrettore.mjs';

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

// #1585 — su Windows il browser lascia l'italiano al dizionario del sistema, e la pagina non lo vede: ogni
// parola le risulta giusta. Qui il browser resta senza lingue, come lì: il correttore deve vedere lo stesso l'errore.
test('col browser senza italiano, come su Windows: «andatto» ha il segno anche col modello spento, «andato» no', async ({ app, openTab, testServer }) => {
  await app.evaluate(async ({ session }) => {
    session.defaultSession.setSpellCheckerLanguages([]);
    await globalThis.SN_STORAGE.updateSettings({
      featureFlags: { spellcheck: true, spellcheckContext: false },
      correttore: { modelloErrori: false },
    });
  });
  await expect.poll(() => app.evaluate(() => globalThis.__filoDizionarioDiFilo.stato()), { timeout: 20_000 })
    .toMatchObject({ fase: 'pronto', lingue: expect.arrayContaining(['it-IT']), dove: 'thread' });

  const url = testServer.html(`<!doctype html><meta charset="utf-8"><body style="margin:0">
    <textarea id="ta" lang="it" style="display:block;width:760px;height:120px;font:22px monospace"></textarea>
  </body>`);
  const page = await openTab(url);
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
  expect(await nelMondoDelMenu(app, page, '["andatto", "andato", "perché"].map((p) => globalThis.SN_DIZIONARIO.sbagliata(p))')).toEqual([true, false, false]);
  expect(await nelMondoDelMenu(app, page, 'globalThis.SN_DIZIONARIO.proposte("andatto")')).toContain('andato');

  await page.locator('#ta').click();
  // Le parole con l'apostrofo in fondo («va'», «be'») sono giuste come senza.
  await page.keyboard.type("sono andatto al mare, poi sono andato via; di' la verità, va' via, be' ");
  const segni = page.locator('.sn-spell-overlay .sn-errore');
  await expect(segni.filter({ hasText: 'andatto' })).toHaveCount(1, { timeout: 5000 });
  await expect(segni).toHaveCount(1);

  // Il browser, da parte sua, la parola non la vede sbagliata: senza il dizionario di Filo qui non ci sarebbe nessun segno.
  // Su Mac le lingue del browser sono del sistema e non si spengono.
  if (await app.evaluate(() => process.platform) === 'darwin') return;
  await app.evaluate(({ webContents }, h) => {
    globalThis.__menuNativo = null;
    for (const wc of webContents.getAllWebContents()) {
      let qui = false;
      try { qui = new URL(wc.getURL()).host === h; } catch (_) {}
      if (qui) wc.once('context-menu', (_e, p) => { globalThis.__menuNativo = { parola: p.misspelledWord }; });
    }
  }, new URL(url).host);
  const b = await riquadroDelSegno(segni.first());
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2, { button: 'right' });
  await expect.poll(() => app.evaluate(() => globalThis.__menuNativo), { timeout: 5000 }).toEqual({ parola: '' });
});

test('anche nelle pagine di Filo il correttore usa il dizionario di Filo', async ({ app, openTab }) => {
  await app.evaluate(({ session }) => session.defaultSession.setSpellCheckerLanguages([]));
  await expect.poll(() => app.evaluate(() => globalThis.__filoDizionarioDiFilo.stato().fase), { timeout: 20_000 }).toBe('pronto');
  const pagina = await openTab('filo://credits/credits.html');
  await expect.poll(() => pagina.evaluate('["andatto", "andato"].map((p) => globalThis.SN_DIZIONARIO?.sbagliata(p))'), { timeout: 8000 })
    .toEqual([true, false]);
});
