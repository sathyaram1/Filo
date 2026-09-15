// Verifica #582, giro 2 — la seconda porta della causa trovata al giro 1.
//
// Il giro 1 ha trovato questo: l'indirizzo di un allegato non lo sceglie Filo,
// lo scrive chi manda la segnalazione, e una segnalazione la manda chiunque,
// anche senza account e senza avere Filo installato (le regole del database
// controllano che `files` sia una lista di al più cinque elementi, non cosa
// c'è dentro). Il giro 1 ha chiuso la porta della CREDENZIALE: la dashboard
// non manda più il gettone dell'owner a un deposito che non è di Filo.
//
// La stessa causa ha una seconda porta, ed è rimasta aperta. Nel riquadro dei
// feedback, che ogni tester può aprire e che mostra le segnalazioni di tutti,
// gli allegati che non sono immagini diventano COLLEGAMENTI CLICCABILI: nome
// scelto da chi ha mandato la segnalazione, indirizzo scelto da chi ha mandato
// la segnalazione. Nessuno controlla che quell'indirizzo sia un allegato di
// Filo. Basta mandare una segnalazione qualunque con un finto allegato
// «schermata.png» che punta al proprio sito per mettere un'esca dentro una
// pagina di Filo, davanti a tutti quelli che aprono l'elenco.
//
// La dashboard dell'owner la stessa cosa la controlla già (l'allegato passa dal
// canale che pretende un indirizzo del deposito di Filo): due strade per la
// stessa cosa, e una delle due non guarda niente.
//
// Cosa deve restare vero: un allegato che non sta nel deposito di Filo non
// diventa un collegamento cliccabile.

import { test, expect } from '../../fixtures/electron.mjs';

const FEEDBACK_URL = 'filo://feedback/feedback.html';

// L'indirizzo che scriverebbe chi manda la segnalazione apposta.
const ESCA = 'https://sito-di-un-estraneo.invalid/accedi';

test('un «allegato» che punta fuori dal deposito di Filo non diventa un collegamento', async ({ openTab }) => {
  const page = await openTab(FEEDBACK_URL);

  await page.evaluate((fb) => { window.SN_FEEDBACK.list = async () => [fb]; }, {
    _id: 'esca-582',
    status: 'open',
    text: 'guarda la schermata allegata',
    images: [],
    files: [{ url: ESCA, name: 'schermata.png', type: 'image/png' }],
    createdAt: new Date().toISOString(),
  });

  await page.locator('#refresh').click();

  const link = page.locator('.fb-file').first();
  await expect(link).toBeVisible({ timeout: 10_000 });
  await page.screenshot({ path: 'tests/.shots/582-giro2-esca.png' });

  const href = (await link.getAttribute('href')) || '';
  expect(
    href,
    `il riquadro dei feedback offre un collegamento cliccabile verso un indirizzo scritto da chi ha mandato la segnalazione (nome mostrato: «${(await link.textContent()) || ''}»)`,
  ).not.toContain('sito-di-un-estraneo.invalid');
});
