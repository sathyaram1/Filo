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

// L'avviso sta in una vista sopra la scheda, non nella pagina.
async function vistaAvviso(app, ms = 12_000) {
  const fine = Date.now() + ms;
  while (Date.now() < fine) {
    const p = app.windows().find((w) => { try { return w.url().startsWith('filo://shell/avviso-sito.html'); } catch (_) { return false; } });
    if (p) return p;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('la vista dell\'avviso non è nata');
}

const coperta = (app) => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()
  .some((w) => w._filoTabs && w._filoTabs.avvisoSito && !!w._filoTabs.avvisoSito.coperta()));

for (const [host, marchio] of ESEMPI) {
  test(`${host}: popup «Continua», non il blocco da «confermo»`, async ({ app, openTab }) => {
    await servi(app, { [host]: `<h1>Pagina di ${host}</h1><p>contenuto vero</p>` });
    const page = await openTab(`https://${host}/`);
    const avviso = await vistaAvviso(app);
    const continua = avviso.getByRole('button', { name: 'Continua' });
    await expect(continua).toBeVisible({ timeout: 12_000 });
    await expect(avviso.getByPlaceholder('confermo')).toHaveCount(0);
    await expect(avviso.getByText(new RegExp(`assomiglia all'indirizzo di ${marchio}`))).toBeVisible();
    if (host === 'posts.com') await avviso.screenshot({ path: 'tests/.shots/verifica-728-posts.png' });
    await continua.click();
    await expect.poll(() => coperta(app)).toBe(false);
    await expect(page.getByRole('heading', { name: `Pagina di ${host}` })).toBeVisible();
    // Ricaricando nella stessa scheda il popup già chiuso non torna.
    await page.reload();
    await expect(page.getByRole('heading', { name: `Pagina di ${host}` })).toBeVisible();
    await page.waitForTimeout(2500);
    expect(await coperta(app)).toBe(false);
  });
}
