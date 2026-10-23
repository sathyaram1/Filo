// Le icone dei siti della home e della chat (#848): prima la copia già vista, poi /favicon.ico del sito, senza cookie,
// e nessun servizio di icone di terzi in src/.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(import.meta.url);
const I = require('../../src/main/services/iconeSiti.js');
const { iconaPer } = require('../../src/main/services/iconaScheda.js');

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
const DATO = `data:image/png;base64,${PNG.toString('base64')}`;

function sessione(risposte = {}) {
  const chiesti = [];
  return {
    chiesti,
    fetch: async (url, init) => {
      chiesti.push({ url, init });
      const r = risposte[url];
      return r ? new Response(r, { status: 200 }) : new Response('<html>no</html>', { status: 404 });
    },
  };
}

test('una scheda aperta sullo stesso sito dà la sua icona senza nessuna richiesta, anche col www di differenza', async () => {
  const ses = sessione();
  const { cercaIconaSito } = I.crea();
  const schede = [{ url: 'https://www.esempio.it/pagina', favicon: DATO }];
  assert.equal(await cercaIconaSito('https://esempio.it/', { ses, schede }), DATO);
  assert.deepEqual(ses.chiesti, []);
});

test('una scheda di un altro sito, o di un\'altra porta, non presta la sua icona', async () => {
  const ses = sessione();
  const { cercaIconaSito } = I.crea();
  const schede = [{ url: 'https://altro.it/', favicon: DATO }, { url: 'http://127.0.0.1:9000/', favicon: DATO }];
  assert.equal(await cercaIconaSito('http://127.0.0.1:8000/x', { ses, schede }), '');
  assert.deepEqual(ses.chiesti.map((c) => c.url), ['http://127.0.0.1:8000/favicon.ico']);
});

test('senza schede: prima l\'icona dichiarata da una pagina salvata o archiviata, poi /favicon.ico, sempre senza cookie', async () => {
  const ses = sessione({ 'https://cdn.esempio.it/logo.png': PNG });
  const { cercaIconaSito } = I.crea();
  const voci = async () => [
    { url: 'https://altro.it/', favicon: 'https://altro.it/a.png' },
    { url: 'https://esempio.it/salvata', favicon: 'https://esempio.it/vecchia.png' },
    { url: 'https://www.esempio.it/archiviata', favicon: 'https://cdn.esempio.it/logo.png' },
  ];
  assert.equal(await cercaIconaSito('https://esempio.it/', { ses, voci }), DATO);
  assert.deepEqual(ses.chiesti.map((c) => c.url), ['https://esempio.it/vecchia.png', 'https://cdn.esempio.it/logo.png']);
  assert.ok(ses.chiesti.every((c) => c.init.credentials === 'omit'), 'a un sito che non hai aperto non vanno i cookie');
});

test('/favicon.ico del sito stesso, con lo schema e la porta del suggerimento', async () => {
  const ses = sessione({ 'http://esempio.it:8080/favicon.ico': PNG });
  const { cercaIconaSito } = I.crea();
  assert.equal(await cercaIconaSito('http://esempio.it:8080/a?b=c', { ses }), DATO);
  assert.deepEqual(ses.chiesti.map((c) => c.url), ['http://esempio.it:8080/favicon.ico']);
});

test('le copie dichiarate si fermano a tre, e un indirizzo che non è un\'immagine o una pagina web non si segue', () => {
  const sito = I.sitoDi('https://esempio.it/');
  const voci = [
    { url: 'https://esempio.it/1', favicon: 'file:///C:/segreto.png' },
    { url: 'https://esempio.it/2', favicon: 'filo://settings/x.png' },
    ...[1, 2, 3, 4].map((n) => ({ url: `https://esempio.it/${n}`, favicon: `https://esempio.it/${n}.png` })),
  ];
  assert.deepEqual(I.candidati(sito, voci), ['https://esempio.it/1.png', 'https://esempio.it/2.png', 'https://esempio.it/3.png', 'https://esempio.it/favicon.ico']);
});

test('un indirizzo che non è un sito web non chiede niente', async () => {
  const ses = sessione();
  const { cercaIconaSito } = I.crea();
  for (const u of ['', 'filo://options/options.html', 'file:///C:/x.html', 'javascript:alert(1)', 'non un indirizzo', null]) {
    assert.equal(await cercaIconaSito(u, { ses }), '');
  }
  assert.deepEqual(ses.chiesti, []);
});

test('un\'icona trovata non si richiede; una mancata si riprova solo dopo dieci minuti', async () => {
  let ora = 0;
  const ses = sessione({ 'https://ok.it/favicon.ico': PNG });
  const { cercaIconaSito } = I.crea({ adesso: () => ora });
  await cercaIconaSito('https://ok.it/', { ses });
  await cercaIconaSito('https://ok.it/altra', { ses });
  await cercaIconaSito('https://manca.it/', { ses });
  await cercaIconaSito('https://manca.it/', { ses });
  assert.deepEqual(ses.chiesti.map((c) => c.url), ['https://ok.it/favicon.ico', 'https://manca.it/favicon.ico']);
  ora += I.RIPROVA_MS + 1;
  await cercaIconaSito('https://manca.it/', { ses });
  await cercaIconaSito('https://ok.it/', { ses });
  assert.deepEqual(ses.chiesti.map((c) => c.url).slice(2), ['https://manca.it/favicon.ico']);
});

test('un indirizzo che chiede l\'OK prende solo copie già in casa: scheda, icona salvata come dato, icona già trovata; mai la rete', async () => {
  const ses = sessione({ 'https://spia.it/favicon.ico': PNG, 'https://spia.it/icona.png': PNG, 'https://noto.it/favicon.ico': PNG });
  const { cercaIconaSito } = I.crea();
  const solo = { ses, soloCopie: true };
  assert.equal(await cercaIconaSito('https://spia.it/x', { ...solo, voci: async () => [{ url: 'https://spia.it/a', favicon: 'https://spia.it/icona.png' }] }), '');
  assert.equal(await cercaIconaSito('https://spia.it/x', { ...solo, schede: [{ url: 'https://spia.it/b', favicon: DATO }] }), DATO);
  assert.equal(await cercaIconaSito('https://spia.it/x', { ...solo, voci: async () => [{ url: 'https://spia.it/a', favicon: DATO }] }), DATO);
  assert.deepEqual(ses.chiesti, []);
  await cercaIconaSito('https://noto.it/', { ses });
  assert.equal(await cercaIconaSito('https://noto.it/y', solo), DATO);
  assert.deepEqual(ses.chiesti.map((c) => c.url), ['https://noto.it/favicon.ico']);
});

test('due richieste insieme per lo stesso sito ne fanno una; in incognito non si ricorda niente', async () => {
  const ses = sessione({ 'https://ok.it/favicon.ico': PNG });
  const { cercaIconaSito } = I.crea();
  const [a, b] = await Promise.all([cercaIconaSito('https://ok.it/', { ses }), cercaIconaSito('https://ok.it/x', { ses })]);
  assert.equal(a, DATO);
  assert.equal(b, DATO);
  assert.equal(ses.chiesti.length, 1);
  const inc = sessione({ 'https://ok.it/favicon.ico': PNG });
  await cercaIconaSito('https://ok.it/', { ses: inc, incognito: true });
  await cercaIconaSito('https://ok.it/', { ses: inc, incognito: true });
  assert.equal(inc.chiesti.length, 2);
});

test('una pagina 404 in html non è un\'icona: resta il ripiego della home', async () => {
  const ses = sessione();
  const { cercaIconaSito } = I.crea();
  assert.equal(await cercaIconaSito('https://senza.it/', { ses, voci: async () => { throw new Error('archivio rotto'); } }), '');
  assert.deepEqual(ses.chiesti.map((c) => c.url), ['https://senza.it/favicon.ico']);
});

// Un'icona di un altro sito parte senza: la regola sta in tests/unit/iconaScheda.test.mjs (#1272.4).
test('l\'icona della scheda continua a viaggiare coi cookie della scheda, se sta sul sito della pagina', async () => {
  const ses = sessione({ 'https://esempio.it/i.png': PNG });
  await iconaPer(ses, ['https://esempio.it/i.png'], { pagina: 'https://www.esempio.it/articolo' });
  assert.equal(ses.chiesti[0].init.credentials, 'include');
});

// I servizi che danno l'icona di un sito dato il suo nome: chi li riceve sa quali siti frequenti.
const SERVIZI_DI_ICONE = /google\.com\/s2\/favicons|gstatic\.com\/favicon|faviconV2|icons\.duckduckgo\.com|duckduckgo\.com\/ip3|icon\.horse|favicone\.com|faviconkit|favicon\.yandex|logo\.clearbit\.com|besticon|api\.faviconkit|favicon\.im\b/i;

function sorgenti(dir, acc = []) {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) { if (n !== 'vendor') sorgenti(p, acc); continue; }
    if (/\.(m?js|cjs|html|css)$/.test(n)) acc.push(p);
  }
  return acc;
}

test('nessuna superficie di Filo chiede l\'icona di un sito a un servizio di terzi', () => {
  const trovati = sorgenti(join(ROOT, 'src'))
    .filter((p) => SERVIZI_DI_ICONE.test(readFileSync(p, 'utf8')))
    .map((p) => relative(ROOT, p).replace(/\\/g, '/'));
  assert.deepEqual(trovati, []);
});
