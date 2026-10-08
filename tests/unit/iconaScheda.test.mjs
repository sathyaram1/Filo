// Icona della scheda scaricata dal main (#1083): il tipo lo dicono i byte, il tetto si rispetta, gli schemi
// che una pagina non deve poter far leggere al main (file:, filo: da una pagina web) non partono.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { iconaPer, tipoImmagine, bytesDaDataUrl, TETTO_BYTE } = require('../../src/main/services/iconaScheda.js');

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
const ICO = Buffer.from([0, 0, 1, 0, 1, 0, 16, 16]);
const SVG = Buffer.from('<?xml version="1.0"?>\n<!-- logo --><svg xmlns="http://www.w3.org/2000/svg"></svg>');

// Una sessione finta: registra gli indirizzi chiesti e risponde dalla mappa.
function sessione(risposte) {
  const chiesti = [];
  return {
    chiesti,
    fetch: async (url, init) => {
      chiesti.push({ url, init });
      const r = risposte[url];
      if (!r) return new Response('no', { status: 404 });
      return new Response(r.body, { status: r.status || 200, headers: r.headers || {} });
    },
  };
}

test('il tipo viene dai byte: png, ico, svg con radice svg; una pagina html con dentro un svg non è un\'icona', () => {
  assert.equal(tipoImmagine(PNG), 'image/png');
  assert.equal(tipoImmagine(ICO), 'image/x-icon');
  assert.equal(tipoImmagine(SVG), 'image/svg+xml');
  assert.equal(tipoImmagine(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), SVG])), 'image/svg+xml');
  assert.equal(tipoImmagine(Buffer.from('<!doctype html><html><body><svg></svg></body></html>')), '');
  assert.equal(tipoImmagine(Buffer.from('not found')), '');
  assert.equal(tipoImmagine(Buffer.alloc(0)), '');
});

test('data: URL in base64 e percent-encoded si leggono byte per byte', () => {
  assert.deepEqual(bytesDaDataUrl('data:image/png;base64,' + PNG.toString('base64')), PNG);
  const svg = '<svg xmlns="http://www.w3.org/2000/svg"><rect fill="#e00"/></svg>';
  assert.equal(bytesDaDataUrl('data:image/svg+xml,' + encodeURIComponent(svg)).toString('utf8'), svg);
  assert.equal(bytesDaDataUrl('https://x.test/a.png'), null);
});

test('scarica con la sessione data e consegna un data: URL in base64', async () => {
  const ses = sessione({ 'https://sito.test/favicon.ico': { body: ICO } });
  const r = await iconaPer(ses, ['https://sito.test/favicon.ico']);
  assert.equal(r.url, 'https://sito.test/favicon.ico');
  assert.equal(r.dato, 'data:image/x-icon;base64,' + ICO.toString('base64'));
  assert.equal(ses.chiesti.length, 1);
});

test('se la prima icona non è un\'immagine passa alla seguente, nell\'ordine della pagina', async () => {
  const ses = sessione({
    'https://sito.test/rotta.png': { body: '<html>404</html>' },
    'https://sito.test/buona.png': { body: PNG },
  });
  const r = await iconaPer(ses, ['https://sito.test/manca.png', 'https://sito.test/rotta.png', 'https://sito.test/buona.png']);
  assert.equal(r.url, 'https://sito.test/buona.png');
  assert.match(r.dato, /^data:image\/png;base64,/);
});

test('oltre il tetto niente icona, dichiarato o no', async () => {
  const grosso = Buffer.concat([PNG, Buffer.alloc(TETTO_BYTE)]);
  const dichiarato = sessione({ 'https://a.test/i.png': { body: grosso, headers: { 'content-length': String(grosso.length) } } });
  assert.deepEqual(await iconaPer(dichiarato, ['https://a.test/i.png']), { url: '', dato: '' });
  const taciuto = sessione({ 'https://a.test/i.png': { body: new Blob([grosso]).stream() } });
  assert.deepEqual(await iconaPer(taciuto, ['https://a.test/i.png']), { url: '', dato: '' });
  const dato = 'data:image/png;base64,' + grosso.toString('base64');
  assert.deepEqual(await iconaPer(sessione({}), [dato]), { url: '', dato: '' });
});

test('file: e javascript: non partono mai; filo: solo da una pagina interna', async () => {
  const ses = sessione({ 'filo://asset/icons/icon-32.png': { body: PNG } });
  assert.deepEqual(await iconaPer(ses, ['file:///etc/passwd', 'javascript:alert(1)', 'filo://asset/icons/icon-32.png']), { url: '', dato: '' });
  assert.equal(ses.chiesti.length, 0);
  const interna = await iconaPer(ses, ['filo://asset/icons/icon-32.png'], { interna: true });
  assert.match(interna.dato, /^data:image\/png;base64,/);
});

test('un\'icona superata da una più nuova smette di cercare', async () => {
  const ses = sessione({ 'https://a.test/2.png': { body: PNG } });
  let vivo = true;
  const giro = iconaPer(ses, ['https://a.test/1.png', 'https://a.test/2.png'], { vivo: () => vivo });
  vivo = false;
  assert.deepEqual(await giro, { url: '', dato: '' });
  assert.ok(ses.chiesti.length <= 1);
});
