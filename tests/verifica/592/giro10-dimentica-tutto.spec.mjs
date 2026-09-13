// Verifica #592, giro 10 — il bottone «Dimentica tutto» del pannello nuovo.
//
// Il pannello della memoria (Preferenze → Memoria di Filo) è nato al giro 6 ed è
// la barriera su cui questo lavoro appoggia tutta la quarta cautela del
// feedback: una lezione entra senza conferma perché l'utente la rilegge e la
// toglie. Ogni gruppo del pannello però ha anche un «Dimentica tutto» che butta
// via il gruppo INTERO al primo clic: niente conferma, niente modo di tornare
// indietro. La stessa cancellazione chiesta a Filo a voce è livello 3 e gli fa
// digitare «conferma».
//
// E il bottone sta nella stessa colonna del × della prima riga, una decina di
// pixel più su: chi sbaglia mira mentre toglie UNA riga cancella il profilo.

import { test, expect } from '../../fixtures/electron.mjs';

const PREFERENZE = 'filo://preferences/preferences.html';

const profilo = (app) => app.evaluate(async () => (await globalThis.SN_FILO_MEMORY.getMemory()).PROFILO || '');

async function apri(openTab) {
  const page = await openTab(PREFERENZE);
  await page.waitForSelector('#memoryBox', { timeout: 20_000 });
  return page;
}

test('«Dimentica tutto» del profilo chiede conferma prima di buttare via mesi di memoria', async ({ app, openTab }) => {
  await app.evaluate(async () => {
    await globalThis.SN_FILO_MEMORY.setMemory({
      PROFILO: 'Si chiama Marta\nVive a Lisbona\nLavora in banca\nHa due figli',
      PREFERENZE: 'Risposte corte',
    });
  });

  const page = await apri(openTab);
  const gruppo = page.locator('.mem-box > div', { hasText: 'Chi sei' }).first();
  await gruppo.locator('.mem-clear').click();
  await page.waitForTimeout(800);

  expect(await profilo(app), 'un clic solo, senza chiedere niente, ha cancellato tutto il profilo')
    .toContain('Marta');
});

test('il × di una riga e il «Dimentica tutto» del gruppo non stanno uno sopra l\'altro', async ({ app, openTab }) => {
  await app.evaluate(async () => {
    await globalThis.SN_FILO_MEMORY.setMemory({ PROFILO: 'Si chiama Marta\nVive a Lisbona\nLavora in banca' });
  });

  const page = await apri(openTab);
  const gruppo = page.locator('.mem-box > div', { hasText: 'Chi sei' }).first();
  const tutto = await gruppo.locator('.mem-clear').boundingBox();
  const x = await gruppo.locator('.mem-line').first().locator('.mem-forget').boundingBox();

  const sovrapposizione = Math.min(tutto.x + tutto.width, x.x + x.width) - Math.max(tutto.x, x.x);
  const distanza = x.y - (tutto.y + tutto.height);
  const incollati = sovrapposizione > 0 && distanza < 16;
  expect(incollati, 'il bottone che cancella tutto il gruppo sta a ridosso del × che toglie una riga sola: '
    + `sovrapposti di ${Math.round(sovrapposizione)}px e distanti ${Math.round(distanza)}px`).toBe(false);
});
