// Verifica #582, giro 3 — la TERZA porta della stessa causa.
//
// La causa, trovata al giro 1 e ripresa al giro 2: dentro una segnalazione ci
// sono indirizzi che NON li sceglie Filo. Li scrive chi manda la segnalazione,
// e una segnalazione la manda chiunque, anche senza account e senza avere Filo
// installato (le regole del database controllano la forma dei campi, non dove
// puntano). Il giro 1 ha chiuso la porta della credenziale dell'owner; il giro
// 2 ha chiuso la pillola dell'allegato, che diventava un collegamento verso
// l'indirizzo scritto da chi mandava.
//
// Nella stessa scheda, due righe sopra la pillola, c'è l'indirizzo della PAGINA
// da cui la segnalazione è partita. Quello è ancora un collegamento cliccabile
// verso un indirizzo scelto da chi manda — e qui c'è qualcosa in più: la scritta
// del collegamento è l'indirizzo TAGLIATO agli 80 caratteri, senza puntini né
// altro segno che dica che continua. Un indirizzo costruito apposta mostra
// ottanta caratteri d'aspetto innocuo e porta altrove.
//
// Cosa deve restare vero: o il collegamento non c'è, o quello che si legge dice
// dove si va davvero (il posto vero compare nella scritta, o c'è un segno che
// l'indirizzo è tagliato).

import { test, expect } from '../../fixtures/electron.mjs';

const FEEDBACK_URL = 'filo://feedback/feedback.html';

// I primi 80 caratteri sono esattamente «https://filo.app/guida/…-2026a»: quello
// che si legge. Il posto vero è quello dopo la chiocciola.
const ESCA = 'https://filo.app/guida/aggiornamento-obbligatorio-per-i-tester-di-settembre-2026a@sito-di-un-estraneo.invalid/accedi';
const VERO_POSTO = 'sito-di-un-estraneo.invalid';

test('l’indirizzo della pagina scritto da chi manda non diventa un collegamento che mente sulla destinazione', async ({ openTab }) => {
  const page = await openTab(FEEDBACK_URL);

  await page.evaluate((url) => {
    window.SN_FEEDBACK.list = async () => [{
      _id: 'esca-pagina-582',
      status: 'open',
      text: 'la pagina non si apre',
      url,
      images: [],
      files: [],
      createdAt: new Date().toISOString(),
    }];
  }, ESCA);

  await page.locator('#refresh').click();
  await expect(page.locator('.fb-card').first()).toBeVisible({ timeout: 10_000 });
  await page.screenshot({ path: 'tests/.shots/582-giro3-esca-pagina.png' });

  // Il collegamento che porta fuori, se c'è.
  const link = page.locator(`.fb-meta a[href*="${VERO_POSTO}"]`);
  const quanti = await link.count();
  if (quanti === 0) return; // nessun collegamento: la porta è chiusa.

  const scritta = (await link.first().textContent()) || '';
  expect(
    scritta,
    `il riquadro dei feedback offre un collegamento verso «${VERO_POSTO}» mostrando la scritta «${scritta}», che quel posto non lo nomina e non dice nemmeno di essere tagliata`,
  ).toContain(VERO_POSTO);
});
