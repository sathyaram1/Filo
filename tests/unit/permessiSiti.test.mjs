// Permessi chiesti dai siti (#586): quali passano senza domanda, cosa si ricorda, e che OGNI sessione nasca col
// suo custode. Le regole pure stanno in src/shared/permessiSiti.js, il custode in src/main/services/permessiSiti.js
// (electron e l'archivio si iniettano: qui gira senza Electron).

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const P = require(join(ROOT, 'src', 'shared', 'permessiSiti.js'));
const Permessi = require(join(ROOT, 'src', 'main', 'services', 'permessiSiti.js'));

// ── regole pure ─────────────────────────────────────────────────────────────

test('le richieste sensibili diventano tipi da approvare; le innocue passano', () => {
  assert.deepEqual(P.tipiRichiesta('media', { mediaTypes: ['audio', 'video'] }), { innocuo: false, tipi: ['camera', 'microfono'] });
  assert.deepEqual(P.tipiRichiesta('media', { mediaTypes: ['audio'] }).tipi, ['microfono']);
  // getDisplayMedia arriva come media senza tracce: è lo schermo.
  assert.deepEqual(P.tipiRichiesta('media', { mediaTypes: [] }).tipi, ['schermo']);
  assert.deepEqual(P.tipiRichiesta('notifications', {}).tipi, ['notifiche']);
  assert.deepEqual(P.tipiRichiesta('geolocation', {}).tipi, ['posizione']);
  assert.deepEqual(P.tipiRichiesta('clipboard-read', {}).tipi, ['appunti']);
  assert.deepEqual(P.tipiRichiesta('display-capture', {}).tipi, ['schermo']);
  for (const p of ['clipboard-sanitized-write', 'fullscreen', 'pointerLock', 'keyboardLock', 'mediaKeySystem']) {
    assert.equal(P.tipiRichiesta(p, {}).innocuo, true, p);
  }
  assert.equal(P.tipiRichiesta('openExternal', { externalURL: 'mailto:a@b.it' }).innocuo, true);
  assert.deepEqual(P.tipiRichiesta('openExternal', { externalURL: 'ms-msdt:/id' }).tipi, ['app']);
  assert.equal(P.tipiRichiesta('fileSystem', { fileAccessType: 'readable', isDirectory: false }).innocuo, true);
  assert.deepEqual(P.tipiRichiesta('fileSystem', { fileAccessType: 'readable', isDirectory: true }).tipi, ['cartelle']);
  assert.deepEqual(P.tipiRichiesta('fileSystem', { fileAccessType: 'writable' }).tipi, ['file']);
  // Per prudenza ciò che non si conosce non è innocuo.
  assert.deepEqual(P.tipiRichiesta('unknown', {}).tipi, ['altro']);
  assert.deepEqual(P.tipiRichiesta('permesso-di-domani', {}).tipi, ['altro']);
});

test('decidi: un no ricordato vince, si chiede solo quello che manca, lo schermo si chiede sempre', () => {
  assert.deepEqual(P.decidi(undefined, ['notifiche']), { esito: 'chiedi', tipi: ['notifiche'] });
  assert.deepEqual(P.decidi({ camera: 'consenti' }, ['camera', 'microfono']), { esito: 'chiedi', tipi: ['microfono'] });
  assert.equal(P.decidi({ camera: 'consenti', microfono: 'consenti' }, ['camera', 'microfono']).esito, 'consenti');
  assert.equal(P.decidi({ camera: 'nega' }, ['camera', 'microfono']).esito, 'nega');
  assert.deepEqual(P.decidi({ schermo: 'consenti' }, ['schermo']), { esito: 'chiedi', tipi: ['schermo'] });
});

test('il controllo silenzioso dice sì solo con un sì già dato', () => {
  assert.equal(P.consentitoAlControllo('notifications', {}, undefined), false);
  assert.equal(P.consentitoAlControllo('notifications', {}, { notifiche: 'consenti' }), true);
  assert.equal(P.consentitoAlControllo('notifications', {}, { notifiche: 'nega' }), false);
  assert.equal(P.consentitoAlControllo('media', { mediaType: 'video' }, { microfono: 'consenti' }), false);
  assert.equal(P.consentitoAlControllo('media', { mediaType: 'audio' }, { microfono: 'consenti' }), true);
  assert.equal(P.consentitoAlControllo('clipboard-sanitized-write', {}, undefined), true);
  assert.equal(P.consentitoAlControllo('hid', {}, undefined), false);
});

test('origine: solo http(s); le pagine di Filo si riconoscono a parte', () => {
  assert.equal(P.origineDi('https://meet.google.com/abc?x=1'), 'https://meet.google.com');
  assert.equal(P.origineDi('http://127.0.0.1:8080/p'), 'http://127.0.0.1:8080');
  for (const u of ['filo://newtab/', 'data:text/html,hi', 'file:///C:/x.html', 'about:blank', '', 'non un url']) {
    assert.equal(P.origineDi(u), '', u);
  }
  assert.equal(P.eFilo('filo://security/security.html'), true);
  assert.equal(P.eFilo('https://filo.example/'), false);
});

test('la domanda nomina il sito e cosa vuole', () => {
  assert.equal(P.domanda('https://meet.google.com', ['camera', 'microfono']), 'meet.google.com vuole usare la fotocamera e il microfono');
  assert.equal(P.domanda('http://127.0.0.1:9000', ['notifiche']), '127.0.0.1:9000 vuole mandarti notifiche');
  assert.match(P.domanda('https://a.it', ['posizione', 'notifiche', 'appunti']), /sapere dove ti trovi, mandarti notifiche e leggere/);
});

test('normalizza rilegge da capo quello che arriva dal disco o da un backup', () => {
  const n = P.normalizza({
    'https://ok.it': { camera: 'consenti', notifiche: 'nega', schermo: 'consenti', inventato: 'consenti', microfono: 'forse' },
    'https://ok.it/percorso': { camera: 'consenti' },
    'javascript:alert(1)': { camera: 'consenti' },
    'filo://x': { camera: 'consenti' },
    __proto__: { camera: 'consenti' },
    'https://vuoto.it': {},
  });
  assert.deepEqual(Object.keys(n), ['https://ok.it']);
  assert.deepEqual({ ...n['https://ok.it'] }, { camera: 'consenti', notifiche: 'nega' });
  assert.equal(Object.getPrototypeOf(n), null);
  assert.deepEqual(Object.keys(P.normalizza('spazzatura')), []);
});

// ── il custode ──────────────────────────────────────────────────────────────

function sessioneFinta() {
  const s = { gestori: {} };
  s.setPermissionRequestHandler = (fn) => { s.gestori.richiesta = fn; };
  s.setPermissionCheckHandler = (fn) => { s.gestori.controllo = fn; };
  s.setDisplayMediaRequestHandler = (fn) => { s.gestori.schermo = fn; };
  return s;
}

let prossimoWc = 1;
function wcFinto(url, ses) {
  const wc = new EventEmitter();
  wc.id = prossimoWc++;
  wc.url = url;
  wc.session = ses;
  wc.distrutto = false;
  wc.getURL = () => wc.url;
  wc.isDestroyed = () => wc.distrutto;
  return wc;
}

let schede;
let archivio;
function prepara() {
  Permessi._azzera();
  schede = new Map();
  archivio = { dati: {}, scritture: 0, ascoltatori: [] };
  archivio.get = async (k) => ({ [k]: archivio.dati[k] });
  archivio.set = async (obj) => { Object.assign(archivio.dati, obj); archivio.scritture++; };
  archivio.onChanged = (fn) => { archivio.ascoltatori.push(fn); };
  Permessi._perTest({
    archivio,
    schedaDi: (wc) => schede.get(wc) || null,
    schedaPerId: () => null,
  });
}

function apriScheda(url, ses) {
  const wc = wcFinto(url, ses);
  const manager = { aggiornamenti: 0, _broadcast() { this.aggiornamenti++; } };
  schede.set(wc, { tab: { id: `t${wc.id}` }, manager, win: null });
  return { wc, manager };
}

function chiedi(ses, wc, permesso, dettagli = {}) {
  const esiti = [];
  ses.gestori.richiesta(wc, permesso, (ok) => esiti.push(ok), { requestingUrl: wc.getURL(), isMainFrame: true, ...dettagli });
  return esiti;
}

const attendi = () => new Promise((r) => setImmediate(r));

beforeEach(prepara);

test('ogni sessione creata riceve i tre gestori, anche quella di default e quelle che nasceranno dopo', async () => {
  const app = new EventEmitter();
  let pronta;
  app.isReady = () => false;
  app.whenReady = () => new Promise((r) => { pronta = r; });
  const predefinita = sessioneFinta();
  Permessi.installaOvunque(app, { get defaultSession() { return predefinita; } });

  const nate = [sessioneFinta(), sessioneFinta(), sessioneFinta()];
  for (const s of nate) app.emit('session-created', s);
  pronta();
  await attendi();
  for (const s of [...nate, predefinita]) {
    assert.equal(typeof s.gestori.richiesta, 'function');
    assert.equal(typeof s.gestori.controllo, 'function');
    assert.equal(typeof s.gestori.schermo, 'function');
    assert.equal(Permessi.protetta(s), true);
  }
  // Idempotente: una sessione che rinasce non riceve un secondo giro di gestori.
  const primo = nate[0].gestori.richiesta;
  app.emit('session-created', nate[0]);
  assert.equal(nate[0].gestori.richiesta, primo);
});

test('senza risposta nessun sì: la domanda aspetta, Consenti la sblocca e la ricorda per il sito', async () => {
  const ses = sessioneFinta();
  Permessi.installa(ses);
  await Permessi.carica();
  const { wc, manager } = apriScheda('https://sito.example/pagina', ses);

  const primo = chiedi(ses, wc, 'notifications');
  assert.deepEqual(primo, [], 'la pagina resta in attesa, non riceve un sì');
  assert.equal(ses.gestori.controllo(wc, 'notifications', 'https://sito.example', {}), false);
  const domande = Permessi.inAttesaPer(wc);
  assert.equal(domande.length, 1);
  assert.equal(domande[0].testo, 'sito.example vuole mandarti notifiche');
  assert.ok(manager.aggiornamenti > 0, 'la barra della scheda viene avvisata');

  // La stessa domanda ripetuta si aggancia alla prima, non ne apre un'altra.
  const bis = chiedi(ses, wc, 'notifications');
  assert.equal(Permessi.inAttesaPer(wc).length, 1);

  assert.deepEqual(Permessi.rispondi(domande[0].id, 'consenti'), { ok: true });
  assert.deepEqual(primo, [true]);
  assert.deepEqual(bis, [true]);
  assert.equal(Permessi.inAttesaPer(wc).length, 0);
  await attendi();
  assert.deepEqual(archivio.dati.sitePermissions, { 'https://sito.example': { notifiche: 'consenti' } });

  assert.deepEqual(chiedi(ses, wc, 'notifications'), [true], 'la volta dopo passa senza domanda');
  assert.equal(ses.gestori.controllo(wc, 'notifications', 'https://sito.example', {}), true);
  // Il sì vale per quel sito, non per un altro.
  const altro = apriScheda('https://altro.example/', ses);
  assert.deepEqual(chiedi(ses, altro.wc, 'notifications'), []);
});

test('Nega si ricorda, «Non ora» no; cambiare pagina vale no', async () => {
  const ses = sessioneFinta();
  Permessi.installa(ses);
  await Permessi.carica();
  const { wc } = apriScheda('https://sito.example/', ses);

  const a = chiedi(ses, wc, 'media', { mediaTypes: ['video'] });
  Permessi.rispondi(Permessi.inAttesaPer(wc)[0].id, 'nega');
  assert.deepEqual(a, [false]);
  assert.deepEqual(chiedi(ses, wc, 'media', { mediaTypes: ['video'] }), [false], 'il no ricordato risponde subito');

  const b = chiedi(ses, wc, 'geolocation');
  Permessi.rispondi(Permessi.inAttesaPer(wc)[0].id, 'ignora');
  assert.deepEqual(b, [false]);
  const c = chiedi(ses, wc, 'geolocation');
  assert.deepEqual(c, [], '«Non ora» non si ricorda: la volta dopo si richiede');

  wc.emit('did-navigate');
  assert.deepEqual(c, [false], 'la domanda di un documento che non c’è più si chiude con un no');
  assert.equal(Permessi.inAttesaPer(wc).length, 0);
});

test('fuori da una scheda non si chiede e non si concede; le pagine di Filo sì', async () => {
  const ses = sessioneFinta();
  Permessi.installa(ses);
  await Permessi.carica();
  const nascosta = wcFinto('https://sito.example/', ses);
  assert.deepEqual(chiedi(ses, nascosta, 'media', { mediaTypes: ['audio'] }), [false]);
  const interna = wcFinto('filo://newtab/', ses);
  assert.deepEqual(chiedi(ses, interna, 'media', { mediaTypes: ['audio'] }), [true]);
  // Un riquadro web dentro una pagina di Filo resta un sito.
  assert.deepEqual(chiedi(ses, interna, 'geolocation', { requestingUrl: 'https://riquadro.example/', isMainFrame: false }), [false]);
  const senzaOrigine = apriScheda('data:text/html,ciao', ses);
  assert.deepEqual(chiedi(ses, senzaOrigine.wc, 'notifications'), [false]);
  const { wc } = apriScheda('https://sito.example/', ses);
  assert.deepEqual(chiedi(ses, wc, 'clipboard-sanitized-write'), [true]);
});

test('lo schermo intero rifiutato dopo un Esc resta rifiutato (#514)', async () => {
  const ses = sessioneFinta();
  Permessi.installa(ses);
  await Permessi.carica();
  const { wc } = apriScheda('https://video.example/', ses);
  assert.deepEqual(chiedi(ses, wc, 'fullscreen'), [true]);
  schede.get(wc).tab._ultimoInputEsc = true;
  assert.deepEqual(chiedi(ses, wc, 'fullscreen'), [false]);
});

test('il permesso che Filo chiede per sé vale per quella scheda e per pochi usi', async () => {
  const ses = sessioneFinta();
  Permessi.installa(ses);
  await Permessi.carica();
  const { wc } = apriScheda('https://sito.example/', ses);
  const altra = apriScheda('https://sito.example/', ses);
  assert.equal(Permessi.concediAFilo(wc, 'appunti'), true);
  assert.equal(Permessi.concediAFilo(wc, 'camera'), false, 'solo quello che Filo usa davvero');
  assert.deepEqual(chiedi(ses, wc, 'clipboard-read'), [true]);
  assert.deepEqual(chiedi(ses, altra.wc, 'clipboard-read'), [], 'l’altra scheda chiede come sempre');
  assert.deepEqual(chiedi(ses, wc, 'notifications'), [], 'non apre altri permessi');
  chiedi(ses, wc, 'clipboard-read');
  chiedi(ses, wc, 'clipboard-read');
  assert.deepEqual(chiedi(ses, wc, 'clipboard-read'), [], 'finiti gli usi, si torna a chiedere');
  assert.equal(archivio.dati.sitePermissions, undefined, 'e non resta niente di ricordato');
});

test('incognito: le scelte restano nella sua sessione e non vanno su disco', async () => {
  const normale = sessioneFinta();
  const incognito = sessioneFinta();
  Permessi.installa(normale);
  Permessi.installa(incognito);
  Permessi.segnaIncognito(incognito);
  await Permessi.carica();
  const n = apriScheda('https://sito.example/', normale);
  const i = apriScheda('https://sito.example/', incognito);

  Permessi.rispondi((chiedi(incognito, i.wc, 'notifications'), Permessi.inAttesaPer(i.wc)[0].id), 'consenti');
  await attendi();
  assert.equal(archivio.scritture, 0, 'niente su disco');
  assert.deepEqual(chiedi(incognito, i.wc, 'notifications'), [true]);
  assert.deepEqual(chiedi(normale, n.wc, 'notifications'), [], 'la finestra normale non eredita il sì');

  Permessi.imposta(normale, 'https://sito.example', 'camera', 'consenti');
  assert.deepEqual(chiedi(incognito, i.wc, 'media', { mediaTypes: ['video'] }), [], 'e l’incognito non eredita quello di fuori');
});

test('una scelta cambiata altrove risponde alle domande già in attesa dello stesso sito', async () => {
  const ses = sessioneFinta();
  Permessi.installa(ses);
  await Permessi.carica();
  const a = apriScheda('https://sito.example/', ses);
  const b = apriScheda('https://sito.example/altra', ses);
  const ea = chiedi(ses, a.wc, 'geolocation');
  const eb = chiedi(ses, b.wc, 'geolocation');
  Permessi.imposta(ses, 'https://sito.example', 'posizione', 'consenti');
  assert.deepEqual(ea, [true]);
  assert.deepEqual(eb, [true]);
  assert.deepEqual(Permessi.elenco(ses), [{ origine: 'https://sito.example', host: 'sito.example', scelte: { posizione: 'consenti' } }]);
  Permessi.imposta(ses, 'https://sito.example', 'posizione', null);
  assert.deepEqual(Permessi.elenco(ses), []);
  assert.deepEqual(Permessi.imposta(ses, 'javascript:alert(1)', 'camera', 'consenti'), { ok: false, error: 'bad_request' });
  assert.deepEqual(Permessi.imposta(ses, 'https://sito.example', 'schermo', 'consenti'), { ok: false, error: 'bad_request' });
});

test('un backup importato riallinea la memoria', async () => {
  const ses = sessioneFinta();
  Permessi.installa(ses);
  await Permessi.carica();
  const { wc } = apriScheda('https://sito.example/', ses);
  const esiti = chiedi(ses, wc, 'notifications');
  for (const fn of archivio.ascoltatori) fn({ sitePermissions: { newValue: { 'https://sito.example': { notifiche: 'consenti' } } } });
  assert.deepEqual(esiti, [true]);
});

test('una pagina che chiede a raffica non gonfia la coda', async () => {
  const ses = sessioneFinta();
  Permessi.installa(ses);
  await Permessi.carica();
  const { wc } = apriScheda('https://raffica.example/', ses);
  const esiti = [];
  for (let i = 0; i < 150; i++) ses.gestori.richiesta(wc, 'notifications', (ok) => esiti.push(ok), { requestingUrl: wc.getURL(), isMainFrame: true });
  assert.equal(Permessi.inAttesaPer(wc).length, 1);
  assert.ok(esiti.length >= 50 && esiti.every((x) => x === false), 'le eccedenti ricevono subito un no');
});

// ── sentinelle ──────────────────────────────────────────────────────────────

function sorgenti(dir, acc = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) sorgenti(p, acc);
    else if (e.endsWith('.js')) acc.push(p);
  }
  return acc;
}

test('i gestori dei permessi li monta un posto solo', () => {
  const fuori = sorgenti(join(ROOT, 'src'))
    .filter((f) => /\.set(PermissionRequest|PermissionCheck|DisplayMediaRequest)Handler\(/.test(readFileSync(f, 'utf8')))
    .map((f) => relative(ROOT, f).replace(/\\/g, '/'));
  assert.deepEqual(fuori, ['src/main/services/permessiSiti.js']);
});

test('main.js aggancia il custode prima che nasca qualsiasi sessione', () => {
  const main = readFileSync(join(ROOT, 'src', 'main', 'main.js'), 'utf8');
  const aggancio = main.indexOf('Permessi.installaOvunque(app, session)');
  assert.ok(aggancio > 0, 'manca installaOvunque in main.js');
  for (const dopo of ["require('./window')", 'app.whenReady(']) {
    assert.ok(main.indexOf(dopo) > aggancio, `${dopo} deve venire dopo l’aggancio`);
  }
});

test('le porte che decidono per un sito sono solo di Filo; quella di Incolla/Detta è aperta', () => {
  const src = readFileSync(join(ROOT, 'src', 'main', 'services', 'handlers', 'permessi.js'), 'utf8');
  const porte = [...src.matchAll(/on\(MSG\.([A-Z_]+),\s*(soloFilo\()?/g)].map((m) => [m[1], !!m[2]]);
  assert.deepEqual(Object.fromEntries(porte), {
    SITE_PERMISSIONS_LIST: true,
    SITE_PERMISSIONS_OF_TAB: true,
    SITE_PERMISSION_SET: true,
    SITE_PERMISSIONS_FORGET: true,
    SITE_PERMISSION_ANSWER: true,
    PERMESSO_FILO: false,
  });
});
