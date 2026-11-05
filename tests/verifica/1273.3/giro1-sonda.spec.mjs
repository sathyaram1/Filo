// #1273.3 giro 1 — sonda del verificatore: un sito con la regola «da un altro paese» non riceve mai la richiesta dell'icona
// dalla connessione vera (link salvato da una scheda normale, voce di prima, suggerimenti della home e della chat).
// Ogni richiesta https della sessione normale resta registrata; la controprova su un sito senza regola parte davvero.

import { test, expect } from '../../fixtures/electron.mjs';

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGM4YaMBAAL8AS3/gzpXAAAAAElFTkSuQmCC';

async function sitiFinti(app) {
  await app.evaluate(({ session, net }, png64) => {
    const richieste = [];
    globalThis.__richiesteSiti = richieste;
    const png = () => new Response(Buffer.from(png64, 'base64'), { headers: { 'content-type': 'image/png' } });
    session.defaultSession.protocol.handle('https', (req) => {
      const u = new URL(req.url);
      if (!/\.test$/.test(u.hostname)) return net.fetch(req, { bypassCustomProtocolHandlers: true });
      richieste.push(`${u.hostname}${u.pathname}`);
      if (/\.(ico|png)$/.test(u.pathname)) return png();
      return new Response('<!doctype html><title>Sito</title><h1>Sito</h1>', { headers: { 'content-type': 'text/html; charset=utf-8' } });
    });
  }, PNG);
}

const richieste = (app) => app.evaluate(() => globalThis.__richiesteSiti.slice());
const versoRegola = (lista) => lista.filter((r) => /(^|\.)regola\.test\//.test(r) || /regola\.png$/.test(r));

test('un sito con la regola del paese non riceve la richiesta dell\'icona dalla connessione vera', async ({ app, openTab }) => {
  test.setTimeout(90_000);
  await sitiFinti(app);
  await app.evaluate(async () => { await globalThis.SN_FILO_MEMORY.setProxyRule('www.regola.test', { country: 'us' }); });

  // Link salvato per dopo da una scheda normale (nessun proxy sulla scheda), col sito di controllo accanto.
  await app.evaluate(async () => {
    await globalThis.SN_SAVED_PAGES.save({ url: 'https://regola.test/articolo', title: 'Con la regola' }, { proxy: null });
    await globalThis.SN_SAVED_PAGES.save({ url: 'https://m.regola.test/mobile', title: 'Sottodominio con la regola' }, { proxy: null });
    await globalThis.SN_SAVED_PAGES.save({ url: 'https://libero.test/articolo', title: 'Senza regola' }, { proxy: null });
  });
  await expect.poll(async () => (await richieste(app)).includes('libero.test/favicon.ico'), { timeout: 20_000 }).toBe(true);
  expect(versoRegola(await richieste(app)), 'link salvato: nessuna richiesta al sito con la regola').toEqual([]);

  // Voci di prima con l'indirizzo dell'icona dichiarato dalla pagina, sul server d'immagini della piattaforma.
  await app.evaluate(async () => {
    const K = globalThis.SN_CONST.STORAGE_KEYS.SAVED_PAGES;
    const r = await globalThis.chrome.storage.local.get(K);
    const voci = r[K] || [];
    voci.push({ id: 'vecchia-regola', url: 'https://www.regola.test/vecchia', title: 'Vecchia', favicon: 'https://cdn-piattaforma.test/i/regola.png', savedAt: new Date().toISOString() });
    voci.push({ id: 'vecchia-libera', url: 'https://libero.test/vecchia', title: 'Vecchia libera', favicon: 'https://cdn-piattaforma.test/i/libero.png', savedAt: new Date().toISOString() });
    await globalThis.chrome.storage.local.set({ [K]: voci });
    await globalThis.__filoIconeVecchie.completa();
  });
  await expect.poll(async () => (await richieste(app)).includes('cdn-piattaforma.test/i/libero.png'), { timeout: 20_000 }).toBe(true);
  expect(versoRegola(await richieste(app)), 'voce di prima: nessuna richiesta all\'icona dichiarata').toEqual([]);

  // Suggerimenti della home e righe della chat: la stessa porta che usano le pagine di Filo.
  const home = await openTab('filo://newtab/');
  const chiedi = (url) => home.evaluate((u) => new Promise((ok) => chrome.runtime.sendMessage({ type: window.SN_MSG.MSG.ICONA_SITO, url: u }, ok)), url);
  await chiedi('https://altro-libero.test/pagina');
  await chiedi('https://regola.test/pagina');
  await chiedi('https://www.regola.test/');
  await chiedi('https://shop.regola.test/x');
  await chiedi('https://REGOLA.test./maiuscole');
  await expect.poll(async () => (await richieste(app)).includes('altro-libero.test/favicon.ico'), { timeout: 15_000 }).toBe(true);
  expect(versoRegola(await richieste(app)), 'home e chat: nessuna richiesta al sito con la regola').toEqual([]);

  // Tolta la regola, il sito torna normale: l'icona del link salvato si chiede.
  await app.evaluate(async () => {
    await globalThis.SN_FILO_MEMORY.removeProxyRule('regola.test');
    await globalThis.__filoIconeVecchie.completa();
  });
  await expect.poll(async () => (await richieste(app)).includes('regola.test/favicon.ico'), { timeout: 20_000 }).toBe(true);
});
