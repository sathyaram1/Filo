// A chi va la foto di una pagina (#589.5) e, per un modello, l'unico punto che la scatta: coperta prima del JPEG (#1721).
// Mai a una scheda di sfondo, a un riquadro o a un popup; una foto che non si riesce a coprire non parte.
// Prove: tests/foto-al-modello-coperture.spec.mjs, tests/aiuto-foto-leggera.spec.mjs, tests/unit/fotoDellaPagina.test.mjs.
'use strict';

const { mittenteInVista } = require('./appuntiDaiSiti');
const { riquadroArrivato } = require('./riquadroArrivato');
const { campiSegretiFuoriPagina, misuraRiquadro, interseca } = require('./campiNeiRiquadri');

function framePrincipale(sender) {
  const f = sender && sender.frame;
  try { return Boolean(f) && !f.detached && !f.parent; } catch (_) { return false; }
}

/** Il webContents da fotografare per chi chiede, o null. La barra fotografa la scheda in primo piano della sua finestra. */
function paginaDaFotografare(sender) {
  if (sender && sender.isShell) {
    const tm = sender.win && sender.win._filoTabs;
    const tab = tm && tm.tabs.find((t) => t.id === tm.activeId);
    return tab ? tab.view.webContents : null;
  }
  if (!sender || !sender.wc || !framePrincipale(sender) || !mittenteInVista(sender)) return null;
  return sender.wc;
}

/** La finestra di cui fotografare la barra in alto, o null: la chiede la barra stessa o la scheda in vista sotto di lei. */
function barraDaFotografare(sender) {
  const win = sender && sender.win;
  if (!win || !win._filoTabs) return null;
  if (sender.isShell) return win;
  return paginaDaFotografare(sender) ? win : null;
}

// Coi modelli che pagano per risoluzione i pixel fisici costano token, e i MB di una PNG secondi d'invio a ogni passo (#1142).
const QUALITA_LEGGERA = 85;

/** Il fattore di scala dello schermo su cui sta la finestra di chi chiede; 1 se non si sa. */
function fattoreDiScala(sender, screen) {
  try {
    const win = sender && sender.win;
    const schermo = win && !win.isDestroyed() ? screen.getDisplayMatching(win.getBounds()) : screen.getPrimaryDisplay();
    const f = Number(schermo && schermo.scaleFactor);
    return Number.isFinite(f) && f > 0 ? f : 1;
  } catch (_) { return 1; }
}

/** La foto riportata ai pixel che l'utente vede (fisici diviso fattore di scala), in JPEG. Null se la foto è vuota. */
function fotoLeggera(img, fattore, qualita = QUALITA_LEGGERA) {
  const { width, height } = img.getSize();
  if (!width || !height) return null;
  const f = Number.isFinite(fattore) && fattore > 1 ? fattore : 1;
  const vista = f > 1
    ? img.resize({ width: Math.max(1, Math.round(width / f)), height: Math.max(1, Math.round(height / f)), quality: 'best' })
    : img;
  return 'data:image/jpeg;base64,' + vista.toJPEG(qualita).toString('base64');
}

// ─── La foto per un modello ─────────────────────────────────────────────────────────────────────────────────────────
// Coperti: i campi segreti, il testo che ne ripete il valore (#810.16) e i riquadri di altre origini (#1537), che
// mostrano dati che la pagina ospite non può leggere e che la risposta del modello le riporterebbe.

// Il mondo dei content script: lì il riconoscimento ricorda le password che il sito ha reso visibili. Dove non c'è
// (pagine filo:// senza isolamento) la misura si crea da sé.
const MONDO_SCRIPT = 999;
const ATTESA_MISURA_MS = 3000;
const GRIGIO = [128, 128, 128];
// Oltre questa profondità un riquadro della stessa origine si copre intero invece di entrarci: misura e frame tree
// devono fermarsi allo stesso livello.
const PROFONDITA = 12;

// Quello che il modello si sente dire quando la foto non parte.
const PERCHE = {
  riquadri: 'un riquadro di un altro sito incorporato nella pagina non si è potuto coprire',
  segreti: 'un campo segreto (password o carta) non si è potuto coprire',
  misura: 'non si è potuto misurare cosa coprire',
};
function perche(codice) {
  return Object.prototype.hasOwnProperty.call(PERCHE, codice) ? PERCHE[codice] : '';
}

function codiceMisura() {
  const G = globalThis.SN_GUARDIANO_STATICO;
  const S = globalThis.SN_CAMPI_SEGRETI;
  return `(function () {
  const luhn = ${G.luhn}; const cartaValida = ${G.cartaValida};
  const crea = ${S.crea}; const rettangoliRipetuti = ${S.rettangoliRipetuti};
  const E = globalThis.SN_EXTRACT;
  const qui = E && E.segreti && typeof E.segreti.valoriSegreti === 'function' ? E.segreti : crea(window, cartaValida);
  // Le stesse misure della copertura dei campi nei riquadri: i due conti non devono divergere.
  const interseca = (a, b) => (a && b ? (${interseca})(a, b) : null);
  const sposta = (r, dx, dy) => ({ left: r.left + dx, top: r.top + dy, width: r.width, height: r.height });
  const contenuto = ${misuraRiquadro};
  const out = { vista: { w: innerWidth, h: innerHeight }, campi: [], ripetuti: [], riquadri: [], conFrame: 0 };
  const documenti = [];
  // clip: la parte della finestra in cui il documento si vede; null se non si vede, ma i suoi riquadri contano.
  const visita = (win, dx, dy, clip, prof) => {
    documenti.push({ win, dx, dy, clip });
    const radici = [win.document];
    for (let i = 0; i < radici.length; i++) {
      for (const el of radici[i].querySelectorAll('*')) {
        if (el.shadowRoot) radici.push(el.shadowRoot);
        if (!/^(IFRAME|FRAME|OBJECT|EMBED)$/.test(el.tagName)) continue;
        let dentro = null;
        try { dentro = el.tagName === 'EMBED' ? null : el.contentDocument; } catch (_) { dentro = null; }
        if (dentro && dentro.defaultView && prof < ${PROFONDITA}) {
          const c = contenuto(el);
          visita(dentro.defaultView, dx + c.left, dy + c.top, interseca(sposta(c, dx, dy), clip), prof + 1);
          continue;
        }
        if (el.tagName !== 'EMBED' && el.contentWindow) out.conFrame += 1;
        const v = interseca(sposta(el.getBoundingClientRect(), dx, dy), clip);
        if (v) out.riquadri.push(v);
      }
    }
  };
  visita(window, 0, 0, { left: 0, top: 0, width: innerWidth, height: innerHeight }, 0);
  out.campi = qui.campiInVista();
  const valori = [];
  for (const d of documenti) valori.push(...(d.win === window ? qui : crea(d.win, cartaValida)).valoriSegreti());
  if (valori.length) {
    for (const d of documenti) {
      if (!d.clip) continue;
      for (const r of rettangoliRipetuti(d.win, valori)) {
        const v = interseca(sposta(r, d.dx, d.dy), d.clip);
        if (v) out.ripetuti.push(v);
      }
    }
  }
  return out;
})()`;
}

/** Quanti riquadri di altre origini la pagina mostra da sé (appesi a frame della sua origine), dal frame tree. La misura
 *  deve averne trovati almeno tanti: uno sfuggito (in un componente chiuso) resterebbe scoperto. PURA. */
function frameDiAltreOrigini(principale) {
  const origine = (f) => { try { return String(f.origin || ''); } catch (_) { return ''; } };
  const o = origine(principale);
  // Due origini opache («null») non sono la stessa: la misura non entra in nessuna delle due.
  const stessa = (f) => !!o && o !== 'null' && origine(f) === o;
  let n = 0;
  const giu = (f, prof) => {
    let figli = [];
    try { figli = Array.from(f.frames || []); } catch (_) {}
    for (const c of figli) {
      // Un riquadro ancora in arrivo mostra il documento vuoto iniziale, e la misura lo vede come tale.
      if (!riquadroArrivato(c)) continue;
      if (stessa(c) && prof < PROFONDITA) giu(c, prof + 1);
      else n += 1;
    }
  };
  giu(principale, 0);
  return n;
}

/** Il motivo per cui una misura non basta a coprire la foto (chiave di PERCHE), o null. PURA. */
function rifiutoDellaMisura(m) {
  if (!m || !m.vista || !(m.vista.w > 0) || !(m.vista.h > 0)) return 'misura';
  if (!(Number(m.conFrame) >= Number(m.attesi))) return 'riquadri';
  return null;
}

function colore(css) {
  const s = String(css || '').trim();
  let m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(s);
  if (m) return [m[1], m[2], m[3]].map((x) => Math.max(0, Math.min(255, Math.round(Number(x)))));
  m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(s);
  if (!m) return null;
  const h = m[1].length === 3 ? m[1].replace(/./g, '$&$&') : m[1];
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
}

function rettangolo(r) {
  const n = [r && r.left, r && r.top, r && r.width, r && r.height].map(Number);
  return n.every(Number.isFinite) && n[2] > 0 && n[3] > 0 ? { left: n[0], top: n[1], width: n[2], height: n[3] } : null;
}

/** Le coperture da dipingere dalle misure (prima e dopo lo scatto: se qualcosa si è spostato si coprono le due
 *  posizioni) e dai campi che misura il main. I riquadri per ultimi: restano pieni anche sopra un campo. PURA. */
function coperture(misure, campiFuori = []) {
  const campi = [], ripetuti = [], riquadri = [];
  // Puntini neutri e non del colore del testo: della scritta nel campo non resta niente, nemmeno la tinta.
  const campo = (c) => {
    const r = rettangolo(c);
    if (!r) return;
    const fondo = colore(c.sfondo) || [255, 255, 255];
    const chiaro = 0.299 * fondo[0] + 0.587 * fondo[1] + 0.114 * fondo[2] > 128;
    campi.push({ ...r, colore: fondo, puntini: chiaro ? [60, 60, 60] : [200, 200, 200] });
  };
  for (const m of misure) {
    if (!m) continue;
    (m.campi || []).forEach(campo);
    for (const x of m.ripetuti || []) { const r = rettangolo(x); if (r) ripetuti.push({ ...r, colore: GRIGIO }); }
    for (const x of m.riquadri || []) { const r = rettangolo(x); if (r) riquadri.push({ ...r, colore: GRIGIO }); }
  }
  (campiFuori || []).forEach(campo);
  return [...campi, ...ripetuti, ...riquadri];
}

/** Dipinge `lista` sul bitmap BGRA di una cattura (`toBitmap()`), sul posto. `scala`: pixel della foto per pixel CSS.
 *  Copre ogni pixel toccato dal rettangolo, anche a metà. PURA. */
function dipingi(bitmap, larghezza, altezza, lista, scala) {
  const sx = Number(scala && scala.x) || 1, sy = Number(scala && scala.y) || 1;
  const W = larghezza, H = altezza;
  const entro = (v, max) => Math.max(0, Math.min(max, v));
  const pixel = (x, y, [r, g, b]) => {
    const i = (y * W + x) * 4;
    bitmap[i] = b; bitmap[i + 1] = g; bitmap[i + 2] = r; bitmap[i + 3] = 255;
  };
  for (const c of lista) {
    const x0 = entro(Math.floor(c.left * sx), W), x1 = entro(Math.ceil((c.left + c.width) * sx), W);
    const y0 = entro(Math.floor(c.top * sy), H), y1 = entro(Math.ceil((c.top + c.height) * sy), H);
    if (x1 <= x0 || y1 <= y0) continue;
    const tinta = c.colore || GRIGIO;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) pixel(x, y, tinta);
    if (!c.puntini) continue;
    // I puntini dicono al modello che il campo è compilato, senza dire cosa c'è.
    const margine = Math.round(3 * sx);
    const raggio = Math.max(1, Math.min((y1 - y0) * 0.18, (x1 - x0 - 2 * margine) / 24));
    const cy = (y0 + y1 - 1) / 2;
    for (let k = 0; k < 8; k++) {
      const cx = x0 + margine + raggio + k * raggio * 3;
      if (cx + raggio > x1 - margine) break;
      for (let y = Math.ceil(cy - raggio); y <= Math.floor(cy + raggio); y++) {
        for (let x = Math.ceil(cx - raggio); x <= Math.floor(cx + raggio); x++) {
          if ((x - cx) ** 2 + (y - cy) ** 2 <= raggio * raggio && x >= x0 && x < x1 && y >= y0 && y < y1) pixel(x, y, c.puntini);
        }
      }
    }
  }
  return bitmap;
}

function entroIl(promessa, ms) {
  let timer;
  const scadenza = new Promise((ok) => { timer = setTimeout(() => ok(null), ms); });
  return Promise.race([Promise.resolve(promessa).catch(() => null), scadenza]).finally(() => clearTimeout(timer));
}

async function misura(wc) {
  let m = null;
  try { m = await entroIl(wc.executeJavaScriptInIsolatedWorld(MONDO_SCRIPT, [{ code: codiceMisura() }]), ATTESA_MISURA_MS); } catch (_) { m = null; }
  if (!m || typeof m !== 'object') return null;
  let attesi = Infinity;
  try { attesi = frameDiAltreOrigini(wc.mainFrame); } catch (_) {}
  return { ...m, attesi };
}

/** La foto di `wc` per un modello: `{ ok: true, img, piena }` coperta, o `{ ok: false, code, piena? }` quando qualcosa
 *  non si può coprire (`code` fra le chiavi di PERCHE) o la foto è vuota (`vuota`). `piena` è per chi la tiene lui. */
async function fotoPerModello(wc) {
  if (!wc || (typeof wc.isDestroyed === 'function' && wc.isDestroyed())) return { ok: false, code: 'vuota' };
  const scatto = (async () => {
    const prima = await misura(wc);
    let img = null;
    try { img = await wc.capturePage(); } catch (_) { img = null; }
    return { prima, img, dopo: img ? await misura(wc) : null };
  })();
  const [{ prima, img, dopo }, fuori] = await Promise.all([
    scatto,
    campiSegretiFuoriPagina(wc).catch(() => ({ campi: [], nonCoperti: true })),
  ]);
  if (!img || img.isEmpty()) return { ok: false, code: 'vuota' };
  const { width, height } = img.getSize();
  const no = rifiutoDellaMisura(prima) || rifiutoDellaMisura(dopo) || (fuori.nonCoperti ? 'segreti' : null);
  if (no) return { ok: false, code: no, piena: img };
  const lista = coperture([prima, dopo], fuori.campi);
  if (!lista.length) return { ok: true, img, piena: img };
  const bitmap = img.toBitmap();
  if (bitmap.length !== width * height * 4) return { ok: false, code: 'misura', piena: img };
  dipingi(bitmap, width, height, lista, { x: width / prima.vista.w, y: height / prima.vista.h });
  const { nativeImage } = require('electron');
  return { ok: true, img: nativeImage.createFromBitmap(bitmap, { width, height }), piena: img };
}

/** La foto intera, per chi la tiene (Screenshot, feedback): mai verso un modello. */
function fotoPiena(wc) {
  return wc.capturePage();
}

/** La barra in alto di Filo alta `altezza`, per il box del feedback: è la shell, non una pagina, e va all'owner. */
function fotoDellaBarra(win, altezza) {
  const [w] = win.getContentSize();
  return win.webContents.capturePage({ x: 0, y: 0, width: w, height: altezza });
}

module.exports = {
  paginaDaFotografare, barraDaFotografare, fattoreDiScala, fotoLeggera, QUALITA_LEGGERA,
  fotoPerModello, fotoPiena, fotoDellaBarra, perche, frameDiAltreOrigini, rifiutoDellaMisura, coperture, dipingi, colore, codiceMisura,
  GRIGIO, PERCHE,
};
