// VERIFICA #496 — giro 19. I riquadri che si aprono solo col mouse.
//
// La regola che questo stesso lavoro ha scritto nella raccolta dei pattern
// («Un numero si apre su cosa ha contato») dice: col clic, con Invio o Spazio
// se non è già un pulsante, e col tasto destro. I riquadri che si ESPANDONO
// sono veri pulsanti e rispondono a tutte e tre le strade; quelli che aprono
// l'elenco delle segnalazioni («Esplorazioni lanciate», «Attesa prima che tu
// lo prendessi in mano», «Durata di una lavorazione», «Lavorazioni arenate»)
// nascono come riquadri muti: si cliccano col mouse, rispondono al tasto
// destro, ma non si possono nemmeno mettere a fuoco — quindi da tastiera quel
// numero non si apre su niente.
//
// Senza il fix il primo controllo è rosso: il riquadro non prende il fuoco.

import { test, expect } from '../../fixtures/electron.mjs';
import { URL_GESTIONE, giorniFa as g, segnalazione as fb, apriStatistiche } from './giro17-aiuto-comune.mjs';

// Una segnalazione presa in mano e lavorata in due momenti: così «Attesa» e
// «Durata» hanno qualcosa da contare, e l'esploratore ha un ritrovamento.
const DATI = {
  feedbacks: [
    fb({ _id: 'k19-a', seq: 210, status: 'done', createdAt: g(6), reviewedAt: g(5) }),
    fb({ _id: 'k19-b', seq: 211, status: 'todo', createdAt: g(4), clientId: 'routine:prober' }),
  ],
  workerLog: [
    { role: 'new-work', startedAt: g(4), num: '210' },
    { role: 'verifier', startedAt: g(3), num: '210' },
    { role: 'prober', startedAt: g(4) },
  ],
};

test('#496 giro19 — i riquadri che aprono un elenco si aprono anche da tastiera', async ({ openTab }) => {
  const page = await openTab(URL_GESTIONE);
  await apriStatistiche(page, DATI, DATI.feedbacks);

  // Per le esplorazioni ad aprirsi è la riga piccola, l'unica delle due a
  // contare segnalazioni: il numero grande conta partenze, che segnalazioni non
  // sono. La promessa da mantenere da tastiera è la sua (giro 21).
  for (const id of ['proberTrovate', 'attesa', 'durata']) {
    const riquadro = page.locator(`[data-fs-id="${id}"]`);
    // Col mouse si apre: è questa la promessa da mantenere anche da tastiera.
    await riquadro.click();
    await expect(page.locator('#mgFsDrill'), `«${id}» non si apre nemmeno col mouse`).toBeVisible();
    await page.locator('#mgFsDrillClose').click();
    await expect(page.locator('#mgFsDrill')).toBeHidden();

    const fuoco = await page.evaluate((i) => {
      const el = document.querySelector(`[data-fs-id="${i}"]`);
      el.focus();
      return document.activeElement === el;
    }, id);
    expect(fuoco, `«${id}» non si può nemmeno mettere a fuoco da tastiera`).toBe(true);

    await page.keyboard.press('Enter');
    await expect(page.locator('#mgFsDrill'), `«${id}»: Invio non apre l'elenco`).toBeVisible();
    await page.locator('#mgFsDrillClose').click();

    await page.evaluate((i) => document.querySelector(`[data-fs-id="${i}"]`).focus(), id);
    await page.keyboard.press(' ');
    await expect(page.locator('#mgFsDrill'), `«${id}»: Spazio non apre l'elenco`).toBeVisible();
    await page.locator('#mgFsDrillClose').click();
  }
});
