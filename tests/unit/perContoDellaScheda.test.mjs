// #1272 — le richieste che il main fa per conto di una scheda: Referer al massimo l'origine della pagina (mai da https a
// http, mai contro la sua politica), mai verso la rete di casa, il nome risolto dal proxy quando la scheda ne ha uno.
// Rete finta: DNS e il singolo passo della richiesta sostituiti; la richiesta vera la prova tests/proxy-tab.spec.mjs.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const DNS = {
  'cdn.example': ['93.184.216.34'],
  'pagina.example': ['93.184.216.35'],
  'img.pagina.example': ['93.184.216.36'],
  'riquadro.example': ['93.184.216.37'],
  'interno.example': ['192.168.1.20'],
};
let chiestiAlDns = [];
require('node:dns').promises.lookup = async (host) => {
  chiestiAlDns.push(String(host));
  const ip = DNS[String(host).toLowerCase()];
  if (!ip) { const e = new Error('ENOTFOUND ' + host); e.code = 'ENOTFOUND'; throw e; }
  return ip.map((address) => ({ address, family: 4 }));
};

const P = require('../../src/main/services/perContoDellaScheda.js');

let passi = [];
let rotte = {};
P._dip.richiesta = async (ses, url, opz) => {
  passi.push({ ses, url, ...opz });
  const r = rotte[url];
  if (r && r.redirect) return { rimando: r.redirect };
  return { risposta: new Response('ok', { status: 200, headers: { 'content-type': 'image/png' } }) };
};

const DIRETTA = { resolveProxy: async () => 'DIRECT' };
const PROXATA = { resolveProxy: async () => 'SOCKS5 127.0.0.1:1080' };
const scheda = (url, session = DIRETTA, frameUrl = null) => ({
  wc: { id: 4, session, getUserAgent: () => 'Mozilla/5.0 (Filo)', isDestroyed: () => false },
  url, tab: { url }, frame: frameUrl ? { url: frameUrl } : { url },
});

beforeEach(() => { passi = []; rotte = {}; chiestiAlDns = []; });

test('il Referer è al massimo l\'origine della pagina, mai da https a http, mai contro la sua politica', () => {
  const pagina = 'https://pagina.example/cerca?q=diagnosi&token=abc#x';
  assert.equal(P.refererPerConto(pagina, 'https://cdn.example/foto.jpg'), 'https://pagina.example/');
  assert.equal(P.refererPerConto(pagina, 'http://cdn.example/foto.jpg'), '');
  assert.equal(P.refererPerConto('http://pagina.example/a?b=c', 'https://cdn.example/f.jpg'), 'http://pagina.example/');
  assert.equal(P.refererPerConto(pagina, 'https://cdn.example/f.jpg', ['no-referrer']), '');
  assert.equal(P.refererPerConto(pagina, 'https://cdn.example/f.jpg', ['never']), '');
  assert.equal(P.refererPerConto(pagina, 'https://cdn.example/f.jpg', ['unsafe-url', 'no-referrer']), '', 'conta la più stretta');
  assert.equal(P.refererPerConto(pagina, 'https://cdn.example/f.jpg', ['same-origin']), '');
  assert.equal(P.refererPerConto(pagina, 'https://pagina.example/f.jpg', ['same-origin']), 'https://pagina.example/');
  assert.equal(P.refererPerConto(pagina, 'https://cdn.example/f.jpg', ['unsafe-url']), 'https://pagina.example/', 'mai più dell\'origine');
  // Un'intestazione con più valori vale per l'ultimo che si capisce.
  assert.equal(P.politicaDi('no-referrer, strict-origin-when-cross-origin'), 'strict-origin-when-cross-origin');
  assert.equal(P.politicaDi('unsafe-url, sconosciuta'), 'unsafe-url');
  for (const p of ['filo://newtab/', 'file:///C:/x.html', 'about:blank', '', 'non un indirizzo']) {
    assert.equal(P.refererPerConto(p, 'https://cdn.example/f.jpg'), '', `da ${p || '(vuota)'}`);
  }
});

test('la politica dell\'intestazione di un documento vale per lui, nella sua scheda, frammento a parte', () => {
  P.ricordaPoliticaDocumento({ resourceType: 'mainFrame', webContentsId: 9, url: 'https://pagina.example/a', responseHeaders: { 'Referrer-Policy': ['no-referrer'] } });
  assert.equal(P.politicaDocumento(9, 'https://pagina.example/a#sezione'), 'no-referrer');
  assert.equal(P.politicaDocumento(10, 'https://pagina.example/a'), '');
  // Le risorse non sono documenti; un documento nuovo senza intestazione cancella quella di prima.
  P.ricordaPoliticaDocumento({ resourceType: 'image', webContentsId: 9, url: 'https://pagina.example/b', responseHeaders: { 'referrer-policy': ['no-referrer'] } });
  assert.equal(P.politicaDocumento(9, 'https://pagina.example/b'), '');
  P.ricordaPoliticaDocumento({ resourceType: 'mainFrame', webContentsId: 9, url: 'https://pagina.example/a', responseHeaders: {} });
  assert.equal(P.politicaDocumento(9, 'https://pagina.example/a'), '');
});

test('un\'immagine si chiede dalla sessione della scheda, col suo user agent e la sola origine come Referer', async () => {
  const s = scheda('https://pagina.example/profilo?id=42');
  const r = await P.perContoDellaScheda(s, 'https://cdn.example/foto.jpg', { credenziali: 'include', conReferer: true });
  assert.equal(r.status, 200);
  assert.equal(r.url, 'https://cdn.example/foto.jpg');
  assert.equal(passi.length, 1);
  assert.equal(passi[0].ses, DIRETTA);
  assert.equal(passi[0].credenziali, 'include');
  assert.equal(passi[0].iniziatore, 'null', 'il CDN è un altro sito: solo i cookie che concede a tutti');
  assert.equal(passi[0].headers.Referer, 'https://pagina.example/');
  assert.equal(passi[0].headers['User-Agent'], 'Mozilla/5.0 (Filo)');
  // Senza Referer la politica dichiarata è no-referrer, con: quella che dà lo stesso valore.
  assert.equal(passi[0].referrerPolicy, 'strict-origin');
});

// #1272.4: l'iniziatore fa scegliere a Chromium i cookie come per la pagina; a un altro sito solo i SameSite=None.
test('i cookie di un file li sceglie la pagina: il suo sito ha l\'origine della pagina, un altro sito un\'origine opaca', async () => {
  const chiedi = async (s, url, opz = { credenziali: 'include' }) => {
    passi = [];
    await P.perContoDellaScheda(s, url, opz);
    return passi.map((p) => p.iniziatore);
  };
  const pagina = scheda('https://pagina.example/profilo?id=42');
  assert.deepEqual(await chiedi(pagina, 'https://cdn.example/foto.jpg'), ['null']);
  assert.deepEqual(await chiedi(pagina, 'https://img.pagina.example/foto.jpg'), ['https://pagina.example']);
  assert.deepEqual(await chiedi(pagina, 'http://pagina.example/foto.jpg'), ['null'], 'da https a http è un altro sito');
  // Anteprime e llms.txt partono senza cookie: niente iniziatore.
  assert.deepEqual(await chiedi(pagina, 'https://cdn.example/foto.jpg', {}), ['']);
  // Ogni passo di un rimando si giudica da sé: il file del sito che rimanda a un altro sito perde i cookie stretti.
  rotte['https://pagina.example/r.jpg'] = { redirect: 'https://cdn.example/foto.jpg' };
  assert.deepEqual(await chiedi(pagina, 'https://pagina.example/r.jpg'), ['https://pagina.example', 'null']);
});

test('in un riquadro conta il riquadro, e un antenato di un altro sito toglie il sito dei cookie a tutta la catena', async () => {
  const chiedi = async (s, url) => { passi = []; await P.perContoDellaScheda(s, url, { credenziali: 'include' }); return passi[0].iniziatore; };
  const cima = { origin: 'https://pagina.example', parent: null };
  const conRiquadro = (frame) => ({ ...scheda('https://pagina.example/'), frame });
  // Un riquadro dello stesso sito della scheda: vale la sua origine.
  const vicino = conRiquadro({ origin: 'https://www.pagina.example', parent: cima });
  assert.equal(await chiedi(vicino, 'https://img.pagina.example/f.jpg'), 'https://www.pagina.example');
  // Il riquadro di un altro sito non manda i cookie stretti nemmeno al proprio sito.
  const estraneo = conRiquadro({ origin: 'https://riquadro.example', parent: cima });
  assert.equal(await chiedi(estraneo, 'https://riquadro.example/f.jpg'), 'null');
  // Né lo fa uno del sito della scheda annidato dentro un altro sito.
  const annidato = conRiquadro({ origin: 'https://pagina.example', parent: { origin: 'https://riquadro.example', parent: cima } });
  assert.equal(await chiedi(annidato, 'https://pagina.example/f.jpg'), 'null');
  // Un riquadro sandbox ha un'origine opaca; un riquadro già chiuso non si legge: in entrambi i casi nessun cookie stretto.
  assert.equal(await chiedi(conRiquadro({ origin: 'null', url: 'https://pagina.example/x', parent: cima }), 'https://pagina.example/f.jpg'), 'null');
  const chiuso = conRiquadro({ get origin() { throw new Error('Render frame was disposed'); } });
  assert.equal(await chiedi(chiuso, 'https://pagina.example/f.jpg'), 'null');
  // Una pagina fuori dal web (filo://, file:) non ha un sito dei cookie.
  assert.equal(await chiedi(scheda('filo://newtab/'), 'https://pagina.example/f.jpg'), 'null');
});

test('in un riquadro il Referer è l\'origine del riquadro; la politica dell\'intestazione del riquadro lo toglie', async () => {
  const s = scheda('https://pagina.example/', DIRETTA, 'https://riquadro.example/embed?utente=7');
  await P.perContoDellaScheda(s, 'https://cdn.example/f.jpg', { conReferer: true });
  assert.equal(passi[0].headers.Referer, 'https://riquadro.example/');
  P.ricordaPoliticaDocumento({ resourceType: 'subFrame', webContentsId: 4, url: 'https://riquadro.example/embed?utente=7', responseHeaders: { 'referrer-policy': ['no-referrer'] } });
  await P.perContoDellaScheda(s, 'https://cdn.example/f.jpg', { conReferer: true });
  assert.equal(passi[1].headers.Referer, '');
  assert.equal(passi[1].referrerPolicy, 'no-referrer');
});

test('un rimando da https a http perde il Referer, ogni passo si ricontrolla', async () => {
  rotte['https://cdn.example/f.jpg'] = { redirect: 'http://cdn.example/f.jpg' };
  await P.perContoDellaScheda(scheda('https://pagina.example/x'), 'https://cdn.example/f.jpg', { conReferer: true });
  assert.deepEqual(passi.map((p) => [p.url, p.headers.Referer]), [
    ['https://cdn.example/f.jpg', 'https://pagina.example/'],
    ['http://cdn.example/f.jpg', ''],
  ]);
  passi = [];
  rotte['https://cdn.example/g.jpg'] = { redirect: 'http://interno.example/router.png' };
  await assert.rejects(() => P.perContoDellaScheda(scheda('https://pagina.example/x'), 'https://cdn.example/g.jpg'), /blocked-private-address/);
  assert.deepEqual(passi.map((p) => p.url), ['https://cdn.example/g.jpg']);
});

test('una pagina pubblica non porta alla rete di casa; una pagina che ci sta già sì, solo dove lo si chiede', async () => {
  for (const verso of ['http://127.0.0.1:8080/x.png', 'http://192.168.1.1/x.png', 'http://interno.example/x.png', 'http://nas.local/x.png', 'http://[::1]/x.png']) {
    await assert.rejects(() => P.perContoDellaScheda(scheda('https://pagina.example/'), verso, { lanSeLaPaginaCiSta: true }), /blocked-private-address/, verso);
  }
  assert.equal(passi.length, 0);
  const nas = scheda('http://192.168.1.30/galleria');
  await P.perContoDellaScheda(nas, 'http://192.168.1.30/foto.jpg', { lanSeLaPaginaCiSta: true });
  await assert.rejects(() => P.perContoDellaScheda(nas, 'http://192.168.1.30/foto.jpg'), /blocked-private-address/);
  await assert.rejects(() => P.perContoDellaScheda(scheda('https://pagina.example/'), 'file:///etc/passwd'), /blocked-scheme/);
});

test('dietro il proxy della scheda il nome non si chiede al DNS di casa; gli indirizzi di casa scritti restano fuori', async () => {
  const s = scheda('https://pagina.example/', PROXATA);
  await P.perContoDellaScheda(s, 'https://solo-dal-proxy.example/f.jpg', { conReferer: true });
  assert.deepEqual(chiestiAlDns, []);
  assert.equal(passi[0].ses, PROXATA);
  for (const verso of ['http://127.0.0.1/x', 'http://localhost/x', 'http://10.0.0.1/x', 'http://stampante.local/x']) {
    await assert.rejects(() => P.perContoDellaScheda(s, verso), /blocked-private-address/, verso);
  }
  // Un proxy che può ripiegare sul collegamento diretto non vale come proxy: il nome si controlla qui.
  const conRipiego = scheda('https://pagina.example/', { resolveProxy: async () => 'PROXY proxy.azienda.example:8080; DIRECT' });
  await assert.rejects(() => P.perContoDellaScheda(conRipiego, 'http://interno.example/x'), /blocked-private-address/);
  assert.deepEqual(chiestiAlDns, ['interno.example']);
});

test('senza una scheda viva non parte niente', async () => {
  for (const s of [null, {}, { wc: { isDestroyed: () => true, session: DIRETTA } }]) {
    await assert.rejects(() => P.perContoDellaScheda(s, 'https://cdn.example/f.jpg'), /no-sender/);
  }
  assert.equal(passi.length, 0);
});

test('una richiesta diretta chiede il nome al risolutore della sessione, quello con cui poi si collega', async () => {
  const chiesti = [];
  const risolutore = (mappa) => ({
    resolveProxy: async () => 'DIRECT',
    resolveHost: async (h) => { chiesti.push(h); if (!mappa[h]) throw new Error('net::ERR_NAME_NOT_RESOLVED'); return { endpoints: mappa[h].map((address) => ({ address, family: 'ipv4' })) }; },
  });
  const ses = risolutore({ 'cdn.dalla-sessione.example': ['93.184.216.40'], 'rimappato.example': ['10.0.0.5'] });
  await P.perContoDellaScheda(scheda('https://pagina.example/', ses), 'https://cdn.dalla-sessione.example/f.jpg');
  await assert.rejects(() => P.perContoDellaScheda(scheda('https://pagina.example/', ses), 'https://rimappato.example/f.jpg'), /blocked-private-address/);
  await assert.rejects(() => P.perContoDellaScheda(scheda('https://pagina.example/', ses), 'https://sconosciuto.example/f.jpg'), /dns-failed/);
  assert.deepEqual(chiesti, ['cdn.dalla-sessione.example', 'rimappato.example', 'sconosciuto.example']);
  assert.deepEqual(chiestiAlDns, [], 'il DNS di Node non c\'entra');
  assert.deepEqual(passi.map((p) => p.url), ['https://cdn.dalla-sessione.example/f.jpg']);
});
