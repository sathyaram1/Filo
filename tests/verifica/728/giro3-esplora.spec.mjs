// VERIFICA #728 giro 3 — esplorazione delle porte rimaste.

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

async function vistaAvviso(app, ms = 12_000) {
  const fine = Date.now() + ms;
  while (Date.now() < fine) {
    const p = app.windows().find((w) => { try { return w.url().startsWith('filo://shell/avviso-sito.html'); } catch (_) { return false; } });
    if (p) return p;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('la vista dell\'avviso non è nata');
}

const ACCESSO = '<form><input name="email" placeholder="Email"><input type="password" name="pw"><button>Accedi</button></form>';

test('telegraph.co.uk: popup, non blocco', async ({ app, openTab }) => {
  await servi(app, { 'telegraph.co.uk': '<h1>The Telegraph</h1>' });
  await openTab('https://telegraph.co.uk/');
  const avviso = await vistaAvviso(app);
  await expect(avviso.getByRole('button', { name: 'Continua' })).toBeVisible({ timeout: 12_000 });
  await new Promise((r) => setTimeout(r, 4000));
  await expect(avviso.getByPlaceholder('confermo')).toBeHidden();
});

test('email.com con modulo d\'accesso nascosto dietro «Accedi»', async ({ app, openTab }) => {
  await servi(app, {
    'email.com': '<h1>Posta gratuita</h1><button onclick="document.getElementById(\'m\').hidden=false">Accedi</button>'
      + `<div id="m" hidden>${ACCESSO}</div>`,
  });
  await openTab('https://email.com/');
  const avviso = await vistaAvviso(app);
  await expect(avviso.getByRole('button', { name: 'Continua' })).toBeVisible({ timeout: 12_000 });
  await new Promise((r) => setTimeout(r, 5000));
  await expect(avviso.getByPlaceholder('confermo')).toBeHidden();
});

test('paypak.com con la password in un shadow DOM', async ({ app, openTab }) => {
  await servi(app, {
    'paypak.com': '<h1>PayPal</h1><login-box></login-box><script>customElements.define("login-box", class extends HTMLElement {'
      + `constructor(){super(); this.attachShadow({mode:"open"}).innerHTML = ${JSON.stringify(ACCESSO)};}});</script>`,
  });
  await openTab('https://paypak.com/');
  const avviso = await vistaAvviso(app);
  await expect(avviso.getByPlaceholder('confermo')).toBeVisible({ timeout: 15_000 });
});

test('paypak.com con la password in un riquadro di un altro dominio', async ({ app, openTab }) => {
  await servi(app, {
    'login-cdn.net': `<!doctype html><body>${ACCESSO}</body>`,
    'paypak.com': '<h1>PayPal</h1><iframe src="https://login-cdn.net/" width="400" height="200"></iframe>',
  });
  await openTab('https://paypak.com/');
  const avviso = await vistaAvviso(app);
  await expect(avviso.getByPlaceholder('confermo')).toBeVisible({ timeout: 15_000 });
});

test('paypak.com: rotta cambiata con pushState e poi il modulo', async ({ app, openTab }) => {
  await servi(app, {
    'paypak.com': '<h1>PayPal</h1><a id="l" href="#" onclick="history.pushState({},\'\',\'/signin\');'
      + `setTimeout(()=>{document.body.insertAdjacentHTML('beforeend', ${JSON.stringify(ACCESSO).replace(/"/g, '&quot;')})},500);return false">Accedi</a>`,
  });
  const page = await openTab('https://paypak.com/');
  const avviso = await vistaAvviso(app);
  const continua = avviso.getByRole('button', { name: 'Continua' });
  await expect(continua).toBeVisible({ timeout: 12_000 });
  await continua.click();
  await new Promise((r) => setTimeout(r, 1500));
  await page.click('#l');
  await expect(page.locator('input[type=password]')).toHaveCount(1);
  await expect(avviso.getByPlaceholder('confermo')).toBeVisible({ timeout: 15_000 });
});
