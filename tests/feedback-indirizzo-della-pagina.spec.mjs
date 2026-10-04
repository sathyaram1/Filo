// Nell'elenco dei feedback, in cima a ogni scheda, c'è l'indirizzo della pagina
// da cui la segnalazione è partita, ed è un collegamento: chi la guarda lo apre,
// perché è il posto dove il problema è successo. Quell'indirizzo però non lo
// sceglie Filo — sta dentro la segnalazione, e una segnalazione la manda
// chiunque, anche senza account e senza avere Filo installato.
//
// Trovato nella verifica #582, giro 3. La scritta del collegamento erano i primi
// 80 caratteri dell'indirizzo, tagliati senza nemmeno un puntino: chi lo
// costruiva apposta sceglieva cosa si leggeva, e si finiva altrove. L'elenco lo
// apre ogni tester dal menu del tasto destro e dall'elenco delle app, e mostra
// le segnalazioni di tutti: l'esca la vedevano tutti.
//
// Qui si prova la metà che vive nella pagina: il collegamento c'è ancora (serve)
// e la scritta nomina il posto vero. La forma della scritta, caso per caso, la
// tiene ferma tests/unit/feedbackLinkLabel.test.mjs.

import { test, expect } from './fixtures/electron.mjs';

const FEEDBACK_URL = 'filo://feedback/feedback.html';
const VERO_POSTO = 'sito-di-un-estraneo.invalid';

// Le due forme che funzionano davvero. La chiocciola messa DOPO la prima barra
// non è un'esca: finisce nel percorso e il sito resta quello davanti.
const SOTTODOMINI = `https://filo.app.guida.aggiornamento-obbligatorio.per-i-tester.settembre-2026.${VERO_POSTO}/accedi`;
const CHIOCCIOLA = `https://filo.app-aggiornamento-obbligatorio-per-i-tester-di-settembre-2026-okay@${VERO_POSTO}/accedi`;
const NORMALE = 'https://esempio.it/pagina-che-non-va';

async function scheda(page, url) {
  await page.evaluate((u) => {
    window.SN_FEEDBACK.list = async () => [{
      _id: 'indirizzo-582',
      status: 'open',
      text: 'la pagina non si apre',
      url: u,
      images: [],
      files: [],
      createdAt: new Date().toISOString(),
    }];
  }, url);
  await page.locator('#refresh').click();
  await expect(page.locator('.fb-card').first()).toBeVisible({ timeout: 10_000 });
  return page.locator('.fb-meta a[href^="http"]').first();
}

test('un indirizzo normale si legge per intero e si apre', async ({ openTab }) => {
  const page = await openTab(FEEDBACK_URL);
  const link = await scheda(page, NORMALE);
  await expect(link).toHaveText('esempio.it/pagina-che-non-va');
  expect(await link.getAttribute('href')).toBe(NORMALE);
});

test('l’esca fatta di sottodomini: la scritta nomina il sito vero', async ({ openTab }) => {
  const page = await openTab(FEEDBACK_URL);
  const link = await scheda(page, SOTTODOMINI);
  const scritta = (await link.textContent()) || '';
  expect(scritta, `la scritta non nomina «${VERO_POSTO}»: ${scritta}`).toContain(VERO_POSTO);
  // Il collegamento resta: quella pagina serve a chi guarda la segnalazione.
  expect(await link.getAttribute('href')).toBe(SOTTODOMINI);
  // E l'indirizzo intero resta leggibile passandoci sopra.
  expect(await link.getAttribute('title')).toBe(SOTTODOMINI);
});

test('l’esca fatta di credenziali: quelle non si mostrano, il sito vero sì', async ({ openTab }) => {
  const page = await openTab(FEEDBACK_URL);
  const link = await scheda(page, CHIOCCIOLA);
  const scritta = (await link.textContent()) || '';
  expect(scritta, `la scritta mostra ancora l’esca: ${scritta}`).not.toContain('filo.app');
  expect(scritta).toContain(VERO_POSTO);
});
