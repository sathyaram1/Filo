// Esplorazione della verifica locale: si cancella prima della critica.
import { test } from '../../fixtures/electron.mjs';
import { MANAGE, PRATICHE, RIFERIMENTI, domanda, mainFinto, aspettaAvvio, finestra } from './aiuto.mjs';

const OUT = 'C:/Users/agenti AI/Desktop/Filo/report/ruoli-invertiti-stato/ondata1/tmp-1150/vista-verifica';

test('E9 tema scuro e testi lunghi', async ({ app, openTab }) => {
  const lungo = 'Parola '.repeat(1400);
  await mainFinto(app, {
    feedbacks: PRATICHE, riferimenti: RIFERIMENTI,
    domande: [
      domanda(12, { priorita: 'bloccante', titolo: 'T'.repeat(30) + ' ' + 'Un titolo molto lungo che arriva quasi al tetto dei duecento caratteri per vedere come va a capo nella lista e nel dettaglio della domanda aperta 🙂', contesto: lungo }),
      domanda(13, { fiducia: 'non_fidato', conversazione: [
        { autore: { tipo: 'biglietto', ruolo: 'worker', fiducia: 'non_fidato' }, testo: 'Ho una domanda in più.', ora: Date.now() - 5000 },
        { autore: { tipo: 'owner' }, testo: 'Risposta mia', ora: Date.now() - 3000, scelta: 1 },
      ] }),
    ],
  });
  const page = await openTab(MANAGE);
  await aspettaAvvio(page);
  await finestra(app, 1536, 864);
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.waitForTimeout(500);
  console.log('E9 tema', await page.evaluate(() => document.documentElement.dataset.snTheme));
  await page.screenshot({ path: `${OUT}/e9-scuro-domande.png` });
  await page.locator('#mgDomandaDettaglio details.mg-dq-note summary').scrollIntoViewIfNeeded();
  await page.locator('#mgDomandaDettaglio details.mg-dq-note summary').click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/e9-scuro-note.png` });
  await page.locator('.mg-domanda[data-id="D-13"]').click();
  await page.waitForTimeout(300);
  await page.locator('#mgDomandaDettaglio .mg-dq-conv').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${OUT}/e9-scuro-conv.png` });
  await page.locator('.mg-sezione[data-sezione="feedback"]').click();
  await page.locator('.mg-livello-btn[data-livello="l1"]').click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/e9-scuro-ricevuti.png` });
});

test.skip('E10 chi non è owner', async ({ app, openTab }) => {
  await mainFinto(app, { admin: false, feedbacks: [], domande: [], domandeErr: 'riservato' });
  // ownerOnly del main vero risponde code not_admin: lo si imita.
  await app.evaluate(({ ipcMain }) => {
    const prima = ipcMain._invokeHandlers.get('filo:message');
    ipcMain.removeHandler('filo:message');
    ipcMain.handle('filo:message', async (e, m) => (m && m.type === 'domande_elenco') ? { ok: false, code: 'not_admin', error: 'Solo l’owner.' } : prima(e, m));
  });
  const page = await openTab(MANAGE);
  await aspettaAvvio(page);
  await finestra(app, 1536, 864);
  await page.waitForTimeout(500);
  console.log('E10', JSON.stringify(await page.evaluate(() => ({
    sezione: document.querySelector('.mg-sezione--active')?.dataset.sezione,
    sezioni: [...document.querySelectorAll('.mg-sezione')].map((b) => b.textContent.trim()).join(' | '),
    schede: [...document.querySelectorAll('.mg-tab')].filter((b) => !b.hidden).map((b) => b.textContent.trim()).join(' | '),
  }))));
  await page.screenshot({ path: `${OUT}/e10-ospite.png` });
  await page.locator('.mg-sezione[data-sezione="domande"]').click();
  await page.waitForTimeout(400);
  console.log('E10 domande', await page.locator('#panel-domande').innerText());
  await page.screenshot({ path: `${OUT}/e10-ospite-domande.png` });
});
