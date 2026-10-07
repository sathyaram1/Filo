// VERIFICA #496 — giro 17. «Quanti di questi sono fail».
//
// La segnalazione chiedeva, oltre alla media dei giri, «quanti di questi sono
// fail e quanti migliorabile». La scheda risponde con la fetta «Fermato:
// decidi tu» e con la riga «fermati: il giro automatico non ce l'ha fatta e
// aspettano te».
//
// Un lavoro può fermarsi e passare la palla all'owner per SEI motivi diversi
// (FEEDBACK-STATES.md §5, e la dashboard li riconosce tutti e sei uno per uno
// in `judgesNote`): bilancio delle correzioni esaurito, rilievo che chiede una
// decisione, fix bocciato dal controllo di sicurezza, ramo fermo al cancello
// di fusione, lavorazione arenata troppe volte, routine che ha domande.
//
// Qui si prova che la scheda ne conta solo una parte, e che gli altri finiscono
// nella riga che dice l'opposto: «ancora in mezzo al giro: quanto costeranno
// non si sa ancora».

import { test, expect } from '../../fixtures/electron.mjs';
import { URL_GESTIONE, giorniFa, segnalazione, apriStatistiche, testoDi } from './giro17-aiuto-comune.mjs';

// I sei modi in cui il giro automatico si ferma e la palla torna all'owner.
const FERMATI = [
  ['bilancio delle correzioni esaurito', { status: 'design', statusReason: 'loop' }],
  ['rilievo che chiede una decisione',   { status: 'design', statusReason: 'decisione' }],
  ['bocciato dalla sicurezza',           { status: 'design', statusReason: 'secaudit', livelli: { l4: { esito: 'fail' } } }],
  ['fermo al cancello di fusione',       { status: 'design', statusReason: 'l5' }],
  ['lavorazione arenata',                { status: 'design', statusReason: 'arenato' }],
  ['la routine ha domande',              { status: 'design', statusReason: 'clarify' }],
];

test('#496 giro17 — i lavori fermi che aspettano l\'owner finiscono fra quelli «ancora in mezzo al giro»', async ({ openTab }) => {
  const page = await openTab(URL_GESTIONE);

  const feedbacks = FERMATI.map(([, stato], i) =>
    segnalazione(Object.assign({ seq: 900 + i, createdAt: giorniFa(2) }, stato)));
  // Su ognuno il verificatore è partito una volta: sono lavorazioni vere,
  // non segnalazioni appena arrivate.
  const workerLog = FERMATI.map((_, i) => ({ role: 'verifier', startedAt: giorniFa(1), num: String(900 + i) }));

  await apriStatistiche(page, { feedbacks, workerLog }, feedbacks);
  await page.locator('[data-fs-range="7g"]').click();

  // Prima: la dashboard SA che tutti e sei aspettano l'owner. È la frase che
  // mostra nel dettaglio di ciascuno, accanto ai pallini dei giudici.
  const frasi = await page.evaluate((list) => list.map((f) => {
    const n = window.SN_MANAGE_REVIEW.judgesNote(f);
    return n ? n.text : '';
  }), feedbacks);
  for (const frase of frasi) {
    expect(frase, 'la dashboard non riconosce questo caso come «aspetta l\'owner»').not.toBe('');
  }

  // Quello che l'owner deve poter credere: il numero dei fermati li conta
  // tutti e sei, e nessuno di loro viene dato per «ancora in mezzo al giro».
  const fermati = Number(await page.locator('[data-fs-esito="fermati"] b').innerText());
  const aperti  = Number(await page.locator('[data-fs-esito="aperti"] b').innerText());

  expect(aperti, `${aperti} lavori fermi in attesa dell'owner vengono dati per ancora in lavorazione`).toBe(0);
  expect(fermati, 'il conto dei lavori fermi non li conta tutti').toBe(FERMATI.length);

  // E la fetta della torta dice la stessa cosa.
  const legenda = await testoDi(page, '#mgFsLegend');
  expect(legenda, `la torta non mette i ${FERMATI.length} fermi nella loro fetta`)
    .toContain(`Fermato: decidi tu | ${FERMATI.length}`);
});

// Ogni motivo, uno alla volta: così la correzione vede QUALE manca.
for (const [nome, stato] of FERMATI) {
  test(`#496 giro17 — un lavoro fermo perché «${nome}» va contato fra i fermati`, async ({ openTab }) => {
    const page = await openTab(URL_GESTIONE);
    const fb = segnalazione(Object.assign({ seq: 910, createdAt: giorniFa(2) }, stato));
    await apriStatistiche(page, {
      feedbacks: [fb],
      workerLog: [{ role: 'verifier', startedAt: giorniFa(1), num: '910' }],
    }, [fb]);
    await page.locator('[data-fs-range="7g"]').click();

    expect(Number(await page.locator('[data-fs-esito="fermati"] b').innerText()),
      `«${nome}» non viene contato fra i lavori fermi`).toBe(1);
    expect(Number(await page.locator('[data-fs-esito="aperti"] b').innerText()),
      `«${nome}» viene dato per ancora in lavorazione`).toBe(0);
  });
}
