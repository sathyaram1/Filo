// Prova del giro 2 (verifica locale) del Red Team in pausa, rilievo 1: un altro nome che Windows dà allo
// stesso file della pagina deve mostrare a chi non è owner la sola frase della pausa, non il sorgente.
// Owner e interruttore sono finti dentro il processo main: nessuna lettura di config/redteam vera.

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
    const vero = globalThis.fetch;
    globalThis.fetch = async (url, init = {}) => {
      const u = String((url && url.url) || url);
      if (u.includes('/documents/config/redteam')) {
        return new Response(JSON.stringify({ name: 'x', fields: { openToAll: { booleanValue: false } } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return vero(url, init);
    };
    await Gate.rileggiOra();
  });
}

test('il nome del flusso dati del file della pagina mostra solo la frase della pausa', async ({ app, openTab }) => {
  test.skip(process.platform !== 'win32', 'nome che esiste solo su Windows');
  await inPausaNonOwner(app);
  const page = await openTab('filo://redteam/redteam.html::$DATA');
  await expect.poll(() => page.evaluate(() => document.body.innerText.trim()), { timeout: 8000 }).toBe(FRASE);
});
