// VERIFICA #728 giro 1 — la lamentela coi suoi esempi: una parola comune a una
// lettera da un marchio corto apre il popup che si chiude con «Continua», mai il
// blocco a tutta pagina; un clic e si è sulla pagina voluta.

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
    // Niente rete vera: età del dominio e liste nere restano ignote, conta solo il nome.
    globalThis.SN_SAFEBROWSE.setProviders({ gsb: null, rdap: null, ct: null, sandbox: null, llm: null });
  }, pagine);
}

const ESEMPI = [
  ['team.com', 'Steam'],
  ['email.com', 'Gmail'],
  ['photon.com', 'Proton'],
  ['posts.com', 'Poste Italiane'],
  ['apply.com', 'Apple'],
];

for (const [host, marchio] of ESEMPI) {
  test(`${host}: popup «Continua», non il blocco da «confermo»`, async ({ app, openTab }) => {
    await servi(app, { [host]: `<h1>Pagina di ${host}</h1><p>contenuto vero</p>` });
    const page = await openTab(`https://${host}/`);
    const continua = page.getByRole('button', { name: 'Continua' });
    await expect(continua).toBeVisible({ timeout: 12_000 });
    await expect(page.getByPlaceholder('confermo')).toHaveCount(0);
    await expect(page.getByText(new RegExp(`assomiglia all'indirizzo di ${marchio}`))).toBeVisible();
    if (host === 'posts.com') await page.screenshot({ path: 'tests/.shots/verifica-728-posts.png' });
    await continua.click();
    await expect(continua).toHaveCount(0, { timeout: 6_000 });
    await expect(page.getByRole('heading', { name: `Pagina di ${host}` })).toBeVisible();
    // Ricaricando nella stessa scheda il popup già chiuso non torna.
    await page.reload();
    await expect(page.getByRole('heading', { name: `Pagina di ${host}` })).toBeVisible();
    await page.waitForTimeout(2500);
    await expect(page.getByRole('button', { name: 'Continua' })).toHaveCount(0);
  });
}
