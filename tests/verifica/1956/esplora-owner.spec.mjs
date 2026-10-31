// Esplorazione del giro 2 di verifica #1956: l'owner sulle righe vere. Si cancella prima della critica.
import { test, expect, aspettaFinestra } from '../../fixtures/electron.mjs';
import { menuDi } from '../../helpers/menuContestuale.mjs';

test('owner: riga vera, «Apri la segnalazione» porta in Gestione', async ({ app, openTab }) => {
  await app.evaluate(() => {
    const M = process.getBuiltinModule('module');
    const k = Object.keys(M._cache).find((x) => /auth[\\/]google-auth\.js$/.test(x));
    const ga = M._cache[k].exports;
    ga.isAdmin = () => true;
    ga.isSignedIn = () => true;
  });
  const page = await openTab('filo://novita/novita.html?q=ultima%20scheda%20chiusa');
  await page.waitForFunction(() => document.body.dataset.pronto === '1', null, { timeout: 10_000 });
  await page.waitForFunction(() => document.documentElement.dataset.filoContentScripts === '1', null, { timeout: 8_000 });
  console.log('NUMERI', await page.locator('.nv-segn').allInnerTexts());
  console.log('TOT owner', await page.evaluate(() => document.querySelectorAll('.nv-segn').length));
  await page.locator('.nv-riga', { hasText: 'Ctrl+Shift+T' }).click({ button: 'right' });
  const menu = menuDi(page);
  await expect(menu.voce('Apri la segnalazione')).toBeVisible();
  await menu.voce('Apri la segnalazione').click();
  const g = await aspettaFinestra(app, (w) => w.url().startsWith('filo://manage/manage.html'), 'Gestione non si è aperta');
  console.log('URL', g.url());
});
