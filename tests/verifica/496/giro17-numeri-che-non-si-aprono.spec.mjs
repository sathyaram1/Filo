// VERIFICA #496 — giro 17. I numeri che restano chiusi.
//
// Questo stesso lavoro ha scritto la regola «Un numero si apre su cosa ha
// contato» (PATTERNS.md): ogni superficie che mostra un conteggio si apre
// sulle righe che ha contato, col clic, da tastiera e col tasto destro.
//
// I quattro riquadri grandi la rispettano. Non la rispettano i numeri scritti
// SOTTO i riquadri, che contano segnalazioni esattamente come loro: le
// segnalazioni trovate dall'esploratore, i controlli di sicurezza passati,
// bocciati e saltati, le segnalazioni arenate, quelle su cui è calcolata la
// mediana dell'attesa.

import { test, expect } from '../../fixtures/electron.mjs';
import { URL_GESTIONE, giorniFa, segnalazione, apriStatistiche } from './giro17-aiuto-comune.mjs';

/** Le voci del menu del tasto destro sopra un pezzo della scheda. */
async function menuSu(page, selettore) {
  await page.locator(selettore).first().click({ button: 'right', force: true });
  await page.waitForTimeout(150);
  const menu = page.locator('.mg-ctxmenu');
  const voci = (await menu.count()) ? await menu.allInnerTexts() : [];
  await page.keyboard.press('Escape');
  await page.waitForTimeout(80);
  return voci.join(' ').replace(/\s*\n\s*/g, ' / ');
}

test('#496 giro17 — i numeri sotto i riquadri non si aprono su cosa hanno contato', async ({ openTab }) => {
  const page = await openTab(URL_GESTIONE);

  const feedbacks = [
    // Due ritrovamenti dell'esploratore.
    segnalazione({ seq: 980, clientId: 'agent:prober', createdAt: giorniFa(2) }),
    segnalazione({ seq: 981, clientId: 'agent:prober', createdAt: giorniFa(2) }),
    // Un lavoro col controllo di sicurezza passato, che si è arenato due volte
    // e che l'owner aveva preso in mano il giorno dopo l'arrivo.
    segnalazione({
      seq: 982, status: 'done', createdAt: giorniFa(4),
      reviewedAt: giorniFa(3), stalls: 2, livelli: { l4: { esito: 'pass' } },
    }),
  ];
  const workerLog = [
    { role: 'prober', startedAt: giorniFa(2) },
    // Due passaggi sullo stesso numero: così la lavorazione ha una durata.
    { role: 'new-work', startedAt: giorniFa(3), num: '982' },
    { role: 'verifier', startedAt: giorniFa(1), num: '982' },
  ];
  await apriStatistiche(page, { feedbacks, workerLog }, feedbacks);
  await page.locator('[data-fs-range="7g"]').click();

  // Prima: i numeri ci sono davvero, altrimenti la prova non proverebbe niente.
  await expect(page.locator('[data-fs-id="proberTrovate"]')).toContainText('2 segnalazioni dall\'esploratore');
  await expect(page.locator('[data-fs-id="audit"]')).toContainText('bocciati');
  await expect(page.locator('[data-fs-id="arenati"]')).toContainText('su 1 segnalazion');
  await expect(page.locator('[data-fs-id="attesa"]')).toContainText('mediana su 1');

  // Quello che l'owner deve poter fare: da ognuno di questi numeri arrivare
  // alle segnalazioni che ci stanno dietro, come dagli altri.
  const casi = [
    // La riga piccola del riquadro delle esplorazioni: è lei a contare
    // segnalazioni, mentre il numero grande conta partenze (giro 21).
    ['[data-fs-id="proberTrovate"]',  'le 2 segnalazioni trovate dall\'esploratore'],
    ['[data-fs-id="arenati"]', 'la segnalazione arenata'],
    ['[data-fs-id="attesa"]',  'la segnalazione presa in mano'],
    ['[data-fs-id="durata"]',  'la lavorazione misurata'],
  ];
  for (const [sel, cosa] of casi) {
    const voci = await menuSu(page, sel);
    expect(voci, `dal numero non si arriva a ${cosa}`).toMatch(/Mostra/);
  }

  // Il riquadro del controllo di sicurezza porta TRE numeri (passati, bocciati,
  // saltati): si apre sulla sua ripartizione, e da lì ogni riga porta alle
  // segnalazioni che ha contato, come le altre ripartizioni della scheda.
  await page.locator('[data-fs-id="audit"]').click();
  const riga = page.locator('[data-fs-bargroup="audit"][data-fs-bar="pass"]');
  await expect(riga, 'il riquadro del controllo di sicurezza non si apre su niente').toHaveCount(1);
  await riga.click();
  await expect(page.locator('#mgFsDrillTitle')).toContainText('sicurezza');
  await expect(page.locator('#mgFsDrill [data-fs-open]')).toHaveCount(1);
});

test('#496 giro17 — le pasticche della finestra e del creatore non hanno un menu proprio', async ({ openTab }) => {
  const page = await openTab(URL_GESTIONE);
  const fb = segnalazione({ seq: 990, createdAt: giorniFa(1) });
  await apriStatistiche(page, { feedbacks: [fb], workerLog: [] }, [fb]);

  // Il tasto destro è «voglio fare qualcosa qui»: su una pasticca che sceglie
  // la finestra o un mittente c'è eccome qualcosa da fare (sceglierla da sola,
  // toglierla, copiare il numero che porta scritto). Oggi risponde il menu
  // generale della pagina, quello che esce anche sullo spazio bianco.
  expect(await menuSu(page, '[data-fs-range="7g"]'),
    'la pasticca della finestra non offre niente di suo').not.toBe('');
  expect(await menuSu(page, '[data-fs-creator="user"]'),
    'la pasticca del mittente non offre niente di suo').not.toBe('');
});
