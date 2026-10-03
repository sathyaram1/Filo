// #813.1 giro 2, rilievo 2: il menu del tasto destro di Filo aperto sull'avviso resta sotto l'avviso e non risponde.

import { test, expect } from '../../fixtures/electron.mjs';

test('tasto destro sull\'avviso: il menu di Filo compare sopra e risponde', async ({ app, shell }) => {
  await app.evaluate(async ({ session, net }) => {
    const risposta = (req) => {
      const u = new URL(req.url);
      if (u.hostname === 'conto-destro.com') return new Response('<title>Accedi</title><form><input type="password" id="pw"></form><p>fine</p>', { headers: { 'content-type': 'text/html; charset=utf-8' } });
      return net.fetch(req, { bypassCustomProtocolHandlers: true });
    };
    for (const s of ['http', 'https']) {
      try { session.defaultSession.protocol.unhandle(s); } catch (_) {}
      session.defaultSession.protocol.handle(s, risposta);
    }
    globalThis.SN_SAFEBROWSE.setProviders({
      gsb: async () => ({ listed: true, category: 'phishing' }),
      rdap: null, ct: null, sandbox: null,
      llm: async () => ({ suspicious: false, reason: null }),
    });
  });
  await shell.evaluate((u) => window.filoShell.tabs.open(u), 'https://conto-destro.com/login');
  let page = null;
  for (let i = 0; i < 100 && !page; i++) {
    page = app.windows().find((w) => { try { return new URL(w.url()).hostname === 'conto-destro.com'; } catch (_) { return false; } });
    if (!page) await new Promise((r) => setTimeout(r, 100));
  }
  await expect(page.getByText('Sito segnalato come pericoloso')).toBeVisible({ timeout: 8_000 });
  await page.waitForTimeout(1000);
  await page.getByText('Sito segnalato come pericoloso').click({ button: 'right' });
  const menu = page.locator('.sn-menu').first();
  await expect(menu).toBeVisible({ timeout: 3000 });
  const sopra = await menu.evaluate((m) => {
    const host = document.getElementById('filo-safebrowse-host');
    return !host || !host.shadowRoot.querySelector('dialog')?.matches(':modal') || !!m.closest('dialog');
  });
  expect(sopra, 'il menu sta sotto l\'avviso modale, quindi inerte').toBe(true);
});
