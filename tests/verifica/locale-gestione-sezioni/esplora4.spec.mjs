// Esplorazione della verifica locale: si cancella prima della critica.
import { test } from '../../fixtures/electron.mjs';
import { MANAGE, PRATICHE, RIFERIMENTI, domanda, mainFinto, aspettaAvvio, finestra } from './aiuto.mjs';

async function sezioni(page) {
  return page.evaluate(() => ({
    sezione: document.querySelector('.mg-sezione--active')?.dataset.sezione,
    sezioni: [...document.querySelectorAll('.mg-sezione')].map((b) => b.textContent.trim()).join(' | '),
    attiva: document.querySelector('.mg-tab--active')?.dataset.tab,
    dettaglio: !document.querySelector('#mgDetail')?.hidden,
  }));
}

test('E11 aprire una pratica mentre le domande arrivano', async ({ app, openTab }) => {
  await mainFinto(app, { feedbacks: PRATICHE, riferimenti: RIFERIMENTI, domande: [domanda(12, { priorita: 'bloccante' })], domandeLente: 8000 });
  const page = await openTab(MANAGE);
  await page.waitForFunction(() => document.querySelectorAll('.mg-item').length > 0, null, { timeout: 7000 });
  console.log('E11 lista pronta', JSON.stringify(await sezioni(page)));
  await page.locator('.mg-item', { hasText: '#805' }).click();
  await page.waitForTimeout(300);
  console.log('E11 pratica aperta', JSON.stringify(await sezioni(page)));
  await page.locator('.mg-livello-btn[data-livello="l3"]').click().catch(() => {});
  await aspettaAvvio(page);
  await page.waitForTimeout(500);
  console.log('E11 dopo le domande', JSON.stringify(await sezioni(page)));
});

test('E12 una risposta che il server rifiuta', async ({ app, openTab }) => {
  await mainFinto(app, { feedbacks: PRATICHE, riferimenti: RIFERIMENTI, domande: [domanda(12, { priorita: 'bloccante' })] });
  const page = await openTab(MANAGE);
  await aspettaAvvio(page);
  await app.evaluate(({ ipcMain }) => {
    const prima = ipcMain._invokeHandlers.get('filo:message');
    ipcMain.removeHandler('filo:message');
    ipcMain.handle('filo:message', async (e, m) => (m && /^domand/.test(m.type) && m.type !== 'domande_elenco') ? { ok: false, error: 'Il server non risponde: controlla la connessione e riprova.' } : prima(e, m));
  });
  await page.locator('.mg-dq[data-id="D-12"] .mg-dq-testo').fill('La mia risposta lunga');
  await page.locator('.mg-dq[data-id="D-12"] button[data-fai="testo"]').click();
  await page.waitForTimeout(500);
  console.log('E12', await page.locator('.mg-dq[data-id="D-12"] .mg-dq-msg').innerText(), '| bozza', await page.locator('.mg-dq[data-id="D-12"] .mg-dq-testo').inputValue(), '|', JSON.stringify(await sezioni(page)));
  // cambia scheda e torna: la bozza resta?
  await page.locator('.mg-sezione[data-sezione="feedback"]').click();
  await page.locator('.mg-sezione[data-sezione="domande"]').click();
  await page.waitForTimeout(400);
  console.log('E12 bozza dopo giro', await page.locator('.mg-dq[data-id="D-12"] .mg-dq-testo').inputValue().catch((e) => 'ERR ' + e.message));
});
