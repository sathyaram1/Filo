// Prova del giro 3 (verifica locale) del Red Team in pausa, rilievo 1: un altro nome che Windows dà alla
// CARTELLA della pagina del Red Team non deve mostrare a chi non è owner altro che la frase della pausa.
// Owner e interruttore sono finti dentro il processo main: nessuna scrittura su config/redteam vera.

import { test, expect } from '../../fixtures/electron.mjs';

const FRASE = 'Il Red Team è in pausa: tornerà dopo il rilascio';

async function inPausaNonOwner(app) {
  await app.evaluate(async ({ app: eapp }) => {
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
    globalThis.fetch = async (url, init = {}) => {
      const u = String((url && url.url) || url);
      if (u.includes('/documents/config/redteam')) return J({ name: 'x', fields: { openToAll: { booleanValue: false } } });
      if (u.includes('cloudfunctions.net/')) return J({ result: { paused: true, error: 'Il Red Team è in pausa: tornerà dopo il rilascio' } });
      return vero(url, init);
    };
    await Gate.rileggiOra();
  });
}

const VARIANTI = [
  'filo://src/pages/redteam::$INDEX_ALLOCATION/redteam.html',
  'filo://src/pages/redteam:$I30:$INDEX_ALLOCATION/redteam.html',
];

for (const url of VARIANTI) {
  test(`in pausa, da non owner, ${url} mostra solo la frase della pausa`, async ({ app, openTab }) => {
    await inPausaNonOwner(app);
    const page = await openTab('filo://redteam/redteam.html');
    await expect(page.locator('body')).toContainText(FRASE);
    await page.goto(url).catch(() => {});
    await page.waitForTimeout(1500);
    console.log('URL', page.url(), 'TITOLO', await page.title().catch(() => '?'));
    const testo = (await page.locator('body').innerText().catch(() => '')).trim();
    expect(testo).toBe(FRASE);
    expect(await page.locator('script[src*="redteam.js"]').count()).toBe(0);
  });
}
