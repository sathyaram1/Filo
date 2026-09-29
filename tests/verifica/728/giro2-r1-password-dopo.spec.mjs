// VERIFICA #728 giro 2, rilievo 1 (era l'1 del giro 1) — un sosia di un marchio corto
// che chiede la password deve arrivare al blocco anche quando il modulo compare un
// attimo dopo l'apertura (pagina montata dal codice, password chiesta dopo l'email)
// o sta in un riquadro incorporato della pagina stessa.

import { test, expect } from '../../fixtures/electron.mjs';

async function servi(app, pagine) {
  await app.evaluate(async ({ session, net }, pg) => {
    try { session.defaultSession.protocol.unhandle('https'); } catch (_) {}
    session.defaultSession.protocol.handle('https', (req) => {
      const u = new URL(req.url);
      const html = pg[u.hostname + u.pathname] || pg[u.hostname];
      if (html) return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } });
      return net.fetch(req, { bypassCustomProtocolHandlers: true });
    });
    globalThis.SN_SAFEBROWSE.setProviders({ gsb: null, rdap: null, ct: null, sandbox: null, llm: null });
  }, pagine);
}

const ACCESSO = '<form><input name="email" placeholder="Email"><input type="password" name="pw"><button>Accedi</button></form>';

test('sosia con la password nella pagina appena aperta: blocco (controllo)', async ({ app, openTab }) => {
  await servi(app, { 'paypak.com': `<h1>PayPal</h1>${ACCESSO}` });
  const page = await openTab('https://paypak.com/');
  await expect(page.getByPlaceholder('confermo')).toBeVisible({ timeout: 12_000 });
});

test('sosia che monta il modulo della password un attimo dopo l\'apertura: blocco', async ({ app, openTab }) => {
  await servi(app, {
    'paypak.com': '<h1>PayPal</h1><div id="app">Caricamento…</div><script>'
      + `setTimeout(() => { document.getElementById('app').innerHTML = ${JSON.stringify(ACCESSO)}; }, 800);</script>`,
  });
  const page = await openTab('https://paypak.com/');
  await expect(page.getByPlaceholder('Email')).toBeVisible({ timeout: 12_000 });
  await expect(page.getByPlaceholder('confermo')).toBeVisible({ timeout: 8_000 });
});

test('sosia che chiede la password dopo l\'email, senza ricaricare: blocco', async ({ app, openTab }) => {
  await servi(app, {
    'paypak.com': '<h1>PayPal</h1><div id="f"><input name="email" placeholder="Email">'
      + '<button id="avanti" onclick="document.getElementById(\'f\').innerHTML = '
      + '\'<input type=password placeholder=Password><button>Accedi</button>\'">Avanti</button></div>',
  });
  const page = await openTab('https://paypak.com/');
  const continua = page.getByRole('button', { name: 'Continua' });
  await expect(continua).toBeVisible({ timeout: 12_000 });
  await continua.click();
  // Il tempo di scrivere l'email: una persona non preme «Avanti» nel primo secondo e mezzo.
  await page.getByPlaceholder('Email').fill('mario@example.com');
  await page.waitForTimeout(3000);
  await page.click('#avanti');
  await expect(page.getByPlaceholder('Password')).toBeVisible();
  await expect(page.getByPlaceholder('confermo')).toBeVisible({ timeout: 8_000 });
});
