// #2177 — Le prove col modello a copione non toccano la rete vera: la chiave finta non va a OpenRouter, i cambi non
// si chiedono a frankfurter.dev, così un turno dura uguale in GitHub e nel contenitore. Regola in
// src/main/test-servizi-chiusi.js; la accende tests/helpers/copione.mjs.

import { test, expect } from './fixtures/electron.mjs';
import { configureModel, copione, ripristina } from './helpers/copione.mjs';

// Le richieste che il fetch del main manda davvero in rete, lette sotto ogni finto: il canale di undici le vede
// partire anche quando nessuno ne aspetta la risposta.
async function spiaLaRete(app) {
  await app.evaluate(() => {
    globalThis.__usciteVere = [];
    const dc = process.mainModule.require('node:diagnostics_channel');
    globalThis.__spiaRete = ({ request }) => { globalThis.__usciteVere.push(`${request.origin}${request.path}`); };
    dc.subscribe('undici:request:create', globalThis.__spiaRete);
  });
}
const usciteVere = (app) => app.evaluate(() => globalThis.__usciteVere.filter((u) => !/^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:|\/)/.test(u)));

test('un turno a copione con uno strumento arriva alla risposta senza che il main parli con la rete', async ({ app, shell, openTab }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  await spiaLaRete(app);
  await configureModel(app);
  await copione(app, [
    { strumenti: [{ id: 't1', name: 'TIMER', arguments: '{"secondi":120,"etichetta":"Pasta"}' }] },
    { testo: 'Timer della pasta messo.' },
  ]);
  try {
    const page = await openTab('filo://newtab/');
    await page.locator('#input').fill('metti un timer di due minuti per la pasta');
    await page.locator('#input').press('Enter');
    await expect(page.locator('.dash-bubble-filo', { hasText: 'Timer della pasta messo' })).toBeVisible({ timeout: 15_000 });
    // Quello che parte a turno finito (titolo della chat, memoria, costi) ha il tempo di provarci.
    await page.waitForTimeout(3_000);
    expect(await usciteVere(app)).toEqual([]);
  } finally {
    await ripristina(app);
  }
});
