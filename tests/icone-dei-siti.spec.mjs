// #848 — le icone dei siti nella home e nella chat non vengono più dal servizio di icone di Google: prima la copia già
// vista in una scheda o nell'archivio, poi /favicon.ico del sito; senza icona resta il ripiego di oggi.
// I siti sono finti e serviti dentro la sessione: ogni richiesta, compresa una a www.google.com, resta registrata.

import { test, expect } from './fixtures/electron.mjs';

const NEWTAB = 'filo://newtab/';
const PNG_ROSSO = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==';
const PNG_BLU = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPj/HwADBwIAMCbHYQAAAABJRU5ErkJggg==';
const dato = (b64) => `data:image/png;base64,${b64}`;

// sito-con-icona.test ha solo /favicon.ico; scheda.test dichiara la sua icona in un altro indirizzo; senza-icona.test niente.
async function sitiFinti(app) {
  await app.evaluate(({ session, net }, { rosso, blu }) => {
    const richieste = [];
    globalThis.__richiesteSiti = richieste;
    const png = (b64) => new Response(Buffer.from(b64, 'base64'), { headers: { 'content-type': 'image/png' } });
    const html = (testa) => new Response(`<!doctype html><html><head><meta charset="utf-8"><title>Sito</title>${testa}</head><body><h1>Sito</h1></body></html>`,
      { headers: { 'content-type': 'text/html; charset=utf-8' } });
    session.defaultSession.protocol.handle('https', (req) => {
      const u = new URL(req.url);
      const finto = /\.test$/.test(u.hostname) || /(^|\.)google\.com$/.test(u.hostname) || /gstatic\.com$/.test(u.hostname);
      if (!finto) return net.fetch(req, { bypassCustomProtocolHandlers: true });
      richieste.push(`${u.hostname}${u.pathname}`);
      if (u.hostname === 'sito-con-icona.test' && u.pathname === '/favicon.ico') return png(rosso);
      if (u.hostname === 'scheda.test' && u.pathname === '/icona-della-scheda.png') return png(blu);
      if (u.hostname === 'scheda.test') return html('<link rel="icon" href="/icona-della-scheda.png">');
      if (/\.test$/.test(u.hostname) && !/\.(ico|png)$/.test(u.pathname)) return html('');
      return new Response('<!doctype html><title>404</title>', { status: 404, headers: { 'content-type': 'text/html' } });
    });
  }, { rosso: PNG_ROSSO, blu: PNG_BLU });
}

const richieste = (app) => app.evaluate(() => globalThis.__richiesteSiti.slice());
const versoTerzi = (lista) => lista.filter((r) => /google\.com|gstatic\.com/.test(r));

async function rigaDiChat(page, id, url) {
  await page.evaluate(({ id, url }) => {
    document.getElementById(id)?.remove();
    const host = document.createElement('div');
    host.id = id;
    document.body.appendChild(host);
    window.__filoDashActions.renderActions(host, [{ type: 'NAVIGA', url }]);
  }, { id, url });
  return page.locator(`#${id} .dash-action-link-chip`);
}

const vociSuggerite = (page) => page.locator('#tieni .dash-carta[data-tipo="suggerimenti"] .dash-carta-voce');

test('la home e la chat mostrano l\'icona dei siti senza chiedere niente a Google', async ({ app, openTab }) => {
  await sitiFinti(app);
  await app.evaluate(async () => {
    await globalThis.SN_SAVED_PAGES.save({ url: 'https://senza-icona.test/ricetta', title: 'La ricetta senza icona' });
    await globalThis.SN_SAVED_PAGES.save({ url: 'https://sito-con-icona.test/articolo', title: 'L\'articolo con l\'icona' });
  });
  const home = await openTab(NEWTAB);
  const daLaPagina = [];
  home.on('request', (r) => daLaPagina.push(r.url()));
  await home.reload();

  // Il suggerimento verso il sito con /favicon.ico ne porta l'icona, come data: URL arrivato dal main.
  const conIcona = vociSuggerite(home).filter({ hasText: 'L\'articolo con l\'icona' });
  await expect(conIcona).toBeVisible({ timeout: 15000 });
  await expect(conIcona.locator('.dash-carta-voce-ico img')).toHaveAttribute('src', dato(PNG_ROSSO), { timeout: 10000 });
  // Quello verso un sito senza icona tiene il ripiego di oggi: il globo, nessuna immagine rotta.
  const senza = vociSuggerite(home).filter({ hasText: 'La ricetta senza icona' });
  await expect(senza.locator('.dash-carta-voce-ico svg')).toBeVisible({ timeout: 10000 });
  await expect(senza.locator('.dash-carta-voce-ico img')).toHaveCount(0);

  // Una riga di attività della chat verso lo stesso sito: stessa icona, senza richiederla.
  const prima = (await richieste(app)).filter((r) => r === 'sito-con-icona.test/favicon.ico').length;
  expect(prima).toBe(1);
  const riga = await rigaDiChat(home, 'riga-con-icona', 'https://sito-con-icona.test/altro');
  await expect(riga).toContainText('sito-con-icona.test');
  await expect(riga.locator('img')).toHaveAttribute('src', dato(PNG_ROSSO));
  expect((await richieste(app)).filter((r) => r === 'sito-con-icona.test/favicon.ico')).toHaveLength(1);

  // Senza icona la riga resta col nome del sito.
  const rigaSenza = await rigaDiChat(home, 'riga-senza-icona', 'https://senza-icona.test/x');
  await expect(rigaSenza).toContainText('senza-icona.test');
  await expect(rigaSenza.locator('img')).toHaveCount(0, { timeout: 10000 });

  const tutte = await richieste(app);
  expect(versoTerzi(tutte), 'nessuna richiesta parte verso un servizio di icone di terzi').toEqual([]);
  expect(daLaPagina.filter((u) => /google\.com|gstatic\.com/.test(u))).toEqual([]);
  // Nella home non resta nessuna immagine caricata da un indirizzo: solo byte già scaricati dal main.
  const srcs = await home.evaluate(() => [...document.querySelectorAll('.dash-carta-voce-ico img, .dash-action-favicon')].map((i) => i.getAttribute('src') || ''));
  expect(srcs.filter((s) => s && !s.startsWith('data:image/'))).toEqual([]);
});

test('l\'icona viene dalla scheda aperta e, chiusa la scheda, dall\'archivio: mai da /favicon.ico se il sito ne dichiara un\'altra', async ({ app, openTab }) => {
  await sitiFinti(app);
  await openTab('https://scheda.test/pagina');
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
    return (w._filoTabs.tabs.find((t) => /scheda\.test/.test(t.url || '')) || {}).favicon || '';
  }), { timeout: 15000 }).toBe(dato(PNG_BLU));
  const dopoLaScheda = (await richieste(app)).length;

  const home = await openTab(NEWTAB);
  const riga = await rigaDiChat(home, 'riga-scheda', 'https://scheda.test/un-altra-pagina');
  await expect(riga.locator('img')).toHaveAttribute('src', dato(PNG_BLU), { timeout: 10000 });
  expect((await richieste(app)).slice(dopoLaScheda), 'la copia della scheda aperta non chiede niente a nessuno').toEqual([]);

  // Chiusa la scheda, l'archivio ricorda l'indirizzo che il sito dichiarava: la home lo usa, senza passare da /favicon.ico.
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
    w._filoTabs.closeTab(w._filoTabs.tabs.find((t) => /scheda\.test/.test(t.url || '')).id);
  });
  await expect.poll(() => app.evaluate(async () => (await globalThis.SN_ARCHIVED_TABS.list())
    .some((t) => /scheda\.test/.test(t.url) && t.favicon)), { timeout: 15000 }).toBe(true);
  await home.reload();
  const rigaDopo = await rigaDiChat(home, 'riga-archivio', 'https://scheda.test/un-altra-pagina');
  await expect(rigaDopo.locator('img')).toHaveAttribute('src', dato(PNG_BLU), { timeout: 10000 });
  const nuove = (await richieste(app)).slice(dopoLaScheda);
  expect(nuove).toEqual(['scheda.test/icona-della-scheda.png']);
  expect(versoTerzi(await richieste(app))).toEqual([]);
});

test('un sito web non può chiedere al main l\'icona di un sito', async ({ openTab, testServer }) => {
  const page = await openTab(testServer.html('<!doctype html><title>Sito</title><h1>sito</h1>'));
  const r = await page.evaluate(() => new Promise((res) => {
    try { chrome.runtime.sendMessage({ type: 'icona_sito', url: 'https://sito-con-icona.test/' }, (x) => res(x || null)); } catch (e) { res({ eccezione: String(e) }); }
  }));
  expect(r && r.dato).toBeFalsy();
});
