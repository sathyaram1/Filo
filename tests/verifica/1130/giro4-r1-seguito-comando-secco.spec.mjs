// #1130 giro 4 (riallineamento con #1296): un seguito scritto mentre un comando secco lavora entra nello stesso turno,
// letto al passo dopo con l'esito del comando; la chat riaperta racconta lo stesso ordine di quella dal vivo.
// r1: rossa sul ramo, verde su main da solo.

import { test, expect } from '../../fixtures/electron.mjs';
import { newtabPage, configureModel, copione, ripristina, testoDellaChiamata } from '../../helpers/copione.mjs';

const chiamate = (app) => app.evaluate(() => globalThis.__messaggi.length);
const ultimaChiamata = (app) => app.evaluate(() => globalThis.__messaggi[globalThis.__messaggi.length - 1]);

test('r1 un seguito scritto durante il timer è letto nello stesso turno, e l\'archivio non ha una risposta vuota in mezzo', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await configureModel(app);
  await copione(app, [
    { pensa: ['Metto il timer. '], ogni: 200, dopoStrumenti: 1_500, strumenti: [{ id: 'b1', name: 'TIMER', arguments: '{"secondi":120,"etichetta":"Pasta"}' }] },
    { pensa: ['Ha aggiunto una cosa. '], ogni: 200, testo: 'Timer messo, e ho letto anche il seguito.' },
  ]);
  await page.locator('#input').fill('metti un timer di due minuti');
  await page.locator('#input').press('Enter');
  await expect(page.locator('.dash-activity').first().locator('.dash-activity-seg-head').first()).toHaveText('Avvio un timer…', { timeout: 5_000 });
  await page.locator('#input').fill('e poi dimmi anche che ore sono');
  await page.locator('#input').press('Enter');
  await expect(page.locator('.dash-bubble-filo', { hasText: 'ho letto anche il seguito' })).toBeVisible({ timeout: 10_000 });
  expect(await chiamate(app)).toBe(2);
  const seconda = await ultimaChiamata(app);
  expect(testoDellaChiamata([seconda[seconda.length - 1]])).toContain('e poi dimmi anche che ore sono');
  const archivio = () => app.evaluate(async () => (await globalThis.SN_FILO_CHATS.list())
    .filter((c) => !c.app).flatMap((c) => c.messages.map((m) => `${m.role}: ${m.text}`)));
  await expect.poll(archivio, { timeout: 5_000 }).toEqual([
    'user: metti un timer di due minuti',
    'user: e poi dimmi anche che ore sono',
    'filo: Timer messo, e ho letto anche il seguito.',
  ]);
  await ripristina(app);
});
