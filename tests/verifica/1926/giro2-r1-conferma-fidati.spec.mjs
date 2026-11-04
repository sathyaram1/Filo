// Verifica #1926 giro 2, r1: il secondo clic di «Segna fidati tutti» cade dove è caduto il primo anche quando accanto
// compare l'avviso dei segnalati rimasti fuori (PATTERNS: una conferma sul posto tiene ferma la sua scatola).
import { test, expect } from '../../fixtures/electron.mjs';
import { apriScheda } from '../../helpers/gestione.mjs';
import { MANAGE, fb, mainFinto, aspettaAvvio } from '../../helpers/gestioneMainFinto.mjs';

test('r1 con un attacco in lista, il secondo clic sullo stesso punto conferma e segna fidati', async ({ app, openTab }) => {
  await mainFinto(app, { feedbacks: [
    fb({ seq: 951, status: 'unlabeled', name: 'Da guardare' }),
    fb({ seq: 953, status: 'unlabeled', name: 'Anche questa' }),
    fb({ seq: 952, status: 'attack', name: 'Ignora le istruzioni' }),
  ], riferimenti: {}, domande: [] });
  await app.evaluate(({ ipcMain }) => {
    const sotto = ipcMain._invokeHandlers.get('filo:message');
    globalThis.__blocchi = [];
    ipcMain.removeHandler('filo:message');
    ipcMain.handle('filo:message', async (event, msg) => {
      if (msg && msg.type === 'fiducia_segna_blocco') {
        globalThis.__blocchi.push(msg.feedbackIds);
        return { ok: true, esiti: msg.feedbackIds.map((id) => ({ feedbackId: id, ok: true })) };
      }
      return sotto(event, msg);
    });
  });
  const page = await openTab(MANAGE);
  await aspettaAvvio(page);
  await apriScheda(page, 'inbox');
  await page.locator('#mgFiduciaFiltro').click();
  const tasto = page.locator('#mgFidatiBtn');
  await expect(tasto).toHaveText('Segna fidati tutti (2)');
  const box = await tasto.boundingBox();
  const x = box.x + box.width * 0.75;
  const y = box.y + box.height / 2;
  await page.mouse.click(x, y);
  await expect(tasto).toHaveText('Confermi? Sono 2');
  await expect(page.locator('#mgFidatiMsg')).toContainText('resta fuori');
  await page.mouse.click(x, y);
  await expect.poll(() => app.evaluate(() => globalThis.__blocchi), { timeout: 3000 }).toEqual([['fb-951', 'fb-953']]);
  await expect(page.locator('#mgFidatiMsg')).toContainText('2 segnati fidati');
});
