// VERIFICA #728 giro 3 — il blocco di un sosia di un marchio corto dipende dal campo password: va contato
// quello che l'utente vede, e va visto dovunque la pagina lo metta.

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
    // Niente rete: conta solo il nome, come con un dominio vecchio o un registro che non risponde.
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

test('r1 email.com col modulo d\'accesso nascosto dietro «Accedi»: popup «Continua», non il blocco', async ({ app, openTab }) => {
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

test('r2 paypak.com col modulo d\'accesso in un componente con shadow DOM: blocco', async ({ app, openTab }) => {
  await servi(app, {
    'paypak.com': '<h1>PayPal</h1><login-box></login-box><script>customElements.define("login-box", class extends HTMLElement {'
      + `constructor(){super(); this.attachShadow({mode:"open"}).innerHTML = ${JSON.stringify(ACCESSO)};}});</script>`,
  });
  await openTab('https://paypak.com/');
  const avviso = await vistaAvviso(app);
  await expect(avviso.getByPlaceholder('confermo')).toBeVisible({ timeout: 15_000 });
});
