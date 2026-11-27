// Verifica #2702 giro 1: foto della domanda in smistamento in Gestione → Domande, sul ramo e su main (esplorazione).
import { test, expect } from '../../fixtures/electron.mjs';
import { MANAGE, PRATICHE, RIFERIMENTI, domanda, mainFinto, aspettaAvvio } from '../../helpers/gestioneMainFinto.mjs';

test('foto della domanda in smistamento', async ({ app, openTab }) => {
  const DUE = domanda(54, {
    stato: 'in_smistamento', titolo: 'Soglia del giudice di priorità', legata: 'fb-813', blocca: true,
    opzioni: [
      { testo: 'Riprendi con la soglia a 2', pro: 'Riparte subito.', contro: 'Una soglia in più da tenere.', azione: { tipo: 'riprendi', feedbackId: 'fb-813' } },
      { testo: 'Archivia il lavoro', pro: 'Niente altro lavoro.', contro: 'La soglia resta com’è.', azione: { tipo: 'archivia', feedbackId: 'fb-813' } },
    ],
    consiglio: { opzione: 0, perche: 'Riparte subito.' },
  });
  await mainFinto(app, { feedbacks: PRATICHE, riferimenti: RIFERIMENTI, domande: [DUE] });
  const page = await openTab(MANAGE);
  await aspettaAvvio(page);
  await page.locator('.mg-sezione[data-sezione="domande"]').click();
  await page.locator('.mg-tab[data-tab="domande-smistamento"]').click();
  await page.locator('#mgDomandeLista .mg-domanda[data-id="D-54"]').click();
  const s = page.locator('#mgDomandaDettaglio .mg-dq[data-id="D-54"]');
  await expect(s).toBeVisible();
  await page.screenshot({ path: 'tests/.shots/verifica-2702-smistamento.png' });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.screenshot({ path: 'tests/.shots/verifica-2702-smistamento-scuro.png' });
});
