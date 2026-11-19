// #2177 giro 1: con il modello a copione nessuna connessione esce da questa macchina, a nessuno strato del main
// (fetch di Node, socket, DNS, rete di Chromium usata dal main). Spia sotto ogni strato, poi un turno con strumenti.

import { test, expect } from '../../fixtures/electron.mjs';
import { newtabPage, configureModel, copione, ripristina } from '../../helpers/copione.mjs';

async function spia(app) {
  await app.evaluate(({ net: enet, session }) => {
    const rq = process.mainModule.require;
    const uscite = globalThis.__uscite = [];
    const locale = (h) => !h || h === 'localhost' || /^127\./.test(h) || h === '::1' || h === '[::1]';
    const segna = (strato, h) => { h = String(h || '').toLowerCase(); if (!locale(h)) uscite.push(`${strato}:${h}`); };
    const hostDi = (u) => { try { return new URL(String(u && u.url ? u.url : u)).hostname; } catch (_) { return String(u); } };
    const net = rq('node:net');
    const tls = rq('node:tls');
    const dns = rq('node:dns');
    const opz = (a) => (a && typeof a[0] === 'object' ? (a[0].host || a[0].servername) : a[1]);
    for (const [m, nome] of [[net, 'connect'], [net, 'createConnection'], [tls, 'connect']]) {
      const v = m[nome];
      m[nome] = function (...a) { segna(`node.${nome}`, opz(a)); return v.apply(this, a); };
    }
    const lv = dns.lookup;
    dns.lookup = function (h, ...a) { segna('dns', h); return lv.call(this, h, ...a); };
    const nr = enet.request.bind(enet);
    enet.request = (o) => { segna('electron.net.request', hostDi(typeof o === 'string' ? o : (o.url || o.hostname))); return nr(o); };
    const nf = enet.fetch.bind(enet);
    enet.fetch = (u, i) => { segna('electron.net.fetch', hostDi(u)); return nf(u, i); };
    const sf = session.defaultSession.fetch.bind(session.defaultSession);
    session.defaultSession.fetch = (u, i) => { segna('session.fetch', hostDi(u)); return sf(u, i); };
  });
}

test('con il modello a copione un turno con strumenti non apre connessioni fuori da questa macchina', async ({ app, shell }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await spia(app);
  await configureModel(app);
  await copione(app, [
    { pensa: ['Cerco. '], ogni: 100, dopoStrumenti: 100, strumenti: [{ id: 'w1', name: 'CERCA_WEB', arguments: '{"query":"cambio 30 dollari in euro"}' }] },
    { pensa: ['Metto il timer. '], ogni: 100, dopoStrumenti: 100, strumenti: [{ id: 't1', name: 'TIMER', arguments: '{"secondi":120,"etichetta":"Pasta"}' }] },
    { testo: 'Fatto: 30 dollari sono circa 27 euro.' },
  ]);
  await page.locator('#input').fill('quanto sono 30 dollari in euro? poi metti un timer');
  await page.locator('#input').press('Enter');
  await expect(page.locator('.dash-bubble-filo').last()).toContainText('27 euro', { timeout: 20_000 });
  // Le chiamate di contorno (titolo, memoria, suggerimenti) partono dopo la risposta.
  await page.waitForTimeout(8_000);
  const uscite = await app.evaluate(() => [...new Set(globalThis.__uscite)]);
  await ripristina(app);
  expect(uscite).toEqual([]);
});
