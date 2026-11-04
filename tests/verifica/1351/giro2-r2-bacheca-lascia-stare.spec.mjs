// #1351, giro 2, rilievo 2: in bacheca «Lascia stare» non libera il freno delle riaperture, e il nuovo «Accedi» entro
// dieci secondi dall'apertura di prima apre la pagina di Google solo allo scadere, mentre la bacheca dice che si è aperta.
import { test, expect } from '../../fixtures/electron.mjs';
import { googleFinto, rispondiAlLoopback } from '../../helpers/googleFinto.mjs';

const aperture = (app) => app.evaluate(() => globalThis.__aperture.slice());

test('r2 bacheca: «Lascia stare» e di nuovo «Accedi» aprono subito la pagina di Google, come nel Profilo', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  await googleFinto(app, testServer, { rifiuta: true });
  const page = await openTab('filo://board/board.html');
  await page.locator('#bdLoading').waitFor({ state: 'hidden', timeout: 15_000 });
  await expect(page.locator('#bdSignIn')).toHaveText('Accedi');

  await page.locator('#bdSignIn').click();
  await expect.poll(() => aperture(app).then((a) => a.length)).toBe(1);
  await page.locator('#bdAuthLascia').click();
  await expect(page.locator('#bdSignIn')).toHaveText('Accedi');
  await page.locator('#bdSignIn').click();
  await expect(page.locator('#bdAuthMsg')).toHaveText('Completa l\'accesso nella pagina di Google che si è aperta.');
  await expect.poll(() => aperture(app).then((a) => a.length), { timeout: 3000, message: 'la pagina di Google non si è aperta' }).toBe(2);

  const [indirizzo] = await aperture(app);
  expect(await rispondiAlLoopback(indirizzo, 'error=access_denied')).toBe(200);
});
