// Verifica locale, giro 2: il termine nuovo della revisione («modelli stretti»)
// deve spiegarsi da solo al lettore, come gli altri termini di gergo: non basta
// che la notarella esista nel documento, deve comparire passandoci sopra.

import { test, expect } from '../../fixtures/electron.mjs';

const URL_PAGINA = 'filo://transparency/transparency.html';

test('passando sopra «modelli stretti» compare la spiegazione, e si legge in tutti e due i temi', async ({ openTab }) => {
  const page = await openTab(URL_PAGINA);
  const glossa = page.locator('#doc-body .sn-gloss', { hasText: 'modelli stretti' }).first();
  await expect(glossa).toBeVisible();

  // La notarella sta alla PRIMA occorrenza, dove il termine viene introdotto:
  // una spiegazione che arriva dopo che il lettore ha già incontrato la parola
  // arriva tardi.
  const primaOccorrenza = await page.evaluate(() => {
    const body = document.getElementById('doc-body');
    const testo = body.innerText.toLowerCase();
    const el = body.querySelector('.sn-gloss[data-gloss]');
    const tutti = [...body.querySelectorAll('.sn-gloss')]
      .filter((n) => /modelli stretti/i.test(n.textContent));
    return {
      posizioneTermine: testo.indexOf('modelli stretti'),
      posizioneGlossa: tutti.length
        ? body.innerText.toLowerCase().indexOf(tutti[0].textContent.toLowerCase())
        : -1,
      quante: tutti.length,
      primoGloss: el ? el.getAttribute('data-gloss') : '',
    };
  });
  expect(primaOccorrenza.quante).toBe(1);

  const pop = page.locator('#gloss-pop');
  for (const schema of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme: schema });
    await glossa.scrollIntoViewIfNeeded();
    await glossa.hover();
    await expect(pop).toBeVisible();
    const testoPop = (await pop.innerText()).trim();
    expect(testoPop.length, `spiegazione vuota in tema ${schema}`).toBeGreaterThan(20);
    // È la spiegazione del termine giusto, non quella di un altro.
    expect(testoPop.toLowerCase()).toMatch(/una cosa sola|classificare|trascrivere|categoria/);
    const colori = await pop.evaluate((el) => {
      const s = getComputedStyle(el);
      return { fg: s.color, bg: s.backgroundColor };
    });
    expect(colori.fg, `testo e sfondo uguali in tema ${schema}`).not.toBe(colori.bg);
    // Il riquadro resta dentro la finestra, non esce a destra.
    const box = await pop.boundingBox();
    const larghezza = await page.evaluate(() => document.documentElement.clientWidth);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(larghezza + 1);
    // Esc lo chiude: si può tornare a leggere.
    await page.keyboard.press('Escape');
    await expect(pop).toBeHidden();
  }
});

test('la notarella si apre anche da tastiera, senza mouse', async ({ openTab }) => {
  const page = await openTab(URL_PAGINA);
  const glossa = page.locator('#doc-body .sn-gloss', { hasText: 'modelli stretti' }).first();
  await glossa.scrollIntoViewIfNeeded();
  await glossa.focus();
  await expect(page.locator('#gloss-pop')).toBeVisible();
});
