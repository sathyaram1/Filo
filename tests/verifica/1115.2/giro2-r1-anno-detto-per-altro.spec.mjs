// Verifica #1115.2 giro 2, rilievo 1: un anno che la pagina dice per altro («fondata nel 1999», «est. 1999», «Menu
// autunno 2023», la data di un articolo) non è l'anno di una prenotazione: la data si legge vicino a oggi.
import { test, expect } from '../../fixtures/electron.mjs';
import { menuDi } from '../../helpers/menuContestuale.mjs';
import { riquadroDelSegno } from '../../helpers/segniDelCorrettore.mjs';

async function apri(app, openTab, testServer, html) {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.SPELLCHECK_SEMANTIC]: 'deepseek-flash', [C.ACTIONS.SPELLCHECK_CONTEXT]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
      featureFlags: { spellcheck: true, spellcheckContext: true },
    });
    const finto = async () => ({ text: '[][][][nessuno]', model: 'finto', provider: 'openrouter', costEur: 0, usage: {} });
    globalThis.SN_PROVIDERS.completeWithFallback = finto;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = finto;
  });
  const page = await testServer.openReady(openTab, html, { pubblico: true });
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
  return page;
}
const ocra = (page) => page.locator('.sn-spell-overlay .sn-suggerimento');
const errore = (page) => page.locator('.sn-spell-overlay .sn-errore');
const TA = '<textarea id="f" spellcheck="true" lang="it" style="display:block;width:700px;height:100px;font:22px sans-serif"></textarea>';
const pagina = (sopra) => `<!doctype html><meta charset="utf-8"><title>Prenota</title><body style="margin:0;padding:20px;font:16px sans-serif"><main>${sopra}<h2>Prenota un tavolo</h2>${TA}</main></body>`;

// Il giorno della settimana del 9 ottobre nella lettura vicina a oggi (quella di quest'anno o del prossimo).
const NOMI = ['domenica', 'lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato'];
function vicinoAOggi() {
  const oggi = new Date();
  const y = oggi.getFullYear();
  const c = [y - 1, y, y + 1].map((a) => new Date(a, 9, 9)).sort((p, q) => Math.abs(p - oggi) - Math.abs(q - oggi))[0];
  return { anno: c.getFullYear(), giorno: c.getDay() };
}
// Un giorno sbagliato sia vicino a oggi sia nell'anno detto dalla pagina.
function giornoSbagliato(...anni) {
  const giusti = new Set([vicinoAOggi().giorno, ...anni.map((a) => new Date(a, 9, 9).getDay())]);
  return [1, 2, 3, 4, 5, 6, 0].find((g) => !giusti.has(g));
}

for (const [nome, sopra, anno] of [
  ['fondata nel 1999', '<p>Trattoria da Mario, fondata nel 1999, cucina di casa.</p>', 1999],
  ['est. 1999', '<p>Trattoria da Mario, est. 1999</p>', 1999],
  ['menu autunno 2023', '<h2>Menu autunno 2023</h2>', 2023],
  ['data dell\'articolo', '<article><h1>Le castagne</h1><p>Pubblicato il 3 marzo 2023</p><p>Testo.</p></article>', 2023],
]) {
  test(`r1 «${nome}» sopra il modulo: la data sbagliata si spiega e si corregge con l'anno vicino a oggi`, async ({ app, openTab, testServer }) => {
    test.setTimeout(60_000);
    const page = await apri(app, openTab, testServer, pagina(sopra));
    const g = NOMI[giornoSbagliato(anno)];
    await page.locator('#f').click();
    await page.keyboard.type(`vorrei un tavolo per ${g} 9 ottobre perchè siamo in 4`);
    await expect(errore(page)).toHaveText(['perchè'], { timeout: 5000 });
    await expect(ocra(page)).toHaveText([`${g} 9 ottobre`], { timeout: 3000 });
    const b = await riquadroDelSegno(ocra(page).first());
    await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2, { button: 'right' });
    const menu = menuDi(page).pannelli;
    await expect(menu).toBeVisible({ timeout: 5000 });
    await expect(menu.locator('.sn-menu-segno')).not.toContainText(String(anno));
    await expect(menu.locator('.sn-menu-correction').first()).toHaveText(`${NOMI[vicinoAOggi().giorno]} 9 ottobre`);
  });
}

test('r1 «Menu autunno» di un anno in cui la data torna: l\'errore di quest\'anno si segna lo stesso', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  const v = vicinoAOggi();
  // L'anno più vicino a quello di oggi, prima, in cui il 9 ottobre cade in un altro giorno della settimana.
  let anno = v.anno - 1;
  while (new Date(anno, 9, 9).getDay() === v.giorno) anno--;
  const g = NOMI[new Date(anno, 9, 9).getDay()];
  const page = await apri(app, openTab, testServer, pagina(`<h2>Menu autunno ${anno}</h2>`));
  await page.locator('#f').click();
  await page.keyboard.type(`vorrei un tavolo per ${g} 9 ottobre perchè siamo in 4`);
  await expect(errore(page)).toHaveText(['perchè'], { timeout: 5000 });
  await expect(ocra(page)).toHaveText([`${g} 9 ottobre`], { timeout: 3000 });
});
