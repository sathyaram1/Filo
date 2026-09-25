// VERIFICA #496 — giro 18. Il riquadro delle esplorazioni scavalca il filtro.
//
// Il filtro per creatore è una delle cose chieste per nome nella segnalazione.
// Il numero grande del riquadro («quante volte è partita l'esplorazione») non
// ha un mittente e giustamente non lo segue. La riga sotto invece CONTA
// SEGNALAZIONI — «N segnalazioni dall'esploratore» — e quelle un mittente ce
// l'hanno: con il filtro su «Utente» la riga continua a contarle, il riquadro
// resta cliccabile e si apre sulle segnalazioni dell'esploratore, cioè proprio
// quelle che il filtro dice di non star guardando.
//
// Senza il fix il primo controllo è rosso.

import { test, expect } from '../../fixtures/electron.mjs';
import { URL_GESTIONE, giorniFa as g, segnalazione as fb, apriStatistiche } from './giro17-aiuto-comune.mjs';

const DATI = {
  feedbacks: [
    fb({ _id: 'g18-p1', seq: 901, clientId: 'routine:prober', createdAt: g(3) }),
    fb({ _id: 'g18-p2', seq: 902, clientId: 'routine:prober', createdAt: g(2) }),
    fb({ _id: 'g18-u1', seq: 903, clientId: 'persona@x.it',   createdAt: g(2) }),
  ],
  workerLog: [
    { role: 'prober', startedAt: g(3), num: '' },
    { role: 'prober', startedAt: g(2), num: '' },
  ],
};

test('#496 giro18 — col filtro su «Utente» il riquadro non conta le segnalazioni dell\'esploratore', async ({ openTab }) => {
  const page = await openTab(URL_GESTIONE);
  await apriStatistiche(page, DATI, DATI.feedbacks);
  await page.locator('[data-fs-range="30g"]').click();

  const sotto = page.locator('[data-fs-id="prober"] .mg-tile-sub');
  await expect(sotto).toContainText('2 segnalazioni');

  // Filtro: solo le persone. L'esploratore è escluso da quello che sto
  // guardando, quindi le sue segnalazioni non si contano più qui.
  await page.locator('[data-fs-creator="user"]').click();
  await expect(sotto).toContainText('0 segnalazioni');
});

test('#496 giro18 — e non si apre su segnalazioni che il filtro esclude', async ({ openTab }) => {
  const page = await openTab(URL_GESTIONE);
  await apriStatistiche(page, DATI, DATI.feedbacks);
  await page.locator('[data-fs-range="30g"]').click();
  await page.locator('[data-fs-creator="user"]').click();

  const tile = page.locator('[data-fs-id="prober"]');
  if ((await tile.getAttribute('class')).includes('mg-tile--click')) {
    await tile.click();
    const righe = await page.locator('#mgFsDrillList li').allInnerTexts();
    expect(righe.join(' ')).not.toContain('#901');
    expect(righe.join(' ')).not.toContain('#902');
  }
});
