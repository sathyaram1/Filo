// VERIFICA #496 — giro 17. Pezzi comuni alle prove del giro.
//
// La scheda «Statistiche feedback» vive nella pagina di gestione e si nutre di
// due sorgenti (le segnalazioni e il registro delle esecuzioni delle routine).
// Negli spec le due letture vere non si possono fare — non c'è né una sessione
// da proprietario né il database — quindi si passano i dati dalla porta di
// prova e da lì in poi gira il codice vero: conti, riquadri, torta, grafico.

import { expect } from '../../fixtures/electron.mjs';

export const URL_GESTIONE = 'filo://manage/manage.html';

const GIORNO = 24 * 60 * 60 * 1000;

/** Un istante di `n` giorni fa, in ISO. */
export const giorniFa = (n) => new Date(Date.now() - n * GIORNO).toISOString();

/** Una segnalazione finta, con i campi che la scheda legge davvero. */
export function segnalazione(over = {}) {
  return Object.assign({
    _id: 'g17-' + Math.random().toString(36).slice(2),
    seq: 1,
    subSeq: 0,
    clientId: 'tester@example.com',
    createdAt: giorniFa(1),
    status: 'todo',
    text: 'testo',
    name: 'titolo',
    images: [],
  }, over);
}

/**
 * Apre la pagina di gestione da proprietario, va sulla scheda delle
 * statistiche e le consegna i dati.
 * `lista` è quello che vede la colonna di sinistra (le più recenti); se non si
 * passa, la colonna resta vuota e l'elenco dietro un numero lo dice.
 */
export async function apriStatistiche(page, dati, lista) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady && window.filo);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.evaluate(() => window.__mgTest.setAdmin(true));
  await page.evaluate((l) => window.__mgTest.setData(l || []), lista || []);
  await page.locator('.mg-tab[data-tab="fbstats"]').click();
  await page.evaluate((d) => window.__mgTest.setFsData(d), dati);
  await expect(page.locator('#mgFsBody')).toBeVisible();
}

/** Il testo di un pezzo della scheda, su una riga sola. */
export const testoDi = async (page, sel) =>
  (await page.locator(sel).innerText()).replace(/\s*\n\s*/g, ' | ').trim();
