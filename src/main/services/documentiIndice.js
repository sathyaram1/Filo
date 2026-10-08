// L'indice locale dei documenti dell'utente (nome, data, testo delle cartelle scelte), aggiornato in sottofondo: al
// modello vanno solo i pochi candidati di una ricerca (CERCA_DOCUMENTI). Non scrive mai nei file dell'utente.
// Punteggio: documentiRicerca.js; regole del giro: patterns/leggere-in-blocco-i-file-dell-utente-il-cloud.md.

'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');

const Ricerca = require('./documentiRicerca');
const { tipoDi } = require('./documentiTesto');

// Le cartelle di serie, come le chiama l'impostazione (documenti.cartelle) e come le dice la pagina.
const DI_SERIE = {
  documenti: { nome: 'Documenti', electron: 'documents', env: 'FILO_DOCUMENTI_DIR' },
  download: { nome: 'Download', electron: 'downloads', env: 'FILO_DOWNLOAD_DIR' },
  scrivania: { nome: 'Scrivania', electron: 'desktop', env: 'FILO_SCRIVANIA_DIR' },
};
const SINONIMI_CARTELLE = {
  documenti: 'documenti', documents: 'documenti', 'i documenti': 'documenti', 'la cartella documenti': 'documenti',
  download: 'download', downloads: 'download', scaricati: 'download', scaricamenti: 'download',
  scrivania: 'scrivania', desktop: 'scrivania',
};

// Le cartelle che non sono documenti di una persona: programmi, cestino, dipendenze di un progetto.
const SALTA = new Set(['node_modules', '__pycache__', '$recycle.bin', 'system volume information', 'appdata',
  'program files', 'program files (x86)', 'programdata', 'windows', 'bower_components', 'site-packages']);
const PROFONDITA_MAX = 24;
// Un tetto che una persona non tocca (centomila documenti), e se lo tocca la ricerca lo dice.
const FILE_MAX = 100_000;
const AVVIO_MS = 20_000;
const OGNI_MS = 30 * 60_000;

const deps = {
  impostazioni: async () => (globalThis.SN_STORAGE ? globalThis.SN_STORAGE.getSettings() : {}),
  cartellaDati: () => process.env.FILO_USER_DATA || require('electron').app.getPath('userData'),
  estrai: (p) => require('./documentiLettore').estrai(p),
};
function configura(d) { Object.assign(deps, d || {}); }

const nelleProve = () => process.env.NODE_ENV === 'test' || !!process.env.FILO_USER_DATA;

function cartellaDiSerie(chiave) {
  const d = DI_SERIE[chiave];
  if (!d) return '';
  if (process.env[d.env]) return path.resolve(process.env[d.env]);
  // Nelle prove le cartelle vere di chi le lancia restano fuori: una prova sceglie le sue.
  if (nelleProve()) return '';
  try { return require('electron').app.getPath(d.electron); } catch (_) { return ''; }
}

/** La voce dell'impostazione com'è scritta → chiave di serie o percorso assoluto; '' se non è una cartella. PURA. */
function voceCartella(v) {
  let s = String(v == null ? '' : v).trim().replace(/^["'«]+|["'»]+$/g, '').trim();
  if (!s) return '';
  const chiave = SINONIMI_CARTELLE[s.toLowerCase()];
  if (chiave) return chiave;
  if (s === '~') return os.homedir();
  if (/^~[\\/]/.test(s)) s = path.join(os.homedir(), s.slice(2));
  return path.isAbsolute(s) ? path.resolve(s) : '';
}

function nomeDellaVoce(voce) {
  if (DI_SERIE[voce]) return DI_SERIE[voce].nome;
  return path.basename(voce) || voce;
}

function dentro(figlio, padre) {
  const r = path.relative(padre, figlio);
  return r === '' || (!!r && !r.startsWith('..') && !path.isAbsolute(r));
}

/** Le cartelle da leggere adesso: [{ voce, percorso, nome, esiste }]. */
async function radici(impostazioni) {
  const s = impostazioni || await deps.impostazioni();
  const elenco = s && s.documenti && Array.isArray(s.documenti.cartelle) ? s.documenti.cartelle : Object.keys(DI_SERIE);
  const out = [];
  for (const v of elenco) {
    const voce = voceCartella(v);
    if (!voce) continue;
    const percorso = DI_SERIE[voce] ? cartellaDiSerie(voce) : voce;
    let esiste = false;
    if (percorso) { try { esiste = (await fsp.stat(percorso)).isDirectory(); } catch (_) { esiste = false; } }
    if (out.some((r) => r.voce === voce)) continue;
    out.push({ voce, percorso, nome: nomeDellaVoce(voce), esiste });
  }
  return out;
}

// Le cartelle da percorrere: quelle che esistono, senza quelle già dentro un'altra (si leggerebbero due volte).
function daPercorrere(rs) {
  const vive = rs.filter((r) => r.esiste && r.percorso).map((r) => r.percorso);
  return vive.filter((p, i) => !vive.some((q, j) => j !== i && dentro(p, q) && !(p === q && j > i)));
}

// ── L'indice in memoria e su disco ──────────────────────────────────────────

let voci = null;          // percorso → { n, m, s, k, t, pg, vuoto, e, tp?, np?, pp? }
let caricamento = null;
let ultimoGiro = 0;
let troppi = false;
let corsa = null;         // { promessa, stato: { fatti, totali, nome }, ascolta: Set }
let daRifare = false;

// Su disco una riga per documento letto, accodata appena letto: il primo giro su migliaia di file non riscrive
// tutto a ogni passo, e dopo un arresto quello che era già letto c'è. Una riga { p, via } toglie un documento; il
// file si ricompatta a fine giro quando le righe superate sono più di quelle vive.
const fileIndice = () => path.join(deps.cartellaDati(), 'documenti', 'indice.jsonl');
let righeSuDisco = 0;

async function carica() {
  if (voci) return voci;
  if (!caricamento) {
    caricamento = (async () => {
      const m = new Map();
      let righe = 0;
      try {
        const testo = await fsp.readFile(fileIndice(), 'utf8');
        for (const riga of testo.split('\n')) {
          if (!riga.trim()) continue;
          let v = null;
          try { v = JSON.parse(riga); } catch (_) { continue; }
          righe += 1;
          if (!v || typeof v.p !== 'string') continue;
          if (v.via) m.delete(v.p); else m.set(v.p, v);
        }
      } catch (_) { /* nessun indice ancora: si fa */ }
      voci = m;
      righeSuDisco = righe;
      return m;
    })();
  }
  return caricamento;
}

let scrittura = Promise.resolve();
function inFila(lavoro) {
  scrittura = scrittura.then(lavoro).catch(() => {});
  return scrittura;
}

function rigaDi(p, v) {
  const { tp, np, pp, ...resto } = v;
  return JSON.stringify({ ...resto, p });
}

function accoda(righe) {
  if (!righe.length) return scrittura;
  righeSuDisco += righe.length;
  const testo = `${righe.join('\n')}\n`;
  return inFila(async () => {
    const f = fileIndice();
    await fsp.mkdir(path.dirname(f), { recursive: true });
    await fsp.appendFile(f, testo, 'utf8');
  });
}

function compatta() {
  if (righeSuDisco <= Math.max(voci.size * 2, 200)) return scrittura;
  const righe = [];
  for (const [p, v] of voci) righe.push(rigaDi(p, v));
  righeSuDisco = righe.length;
  return inFila(async () => {
    const f = fileIndice();
    await fsp.mkdir(path.dirname(f), { recursive: true });
    const tmp = `${f}.${process.pid}.tmp`;
    await fsp.writeFile(tmp, righe.length ? `${righe.join('\n')}\n` : '', 'utf8');
    await fsp.rename(tmp, f);
  });
}

async function elimina() {
  voci = new Map();
  caricamento = Promise.resolve(voci);
  righeSuDisco = 0;
  await inFila(() => fsp.rm(fileIndice(), { force: true }));
}

// ── Il giro: elencare le cartelle, leggere i file nuovi o cambiati ─────────

// Un file di OneDrive o di iCloud che sta solo nel cloud ha la sua misura ma nessun blocco sul disco: leggerlo vorrebbe
// dire scaricarlo, e su una cartella sincronizzata l'indice scaricherebbe tutto. Si trova per nome. Sotto i 4 KB un file
// può stare dentro l'indice del disco senza blocchi suoi (NTFS), e scaricarlo non costa niente.
function soloNelCloud(st) {
  return !!st && st.size > 4096 && st.blocks === 0;
}

// Una cartella dell'elenco che il sistema non lascia leggere (su Mac il «Non consentire» alla prima ricerca) non è una
// cartella vuota: va detto, col modo di dare il permesso, o la ricerca risponde «non c'è» per sempre.
const NEGATO = new Set(['EPERM', 'EACCES']);

async function elenca(cartelle) {
  const trovati = new Map();
  const negate = [];
  let contati = 0;
  let pieno = false;
  async function giro(dir, prof) {
    if (pieno || prof > PROFONDITA_MAX) return;
    let elenco;
    try { elenco = await fsp.readdir(dir, { withFileTypes: true }); } catch (e) {
      if (prof === 0 && e && NEGATO.has(e.code)) negate.push(dir);
      return;
    }
    for (const v of elenco) {
      if (pieno) return;
      // I file nascosti e quelli di blocco di Office (~$documento.docx) non sono documenti.
      if (v.name.startsWith('.') || v.name.startsWith('~$')) continue;
      const p = path.join(dir, v.name);
      let tipo = v;
      // Su Windows l'elenco dà per collegamento ogni segnaposto di OneDrive, file e cartelle, anche già scaricati:
      // lstat dice se è un collegamento vero (quelli restano fuori).
      if (v.isSymbolicLink()) {
        try { tipo = await fsp.lstat(p); } catch (_) { continue; }
        if (tipo.isSymbolicLink()) continue;
      }
      if (tipo.isDirectory()) {
        if (!SALTA.has(v.name.toLowerCase())) await giro(p, prof + 1);
        continue;
      }
      if (!tipo.isFile() || !tipoDi(p)) continue;
      if (++contati > FILE_MAX) { pieno = true; return; }
      try {
        const st = await fsp.stat(p);
        trovati.set(p, { m: Math.round(st.mtimeMs), s: st.size, nuvola: soloNelCloud(st) });
      } catch (_) {}
    }
  }
  for (const c of cartelle) await giro(c, 0);
  return { trovati, pieno, negate };
}

/** Dove si dà a Filo il permesso di leggere una cartella, su questo sistema. */
function comeDarePermesso(piattaforma = process.platform) {
  if (piattaforma === 'darwin') return 'Impostazioni di Sistema › Privacy e sicurezza › File e cartelle › Filo: attiva la cartella';
  if (piattaforma === 'win32') return 'tasto destro sulla cartella › Proprietà › Sicurezza: dai al tuo utente il permesso di lettura';
  return 'i permessi della cartella (o, se Filo è installato come Flatpak o Snap, l\'accesso ai file nelle sue impostazioni)';
}

function avvisa(stato) {
  if (!corsa) return;
  corsa.stato = stato;
  for (const f of corsa.ascolta) { try { f(stato); } catch (_) {} }
}

async function eseguiGiro(extra) {
  await carica();
  const rs = await radici();
  const cartelle = daPercorrere(rs).concat((extra || []).filter((c) => !daPercorrere(rs).some((r) => dentro(c, r))));
  avvisa({ fase: 'elenco', fatti: 0, totali: 0, nome: '' });
  const { trovati, pieno, negate: rifiutate } = await elenca(cartelle);
  troppi = pieno;
  negate = new Set(rifiutate.map((c) => path.resolve(c)));
  // Via quello che non c'è più, o che sta in una cartella tolta dall'elenco.
  const tolti = [];
  for (const p of Array.from(voci.keys())) {
    if (!trovati.has(p) && !(pieno && cartelle.some((c) => dentro(p, c)) && fs.existsSync(p))) {
      voci.delete(p);
      tolti.push(JSON.stringify({ p, via: true }));
    }
  }
  accoda(tolti);
  const daLeggere = [];
  for (const [p, st] of trovati) {
    const v = voci.get(p);
    // Un file che era solo nel cloud e adesso è scaricato si rilegge anche se data e misura sono le stesse.
    if (!v || v.m !== st.m || v.s !== st.s || (v.e === 'nuvola' && !st.nuvola)) daLeggere.push([p, st]);
  }
  // Prima i più recenti: è più probabile che si cerchi la bolletta arrivata ieri che quella del 2019.
  daLeggere.sort((a, b) => b[1].m - a[1].m);
  let letti = 0;
  for (const [p, st] of daLeggere) {
    avvisa({ fase: 'lettura', fatti: letti, totali: daLeggere.length, nome: path.basename(p) });
    const r = st.nuvola ? { testo: '', pagine: 0, vuoto: false, errore: 'nuvola' } : await deps.estrai(p);
    const v = {
      n: path.basename(p), m: st.m, s: st.s, k: tipoDi(p), t: r.testo || '', pg: r.pagine || 0,
      vuoto: !!r.vuoto, e: r.errore || '',
    };
    voci.set(p, v);
    accoda([rigaDi(p, v)]);
    letti += 1;
  }
  avvisa({ fase: 'fine', fatti: letti, totali: daLeggere.length, nome: '' });
  // Nessuna cartella da leggere: sul disco non resta niente dei documenti di prima.
  if (!voci.size) await elimina();
  else await compatta();
  if (!extra || !extra.length) ultimoGiro = Date.now();
}

/** Un giro sull'indice; se ce n'è già uno, ci si accoda a quello. `extra`: cartelle in più solo per questo giro. */
function aggiorna({ extra = [] } = {}) {
  if (corsa) {
    if (!extra.length) return corsa.promessa;
    return corsa.promessa.then(() => aggiorna({ extra }));
  }
  const c = { stato: null, ascolta: new Set(), promessa: null };
  corsa = c;
  c.promessa = eseguiGiro(extra).catch(() => {}).finally(() => {
    if (corsa === c) corsa = null;
    if (daRifare) { daRifare = false; aggiorna().catch(() => {}); }
  });
  return c.promessa;
}

function ascoltaGiro(f) {
  if (!corsa || typeof f !== 'function') return () => {};
  corsa.ascolta.add(f);
  if (corsa.stato) { try { f(corsa.stato); } catch (_) {} }
  const c = corsa;
  return () => c.ascolta.delete(f);
}

// ── La ricerca ─────────────────────────────────────────────────────────────

function aspettaStop(segnale) {
  if (!segnale) return new Promise(() => {});
  if (segnale.aborted) return Promise.resolve();
  return new Promise((ok) => segnale.addEventListener('abort', () => ok(), { once: true }));
}

function riassuntoIndice(rs, sotto) {
  let documenti = 0; let conTesto = 0; let scansioni = 0; let senzaTesto = 0;
  for (const [p, v] of voci || new Map()) {
    if (!sotto.some((c) => dentro(p, c))) continue;
    documenti += 1;
    if (v.t) conTesto += 1;
    else if (v.vuoto) scansioni += 1;
    else senzaTesto += 1;
  }
  return {
    documenti, conTesto, scansioni, senzaTesto, troppi,
    cartelle: rs.map((r) => ({ voce: r.voce, nome: r.nome, percorso: r.percorso, esiste: r.esiste })),
  };
}

/**
 * Cerca fra i documenti. `cartella`: solo dentro quella (anche fuori dall'elenco, letta per l'occasione).
 * → { risultati: [...], indice: {...}, fermata, cartellaMancante }
 */
async function cerca(richiesta, { limite = 8, cartella = '', avanzamento = null, segnale = null } = {}) {
  await carica();
  const rs = await radici();
  let sotto = daPercorrere(rs);
  let extra = [];
  let cartellaMancante = '';
  if (cartella) {
    const c = voceCartella(cartella);
    const p = c && DI_SERIE[c] ? cartellaDiSerie(c) : c;
    let esiste = false;
    if (p) { try { esiste = (await fsp.stat(p)).isDirectory(); } catch (_) { esiste = false; } }
    if (!esiste) cartellaMancante = String(cartella);
    else {
      sotto = [p];
      if (!daPercorrere(rs).some((r) => dentro(p, r))) extra = [p];
    }
  }
  let fermata = false;
  if (!cartellaMancante) {
    // Ogni ricerca riguarda le cartelle: un file messo lì da un altro programma un attimo prima si trova. Elencare
    // costa poco, si rileggono solo i file nuovi o cambiati.
    const lavoro = extra.length ? aggiorna({ extra }) : aggiorna();
    const smetti = ascoltaGiro(avanzamento);
    fermata = await Promise.race([lavoro.then(() => false), aspettaStop(segnale).then(() => true)]);
    smetti();
  }
  const candidati = [];
  for (const [p, v] of voci) {
    if (!sotto.some((c) => dentro(p, c))) continue;
    if (v.tp == null) v.tp = Ricerca.piano(v.t);
    if (v.np == null) v.np = Ricerca.piano(v.n.replace(/\.[^.]+$/, ''));
    if (v.pp == null) v.pp = Ricerca.periodi(v.t);
    candidati.push({ id: p, nome: v.n, testo: v.t, data: v.m, testoPiano: v.tp, nomePiano: v.np, periodi: v.pp });
  }
  const ordinati = Ricerca.ordina(candidati, richiesta, { limite: limite + 4 });
  const risultati = [];
  for (const o of ordinati) {
    if (risultati.length >= limite) break;
    // Cancellato dopo l'ultimo giro: non si propone un file che non c'è.
    if (!fs.existsSync(o.id)) continue;
    const v = voci.get(o.id);
    const testo = String(v.t || '');
    const sq = Ricerca.squarcioMigliore(testo, richiesta);
    const inizio = testo ? Ricerca.squarcio(testo, '', 140) : '';
    risultati.push({
      percorso: o.id,
      nome: v.n,
      cartella: path.dirname(o.id),
      data: v.m,
      tipo: v.k,
      pagine: v.pg || 0,
      scansione: !!v.vuoto,
      senzaTesto: !v.t && !v.vuoto ? (v.e || 'tipo') : '',
      inizio: sq.startsWith(inizio.replace(/…$/, '')) ? '' : inizio,
      squarcio: sq,
      trovati: o.trovati,
      punteggio: Math.round(o.punteggio * 100) / 100,
    });
  }
  return { risultati, indice: riassuntoIndice(rs, sotto), fermata, cartellaMancante };
}

/** Le voci dell'elenco che non sono una cartella di questo computer (per dirlo prima di salvarle). */
async function cartelleMancanti(elenco) {
  const out = [];
  for (const v of Array.isArray(elenco) ? elenco : []) {
    const voce = voceCartella(v);
    if (voce && DI_SERIE[voce]) continue;
    let ok = false;
    if (voce) { try { ok = (await fsp.stat(voce)).isDirectory(); } catch (_) { ok = false; } }
    if (!ok) out.push(String(v));
  }
  return out;
}

async function stato() {
  await carica();
  const rs = await radici();
  return {
    ...riassuntoIndice(rs, daPercorrere(rs)),
    aggiornato: ultimoGiro || null,
    inCorso: corsa && corsa.stato && corsa.stato.fase === 'lettura' ? { fatti: corsa.stato.fatti, totali: corsa.stato.totali } : null,
  };
}

// Su macOS leggere Documenti, Scrivania e Download fa comparire la richiesta di permesso del sistema: la prima lettura
// la fa la prima ricerca chiesta dall'utente, così la richiesta arriva quando ha un senso. Da lì in poi, in sottofondo.
function giroInSottofondo() {
  if (process.platform === 'darwin' && !fs.existsSync(fileIndice())) return;
  aggiorna().catch(() => {});
}

let avviato = false;
function avviaInSottofondo() {
  if (avviato) return;
  avviato = true;
  const t = setTimeout(giroInSottofondo, AVVIO_MS);
  if (t.unref) t.unref();
  const i = setInterval(giroInSottofondo, OGNI_MS);
  if (i.unref) i.unref();
  const cartelleDi = (s) => JSON.stringify((s && s.documenti && s.documenti.cartelle) || null);
  let prima = null;
  deps.impostazioni().then((s) => { prima = cartelleDi(s); }).catch(() => {});
  try {
    globalThis.chrome.storage.onChanged.addListener((changes) => {
      if (!changes || !changes.settings) return;
      deps.impostazioni().then((s) => {
        const dopo = cartelleDi(s);
        if (dopo === prima) return;
        prima = dopo;
        // Una cartella tolta esce dall'indice al giro dopo, e una aggiunta si legge: lo si fa partire subito.
        if (corsa) daRifare = true; else giroInSottofondo();
      }).catch(() => {});
    });
  } catch (_) {}
}

module.exports = {
  configura, radici, aggiorna, cerca, stato, avviaInSottofondo, ascoltaGiro, voceCartella, nomeDellaVoce, cartelleMancanti,
  cartellaDiSerie, elimina, DI_SERIE,
  // per gli unit test
  _giroInSottofondo: giroInSottofondo,
  _azzera: () => { voci = null; caricamento = null; ultimoGiro = 0; corsa = null; daRifare = false; troppi = false; righeSuDisco = 0; },
};
