// VERIFICA #496 — giro 25. Il pannello di dettaglio aperto sotto un riquadro
// resta aperto quando il riquadro smette di potersi aprire: senza la scritta
// «chiudi» e senza essere un pulsante, non c'è più nessuna via per richiuderlo.
import { test, expect } from '../../fixtures/electron.mjs';
import { URL_GESTIONE, giorniFa as g, segnalazione as fb, apriStatistiche } from './giro17-aiuto-comune.mjs';

test('#496 giro25 — il dettaglio del controllo di sicurezza si può richiudere anche cambiando finestra', async ({ openTab }) => {
  const page = await openTab(URL_GESTIONE);
  const feedbacks = [
    fb({ _id: 'a1', seq: 1, createdAt: g(20), status: 'done', livelli: { l4: { esito: 'pass' } } }),
  ];
  const workerLog = [
    { role: 'fixer', startedAt: g(20), num: '1' },
    { role: 'verifier', startedAt: g(20), num: '1' },
  ];
  await apriStatistiche(page, { feedbacks, workerLog }, feedbacks);
  await page.locator('[data-fs-range="tutto"]').click();

  // Il riquadro si apre: sotto compare la sua ripartizione.
  await page.locator('[data-fs-tile="audit"]').click();
  await expect(page.locator('#mgFsAltro .mg-fs-detail')).toBeVisible();

  // Si cambia finestra: in «Oggi» non c'è nessun controllo di sicurezza.
  await page.locator('[data-fs-range="oggi"]').click();
  const dettaglio = page.locator('#mgFsAltro .mg-fs-detail');
  const testo = (await dettaglio.count()) ? await dettaglio.innerText() : '(niente)';
  const apribile = await page.locator('[data-fs-tile="audit"]').count();
  console.log('DETTAGLIO DOPO IL CAMBIO: %j | riquadro apribile: %d', testo, apribile);

  // Se il pannello è ancora lì, deve esistere una via per richiuderlo.
  if (await dettaglio.count()) {
    expect(apribile, 'il riquadro che ha aperto il pannello deve restare cliccabile per richiuderlo').toBeGreaterThan(0);
  }
});

test('#496 giro25 — lo stesso dal filtro per creatore', async ({ openTab }) => {
  const page = await openTab(URL_GESTIONE);
  const feedbacks = [
    fb({ _id: 'a1', seq: 1, createdAt: g(2), status: 'done', clientId: 'tester@example.com', livelli: { l4: { esito: 'pass' } } }),
  ];
  const workerLog = [
    { role: 'fixer', startedAt: g(2), num: '1' },
    { role: 'verifier', startedAt: g(2), num: '1' },
  ];
  await apriStatistiche(page, { feedbacks, workerLog }, feedbacks);
  await page.locator('[data-fs-range="tutto"]').click();
  await page.locator('[data-fs-tile="audit"]').click();
  await expect(page.locator('#mgFsAltro .mg-fs-detail')).toBeVisible();
  await page.locator('[data-fs-creator="__routine"]').click();
  const dettaglio = page.locator('#mgFsAltro .mg-fs-detail');
  console.log('FILTRO: dettaglio=%d apribile=%d', await dettaglio.count(), await page.locator('[data-fs-tile="audit"]').count());
  if (await dettaglio.count()) {
    expect(await page.locator('[data-fs-tile="audit"]').count()).toBeGreaterThan(0);
  }
});
