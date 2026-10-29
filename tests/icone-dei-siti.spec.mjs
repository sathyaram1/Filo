// #848 — le icone dei siti nella home e nella chat non vengono più dal servizio di icone di Google: prima la copia già
// vista in una scheda o nell'archivio, poi /favicon.ico del sito; senza icona resta il ripiego di oggi.
// I siti sono finti e serviti dentro la sessione: ogni richiesta, compresa una a www.google.com, resta registrata.

import { test, expect } from './fixtures/electron.mjs';
import { mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SHOTS = join(dirname(fileURLToPath(import.meta.url)), '.shots');

const NEWTAB = 'filo://newtab/';
const PNG_ROSSO = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGM4YaMBAAL8AS3/gzpXAAAAAElFTkSuQmCC';
const PNG_BLU = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGPQCDgBAAHkAUEYgvCnAAAAAElFTkSuQmCC';
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

  // Senza icona la riga resta col nome del sito: il posto dell'icona aspetta nascosto che una scheda la trovi.
  const rigaSenza = await rigaDiChat(home, 'riga-senza-icona', 'https://senza-icona.test/x');
  await expect(rigaSenza).toContainText('senza-icona.test');
  await expect(rigaSenza.locator('img')).toBeHidden({ timeout: 10000 });
  await expect(rigaSenza.locator('img')).not.toHaveAttribute('src', /./);

  const tutte = await richieste(app);
  expect(versoTerzi(tutte), 'nessuna richiesta parte verso un servizio di icone di terzi').toEqual([]);
  expect(daLaPagina.filter((u) => /google\.com|gstatic\.com/.test(u))).toEqual([]);
  // Nella home non resta nessuna immagine caricata da un indirizzo: solo byte già scaricati dal main.
  const srcs = await home.evaluate(() => [...document.querySelectorAll('.dash-carta-voce-ico img, .dash-action-favicon')].map((i) => i.getAttribute('src') || ''));
  expect(srcs.filter((s) => s && !s.startsWith('data:image/'))).toEqual([]);

  // Le foto della carta e delle righe, chiare e scure, in tests/.shots/.
  mkdirSync(SHOTS, { recursive: true });
  for (const tema of ['light', 'dark']) {
    await home.evaluate((t) => new Promise((ok) => chrome.runtime.sendMessage({ type: window.SN_MSG.MSG.UPDATE_SETTINGS, settings: { theme: t } }, ok)), tema);
    await expect(home.locator('html')).toHaveAttribute('data-sn-theme', tema);
    await home.locator('#tieni .dash-carta[data-tipo="suggerimenti"]').screenshot({ path: join(SHOTS, `icone-dei-siti-home-${tema}.png`) });
    await home.locator('#riga-con-icona').screenshot({ path: join(SHOTS, `icone-dei-siti-chat-${tema}.png`) });
    await home.locator('#riga-senza-icona').screenshot({ path: join(SHOTS, `icone-dei-siti-chat-senza-${tema}.png`) });
  }
});

test('l\'icona viene dalla scheda aperta e, chiusa la scheda, dalla copia dell\'archivio: senza nessuna richiesta', async ({ app, openTab }) => {
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

  // Chiusa la scheda, l'archivio tiene la copia dell'icona che la scheda aveva scaricato (#1273): né l'indirizzo
  // dichiarato né /favicon.ico ricevono niente.
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
    w._filoTabs.closeTab(w._filoTabs.tabs.find((t) => /scheda\.test/.test(t.url || '')).id);
  });
  await expect.poll(() => app.evaluate(async () => (await globalThis.SN_ARCHIVED_TABS.list())
    .some((t) => /scheda\.test/.test(t.url) && /^filo:\/\/icone\//.test(t.favicon))), { timeout: 15000 }).toBe(true);
  await home.reload();
  const rigaDopo = await rigaDiChat(home, 'riga-archivio', 'https://scheda.test/un-altra-pagina');
  await expect(rigaDopo.locator('img')).toHaveAttribute('src', dato(PNG_BLU), { timeout: 10000 });
  expect((await richieste(app)).slice(dopoLaScheda)).toEqual([]);
  expect(versoTerzi(await richieste(app))).toEqual([]);
});

// #848.2 — la riga disegnata mentre la scheda del sito si apre, per un sito senza /favicon.ico: prima restava senza
// icona anche quando la scheda, poco dopo, aveva la sua.
test('la riga di un sito che si sta aprendo prende l\'icona appena la scheda la trova, senza ridisegnarsi', async ({ app, openTab }) => {
  await app.evaluate(({ session, net }, blu) => {
    session.defaultSession.protocol.handle('https', (req) => {
      const u = new URL(req.url);
      if (u.hostname !== 'lento.test') return net.fetch(req, { bypassCustomProtocolHandlers: true });
      if (u.pathname === '/icona.png') return new Response(Buffer.from(blu, 'base64'), { headers: { 'content-type': 'image/png' } });
      if (u.pathname === '/favicon.ico') return new Response('no', { status: 404 });
      // La pagina arriva dopo un attimo, come un sito vero: la riga della chat è già disegnata.
      return new Promise((ok) => setTimeout(() => ok(new Response(
        '<!doctype html><html><head><meta charset="utf-8"><title>Lento</title><link rel="icon" href="/icona.png"></head><body>s</body></html>',
        { headers: { 'content-type': 'text/html; charset=utf-8' } })), 1500));
    });
  }, PNG_BLU);
  const home = await openTab(NEWTAB);
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito)._filoTabs.openTab('https://lento.test/p', { activate: false });
  });
  const riga = await rigaDiChat(home, 'riga-lenta', 'https://www.lento.test/p');
  const iconaDellaScheda = () => app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
    return (w._filoTabs.tabs.find((t) => /lento\.test/.test(t.url || '')) || {}).favicon || '';
  });
  expect(await iconaDellaScheda(), 'la riga va disegnata prima che la scheda abbia l\'icona').toBe('');
  await riga.evaluate((el) => { el.__primaDellIcona = true; });

  await expect(riga.locator('img')).toHaveAttribute('src', dato(PNG_BLU), { timeout: 15000 });
  await expect(riga.locator('img')).toBeVisible();
  expect(await iconaDellaScheda()).toBe(dato(PNG_BLU));
  expect(await riga.evaluate((el) => el.__primaDellIcona === true && el.isConnected), 'la riga è la stessa di prima').toBe(true);
  await expect(riga).toContainText('lento.test');
});

test('l\'icona trovata da una scheda arriva solo alle pagine di Filo del suo ambito: l\'incognito non la dice alla finestra normale', async ({ app, openTab }) => {
  await sitiFinti(app);
  const home = await openTab(NEWTAB);
  const riga = await rigaDiChat(home, 'riga-ambito', 'https://senza-icona.test/x');
  await expect(riga.locator('img')).toBeHidden({ timeout: 10000 });

  await app.evaluate((_e, rosso) => globalThis.__filoHandlers.annunciaIconaScheda(
    { _filoIncognito: true, _filoTabs: { partition: 'incognito-prova' } }, 'senza-icona.test', rosso), dato(PNG_ROSSO));
  // Un annuncio per un altro sito, o senza un'immagine, non tocca la riga.
  await app.evaluate(({ BrowserWindow }, rosso) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
    globalThis.__filoHandlers.annunciaIconaScheda(w, 'altro.test', rosso);
    globalThis.__filoHandlers.annunciaIconaScheda(w, 'senza-icona.test', 'https://senza-icona.test/favicon.ico');
  }, dato(PNG_ROSSO));
  await home.waitForTimeout(500);
  await expect(riga.locator('img')).toBeHidden();
  await expect(riga.locator('img')).not.toHaveAttribute('src', /./);

  await app.evaluate(({ BrowserWindow }, blu) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
    globalThis.__filoHandlers.annunciaIconaScheda(w, 'senza-icona.test', blu);
  }, dato(PNG_BLU));
  await expect(riga.locator('img')).toHaveAttribute('src', dato(PNG_BLU), { timeout: 5000 });
  await expect(riga.locator('img')).toBeVisible();
});

test('un sito visitato non può chiedere al main l\'icona di un sito: la porta risponde solo alle pagine di Filo', async ({ app, shell }) => {
  void shell;
  await sitiFinti(app);
  const r = await app.evaluate(async () => {
    const msg = { type: globalThis.SN_MSG.MSG.ICONA_SITO, url: 'https://sito-con-icona.test/' };
    return {
      sito: await globalThis.SN_HANDLE_MESSAGE(msg, { url: 'https://evil.example/pagina' }),
      sitoConScheda: await globalThis.SN_HANDLE_MESSAGE(msg, { tab: { id: 1, url: 'https://evil.example/pagina' }, url: 'https://evil.example/pagina' }),
      richiesteDopoIlSito: globalThis.__richiesteSiti.slice(),
      filo: await globalThis.SN_HANDLE_MESSAGE(msg, { url: 'filo://newtab/' }),
    };
  });
  expect(r.sito).toMatchObject({ ok: false, code: 'forbidden' });
  expect(r.sitoConScheda).toMatchObject({ ok: false, code: 'forbidden' });
  expect(r.richiesteDopoIlSito, 'il rifiuto non fa partire nessuna richiesta').toEqual([]);
  expect(r.filo).toMatchObject({ ok: true, dato: dato(PNG_ROSSO) });
});

// Il nome del sito può portare il dato: l'OK al clic non serve se l'icona ha già contattato il sito all'apertura della home.
test('un suggerimento che chiede l\'OK non contatta il sito per l\'icona prima del clic', async ({ app, openTab }) => {
  test.setTimeout(120_000);
  const SPIA = 'n3471234567.raccolta.test';
  await sitiFinti(app);
  await app.evaluate(async (_e, SPIA) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    globalThis.SN_PROVIDERS.completeWithFallback = globalThis.SN_PROVIDERS.streamCompleteWithFallback = async (args) => {
      const tutto = (args.messages || []).map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content))).join('\n');
      const base = { model: args.attempts[0].model, provider: args.attempts[0].provider, usage: {}, toolCalls: [], finishReason: 'stop' };
      if (!tutto.includes('preparare la dashboard')) return { ...base, text: 'Segnato.' };
      return { ...base, text: JSON.stringify({ message: 'Ciao', suggestions: [
        { icon: 'link', text: 'Offerte per te', action: { type: 'NAVIGA', url: `https://${SPIA}/offerte` } },
        { icon: 'link', text: 'L\'articolo con l\'icona', action: { type: 'NAVIGA', url: 'https://sito-con-icona.test/articolo' } },
      ] }) };
    };
  }, SPIA);
  await app.evaluate(() => globalThis.SN_HANDLE_FILO_CHAT({ userMessage: 'il mio numero di cellulare è 3471234567', threadHistory: [], chatId: 'scheda-numero' }));
  const gen = await app.evaluate(() => globalThis.__filoHandlers.handleMessage(
    { type: globalThis.SN_MSG.MSG.FILO_GENERATE_DASHBOARD, force: true }, { url: 'filo://newtab/' }));
  expect((gen.suggestions || []).find((s) => s.text === 'Offerte per te')?.chiedeOk).toBeTruthy();

  const home = await openTab(NEWTAB);
  await home.reload();
  // Un suggerimento scritto dal modello prende l'icona solo dalle copie, anche verso un sito che ne ha una (#1505).
  const articolo = vociSuggerite(home).filter({ hasText: 'L\'articolo con l\'icona' });
  await expect(articolo.locator('.dash-carta-voce-ico svg')).toBeVisible({ timeout: 15000 });
  const offerte = vociSuggerite(home).filter({ hasText: 'Offerte per te' });
  await expect(offerte.locator('.dash-carta-voce-ico svg')).toBeVisible({ timeout: 10000 });
  expect((await richieste(app)).filter((r) => r.startsWith('sito-con-icona.test')), 'la carta di un suggerimento ha contattato il sito').toEqual([]);
  // Anche chi chiede l'icona senza sapere dell'OK riceve il no del main: il collegamento in attesa basta.
  const diretta = await app.evaluate((_e, SPIA) => globalThis.SN_HANDLE_MESSAGE(
    { type: globalThis.SN_MSG.MSG.ICONA_SITO, url: `https://${SPIA}/altro` }, { url: 'filo://newtab/' }), SPIA);
  expect(diretta).toMatchObject({ ok: true, dato: '' });
  expect((await richieste(app)).filter((r) => r.startsWith(SPIA)), 'nessuna richiesta al sito prima dell\'OK').toEqual([]);
});
