// Esplorazione temporanea #728: si cancella prima della registrazione.

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

test('mail.com con il modulo d\'accesso nascosto dietro «Accedi»', async ({ app, openTab }) => {
  await servi(app, {
    'mail.com': '<h1>mail.com</h1><button>Accedi</button><div style="display:none"><form>'
      + '<input name="u" placeholder="Email"><input type="password" name="p"></form></div><p>Posta gratuita</p>',
  });
  const page = await openTab('https://mail.com/');
  await page.waitForTimeout(4000);
  const bloccato = await page.getByPlaceholder('confermo').count();
  const titolo = await page.locator('body').evaluate(() => document.querySelector('[data-filo-sb], div')?.shadowRoot ? 'shadow' : '');
  console.log('mail.com nascosto → blocco:', bloccato, titolo);
  await page.screenshot({ path: 'tests/.shots/verifica-728-mail-nascosto.png' });
});

test('telegraph.co.uk', async ({ app, openTab }) => {
  await servi(app, { 'www.telegraph.co.uk': '<h1>The Telegraph</h1><p>News</p>' });
  const page = await openTab('https://www.telegraph.co.uk/');
  await expect(page.getByPlaceholder('confermo')).toBeVisible({ timeout: 12_000 });
  await page.screenshot({ path: 'tests/.shots/verifica-728-telegraph.png' });
});
