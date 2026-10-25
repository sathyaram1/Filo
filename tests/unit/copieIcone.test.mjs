// #1273 — le icone di pagine salvate e schede archiviate sono una copia che Filo tiene in una cartella sua: nessuna
// richiesta per mostrarle, una sola per le voci di prima, mai fuori dal proxy, niente su disco in incognito, e il file se
// ne va con la voce. Electron è finto, il disco è vero.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import Module from 'node:module';
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { cartellaTemporanea, togliCartella } from '../helpers/percorsi.mjs';

const require = createRequire(import.meta.url);
const userData = cartellaTemporanea('filo-icone-');
process.env.FILO_USER_DATA = userData;
// La sessione predefinita finta: risponde con la foto del profilo e annota chi chiede cosa.
const chiesteAGoogle = [];
const sessionePredefinita = {
  fetch: async (url, init) => {
    chiesteAGoogle.push({ url, credentials: init && init.credentials });
    return new Response(FOTO, { status: 200, headers: { 'content-type': 'image/png' } });
  },
};
const caricaOriginale = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'electron') {
    return { app: { getPath: () => userData }, safeStorage: { isEncryptionAvailable: () => false }, session: { defaultSession: sessionePredefinita } };
  }
  return caricaOriginale.call(this, request, parent, isMain);
};

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
require(join(ROOT, 'src', 'shared', 'constants.js'));
require(join(ROOT, 'src', 'shared', 'messages.js'));
const Disco = require(join(ROOT, 'src', 'main', 'shim', 'storage.js'));
require(join(ROOT, 'src', 'main', 'shim', 'chrome-api.js'));
require(join(ROOT, 'src', 'main', 'services', 'savedPages.js'));
require(join(ROOT, 'src', 'main', 'services', 'archivedTabs.js'));
const Copie = require(join(ROOT, 'src', 'main', 'services', 'copieIcone.js'));
const IconeVecchie = require(join(ROOT, 'src', 'main', 'services', 'iconeVecchie.js'));
const S = globalThis.SN_SAVED_PAGES;
const A = globalThis.SN_ARCHIVED_TABS;
const { MSG } = globalThis.SN_MSG;
const { STORAGE_KEYS } = globalThis.SN_CONST;

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGM4YaMBAAL8AS3/gzpXAAAAAElFTkSuQmCC', 'base64');
const PNG2 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGPQCDgBAAHkAUEYgvCnAAAAAElFTkSuQmCC', 'base64');
const FOTO = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64');
const dato = (b) => `data:image/png;base64,${b.toString('base64')}`;
const cartella = join(userData, 'icone');
const fileDi = (rif) => join(cartella, Copie.nomeDa(rif));
const icone = () => (existsSync(cartella) ? readdirSync(cartella).filter((n) => /\.png$/.test(n)).sort() : []);
const aspetta = async (cond, ms = 4000) => {
  const fine = Date.now() + ms;
  while (!cond()) { if (Date.now() > fine) return false; await new Promise((r) => setTimeout(r, 50)); }
  return true;
};

const registro = new Map();
require(join(ROOT, 'src', 'main', 'services', 'handlers', 'pages.js'))((t, fn) => registro.set(t, fn), { MSG, maybeCategorizeAsync: async () => {} });
const daScheda = (tab) => ({ tab: { id: tab.id, url: tab.url }, url: tab.url, win: { _filoTabs: { tabs: [tab] } } });

test('la copia è un file nella cartella dati con un nome che un sito non indovina; un indirizzo o un non-immagine non diventano niente', async () => {
  const rif = await Copie.conserva(dato(PNG));
  assert.match(rif, /^filo:\/\/icone\/[0-9a-f]{40}\.png$/);
  assert.deepEqual(readFileSync(fileDi(rif)), PNG);
  assert.equal(await Copie.conserva(dato(PNG)), rif, 'gli stessi byte, la stessa copia');
  assert.ok(!rif.includes(createHash('sha256').update(PNG).digest('hex').slice(0, 40)), 'il nome non è l’impronta dei byte');
  assert.equal(await Copie.conserva('https://cdn.esempio.it/logo.png'), '');
  assert.equal(await Copie.conserva('data:text/html;base64,PGgxPmNpYW88L2gxPg=='), '');
  assert.equal(await Copie.comeDato(rif), dato(PNG));
});

test('le pagine di Filo la leggono da filo://icone/, e niente altro esce da quella porta', async () => {
  const rif = await Copie.conserva(dato(PNG));
  const r = await Copie.risposta(Copie.nomeDa(rif));
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('content-type'), 'image/png');
  assert.match(r.headers.get('content-security-policy'), /sandbox/);
  assert.deepEqual(Buffer.from(await r.arrayBuffer()), PNG);
  for (const via of ['chiave', '../storage.json', `${Copie.nomeDa(rif)}/x`, '']) assert.equal((await Copie.risposta(via)).status, 404, via);
});

test('in incognito niente su disco: la voce tiene i byte in memoria', async () => {
  const prima = icone();
  const r = await Disco.runIncognito(() => Copie.conserva(dato(PNG2)));
  assert.equal(r, dato(PNG2));
  const voce = await Disco.runIncognito(() => S.save({ url: 'https://privata.test/', title: 'Privata', favicon: dato(PNG2) }));
  assert.equal(voce.favicon, dato(PNG2));
  assert.deepEqual(icone(), prima);
});

test('salva per dopo: l’icona è quella che la scheda ha scaricato, mai l’indirizzo che manda la pagina', async () => {
  const tab = { id: 7, url: 'https://negozio.test/p', favicon: dato(PNG), _origineIcona: 'https://negozio.test' };
  const r = await registro.get(MSG.SAVE_PAGE)({ type: MSG.SAVE_PAGE, page: { url: tab.url, title: 'Negozio', favicon: 'https://img.piattaforma.test/negozio.png' } },
    daScheda(tab), tab.url);
  assert.equal(r.ok, true);
  const voce = (await S.list()).find((p) => p.url === tab.url);
  assert.match(voce.favicon, /^filo:\/\/icone\//);
  assert.equal(voce.faviconDaChiedere, undefined);
  await Disco.whenSettled();
  const suDisco = readFileSync(join(userData, 'storage.json'), 'utf8');
  assert.ok(!suDisco.includes(PNG.toString('base64')) && !suDisco.includes('img.piattaforma.test'), 'storage.json non tiene né i byte né l’indirizzo');
  // L'icona di un'altra pagina, rimasta sulla scheda mentre arriva quella nuova, non si prende.
  const altra = { id: 8, url: 'https://altro.test/', favicon: dato(PNG), _origineIcona: 'https://negozio.test' };
  await registro.get(MSG.SAVE_PAGE)({ type: MSG.SAVE_PAGE, page: { url: altra.url, title: 'Altro' } }, daScheda(altra), altra.url);
  assert.equal((await S.list()).find((p) => p.url === altra.url).favicon, '');
});

test('togliere la voce toglie il file; «Annulla» lo rimette', async () => {
  // Un'icona che nessun'altra voce usa.
  const solo = await registro.get(MSG.SAVE_PAGE)({ type: MSG.SAVE_PAGE, page: { url: 'https://unico.test/', title: 'Unico' } },
    daScheda({ id: 9, url: 'https://unico.test/', favicon: dato(PNG2), _origineIcona: 'https://unico.test' }), 'https://unico.test/');
  const rif = (await S.list()).find((p) => p.url === 'https://unico.test/').favicon;
  assert.ok(existsSync(fileDi(rif)));
  await S.remove((await S.list()).find((p) => p.url === 'https://unico.test/').id);
  assert.ok(await aspetta(() => !existsSync(fileDi(rif))), 'il file dell’icona resta dopo aver tolto la voce');
  const { entry } = await S.rimetti(solo.entry.id, []);
  assert.equal(entry.favicon, rif);
  assert.ok(existsSync(fileDi(rif)), 'l’«Annulla» non rimette l’icona');
});

test('chiudere una scheda archivia la sua copia; cancellarla dall’archivio toglie il file, se nessuno lo usa', async () => {
  const t = await A.archive({ url: 'https://blog.test/articolo', title: 'Articolo', favicon: dato(PNG2), proxy: { country: 'us' } });
  assert.match(t.favicon, /^filo:\/\/icone\//);
  const salvata = (await S.list()).find((p) => p.url === 'https://unico.test/');
  assert.equal(salvata.favicon, t.favicon, 'stessi byte, stessa copia');
  await A.remove(t.id);
  await new Promise((r) => setTimeout(r, Copie.GRAZIA_MS + 300));
  assert.ok(existsSync(fileDi(t.favicon)), 'la pagina salvata usa ancora quell’icona');
  await S.remove(salvata.id);
  assert.ok(await aspetta(() => !existsSync(fileDi(t.favicon))));
});

test('le voci di prima: l’indirizzo dichiarato non arriva a nessuna pagina, si chiede una volta senza cookie e poi resta; dal proxy mai', async () => {
  const salvate = (await S.list()).filter((p) => !/^https:\/\/(negozio|altro|privata)\.test/.test(p.url));
  await chrome.storage.local.set({ [STORAGE_KEYS.SAVED_PAGES]: [...salvate,
    { id: 'v1', url: 'https://vecchio.test/a', title: 'Vecchio', favicon: 'https://img.piattaforma.test/v.png', savedAt: '2026-01-01T00:00:00Z' },
    { id: 'v2', url: 'https://vecchio.test/b', title: 'Vecchio 2', favicon: 'https://img.piattaforma.test/v.png', savedAt: '2026-01-01T00:00:00Z' },
    { id: 'v3', url: 'https://datata.test/', title: 'Col dato', favicon: dato(PNG), savedAt: '2026-01-01T00:00:00Z' },
  ] });
  await A.importa([
    { id: 'a1', url: 'https://archiviato.test/', title: 'Archiviato', favicon: 'https://archiviato.test/i.png', closedAt: '2026-01-02T00:00:00Z' },
    { id: 'a2', url: 'https://dal-proxy.test/', title: 'Dal proxy', favicon: 'https://dal-proxy.test/i.png', proxy: { country: 'us' }, closedAt: '2026-01-02T00:00:00Z' },
  ]);
  const v1 = (await S.list()).find((p) => p.id === 'v1');
  assert.equal(v1.favicon, '', 'una pagina non vede l’indirizzo di prima');
  assert.equal(v1.faviconDaChiedere, 'https://img.piattaforma.test/v.png');
  const a2 = (await A.list()).find((t) => t.id === 'a2');
  assert.equal(a2.favicon, '');
  assert.equal(a2.faviconDaChiedere, undefined, 'una scheda passata da un proxy non si chiede da fuori');

  const chieste = [];
  const R = IconeVecchie.crea({
    iconaPer: async (ses, lista, opz) => { chieste.push({ lista, opz }); return lista[0].includes('archiviato') ? { url: lista[0], dato: dato(PNG2) } : { url: '', dato: '' }; },
    sessione: () => ({}),
    inLinea: () => true,
  });
  await R.completa();
  assert.deepEqual(chieste.map((c) => c.lista[0]).sort(), ['https://archiviato.test/i.png', 'https://img.piattaforma.test/v.png'], 'un indirizzo, una richiesta');
  assert.ok(chieste.every((c) => c.opz.cookie === false));
  const dopo = await S.list();
  assert.equal(dopo.find((p) => p.id === 'v1').favicon, '');
  assert.equal(dopo.find((p) => p.id === 'v1').faviconDaChiedere, undefined, 'tentata una volta: non si richiede');
  assert.equal(dopo.find((p) => p.id === 'v1').iconaMancante, true);
  assert.match(dopo.find((p) => p.id === 'v3').favicon, /^filo:\/\/icone\//, 'il data: rimasto in storage.json diventa una copia');
  assert.match((await A.list()).find((t) => t.id === 'a1').favicon, /^filo:\/\/icone\//);
  chieste.length = 0;
  await R.completa();
  assert.deepEqual(chieste, [], 'al giro dopo nessuna richiesta');
});

test('senza rete il tentativo non conta; un link salvato si chiede una volta, da una scheda col proxy mai', async () => {
  const chieste = [];
  const finta = (inLinea) => IconeVecchie.crea({ iconaPer: async (s, l) => { chieste.push(l[0]); return { url: l[0], dato: dato(PNG) }; }, sessione: () => ({}), inLinea: () => inLinea });
  await registro.get(MSG.SAVE_LINK)({ type: MSG.SAVE_LINK, url: 'https://link.test/x', title: 'Link' }, daScheda({ id: 3, url: 'https://da.test/' }), 'https://da.test/');
  await registro.get(MSG.SAVE_LINK)({ type: MSG.SAVE_LINK, url: 'https://link-proxy.test/x', title: 'Link proxy' }, daScheda({ id: 4, url: 'https://da.test/', proxy: { country: 'us', tier: 'datacenter' } }), 'https://da.test/');
  await finta(false).completa();
  assert.deepEqual(chieste, []);
  const link = (await S.list()).find((p) => p.url === 'https://link.test/x');
  assert.equal(IconeVecchie.daChiedere(link), 'https://link.test/favicon.ico');
  const dalProxy = (await S.list()).find((p) => p.url === 'https://link-proxy.test/x');
  assert.deepEqual(dalProxy.proxy, { country: 'us', tier: 'datacenter' });
  assert.equal(IconeVecchie.daChiedere(dalProxy), '');
  await finta(true).completa();
  assert.ok(chieste.includes('https://link.test/favicon.ico'));
  assert.ok(!chieste.some((u) => u.includes('link-proxy.test')), 'una voce nata da una scheda col proxy non si chiede fuori');
  assert.match((await S.list()).find((p) => p.url === 'https://link.test/x').favicon, /^filo:\/\/icone\//);
});

test('la foto del profilo Google è una copia: scaricata una volta per account, senza cookie, e alle pagine arriva solo lei', async () => {
  const auth = require(join(ROOT, 'src', 'main', 'auth', 'google-auth.js'));
  const store = require(join(ROOT, 'src', 'main', 'auth', 'token-store.js'));
  const FOTO_GOOGLE = 'https://lh3.googleusercontent.com/a/foto-di-prova=s96-c';
  // Una sessione salvata prima del #1273: solo l'indirizzo della foto.
  store.save({ refreshToken: 'rt', email: 'chi@esempio.it', name: 'Chi', picture: FOTO_GOOGLE });
  const avvisi = [];
  auth.suFoto((p) => avvisi.push(p));
  auth.restore();
  assert.equal(auth.getProfile().picture, '', 'finché la copia non c’è, alle pagine non arriva l’indirizzo di Google');
  await auth.aggiornaFoto();
  const copia = auth.getProfile().picture;
  assert.match(copia, /^filo:\/\/icone\/[0-9a-f]{40}\.png$/);
  assert.deepEqual(readFileSync(fileDi(copia)), FOTO);
  assert.deepEqual(chiesteAGoogle, [{ url: FOTO_GOOGLE, credentials: 'omit' }]);
  assert.equal(avvisi.length, 1, 'la barra e la home sanno che la foto è arrivata');
  // Al riavvio la copia c'è già: nessuna richiesta.
  auth.restore();
  await auth.aggiornaFoto();
  assert.equal(auth.getProfile().picture, copia);
  assert.equal(chiesteAGoogle.length, 1);
  // L'uscita porta via anche la foto.
  auth.signOut();
  assert.ok(await aspetta(() => !existsSync(fileDi(copia))), 'la foto resta dopo l’uscita');
});

test('all’avvio i file che nessuna voce nomina se ne vanno', async () => {
  mkdirSync(cartella, { recursive: true });
  const orfano = join(cartella, `${'a'.repeat(40)}.png`);
  writeFileSync(orfano, PNG);
  const usata = (await S.list()).find((p) => Copie.eCopia(p.favicon)).favicon;
  await Copie.pulisci();
  assert.ok(!existsSync(orfano));
  assert.ok(existsSync(fileDi(usata)));
  assert.ok(existsSync(join(cartella, 'chiave')), 'la chiave dei nomi resta');
});

test('una copia che non si scrive lascia la voce col globo: la scheda chiusa si archivia e la pagina si salva lo stesso; una cartella sparita si rifà', async () => {
  const gif = (n) => `data:image/gif;base64,${Buffer.from(`GIF89a${String.fromCharCode(n)}`, 'latin1').toString('base64')}`;
  const daParte = `${cartella}.da-parte`;
  // Al posto della cartella un file: ogni scrittura fallisce, come col disco pieno o un file bloccato.
  renameSync(cartella, daParte);
  writeFileSync(cartella, 'non una cartella');
  try {
    assert.equal(await Copie.conserva(gif(1)), '');
    const t = await A.archive({ url: 'https://chiusa.test/', title: 'Chiusa', favicon: gif(2), proxy: { country: 'us' } });
    assert.ok(t && t.id, 'la scheda chiusa non è entrata nell’archivio');
    assert.equal(t.favicon, '');
    const tab = { id: 21, url: 'https://salvata.test/', favicon: gif(3), _origineIcona: 'https://salvata.test', proxy: { country: 'us' } };
    const r = await registro.get(MSG.SAVE_PAGE)({ type: MSG.SAVE_PAGE, page: { url: tab.url, title: 'Salvata' } }, daScheda(tab), tab.url);
    assert.equal(r.ok, true);
    assert.equal((await S.list()).find((p) => p.url === tab.url).favicon, '');
  } finally {
    rmSync(cartella, { force: true });
    renameSync(daParte, cartella);
  }
  assert.ok(togliCartella(cartella));
  const rif = await Copie.conserva(gif(4));
  assert.match(rif, /^filo:\/\/icone\//);
  assert.ok(existsSync(fileDi(rif)), 'la cartella sparita non si è rifatta');
});
