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
  // Quello che Chrome concede da sé non diventa una domanda: l'inclinazione del computer, lo spazio tenuto da parte.
  for (const p of ['clipboard-sanitized-write', 'fullscreen', 'pointerLock', 'keyboardLock', 'mediaKeySystem', 'sensors', 'persistent-storage']) {
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

test('Filo non ha un permesso suo sulla scheda: una lettura degli appunti dal documento chiede come le altre', async () => {
  const ses = sessioneFinta();
  Permessi.installa(ses);
  await Permessi.carica();
  const { wc } = apriScheda('https://sito.example/', ses);
  assert.equal(typeof Permessi.concediAFilo, 'undefined', 'nessuna porta apre la scheda a Filo, e quindi al sito');
  assert.deepEqual(chiedi(ses, wc, 'clipboard-read'), [], 'la lettura aspetta la risposta dell’utente');
  assert.equal(Permessi.inAttesaPer(wc)[0].testo, 'sito.example vuole leggere quello che hai copiato');
});

test('chiusa tre volte senza risposta, la domanda smette di tornare, e la scheda dice perché', async () => {
  const ses = sessioneFinta();
  Permessi.installa(ses);
  await Permessi.carica();
  const { wc } = apriScheda('https://insiste.example/', ses);
  for (let i = 0; i < 3; i++) {
    const e = chiedi(ses, wc, 'media', { mediaTypes: ['video'] });
    const d = Permessi.inAttesaPer(wc)[0];
    assert.ok(d, `la domanda ${i + 1} c’è`);
    if (i === 1) assert.equal(Permessi.chiudiPrimaDomanda(wc), true, 'l’Esc chiude come la ×');
    else Permessi.rispondi(d.id, 'ignora');
    assert.deepEqual(e, [false]);
  }
  assert.deepEqual(chiedi(ses, wc, 'media', { mediaTypes: ['video'] }), [false], 'dopo tre chiusure si risponde no senza domanda');
  assert.equal(Permessi.inAttesaPer(wc).length, 0);
  assert.deepEqual(Permessi.usiPer(wc).bloccati, [{ tipo: 'camera', motivo: 'smesso' }]);
  assert.deepEqual(Permessi.perSito(ses, 'https://insiste.example').smesso, ['camera']);
  assert.deepEqual(Permessi.negatiPer(wc), ['camera'], 'per la pagina è un no vero');
  // Ridarlo dal menu della scheda o da Sicurezza riapre la strada.
  Permessi.imposta(ses, 'https://insiste.example', 'camera', null);
  assert.deepEqual(chiedi(ses, wc, 'media', { mediaTypes: ['video'] }), []);
  assert.equal(Permessi.inAttesaPer(wc).length, 1);
});

test('un no che non si ricorda (lo schermo, ciò che Filo non conosce) conta come chiusura', async () => {
  const ses = sessioneFinta();
  Permessi.installa(ses);
  await Permessi.carica();
  const { wc } = apriScheda('https://insiste.example/', ses);
  for (let i = 0; i < 3; i++) {
    chiedi(ses, wc, 'permesso-di-domani');
    Permessi.rispondi(Permessi.inAttesaPer(wc)[0].id, 'nega');
  }
  assert.deepEqual(chiedi(ses, wc, 'permesso-di-domani'), [false]);
  assert.equal(Permessi.inAttesaPer(wc).length, 0);
});

test('ciò che Filo non conosce si nomina, e un sì vale per quella volta sola', async () => {
  const ses = sessioneFinta();
  Permessi.installa(ses);
  await Permessi.carica();
  const { wc } = apriScheda('https://ricette.example/', ses);
  const e = chiedi(ses, wc, 'permesso-di-domani');
  const d = Permessi.inAttesaPer(wc)[0];
  assert.match(d.testo, /che Filo non conosce \(«permesso-di-domani»\)/);
  Permessi.rispondi(d.id, 'consenti');
  assert.deepEqual(e, [true]);
  assert.deepEqual(chiedi(ses, wc, 'permesso-di-domani'), [], 'la volta dopo richiede');
  assert.equal(archivio.dati.sitePermissions, undefined, 'e non resta niente di ricordato');
  assert.equal(ses.gestori.controllo(wc, 'hid', 'https://ricette.example', {}), false, 'i dispositivi restano chiusi');
  assert.deepEqual(chiedi(ses, wc, 'screen-wake-lock'), [true], 'tenere acceso lo schermo non si chiede');
});

test('i caratteri del computer: una lettura dopo un gesto accende il segno sulla scheda, mai la striscia', async () => {
  const ses = sessioneFinta();
  Permessi.installa(ses);
  await Permessi.carica();
  let gesto = false;
  Permessi._perTest({ gestoVeroRecente: () => gesto });
  const { wc } = apriScheda('https://editor.example/', ses);
  assert.equal(ses.gestori.controllo(wc, 'local-fonts', 'https://editor.example', {}), false);
  assert.equal(Permessi.usiPer(wc), null, 'una lettura al caricamento non accende niente');
  gesto = true;
  for (let i = 0; i < 3; i++) ses.gestori.controllo(wc, 'local-fonts', 'https://editor.example', {});
  assert.equal(Permessi.inAttesaPer(wc).length, 0, 'una lettura non è una domanda');
  assert.deepEqual(Permessi.usiPer(wc).bloccati, [{ tipo: 'caratteri', motivo: 'chiedi' }]);
  Permessi.imposta(ses, 'https://editor.example', 'caratteri', 'consenti');
  assert.equal(ses.gestori.controllo(wc, 'local-fonts', 'https://editor.example', {}), true);
  assert.equal(Permessi.usiPer(wc), null, 'dato il sì, il segno si spegne');
});

test('fuori da una scheda si chiede con la finestra di sistema; nascosta, no', async () => {
  const ses = sessioneFinta();
  Permessi.installa(ses);
  await Permessi.carica();
  const finestra = { visibile: true, isDestroyed: () => false, isVisible() { return this.visibile; } };
  const dialoghi = [];
  let risposta = 2;
  Permessi._perTest({
    electron: {
      BrowserWindow: { fromWebContents: () => finestra },
      dialog: { showMessageBox: async (w, o) => { dialoghi.push(o); return { response: risposta }; } },
    },
  });
  const popup = wcFinto('https://accesso.example/', ses);
  const e = chiedi(ses, popup, 'media', { mediaTypes: ['video'] });
  await attendi(); await attendi();
  assert.deepEqual(e, [true]);
  assert.equal(dialoghi[0].message, 'accesso.example vuole usare la fotocamera');
  assert.deepEqual(chiedi(ses, popup, 'media', { mediaTypes: ['video'] }), [true], 'la risposta si ricorda come dalla striscia');
  risposta = 0;
  const f = chiedi(ses, popup, 'notifications');
  await attendi(); await attendi();
  assert.deepEqual(f, [false], '«Non ora» vale no per quella volta');
  finestra.visibile = false;
  assert.deepEqual(chiedi(ses, popup, 'geolocation'), [false], 'una finestra nascosta non chiede');
  assert.equal(dialoghi.length, 2);
});

test('lo schermo lo chiede solo un documento web: da un riquadro senza indirizzo no', async () => {
  const ses = sessioneFinta();
  Permessi.installa(ses);
  await Permessi.carica();
  const { wc } = apriScheda('https://video.example/', ses);
  assert.deepEqual(chiedi(ses, wc, 'media', { mediaTypes: [], requestingUrl: 'about:blank', isMainFrame: false }), [false]);
  assert.equal(Permessi.inAttesaPer(wc).length, 0);
  Permessi.annunciaSchermo(wc);
  chiedi(ses, wc, 'media', { mediaTypes: [] });
  assert.deepEqual(Permessi.inAttesaPer(wc)[0].tipi, ['schermo']);
});

// Chromium fa arrivare getDisplayMedia e la strada vecchia (`chromeMediaSource`) identiche; solo getDisplayMedia,
// DENTRO il sì, passa dal gestore dello schermo, e si annuncia prima dalla pagina.
function chiediSchermo(ses, wc, { gestore = true } = {}) {
  const esiti = [];
  const flussi = [];
  ses.gestori.richiesta(wc, 'media', (ok) => {
    esiti.push(ok);
    if (ok && gestore) ses.gestori.schermo({ frame: { wc } }, (f) => flussi.push(f));
  }, { requestingUrl: wc.getURL(), isMainFrame: true, mediaTypes: [] });
  return { esiti, flussi };
}

test('lo schermo senza annuncio è la strada vecchia: no subito, senza domanda', async () => {
  const ses = sessioneFinta();
  Permessi.installa(ses);
  await Permessi.carica();
  const { wc } = apriScheda('https://video.example/', ses);
  assert.deepEqual(chiediSchermo(ses, wc).esiti, [false]);
  assert.equal(Permessi.inAttesaPer(wc).length, 0);
});

test('il sì allo schermo che Chromium non passa al gestore dello schermo chiude la pagina prima che la cattura arrivi', async () => {
  const ses = sessioneFinta();
  Permessi.installa(ses);
  const chiuse = [];
  Permessi._perTest({
    electron: {
      webContents: { fromFrame: (f) => f.wc },
      desktopCapturer: { getSources: async () => [{ id: 'screen:1:0', name: 'Entire screen' }] },
      screen: { getDisplayMatching: () => ({ id: 1 }) },
    },
    fermaPagina: (w) => chiuse.push(w.id),
  });
  await Permessi.carica();
  const { wc } = apriScheda('https://video.example/', ses);

  // getDisplayMedia: annuncio, domanda, «Condividi lo schermo», e il gestore consegna quello che si è scelto.
  Permessi.annunciaSchermo(wc);
  const vero = chiediSchermo(ses, wc);
  assert.deepEqual(vero.esiti, [], 'finché non si risponde la pagina aspetta');
  Permessi.rispondi(Permessi.inAttesaPer(wc)[0].id, 'consenti', 'screen:1:0');
  await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual(vero.esiti, [true]);
  assert.equal(vero.flussi.length, 1);
  assert.equal(vero.flussi[0].video.id, 'screen:1:0');
  assert.deepEqual(chiuse, [], 'la strada giusta non chiude niente');

  // La strada vecchia con un annuncio falso: la domanda c'è, ma il sì non passa dal gestore e la pagina si chiude.
  Permessi.annunciaSchermo(wc);
  const vecchia = chiediSchermo(ses, wc, { gestore: false });
  Permessi.rispondi(Permessi.inAttesaPer(wc)[0].id, 'consenti', 'screen:1:0');
  assert.deepEqual(vecchia.esiti, [true]);
  assert.deepEqual(chiuse, [wc.id]);
});

test('le notifiche non le chiede un riquadro di un altro sito, e quello che non si delega resta di chi lo chiede', async () => {
  const ses = sessioneFinta();
  Permessi.installa(ses);
  await Permessi.carica();
  const { wc } = apriScheda('https://giornale.example/', ses);
  const riquadro = { isMainFrame: false, requestingUrl: 'https://pubblicita.example/w' };
  Permessi.imposta(null, 'https://giornale.example', 'notifiche', 'consenti');
  assert.deepEqual(chiedi(ses, wc, 'notifications', riquadro), [false], 'il sì del giornale non vale per chi incorpora');
  assert.equal(ses.gestori.controllo(wc, 'notifications', 'https://pubblicita.example', riquadro), false);
  assert.equal(ses.gestori.controllo(wc, 'notifications', 'https://giornale.example', {}), true);
  assert.deepEqual(chiedi(ses, wc, 'notifications', { isMainFrame: false, requestingUrl: 'about:blank' }), [true], 'un riquadro vuoto è del giornale');
  // Aprire un'altra app: la domanda porta il nome del riquadro, e la risposta resta sua.
  Permessi.imposta(null, 'https://giornale.example', 'app', 'consenti');
  chiedi(ses, wc, 'openExternal', { ...riquadro, externalURL: 'zoommtg://x' });
  const d = Permessi.inAttesaPer(wc)[0];
  assert.equal(d.host, 'pubblicita.example');
  assert.deepEqual(Permessi.negatiPer(wc, { url: riquadro.requestingUrl }), ['notifiche'], 'e lì dentro le notifiche si leggono negate');
  assert.deepEqual(Permessi.negatiPer(wc), []);
});

test('la scheda sa cosa il sito ha avuto e cosa si è visto negare, fino al documento dopo', async () => {
  const ses = sessioneFinta();
  Permessi.installa(ses);
  await Permessi.carica();
  const { wc } = apriScheda('https://chiamata.example/', ses);
  assert.equal(Permessi.usiPer(wc), null);
  chiedi(ses, wc, 'media', { mediaTypes: ['audio'] });
  Permessi.rispondi(Permessi.inAttesaPer(wc)[0].id, 'consenti');
  chiedi(ses, wc, 'media', { mediaTypes: ['video'] });
  Permessi.rispondi(Permessi.inAttesaPer(wc)[0].id, 'nega');
  assert.deepEqual(Permessi.usiPer(wc), { host: 'chiamata.example', inUso: ['microfono'], bloccati: [{ tipo: 'camera', motivo: 'negato' }] });
  wc.emit('did-navigate');
  assert.equal(Permessi.usiPer(wc), null, 'una pagina nuova riparte pulita');
});

test('togliere un permesso che la pagina tiene aperto lo dice, da qualunque strada', async () => {
  const ses = sessioneFinta();
  Permessi.installa(ses);
  await Permessi.carica();
  const { wc } = apriScheda('https://chiamata.example/', ses);
  const avvisi = [];
  Permessi._perTest({
    tutteLeSchede: () => [...schede.entries()].map(([c, s]) => ({ ...s, tab: { ...s.tab, view: { webContents: c } } })),
    avvisaAcceso: (_s, info) => avvisi.push(info),
  });
  chiedi(ses, wc, 'media', { mediaTypes: ['audio'] });
  Permessi.rispondi(Permessi.inAttesaPer(wc)[0].id, 'consenti');
  assert.equal(Permessi.imposta(ses, 'https://chiamata.example', 'microfono', 'nega').ancoraAperti, 1);
  assert.equal(Permessi.dimentica(ses, 'https://chiamata.example').ancoraAperti, 1);
  assert.equal(Permessi.imposta(ses, 'https://chiamata.example', 'notifiche', null).ancoraAperti, 0, 'le notifiche non restano aperte');
  assert.deepEqual(avvisi.map((a) => [a.host, a.tipi]), [['chiamata.example', ['microfono']], ['chiamata.example', ['microfono']]]);
});

test('una scheda da un altro paese aperta in incognito resta nella memoria di quella finestra', async () => {
  const normale = sessioneFinta();
  const finestra = sessioneFinta();
  const paese = sessioneFinta();
  for (const s of [normale, finestra, paese]) Permessi.installa(s);
  Permessi.segnaIncognito(finestra);
  Permessi.segnaIncognito(paese, finestra);
  await Permessi.carica();
  const p = apriScheda('https://sito.example/', paese);
  Permessi.rispondi((chiedi(paese, p.wc, 'notifications'), Permessi.inAttesaPer(p.wc)[0].id), 'consenti');
  await attendi();
  assert.equal(archivio.scritture, 0, 'niente su disco');
  assert.deepEqual(Permessi.elenco(null), [], 'le finestre normali non la vedono');
  assert.deepEqual(Permessi.elenco(finestra).map((x) => x.host), ['sito.example'], 'la finestra incognito sì');
});

test('i dispositivi restano chiusi: nessuna scelta automatica di Bluetooth, HID, seriale, USB', () => {
  const ses = sessioneFinta();
  const eventi = new EventEmitter();
  ses.on = (n, fn) => eventi.on(n, fn);
  Permessi.installa(ses);
  const wc = new EventEmitter();
  Permessi.cablaContenuti(wc);
  const esiti = [];
  const evento = () => { const e = { prevenuto: false, preventDefault() { e.prevenuto = true; } }; return e; };
  const eb = evento();
  wc.emit('select-bluetooth-device', eb, [{ deviceId: 'cuffie' }], (id) => esiti.push(['bt', id]));
  const eh = evento();
  eventi.emit('select-hid-device', eh, {}, (id) => esiti.push(['hid', id]));
  const es = evento();
  eventi.emit('select-serial-port', es, [{ portId: 'p' }], wc, (id) => esiti.push(['seriale', id]));
  const eu = evento();
  eventi.emit('select-usb-device', eu, {}, (id) => esiti.push(['usb', id]));
  assert.deepEqual(esiti, [['bt', ''], ['hid', undefined], ['seriale', ''], ['usb', undefined]]);
  assert.ok([eb, eh, es, eu].every((e) => e.prevenuto), 'senza preventDefault Electron sceglie il primo da sé');
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

function porte(file) {
  const src = readFileSync(join(ROOT, 'src', 'main', 'services', 'handlers', file), 'utf8');
  return Object.fromEntries([...src.matchAll(/on\(MSG\.([A-Z_]+),\s*(soloFilo\()?/g)].map((m) => [m[1], !!m[2]]));
}

test('le porte che decidono per un sito sono solo di Filo; aperte ai content script solo Incolla, Detta e l’Esc', () => {
  assert.deepEqual(porte('permessi.js'), {
    SITE_PERMISSIONS_LIST: true,
    SITE_PERMISSIONS_OF_TAB: true,
    SITE_PERMISSION_SET: true,
    SITE_PERMISSIONS_FORGET: true,
    SITE_PERMISSION_ANSWER: true,
    SITE_SCREEN_SOURCES: true,
    PERMESSI_ESC: false,
    FILO_READ_CLIPBOARD: false,
  });
  assert.deepEqual(porte('dettatura.js'), { DETTATURA_AVVIA: false, DETTATURA_FERMA: false, DETTATURA_EVENTO: true });
});

test('Incolla e Detta sulle pagine web non passano dal permesso del sito', () => {
  const actions = readFileSync(join(ROOT, 'src', 'content', 'actions.js'), 'utf8');
  const tts = readFileSync(join(ROOT, 'src', 'content', 'tts.js'), 'utf8');
  assert.match(actions, /MSG\.FILO_READ_CLIPBOARD/);
  assert.doesNotMatch(actions, /navigator\.clipboard\.read\(\)/, 'Incolla non legge gli appunti dal documento del sito');
  assert.match(tts, /if \(dettaDallaCornice\(\)\) \{ await dettaConLaCornice\(\); return; \}/);
  for (const f of sorgenti(join(ROOT, 'src'))) assert.doesNotMatch(readFileSync(f, 'utf8'), /PERMESSO_FILO|permesso_filo/, f);
});

test('sulle pagine web solo il menu va nello strato alto: sotto-menu, etichette e icona trascinata ci stanno dentro', () => {
  const menu = readFileSync(join(ROOT, 'src', 'content', 'menu.js'), 'utf8');
  const fuori = menu.match(/menuHost\(\)\.appendChild\((\w+)\)/g) || [];
  assert.deepEqual(fuori, ['menuHost().appendChild(root)'], 'un pezzo appeso fuori dal menu lo copre o gli sta sotto');
  assert.equal((menu.match(/showPopover\(\)/g) || []).length, 1, 'uno strato alto solo, quello del menu');
});

test('il sorgente per il mondo della pagina: «da chiedere» dove nessuno ha negato, e niente strada vecchia per lo schermo', () => {
  const { buildPermessiPaginaSource } = require(join(ROOT, 'src', 'preload', 'permessi-pagina.js'));
  const src = buildPermessiPaginaSource(['camera']);
  let stati = { camera: 'denied', microphone: 'denied', notifications: 'denied' };
  let permessoNotifiche = 'denied';
  const chiamate = [];
  class PermissionStatus { constructor(name) { this.name = name; } }
  Object.defineProperty(PermissionStatus.prototype, 'state', { configurable: true, get() { return stati[this.name]; } });
  class Notification {}
  Object.defineProperty(Notification, 'permission', { configurable: true, get() { return permessoNotifiche; } });
  const annunci = [];
  class MediaDevices {
    getUserMedia(c) { chiamate.push(c); return Promise.resolve('flusso'); }
    getDisplayMedia() { annunci.push('chiamata'); return Promise.resolve('schermo'); }
  }
  class DOMException extends Error { constructor(m, n) { super(m); this.name = n; } }
  const { ANNUNCIO_SCHERMO } = require(join(ROOT, 'src', 'preload', 'permessi-pagina.js'));
  const doc = new EventTarget();
  doc.addEventListener(ANNUNCIO_SCHERMO, () => annunci.push('annuncio'));
  const w = { PermissionStatus, Notification, MediaDevices, DOMException, Promise, setTimeout, Navigator: class {} };
  new Function('window', 'document', `with (window) { ${src} }`)(w, doc);
  assert.equal(new PermissionStatus('microphone').state, 'prompt', 'nessuno ha negato il microfono');
  assert.equal(new PermissionStatus('camera').state, 'denied', 'la fotocamera l’ha negata l’utente');
  assert.equal(Notification.permission, 'default');
  stati = { microphone: 'granted' };
  assert.equal(new PermissionStatus('microphone').state, 'granted');
  permessoNotifiche = 'granted';
  assert.equal(Notification.permission, 'granted');
  const md = new MediaDevices();
  const nega = (e) => assert.equal(e.name, 'NotAllowedError');
  // Una richiesta che cambia mentre la si legge: vuota la prima volta, con la fonte vecchia dalla seconda.
  const cambia = () => { let n = 0; return { get mandatory() { return n++ ? { chromeMediaSource: 'desktop' } : {}; } }; };
  // Una richiesta coi getter di un framework (Vue 2): lo stesso valore a ogni lettura, passa com'è.
  const reattiva = {};
  Object.defineProperty(reattiva, 'deviceId', { enumerable: true, get: () => 'mic-1' });
  return Promise.all([
    md.getUserMedia({ audio: { mandatory: { chromeMediaSource: 'desktop' } } }).then(() => assert.fail('la strada vecchia è passata'), nega),
    md.getUserMedia({ video: { optional: [{ chromeMediaSourceId: 'x' }] } }).then(() => assert.fail(), nega),
    md.getUserMedia({ video: cambia() }).then(() => assert.fail('la richiesta che cambia è passata'), nega),
    md.getUserMedia({ audio: true }).then((r) => assert.equal(r, 'flusso')),
    md.getUserMedia({ audio: reattiva }).then((r) => assert.equal(r, 'flusso')),
    md.getDisplayMedia({ video: true }).then((r) => assert.equal(r, 'schermo')),
  ]).then(() => {
    assert.equal(chiamate.length, 2, 'al browser arrivano solo le richieste normali');
    // Al browser arriva la copia controllata: senza prototipo, così niente si pesca da un prototipo della pagina.
    assert.equal(Object.getPrototypeOf(chiamate[0]), null);
    assert.equal(chiamate[0].audio, true);
    assert.equal(chiamate[1].audio.deviceId, 'mic-1');
    assert.equal(Object.getOwnPropertyDescriptor(chiamate[1].audio, 'deviceId').get, undefined, 'la copia non ha getter');
    assert.deepEqual(annunci, ['annuncio', 'chiamata'], 'getDisplayMedia si annuncia prima di partire');
  });
});
