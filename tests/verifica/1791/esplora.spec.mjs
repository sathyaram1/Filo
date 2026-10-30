// Esplorazione della verifica di #1791: Gestione → Domande col nuovo ciclo.
import { test, expect } from '../../fixtures/electron.mjs';
import { MANAGE, PRATICHE, RIFERIMENTI, domanda, mainFinto, aspettaAvvio } from '../../helpers/gestioneMainFinto.mjs';

const riga = (page, id) => page.locator(`#mgDomandeLista .mg-domanda[data-id="${id}"]`);
const dq = (page, id) => page.locator(`#mgDomandaDettaglio .mg-dq[data-id="${id}"]`);
const tab = (page, t) => page.locator(`.mg-tab[data-tab="${t}"]`);

async function apriDomande(page) {
  await aspettaAvvio(page);
  await page.locator('.mg-sezione[data-sezione="domande"]').click();
  await expect(page.locator('#panel-domande')).toHaveClass(/mg-panel--active/);
}

async function registraInvii(app) {
  await app.evaluate(({ ipcMain }) => {
    const sotto = ipcMain._invokeHandlers.get('filo:message');
    globalThis.__mandati = [];
    ipcMain.removeHandler('filo:message');
    ipcMain.handle('filo:message', async (event, msg) => {
      if (msg && /^domand/.test(String(msg.type)) && msg.type !== 'domande_elenco') globalThis.__mandati.push(msg);
      return sotto(event, msg);
    });
  });
}

const DUE = (n, over = {}) => domanda(n, Object.assign({
  opzioni: [
    { testo: 'Caldo', pro: 'Come Filo.', contro: 'Poco contrasto.', azione: { tipo: 'riprendi', feedbackId: 'fb-813' } },
    { testo: 'Freddo', pro: 'Contrasto.', contro: 'Non è Filo.', azione: { tipo: 'archivia', feedbackId: 'fb-813' } },
  ],
  consiglio: { opzione: 0, perche: 'È lo stile.' },
}, over));

test('bozza mandata con un pulsante d’opzione', async ({ app, openTab }) => {
  await mainFinto(app, { feedbacks: PRATICHE, riferimenti: RIFERIMENTI, domande: [DUE(70), DUE(71)] });
  await registraInvii(app);
  const page = await openTab(MANAGE);
  await apriDomande(page);
  await riga(page, 'D-70').click();
  const d = dq(page, 'D-70');
  await expect(d.locator('.mg-dq-applica')).toHaveCount(1);
  await expect(d.locator('.mg-dq-parole')).toBeVisible();
  await d.locator('.mg-dq-testo').fill('scritto a mano');
  await d.locator('.mg-dq-azione[data-scelta="1"]').click();
  await expect(d.locator('.mg-dq-msg')).toHaveText(/^Mandata/);
  const m = await app.evaluate(() => globalThis.__mandati);
  expect(m[0]).toMatchObject({ type: 'domanda_rispondi', id: 'D-70', scelta: 1, testo: 'scritto a mano' });
  expect(await page.evaluate(() => localStorage.getItem('filo.gestione.bozzeDomande'))).toBeNull();
  await page.screenshot({ path: 'tests/.shots/v1791-mandata.png' });
});

test('in smistamento: sola lettura', async ({ app, openTab }) => {
  await mainFinto(app, {
    feedbacks: PRATICHE, riferimenti: RIFERIMENTI,
    domande: [DUE(80, { stato: 'in_smistamento', legata: 'fb-813', blocca: true, notePerAgenti: 'testo vero' }), DUE(81)],
  });
  const page = await openTab(MANAGE);
  await apriDomande(page);
  await expect(tab(page, 'domande-smistamento')).toContainText('(1)');
  await expect(tab(page, 'domande')).toContainText('(1)');
  await tab(page, 'domande-smistamento').click();
  await expect(riga(page, 'D-80')).toContainText('ferma #813');
  await riga(page, 'D-80').click();
  const d = dq(page, 'D-80');
  await expect(d.locator('.mg-dq-testo')).toHaveCount(0);
  await expect(d.locator('.mg-dq-azione')).toHaveCount(0);
  await expect(d.locator('.mg-dq-applica')).toHaveCount(0);
  await expect(d.locator('.mg-dq-tasti button')).toHaveText(['Archivia']);
  await page.screenshot({ path: 'tests/.shots/v1791-smistamento.png' });
  await page.evaluate(() => document.documentElement.setAttribute('data-sn-theme', 'dark'));
  await page.screenshot({ path: 'tests/.shots/v1791-smistamento-scuro.png' });
});
