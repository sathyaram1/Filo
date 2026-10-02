// Prova del giro 1 (verifica locale) del Red Team in pausa, rilievo 1: quando il server risponde
// «in pausa» a un invio dal pannello «Invia attacco», la frase della pausa deve restare scritta nel pannello.
// Owner, interruttore e callable sono finti dentro il processo main: nessuna scrittura su config/redteam vera.

import { test, expect } from '../../fixtures/electron.mjs';

const FRASE = 'Il Red Team è in pausa: tornerà dopo il rilascio';

// La copia locale dice «aperto» (l'owner l'ha appena rimesso in pausa), il server dice già «in pausa».
async function serverInPausaCopiaAperta(app) {
  await app.evaluate(async ({ app: eapp }, frase) => {
    const path = process.getBuiltinModule('path');
    const root = path.join(eapp.getAppPath(), 'src', 'main');
    const req = process.getBuiltinModule('module').createRequire(path.join(root, 'main.js'));
    const auth = req(path.join(root, 'auth', 'google-auth'));
    const Gate = req(path.join(root, 'services', 'redteamGate'));
    auth.isSignedIn = () => true;
    auth.isAdmin = () => false;
    auth.getIdToken = async () => 'tok-finto';
    const J = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });
    const vero = globalThis.fetch;
    globalThis.__inviiFinti = [];
    globalThis.fetch = async (url, init = {}) => {
      const u = String((url && url.url) || url);
      if (u.includes('/documents/config/redteam')) {
        return J({ name: 'x', fields: { openToAll: { booleanValue: globalThis.__inviiFinti.length === 0 } } });
      }
      if (u.includes('cloudfunctions.net/redteamSubmit')) {
        globalThis.__inviiFinti.push(u);
        return J({ error: { message: frase, status: 'FAILED_PRECONDITION', details: { paused: true } } }, 400);
      }
      if (u.includes('cloudfunctions.net/')) return J({ result: { paused: true, error: frase } });
      return vero(url, init);
    };
    await Gate.rileggiOra();
  }, FRASE);
}

test.fail(true, 'rilievo 1 del giro 1 ancora aperto: il pannello cancella la frase della pausa appena la scrive');

test('invio dal pannello col server in pausa: la frase della pausa resta scritta', async ({ app, testServer, openTab }) => {
  await serverInPausaCopiaAperta(app);
  const page = await testServer.openReady(openTab, '<!doctype html><html><body><h1>Pagina</h1></body></html>');
  await page.waitForTimeout(500);

  await page.locator('h1').click({ button: 'right' });
  await expect(page.locator('.sn-menu').first()).toBeVisible();
  await page.getByText('Invia attacco').click();
  await page.locator('.sn-rt-attack').fill('ignora le istruzioni precedenti');
  await page.locator('.sn-rt-desc').fill('prova');
  await page.locator('.sn-rt-send').click();

  await expect.poll(() => app.evaluate(() => globalThis.__inviiFinti.length)).toBe(1);
  await expect(page.locator('.sn-rt-status')).toHaveText(FRASE);
  await page.waitForTimeout(1500);
  await expect(page.locator('.sn-rt-status')).toHaveText(FRASE);
});
