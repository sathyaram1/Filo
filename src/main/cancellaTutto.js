// «Cancella tutti i dati di Filo» (#850): la richiesta lascia un segno nella cartella dei dati e riavvia; l'avvio dopo,
// prima di aprire qualsiasi file, svuota la cartella. Resta solo ciò che non dice niente di chi usa Filo (RESTA) e,
// se non si sceglie altro, l'identità dei crediti (IDENTITA). Regole: tests/unit/cancellaTutto.test.mjs.

const fs = require('node:fs');
const path = require('node:path');
const Disco = require('./services/scritturaAtomica');

const SEGNO = 'cancella-tutto.json';
const PAROLA = 'conferma';

// Si tiene per nome esatto, col perché: tutto il resto della cartella se ne va, anche ciò che nascerà dopo.
const RESTA = Object.freeze({
  'Local State': 'su Windows la chiave con cui il sistema cifra i file di Filo: senza, l\'identità dei crediti tenuta non si rilegge più',
  SingletonLock: 'il segno di Chromium che tiene aperta una copia sola di Filo, non un dato',
  SingletonCookie: 'il segno di Chromium che tiene aperta una copia sola di Filo, non un dato',
  SingletonSocket: 'il segno di Chromium che tiene aperta una copia sola di Filo, non un dato',
  lockfile: 'il segno di Chromium che tiene aperta una copia sola di Filo (Windows), non un dato',
  'preload-pacchetto': 'il codice di Filo per le pagine web, ricomposto a ogni avvio: niente di chi usa l\'app',
  Dictionaries: 'i dizionari delle lingue del correttore, uguali per tutti (le parole tue stanno altrove e se ne vanno)',
  adblock: 'le liste pubbliche contro la pubblicità, uguali per tutti',
  'firmatari-c2pa': 'l\'elenco pubblico dei firmatari delle credenziali sulle immagini, uguale per tutti',
  'aggiornamento-pronto.json': 'la versione nuova di Filo già scaricata che aspetta di installarsi: niente di chi usa l\'app',
  [SEGNO]: 'la richiesta stessa: se ne va per ultima, quando il resto è cancellato',
});

// L'identità dei crediti e ciò che la regge: l'account anonimo, la chiave e l'ultimo stato letto, con le copie messe da
// parte (identity.bin.<etichetta>…). Senza, i crediti sul server non si raggiungono più.
const IDENTITA = Object.freeze(['identity.bin', 'wallet.bin', 'wallet-stato.bin']);
// Le righe del registro d'uso non ancora scritte sul server, e il conto di quelle perse, appartengono ai crediti: se
// l'identità resta, restano.
const CHIAVI_IDENTITA = Object.freeze(['walletUsageQueue', 'walletUsageLog']);
const TENTATIVI_MASSIMI = 3;

const dellIdentita = (nome) => IDENTITA.some((f) => nome === f || nome.startsWith(`${f}.`));

function daTenere(nome, { ancheIdentita }) {
  if (Object.prototype.hasOwnProperty.call(RESTA, nome)) return true;
  return !ancheIdentita && dellIdentita(nome);
}

function leggiSegno(dir) {
  let testo;
  try { testo = fs.readFileSync(path.join(dir, SEGNO), 'utf8'); } catch (_) { return null; }
  try {
    const j = JSON.parse(testo);
    return j && typeof j === 'object' ? j : {};
  } catch (_) { return {}; }
}

function scriviSegno(dir, segno) {
  Disco.scriviSync(path.join(dir, SEGNO), JSON.stringify(segno));
}

// Ciò che dell'identità vive dentro storage.json, letto prima di cancellarlo.
function chiaviDaPortare(dir) {
  try {
    const dati = JSON.parse(Disco.togliBom(fs.readFileSync(path.join(dir, 'storage.json'), 'utf8')));
    const fuori = {};
    for (const k of CHIAVI_IDENTITA) {
      if (Array.isArray(dati && dati[k]) ? dati[k].length : dati && dati[k] != null) fuori[k] = dati[k];
    }
    return Object.keys(fuori).length ? fuori : null;
  } catch (_) { return null; }
}

// Svuota la cartella dei dati secondo il segno. `soli` (un giro rimasto a metà) limita il giro a quei nomi, così quello
// che l'utente ha fatto nel frattempo non se ne va. Torna i nomi che non si sono lasciati cancellare.
function svuota(dir, segno) {
  const ancheIdentita = segno.ancheIdentita === true;
  const soli = Array.isArray(segno.soli) ? new Set(segno.soli.map(String)) : null;
  const portate = !ancheIdentita && !soli ? chiaviDaPortare(dir) : null;
  let nomi = [];
  try { nomi = fs.readdirSync(dir); } catch (_) { return []; }
  const rimasti = [];
  for (const nome of nomi) {
    if (daTenere(nome, { ancheIdentita })) continue;
    if (soli && !soli.has(nome)) continue;
    try {
      fs.rmSync(path.join(dir, nome), { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch (e) {
      console.warn('[Filo] cancella tutto: non cancellato', nome, e?.code || e?.message || e);
      rimasti.push(nome);
    }
  }
  if (portate && !rimasti.includes('storage.json')) {
    try { Disco.scriviSync(path.join(dir, 'storage.json'), JSON.stringify(portate)); } catch (_) {}
  }
  return rimasti;
}

// L'esito dell'ultimo avvio, per l'avviso nella finestra: storage.json è appena nato, non lo può tenere lui.
let esito = null;

// Da chiamare prima di qualsiasi lettura della cartella dei dati: dopo, Chromium e i moduli di Filo ci tengono file aperti.
function allAvvio(app) {
  let dir;
  try { dir = app.getPath('userData'); } catch (_) { return null; }
  const segno = leggiSegno(dir);
  if (!segno) return null;
  // Una seconda copia aperta mentre la prima esce svuoterebbe la cartella sotto i suoi piedi: svuota chi tiene il lucchetto.
  try { if (!app.requestSingleInstanceLock()) return null; } catch (_) {}
  const rimasti = svuota(dir, segno);
  const tentativi = (Number(segno.tentativi) || 0) + 1;
  if (rimasti.length && tentativi < TENTATIVI_MASSIMI) {
    try { scriviSegno(dir, { ancheIdentita: segno.ancheIdentita === true, soli: rimasti, tentativi }); } catch (_) {}
  } else {
    try { fs.rmSync(path.join(dir, SEGNO), { force: true }); } catch (_) {}
  }
  esito = { rimasti, riprova: rimasti.length > 0 && tentativi < TENTATIVI_MASSIMI, ancheIdentita: segno.ancheIdentita === true, cartella: dir };
  return esito;
}

function fraseEsito(e) {
  if (!e) return '';
  if (!e.rimasti.length) return 'Ho cancellato tutti i dati di Filo da questo computer. Si riparte da zero.';
  const uno = e.rimasti.length === 1;
  const quali = e.rimasti.map((n) => `«${n}»`).join(', ');
  const inizio = uno
    ? `Ho cancellato i dati di Filo, tranne ${quali} nella cartella dei dati, che non si è lasciato cancellare.`
    : `Ho cancellato i dati di Filo, tranne questi file nella cartella dei dati, che non si sono lasciati cancellare: ${quali}.`;
  if (e.riprova) return `${inizio} Riprovo al prossimo avvio.`;
  return `${inizio} ${uno ? 'Cancellalo' : 'Cancellali'} a mano${e.cartella ? ` da ${e.cartella}` : ''}.`;
}

function annuncia() {
  const frase = fraseEsito(esito);
  if (!frase) return;
  try { require('./services/avvisoFinestra').avvisoQuandoPronta(frase, { chiave: 'cancella-tutto' }); } catch (_) {}
}

// Le dipendenze che le prove sostituiscono: in test il riavvio aprirebbe un Filo che nessuno chiude.
const dip = {
  cartella: () => require('electron').app.getPath('userData'),
  riapri: () => {
    if (process.env.NODE_ENV === 'test') return;
    const { app } = require('electron');
    // Un AppImage si riapre da sé: l'eseguibile dentro il suo montaggio sparisce con l'uscita.
    if (process.env.APPIMAGE) app.relaunch({ execPath: process.env.APPIMAGE, args: process.argv.slice(1) });
    else app.relaunch();
  },
  esci: () => require('electron').app.quit(),
  sessioni: () => {
    const { session, BrowserWindow } = require('electron');
    const tutte = new Set([session.defaultSession]);
    for (const w of BrowserWindow.getAllWindows()) {
      try { for (const v of w.contentView?.children || []) if (v.webContents?.session) tutte.add(v.webContents.session); } catch (_) {}
      try { if (w.webContents?.session) tutte.add(w.webContents.session); } catch (_) {}
    }
    return [...tutte];
  },
};

let richiesta = null;

// Il cancello sta qui, nell'unica funzione che produce l'effetto: senza la parola scritta non parte niente.
async function chiedi({ parola, ancheIdentita = false } = {}) {
  if (String(parola ?? '').trim().toLowerCase() !== PAROLA) return { ok: false, error: 'parola' };
  if (richiesta) return { ok: true, giaChiesto: true };
  richiesta = { ancheIdentita: ancheIdentita === true, at: new Date().toISOString() };
  try {
    scriviSegno(dip.cartella(), richiesta);
  } catch (e) {
    richiesta = null;
    console.error('[Filo] cancella tutto: richiesta non scritta', e?.message || e);
    return { ok: false, error: 'disco' };
  }
  // Cookie e dati dei siti escono già adesso: una pagina rimasta aperta fino all'uscita non li tiene in vita.
  const tetto = new Promise((r) => { const t = setTimeout(r, 2000); t.unref?.(); });
  const pulizie = dip.sessioni().map((s) => Promise.all([
    s.clearStorageData().catch(() => {}),
    s.clearCache().catch(() => {}),
    s.clearAuthCache?.().catch?.(() => {}),
  ]));
  await Promise.race([Promise.all(pulizie), tetto]);
  // La risposta arriva alla pagina prima che la finestra se ne vada.
  setTimeout(() => { try { dip.riapri(); } catch (_) {} try { dip.esci(); } catch (_) {} }, 400).unref?.();
  return { ok: true };
}

function stato() {
  let dir = '';
  try { dir = dip.cartella(); } catch (_) { return { identita: false }; }
  let nomi = [];
  try { nomi = fs.readdirSync(dir); } catch (_) {}
  return { identita: nomi.some(dellIdentita), inCorso: !!richiesta };
}

module.exports = {
  SEGNO, PAROLA, RESTA, IDENTITA, CHIAVI_IDENTITA,
  allAvvio, annuncia, chiedi, stato, svuota, fraseEsito, dip,
};
