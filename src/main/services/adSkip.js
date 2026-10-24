// Il «Salta» delle pubblicità dei video premuto come lo premerebbe l'utente (#737): un clic del content script è finto e YouTube lo riconosce.
// Solo a YouTube (frame principale, o lettore incorporato col punto confermato dai frame sopra di lui): altrove un sito si
// fabbricherebbe un pulsante per avere gesti veri. Regole: tests/unit/adSkip.test.mjs; il lato pagina è src/content/adSkip.js.
'use strict';

const Permessi = require('./permessiPagine');

// Fra due clic veri sulla stessa scheda: più fitto di così non serve nemmeno a una serie di pubblicità.
const INTERVALLO_MS = 800;
const ultimoClic = new WeakMap();
let ultimoStato = null;

function attivo(settings) {
  return settings?.security?.adSkip?.enabled !== false;
}

// Rilegge l'interruttore; true se è cambiato, così chi salva le impostazioni lo dice alle schede.
function configureFromSettings(settings) {
  const ora = attivo(settings);
  const cambiato = ultimoStato !== null && ultimoStato !== ora;
  ultimoStato = ora;
  return cambiato;
}

/** I siti a cui Filo dà il clic vero sul «Salta». PURA. */
function hostConClicVero(url) {
  let u;
  try { u = new URL(String(url || '')); } catch (_) { return false; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
  const h = u.hostname.toLowerCase();
  return h === 'youtube.com' || h.endsWith('.youtube.com');
}

// I lettori incorporati: il dominio senza cookie è quello che molti siti usano per i video di YouTube.
function hostIncorporato(url) {
  if (hostConClicVero(url)) return true;
  let u;
  try { u = new URL(String(url || '')); } catch (_) { return false; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
  const h = u.hostname.toLowerCase();
  return h === 'youtube-nocookie.com' || h.endsWith('.youtube-nocookie.com');
}

function framePrincipale(sender) {
  try {
    const wc = sender && sender.wc;
    const f = sender && sender.frame;
    return Boolean(wc && f && wc.mainFrame && f.frameTreeNodeId === wc.mainFrame.frameTreeNodeId);
  } catch (_) { return false; }
}

function urlDelFrame(sender) {
  try { return String(sender.frame.url || ''); } catch (_) { return ''; }
}

// Dal lettore in su fino al frame principale: ogni anello è un frame che deve ritrovare nella sua pagina il riquadro
// figlio, riconosciuto dall'origine. Un'origine opaca («null») la può avere anche un riquadro del sito: lì niente.
const MAX_ANELLI = 8;
function catena(sender) {
  try {
    const mainId = sender.wc.mainFrame.frameTreeNodeId;
    const anelli = [];
    let figlio = sender.frame;
    while (figlio.frameTreeNodeId !== mainId) {
      const padre = figlio.parent;
      const origine = String(figlio.origin || '');
      if (!padre || anelli.length >= MAX_ANELLI || !/^https?:\/\/[^/]+$/.test(origine)) return null;
      anelli.push({ frame: padre, origineFiglio: origine });
      figlio = padre;
    }
    return anelli.length ? anelli : null;
  } catch (_) { return null; }
}

/** Come il mittente può avere il clic vero: 'principale' (YouTube), 'riquadro' (lettore incorporato), o null. */
function modoClicVero(sender) {
  if (!sender || !sender.tab) return null;
  if (framePrincipale(sender)) return hostConClicVero(urlDelFrame(sender)) ? 'principale' : null;
  if (hostIncorporato(urlDelFrame(sender)) && catena(sender)) return 'riquadro';
  return null;
}

function mittenteConClicVero(sender) {
  return modoClicVero(sender) !== null;
}

function numero(v) { return typeof v === 'number' && Number.isFinite(v); }

// Le domande ai frame sopra il lettore vanno dal main al content script e ritorno, mai per la pagina: un sito che
// sapesse quando arriva il clic ci infilerebbe sopra un suo elemento fra il controllo e il clic.
const DOMANDA_MS = 1500;
const domande = new Map();
const tipoDove = () => (globalThis.SN_MSG && globalThis.SN_MSG.MSG && globalThis.SN_MSG.MSG.AD_SKIP_WHERE) || 'ad_skip_where';

function chiediAlFrame(wc, frame, domanda) {
  return new Promise((risolvi) => {
    const id = require('crypto').randomBytes(16).toString('hex');
    let timer = null;
    const fine = (r) => { clearTimeout(timer); domande.delete(id); risolvi(r); };
    timer = setTimeout(() => fine(null), DOMANDA_MS);
    domande.set(id, { wc, ftn: frame.frameTreeNodeId, fine });
    try { frame.send('filo:broadcast', { type: tipoDove(), id, ...domanda }); } catch (_) { fine(null); }
  });
}

/** La risposta di un frame a una domanda: vale solo dal frame a cui è stata fatta. true se era attesa. */
function rispostaDalFrame(sender, msg) {
  const d = msg && typeof msg.id === 'string' ? domande.get(msg.id) : null;
  if (!d || !sender || sender.wc !== d.wc) return false;
  try { if (sender.frame.frameTreeNodeId !== d.ftn) return false; } catch (_) { return false; }
  const ok = numero(msg.x) && numero(msg.y) && msg.x >= 0 && msg.y >= 0
    && typeof msg.tag === 'string' && msg.tag.length > 0 && msg.tag.length <= 64;
  d.fine(ok ? { x: msg.x, y: msg.y, tag: msg.tag } : { no: msg.code === 'ignoto' || msg.code === 'nascosta' ? msg.code : 'coperto' });
  return true;
}

/**
 * Dal punto della pagina (px CSS del riquadro visibile) al punto della vista (px dello schermo logico). PURA.
 * Fuori dalla vista, o non un numero, è null: il clic non parte.
 */
function puntoNellaVista(msg, zoom, larghezza, altezza) {
  if (!msg || typeof msg.x !== 'number' || typeof msg.y !== 'number') return null;
  const { x, y } = msg;
  const z = Number(zoom) > 0 ? Number(zoom) : 1;
  if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0) return null;
  const px = Math.round(x * z);
  const py = Math.round(y * z);
  if (!(px < Number(larghezza)) || !(py < Number(altezza))) return null;
  return { x: px, y: py };
}

// Dopo il clic la pagina crede che il puntatore sia sul «Salta»: glielo si rimette dov'è davvero.
function rimettiPuntatore(wc, win, vista) {
  try {
    const { screen } = require('electron');
    const c = screen.getCursorScreenPoint();
    const cb = win.getContentBounds();
    const x = Math.round(c.x - cb.x - vista.x);
    const y = Math.round(c.y - cb.y - vista.y);
    const dentro = x >= 0 && y >= 0 && x < vista.width && y < vista.height;
    wc.sendInputEvent({ type: dentro ? 'mouseMove' : 'mouseLeave', x, y });
  } catch (_) {}
}

// La scheda in secondo piano ha la vista grande zero ma la pagina tiene la sua misura, e il clic le arriva lo stesso:
// lì il limite è l'area della finestra, dove la pagina tornerà.
function areaDelClic(view, win) {
  let b = null;
  try { b = view.getBounds(); } catch (_) { b = null; }
  if (b && b.width > 0 && b.height > 0) return b;
  let c = null;
  try { c = win && win.getContentBounds(); } catch (_) { c = null; }
  return c && c.width > 0 && c.height > 0 ? { x: 0, y: 0, width: c.width, height: c.height } : null;
}

function clicVero(wc, msg, { win, view, ora = Date.now() } = {}) {
  if (!wc || !view || (wc.isDestroyed && wc.isDestroyed())) return { ok: false, code: 'scheda' };
  if (ora - (ultimoClic.get(wc) || 0) < INTERVALLO_MS) return { ok: false, code: 'presto' };
  const b = areaDelClic(view, win);
  let zoom = 1;
  try { zoom = wc.getZoomFactor(); } catch (_) { zoom = 1; }
  const p = b && puntoNellaVista(msg, zoom, b.width, b.height);
  if (!p) return { ok: false, code: 'punto' };
  ultimoClic.set(wc, ora);
  Permessi.clicDiFilo(wc);
  try {
    wc.sendInputEvent({ type: 'mouseMove', x: p.x, y: p.y });
    wc.sendInputEvent({ type: 'mouseDown', x: p.x, y: p.y, button: 'left', clickCount: 1 });
    wc.sendInputEvent({ type: 'mouseUp', x: p.x, y: p.y, button: 'left', clickCount: 1 });
  } catch (_) { return { ok: false, code: 'scheda' }; }
  if (win) rimettiPuntatore(wc, win, b);
  return { ok: true };
}

// Una risposta del protocollo che non arriva non deve tenere il debugger attaccato né fermare i clic dopo.
const TETTO_CLIC_MS = 3000;
function entro(p, ms) {
  let t = null;
  const scade = new Promise((_, ko) => { t = setTimeout(() => ko(new Error('tempo')), ms); });
  return Promise.race([p, scade]).finally(() => clearTimeout(t));
}

// I «Salta» di YouTube (gli stessi del content script): il riquadro che riceve il clic deve averne uno sotto il punto.
const SALTA_YOUTUBE = ['.ytp-skip-ad-button', '.ytp-ad-skip-button', '.ytp-ad-skip-button-modern'];

// Fra i riquadri della scheda con l'indirizzo del lettore, quello che ha un «Salta» sotto il punto: due video uguali
// nella stessa pagina hanno lo stesso indirizzo.
async function sessioneDelLettore(cmd, sessioni, msg) {
  const domanda = `(() => { const e = document.elementFromPoint(${msg.x}, ${msg.y}); `
    + `return !!(e && e.closest(${JSON.stringify(SALTA_YOUTUBE.join(','))})); })()`;
  for (const s of sessioni) {
    if (s.url !== msg.url) continue;
    try {
      const r = await cmd('Runtime.evaluate', { expression: domanda, returnByValue: true }, s.sid);
      if (r && r.result && r.result.value === true) return s.sid;
    } catch (_) {}
  }
  return null;
}

// Un lettore incorporato da un altro sito vive in un processo suo: sendInputEvent arriva solo al frame principale.
// Il clic va dritto al riquadro del lettore, nel suo punto: instradato dal punto dello schermo, con la scheda dietro o
// appena tornata davanti (non ancora disegnata) cadeva sul sito che lo ospita (#1494).
async function clicNelRiquadro(wc, msg, { win, view, ora = Date.now(), tetto = TETTO_CLIC_MS } = {}) {
  if (!wc || !view || (wc.isDestroyed && wc.isDestroyed())) return { ok: false, code: 'scheda' };
  if (ora - (ultimoClic.get(wc) || 0) < INTERVALLO_MS) return { ok: false, code: 'presto' };
  if (!msg || !numero(msg.x) || !numero(msg.y) || msg.x < 0 || msg.y < 0 || typeof msg.url !== 'string' || !msg.url) {
    return { ok: false, code: 'punto' };
  }
  ultimoClic.set(wc, ora);
  Permessi.clicDiFilo(wc);
  const dbg = wc.debugger;
  let mio = false;
  const sessioni = [];
  const attese = [];
  const cmd = (metodo, parametri = {}, sid = '') => (sid ? dbg.sendCommand(metodo, parametri, sid) : dbg.sendCommand(metodo, parametri));
  const segui = (sid) => cmd('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true }, sid).catch(() => {});
  const suMessaggio = (_e, metodo, p) => {
    if (metodo !== 'Target.attachedToTarget' || !p || !p.targetInfo || p.targetInfo.type !== 'iframe') return;
    sessioni.push({ sid: p.sessionId, url: String(p.targetInfo.url || '') });
    attese.push(segui(p.sessionId));
  };
  let trovato = false;
  try {
    if (!dbg.isAttached()) { dbg.attach('1.3'); mio = true; }
    dbg.on('message', suMessaggio);
    trovato = await entro((async () => {
      attese.push(segui(''));
      while (attese.length) await Promise.all(attese.splice(0));
      let sid = await sessioneDelLettore(cmd, sessioni, msg);
      let base = { x: msg.x, y: msg.y };
      // Un lettore nello stesso processo della pagina non ha una sessione sua: lì il punto nella pagina, confermato dai
      // frame sopra, arriva giusto anche instradato.
      if (!sid && msg.radice) { sid = ''; base = { x: msg.radice.x, y: msg.radice.y }; }
      if (sid === null) return false;
      // Lo spostamento la pagina lo legge al fotogramma dopo, che una scheda nascosta non disegna: la sua risposta non
      // arriverebbe mai. Non lo si aspetta; la pressione, che parte subito, se lo porta dietro nell'ordine giusto.
      cmd('Input.dispatchMouseEvent', { ...base, type: 'mouseMoved', button: 'none' }, sid).catch(() => {});
      await Promise.all([
        cmd('Input.dispatchMouseEvent', { ...base, type: 'mousePressed', button: 'left', buttons: 1, clickCount: 1 }, sid),
        cmd('Input.dispatchMouseEvent', { ...base, type: 'mouseReleased', button: 'left', buttons: 0, clickCount: 1 }, sid),
      ]);
      return true;
    })(), tetto);
  } catch (_) {
    return { ok: false, code: 'scheda' };
  } finally {
    try { dbg.removeListener('message', suMessaggio); } catch (_) {}
    if (mio) { try { dbg.detach(); } catch (_) {} }
  }
  if (!trovato) return { ok: false, code: 'coperto' };
  if (win) rimettiPuntatore(wc, win, areaDelClic(view, win));
  return { ok: true };
}

// In una scheda nascosta i frame rispondono al passo dei loro timer, un secondo: il tentativo dopo del lettore
// arriverebbe con la domanda di prima ancora aperta, e due clic intrecciati non ne fanno nessuno.
const inCorso = new WeakSet();

/**
 * Il lettore incorporato chiede il clic nel suo punto. Con la scheda davanti ogni frame sopra di lui, dal più vicino
 * alla pagina della scheda, ritrova il riquadro figlio e vede che sopra non c'è altro e che nessuno ci sta scrivendo.
 * Una pagina nascosta nessuno la guarda né ci scrive: lì il clic va al lettore senza domande.
 */
async function clicDalRiquadro(sender, msg, dove, { chiedi = chiediAlFrame, ora = Date.now() } = {}) {
  const wc = sender.wc;
  if (inCorso.has(wc) || ora - (ultimoClic.get(wc) || 0) < INTERVALLO_MS) return { ok: false, code: 'presto' };
  const anelli = catena(sender);
  if (!anelli) return { ok: false, code: 'forbidden', error: 'forbidden' };
  if (!msg || !numero(msg.x) || !numero(msg.y) || msg.x < 0 || msg.y < 0) return { ok: false, code: 'punto' };
  if (typeof msg.tag !== 'string' || !msg.tag || msg.tag.length > 64) return { ok: false, code: 'punto' };
  inCorso.add(wc);
  try {
    let radice = null;
    if (dove && dove.davanti) {
      let p = { x: msg.x, y: msg.y, tag: msg.tag };
      let nascosta = false;
      for (const a of anelli) {
        const r = await chiedi(wc, a.frame, { tag: p.tag, origine: a.origineFiglio, x: p.x, y: p.y });
        if (!r) return { ok: false, code: 'tempo' };
        if (r.no === 'nascosta') { nascosta = true; break; }
        if (r.no) return { ok: false, code: r.no };
        p = r;
      }
      if (!nascosta) radice = { x: p.x, y: p.y };
    }
    return await clicNelRiquadro(wc, { x: msg.x, y: msg.y, url: urlDelFrame(sender), radice }, { ...dove, ora });
  } finally {
    inCorso.delete(wc);
  }
}

module.exports = {
  SALTA_YOUTUBE, attivo, configureFromSettings, hostConClicVero, hostIncorporato, modoClicVero, mittenteConClicVero, catena,
  rispostaDalFrame, clicDalRiquadro, puntoNellaVista, clicVero, clicNelRiquadro, INTERVALLO_MS, TETTO_CLIC_MS,
};
