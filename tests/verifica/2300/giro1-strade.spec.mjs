// Verifica #2300 giro 1: il gettone di un trascinamento vero vale anche su un'altra pagina di Filo, e quello di una
// cosa non apre l'altra (un riferimento lasciato sulla home non diventa un allegato, e resta buono per l'Aiuto).
import { test, expect } from '../../fixtures/electron.mjs';
import { home } from '../../helpers/chatFinta.mjs';
import { MANAGE, PRATICHE, RIFERIMENTI, domanda, mainFinto } from '../../helpers/gestioneMainFinto.mjs';

const lascia = async (page, loc, items) => {
  const a = await loc.boundingBox();
  const cdp = await page.context().newCDPSession(page);
  const data = { items, dragOperationsMask: 1 };
  for (const type of ['dragEnter', 'dragOver', 'drop']) await cdp.send('Input.dispatchDragEvent', { type, x: a.x + a.width / 2, y: a.y + a.height / 2, data });
  await cdp.detach().catch(() => {});
};

test('un riferimento preso in Gestione arriva nell’Aiuto della home; lasciato sul campo della home resta testo', async ({ app, openTab }) => {
  await mainFinto(app, { feedbacks: PRATICHE, riferimenti: RIFERIMENTI, domande: [domanda(52, { titolo: 'Colore del bordo' })] });
  const gestione = await openTab(MANAGE);
  await expect.poll(() => gestione.evaluate(() => typeof SN_TRASCINO_INTERNO)).toBe('object');
  const gettone = await gestione.evaluate(async () => {
    const dt = new DataTransfer();
    await SN_TRASCINO_INTERNO.parte(dt, 'riferimento', { titolo: 'D-52 Colore del bordo', testo: 'Contenuto nascosto.' });
    return dt.getData('application/x-filo-riferimento');
  });
  expect(gettone).toMatch(/^[\w-]{16,64}$/);

  const casa = await home(app);
  // Il gettone di un riferimento sul campo della home: non è un file, entra il testo a vista e niente allegato.
  await lascia(casa, casa.locator('#input'), [{ mimeType: 'application/x-filo-file', data: gettone }, { mimeType: 'text/plain', data: 'a vista' }]);
  await expect(casa.locator('#input')).toHaveValue('a vista');
  await expect(casa.locator('.dash-file-chip')).toHaveCount(0);
  await casa.locator('#input').fill('');

  // Lo stesso gettone, nell'Aiuto aperto sulla home: è un riferimento vero, e arriva col suo contenuto.
  await casa.evaluate(() => SN_SIDEBAR.open());
  const casella = casa.locator('.sn-sidebar-input textarea');
  await expect(casella).toBeVisible();
  await lascia(casa, casella, [{ mimeType: 'application/x-filo-riferimento', data: gettone }, { mimeType: 'text/plain', data: 'testo di riserva' }]);
  await expect.poll(() => casa.evaluate(() => window.__filoSidebarTest.riferimenti().length)).toBe(1);
  const rif = await casa.evaluate(() => window.__filoSidebarTest.riferimenti());
  expect(rif[0].titolo).toBe('D-52 Colore del bordo');
  expect(rif[0].testo).toBe('Contenuto nascosto.');
  await expect(casella).toHaveValue('');
});
