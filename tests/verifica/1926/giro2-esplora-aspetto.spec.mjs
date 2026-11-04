// Esplorazione della verifica #1926 giro 2: aspetto in chiaro e scuro di parola nata, blocco fidati e segno di sessione.
import { test, expect } from '../../fixtures/electron.mjs';
import { apriScheda } from '../../helpers/gestione.mjs';
import { MANAGE, PRATICHE, RIFERIMENTI, fb, domanda, mainFinto, aspettaAvvio } from '../../helpers/gestioneMainFinto.mjs';

const OUT = 'tests/.shots/verifica-1926';

for (const tema of ['light', 'dark']) {
  test(`aspetto ${tema}`, async ({ app, openTab }) => {
    const opzioni = [
      { testo: 'Caldo', pro: 'È Filo.', contro: 'Meno contrasto.', azione: { tipo: 'riprendi', feedbackId: 'fb-813' } },
      { testo: 'Freddo', pro: 'Più contrasto.', contro: 'Non è Filo.', azione: { tipo: 'riprendi', feedbackId: 'fb-813' } },
    ];
    const IERI = Date.now() - 20 * 3600 * 1000;
    const d = domanda(72, { stato: 'chiusa', titolo: 'Caldo o freddo?', opzioni,
      esito: { ok: true, azione: opzioni[0].azione, applicataIl: IERI }, annullabile: true,
      registrataDa: 'sessione', rispostaDaSessione: { il: IERI, scelta: 0 } });
    await mainFinto(app, { feedbacks: [...PRATICHE, fb({ seq: 951, status: 'unlabeled', name: 'Da guardare' }),
      fb({ seq: 952, status: 'attack', name: 'Attacco' })], riferimenti: RIFERIMENTI, domande: [d] });
    const page = await openTab(MANAGE);
    await page.emulateMedia({ colorScheme: tema });
    await aspettaAvvio(page);
    await apriScheda(page, 'inbox');
    await page.locator('#mgFiduciaFiltro').click();
    await page.locator('#mgFidatiBtn').click();
    await page.screenshot({ path: `${OUT}/fidati-${tema}.png` });
    await page.locator('.mg-sezione[data-sezione="domande"]').click();
    await page.locator('.mg-tab[data-tab="domande-archivio"]').click();
    await page.locator('#mgDomandeLista .mg-domanda[data-id="D-72"]').click();
    await expect(page.locator('#mgDomandaDettaglio button[data-fai="annulla"]')).toBeVisible();
    await page.screenshot({ path: `${OUT}/domanda-${tema}.png` });
  });
}
