// Verifica locale, giro 2: il termine nuovo della revisione («modelli stretti»)
// deve spiegarsi da solo al lettore, come gli altri termini di gergo: non basta
// che la notarella esista nel documento, deve comparire passandoci sopra.
//
// Lo stato del riquadro si legge DOPO un attimo di quiete, non con un'attesa
// automatica sul riquadro: la pagina lo nasconde a ogni scorrimento, e
// un'asserzione che parte mentre lo scorrimento non è finito misura la corsa
// fra i due, non il passaggio del mouse.

import { test, expect } from '../../fixtures/electron.mjs';

const URL_PAGINA = 'filo://transparency/transparency.html';

async function passaSopra(page, termine) {
  // Il puntatore riparte sempre da lontano: fermo dov'era, il secondo giro non
  // produrrebbe nessun movimento e quindi nessun passaggio sopra da misurare.
  await page.mouse.move(5, 5);
  await page.waitForTimeout(80);
  const el = page.locator('#doc-body .sn-gloss', { hasText: termine }).first();
  await el.scrollIntoViewIfNeeded();
  await page.waitForTimeout(250);
  await el.hover();
  await page.waitForTimeout(250);
  return page.evaluate(() => {
    const pop = document.getElementById('gloss-pop');
    const s = getComputedStyle(pop);
    const r = pop.getBoundingClientRect();
    return {
      aperta: !pop.hidden,
      testo: (pop.textContent || '').trim(),
      fg: s.color,
      bg: s.backgroundColor,
      destra: Math.round(r.right),
      sinistra: Math.round(r.left),
      larghezzaFinestra: document.documentElement.clientWidth,
    };
  });
}

test('passando sopra «modelli stretti» compare la spiegazione, e si legge in tutti e due i temi', async ({ openTab }) => {
  const page = await openTab(URL_PAGINA);

  // Una sola notarella per il termine, e sta dove il termine viene introdotto.
  const quante = await page.evaluate(() => [...document.querySelectorAll('#doc-body .sn-gloss')]
    .filter((n) => /modelli stretti/i.test(n.textContent)).length);
  expect(quante).toBe(1);

  for (const schema of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme: schema });
    const stato = await passaSopra(page, 'modelli stretti');
    expect(stato.aperta, `la spiegazione non compare in tema ${schema}`).toBe(true);
    expect(stato.testo.length).toBeGreaterThan(20);
    // È la spiegazione del termine giusto, non quella di un altro.
    expect(stato.testo.toLowerCase()).toMatch(/una cosa sola|categoria|trascrivere/);
    expect(stato.fg, `testo e sfondo uguali in tema ${schema}`).not.toBe(stato.bg);
    // Il riquadro resta dentro la finestra.
    expect(stato.sinistra).toBeGreaterThanOrEqual(0);
    expect(stato.destra).toBeLessThanOrEqual(stato.larghezzaFinestra + 1);

    // Esc lo chiude: si può tornare a leggere.
    await page.keyboard.press('Escape');
    const dopoEsc = await page.evaluate(() => document.getElementById('gloss-pop').hidden);
    expect(dopoEsc).toBe(true);
  }
});

test('la notarella si apre anche da tastiera, senza mouse', async ({ openTab }) => {
  const page = await openTab(URL_PAGINA);
  const glossa = page.locator('#doc-body .sn-gloss', { hasText: 'modelli stretti' }).first();
  await glossa.scrollIntoViewIfNeeded();
  await page.waitForTimeout(250);
  await glossa.focus();
  await page.waitForTimeout(250);
  const aperta = await page.evaluate(() => !document.getElementById('gloss-pop').hidden);
  expect(aperta).toBe(true);
});
