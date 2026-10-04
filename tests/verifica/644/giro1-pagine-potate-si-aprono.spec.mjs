// Verifica #644, giro 1 — le pagine potate si aprono davvero e il foglio di
// stile arriva fino in fondo.
//
// Un commento tolto male dentro un CSS non dà errore: il browser scarta la
// regola rotta e la pagina si apre storta. Qui si guarda che ogni foglio
// caricato dalla pagina abbia ancora regole dentro, che il layout non traboardi
// in orizzontale e che le regole scritte accanto ai commenti compressi
// arrivino ancora a destinazione.

import { test, expect } from '../../fixtures/electron.mjs';

const PAGINE = [
  'filo://home/home.html',
  'filo://editor/editor.html',
  'filo://preferences/preferences.html',
  'filo://downloads/downloads.html',
  'filo://archive/archive.html',
  'filo://feedback/feedback.html',
];

for (const url of PAGINE) {
  const nome = url.replace('filo://', '').replace(/[/.]/g, '-');
  test(`si apre e ha uno stile: ${url}`, async ({ openTab }) => {
    const page = await openTab(url);
    const errori = [];
    page.on('pageerror', (e) => errori.push(String(e)));
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(800);

    const stato = await page.evaluate(() => {
      const fogli = [...document.styleSheets].map((s) => {
        let n = -1;
        try { n = s.cssRules.length; } catch (_) { n = -2; }
        return { href: s.href || '(incorporato)', regole: n };
      });
      const d = document.documentElement;
      return {
        fogli,
        vuoti: fogli.filter((f) => f.regole === 0).map((f) => f.href),
        testo: (document.body.innerText || '').trim().length,
        traboccaOrizzontale: d.scrollWidth - d.clientWidth > 2,
        sfondo: getComputedStyle(document.body).backgroundColor,
      };
    });

    await page.screenshot({ path: `tests/.shots/verifica-644-${nome}.png` }).catch(() => {});

    expect(stato.fogli.length, 'la pagina non ha nemmeno un foglio di stile').toBeGreaterThan(0);
    expect(stato.vuoti, 'un foglio di stile è arrivato senza regole dentro').toEqual([]);
    expect(stato.traboccaOrizzontale, 'la pagina trabocca in orizzontale').toBe(false);
    expect(stato.sfondo, 'il corpo è rimasto senza sfondo: il tema non si applica').not.toBe('rgba(0, 0, 0, 0)');
    expect(errori, 'la pagina ha sollevato un errore').toEqual([]);
  });
}

test("l'editor: le regole scritte accanto ai commenti compressi valgono ancora", async ({ openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(800);

  const misure = await page.evaluate(() => {
    const val = (sel, prop) => {
      const el = document.querySelector(sel);
      return el ? getComputedStyle(el)[prop] : `(manca ${sel})`;
    };
    return {
      paneRelative: val('.ed-text-pane', 'position'),
      topbarAssoluta: val('.ed-topbar', 'position'),
      topbarTrasparenteAiClick: val('.ed-topbar', 'pointerEvents'),
      docAltezzaPiena: val('.ed-doc', 'minHeight'),
    };
  });

  expect(misure.paneRelative, "il pannello testo non ancora più la topbar flottante").toBe('relative');
  expect(misure.topbarAssoluta, 'la topbar non è più flottante').toBe('absolute');
  expect(misure.topbarTrasparenteAiClick, "i click sull'area vuota della topbar non passano più oltre").toBe('none');
  expect(misure.docAltezzaPiena, 'il foglio non riempie più l’area visibile: cliccare nel vuoto non dà il focus').not.toBe('0px');
});
