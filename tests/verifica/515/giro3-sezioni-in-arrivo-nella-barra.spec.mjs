// Verifica #515 — giro 3.
//
// I giri 1 e 2 hanno guardato il nome del documento: nel prompt e
// nell'indirizzo. Qui si guarda l'altra strada per la stessa cosa, quella che
// un utente prende per prima: la barra in cima alla pagina della trasparenza.
//
// Perché conta: la barra mostra quattro aree e tre non sono scritte. Chiesta
// nell'indirizzo, una di quelle tre ora si spiega («non è ancora scritta») e
// offre i link a quello che c'è. Cliccata nella barra, la stessa area non fa
// niente.

import { test, expect } from '../../fixtures/electron.mjs';

const PAGINA = 'filo://transparency/transparency.html';

async function areeSenzaDocumento(app) {
  return app.evaluate(() => {
    const T = globalThis.SN_TRANSPARENCY;
    const scritti = T.ids();
    return T.NAV.filter((n) => !scritti.includes(n.id)).map((n) => ({ id: n.id, label: n.label }));
  });
}

test('una sezione non ancora scritta si spiega anche quando la si clicca nella barra', async ({ app, openTab }) => {
  const mancanti = await areeSenzaDocumento(app);
  expect(mancanti.length, 'tutte le aree hanno un documento: qui non c\'è niente da provare').toBeGreaterThan(0);

  const page = await openTab(PAGINA);
  await expect(page.locator('#title')).toBeVisible({ timeout: 10_000 });

  const voce = page.locator('#nav .is-soon').first();
  await expect(voce).toBeVisible();
  await voce.click();
  await page.waitForTimeout(400);

  // Il successo dal punto di vista dell'utente: dopo il clic sa che quella
  // sezione non è scritta. È quello che ottiene chi ci arriva dall'indirizzo.
  const detto = await page.evaluate(() => ({
    titolo: (document.getElementById('title').textContent || '').trim(),
    sotto: (document.getElementById('subtitle').textContent || '').trim(),
    corpo: (document.getElementById('doc-body').textContent || '').slice(0, 400),
  }));
  expect(
    `${detto.titolo} ${detto.sotto} ${detto.corpo}`.toLowerCase(),
    `cliccando «${mancanti[0].label}» la pagina non cambia e non dice niente: resta il documento di prima`,
  ).toMatch(/non è ancora scritta|non esiste/);
});

test('le sezioni non ancora scritte si raggiungono anche senza mouse', async ({ app, openTab }) => {
  const mancanti = await areeSenzaDocumento(app);
  expect(mancanti.length).toBeGreaterThan(0);

  const page = await openTab(PAGINA);
  await expect(page.locator('#title')).toBeVisible({ timeout: 10_000 });

  // «in arrivo» oggi lo dice solo il suggerimento del mouse. Chi naviga da
  // tastiera (o da uno schermo che si tocca) non lo incontra mai, e la voce non
  // si può nemmeno selezionare.
  const guai = await page.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll('#nav .is-soon')) {
      const nome = el.textContent;
      if (el.tabIndex < 0) out.push(`${nome}: non si raggiunge con il tabulatore`);
      const dice = (el.getAttribute('aria-label') || '') + ' ' + (el.textContent || '');
      if (!/arrivo|non .*scritt/i.test(dice)) out.push(`${nome}: senza mouse niente dice che non è ancora scritta`);
    }
    return out;
  });
  expect(guai, guai.join(' | ')).toEqual([]);
});
