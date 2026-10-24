// L'elenco ufficiale dei firmatari riconosciuti delle credenziali C2PA (#711): si scarica ogni tanto e resta in userData.
// Non lo sostituisce mai una lista scritta qui: finché non c'è, una firma valida resta «firmatario non verificato».
// Regole: patterns/unetichetta-di-origine-e-una-dichiarazione-non-una-prova.md

'use strict';

const fsp = require('node:fs/promises');
const path = require('node:path');
const { impronta } = require('./improntaPixel');

// Lo pubblica chi gestisce lo standard (programma di conformità del C2PA).
const FONTE = 'https://raw.githubusercontent.com/c2pa-org/conformance-public/main/trust-list/C2PA-TRUST-LIST.pem';
// Le autorità di marcatura temporale: dicono se una firma fatta con un certificato oggi scaduto valeva quando è stata fatta.
const FONTE_TSA = 'https://raw.githubusercontent.com/c2pa-org/conformance-public/main/trust-list/C2PA-TSA-TRUST-LIST.pem';
// L'elenco provvisorio, congelato, che legge il verificatore di riferimento: autorità e singoli firmatari ammessi (#946.1).
const FONTE_PROVVISORIO = 'https://raw.githubusercontent.com/contentauth/verify-site/main/static/trust/anchors.pem';
const FONTE_AMMESSI = 'https://raw.githubusercontent.com/contentauth/verify-site/main/static/trust/allowed.pem';
const RINFRESCO_MS = 24 * 60 * 60 * 1000;
const CONTROLLO_MS = 60 * 60 * 1000;
// Dopo un fallimento non si riprova subito: il canale del menu lo può toccare anche una pagina web.
const RIPROVA_MS = 10 * 60 * 1000;
// Un elenco provvisorio che manca si richiede, ma non ogni dieci minuti: senza, l'elenco ufficiale basta a rispondere.
const RIPROVA_PROVVISORIO_MS = 6 * 60 * 60 * 1000;
// Alla prima immagine firmata, se l'elenco sta arrivando, lo si aspetta un poco invece di dire «non verificato».
const ATTESA_PRIMA_VOLTA_MS = 3000;
// L'elenco pesa decine di KB: oltre il tetto si rifiuta col numero nei log e si tiene quello che c'era.
const MAX_BYTE = 8 * 1024 * 1024;
const TIMEOUT_MS = 30_000;

const VUOTO = { pem: '', scaricatoIl: 0, fonte: '', pemTsa: '', pemProvvisorio: '', pemAmmessi: '' };
let salvato = { ...VUOTO };
// Il thread di lettura riceve l'elenco solo quando cambia: ogni cambio di `ancore` la fa salire.
let versioneElenco = 0;
let ancore = null;
let ancoreTsa = null;
let inCorso = null;
let ultimoTentativo = 0;
let ultimoErrore = '';
let timer = null;

function provenienza() { return globalThis.SN_PROVENIENZA || null; }

// Nei test la rete la tocca solo chi chiede un aggiornamento con un indirizzo.
function automatico() { return process.env.NODE_ENV !== 'test' && !process.env.FILO_SMOKE; }

function cartella() {
  let base = '';
  try { base = require('electron').app.getPath('userData'); } catch (_) {}
  if (!base || typeof base !== 'string') base = process.env.FILO_USER_DATA || '.';
  return path.join(base, 'firmatari-c2pa');
}
function file() { return path.join(cartella(), 'elenco.json'); }

function leggiAncore(pem) {
  const P = provenienza();
  return P ? P.ancoreDaPem(pem) : [];
}

async function carica() {
  try {
    const dati = JSON.parse(await fsp.readFile(file(), 'utf8'));
    const lette = leggiAncore(dati && dati.pem);
    if (lette.length) {
      salvato = {
        pem: String(dati.pem), scaricatoIl: Number(dati.scaricatoIl) || 0, fonte: String(dati.fonte || ''), pemTsa: String(dati.pemTsa || ''),
        pemProvvisorio: String(dati.pemProvvisorio || ''), pemAmmessi: String(dati.pemAmmessi || ''),
      };
      ancore = lette;
      const tsa = leggiAncore(salvato.pemTsa);
      ancoreTsa = tsa.length ? tsa : null;
      versioneElenco++;
      return true;
    }
  } catch (_) {}
  return false;
}

async function salva() {
  await fsp.mkdir(cartella(), { recursive: true });
  const tmp = file() + '.tmp';
  await fsp.writeFile(tmp, JSON.stringify(salvato), 'utf8');
  await fsp.rename(tmp, file());
}

function fetchDisponibile() {
  try {
    const { net } = require('electron');
    if (net && typeof net.fetch === 'function') return net.fetch.bind(net);
  } catch (_) {}
  return globalThis.fetch;
}

async function scarica(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetchDisponibile()(url, { signal: ctrl.signal, cache: 'no-store' });
    if (!res.ok) throw new Error(`risposta ${res.status}`);
    const dichiarati = Number(res.headers.get('content-length')) || 0;
    if (dichiarati > MAX_BYTE) throw new Error(`elenco di ${dichiarati} byte, oltre il tetto di ${MAX_BYTE}`);
    const lettore = res.body.getReader();
    const pezzi = [];
    let totale = 0;
    for (;;) {
      const { done, value } = await lettore.read();
      if (done) break;
      totale += value.length;
      if (totale > MAX_BYTE) { ctrl.abort(); throw new Error(`elenco oltre il tetto di ${MAX_BYTE} byte`); }
      pezzi.push(Buffer.from(value));
    }
    return Buffer.concat(pezzi).toString('utf8');
  } finally {
    clearTimeout(t);
  }
}

// Un elenco che non si legge non prende il posto di quello buono: una risposta
// sbagliata del server non deve far diventare «sconosciuto» chi era riconosciuto.
// `urlTsa` assente con un `url` di prova: nei test la rete vera non si tocca.
function aggiorna({
  forza = false, url = FONTE, urlTsa = url === FONTE ? FONTE_TSA : null,
  urlProvvisorio = url === FONTE ? FONTE_PROVVISORIO : null, urlAmmessi = url === FONTE ? FONTE_AMMESSI : null,
} = {}) {
  if (inCorso) return inCorso;
  if (!forza && ancore && !(urlProvvisorio && mancaProvvisorio()) && Date.now() - salvato.scaricatoIl < RINFRESCO_MS) {
    return Promise.resolve({ ok: true, saltato: true, certificati: ancore.length, scaricatoIl: salvato.scaricatoIl });
  }
  ultimoTentativo = Date.now();
  inCorso = (async () => {
    try {
      // Gli elenchi di contorno che non arrivano non fermano quello ufficiale, né fanno perdere quelli di prima.
      const contorno = (u, nome) => (u ? scarica(u).catch((e) => {
        console.warn(`[firmatari-c2pa] ${nome} non aggiornato:`, e && e.message);
        return '';
      }) : Promise.resolve(''));
      const [pem, pemTsa, pemProvvisorio, pemAmmessi] = await Promise.all([
        scarica(url),
        contorno(urlTsa, 'elenco delle marche temporali'),
        contorno(urlProvvisorio, 'elenco provvisorio'),
        contorno(urlAmmessi, 'elenco provvisorio dei firmatari ammessi'),
      ]);
      const lette = leggiAncore(pem);
      if (!lette.length) throw new Error('nessun certificato leggibile nell’elenco scaricato');
      const tsa = leggiAncore(pemTsa);
      const P = provenienza();
      salvato = {
        pem, scaricatoIl: Date.now(), fonte: url, pemTsa: tsa.length ? pemTsa : salvato.pemTsa,
        pemProvvisorio: leggiAncore(pemProvvisorio).length ? pemProvvisorio : salvato.pemProvvisorio,
        pemAmmessi: P && P.ammessiDaPem(pemAmmessi).length ? pemAmmessi : salvato.pemAmmessi,
      };
      ancore = lette;
      if (tsa.length) ancoreTsa = tsa;
      versioneElenco++;
      ultimoErrore = '';
      try { await salva(); } catch (e) { console.warn('[firmatari-c2pa] elenco non salvato:', e && e.message); }
      return { ok: true, certificati: lette.length, scaricatoIl: salvato.scaricatoIl };
    } catch (e) {
      ultimoErrore = String((e && e.message) || e);
      console.warn('[firmatari-c2pa] aggiornamento fallito, resta l’elenco di prima:', ultimoErrore);
      return { ok: false, error: ultimoErrore, certificati: ancore ? ancore.length : 0 };
    } finally {
      inCorso = null;
    }
  })();
  return inCorso;
}

function mancaProvvisorio() { return !salvato.pemProvvisorio && !salvato.pemAmmessi; }

function serveAggiornare() {
  const daUltimo = Date.now() - ultimoTentativo;
  if (ancore && mancaProvvisorio() && daUltimo >= RIPROVA_PROVVISORIO_MS) return true;
  const vecchio = !ancore || Date.now() - salvato.scaricatoIl >= RINFRESCO_MS;
  return vecchio && daUltimo >= RIPROVA_MS;
}

async function init() {
  await carica();
  if (!automatico()) return;
  if (!timer) {
    timer = setInterval(() => { if (serveAggiornare()) aggiorna().catch(() => {}); }, CONTROLLO_MS);
    if (timer.unref) timer.unref();
  }
  if (serveAggiornare()) aggiorna().catch(() => {});
}

const attesa = (ms) => new Promise((r) => { const t = setTimeout(r, ms); if (t.unref) t.unref(); });

// La lettura che usano il menu, la chat e l'Aiuto: una sola, così le strade dicono la stessa cosa.
function elenco() {
  return {
    versione: versioneElenco,
    pem: ancore ? salvato.pem : '',
    pemTsa: ancore && ancoreTsa ? salvato.pemTsa : '',
    pemProvvisorio: ancore ? salvato.pemProvvisorio : '',
    pemAmmessi: ancore ? salvato.pemAmmessi : '',
  };
}

// Un marchio nei pixel si cerca solo se il file non dichiara niente: le sue etichette parlano per prime (#889).
// La lettura si ricorda per i byte, così menu, Aiuto e chat sulla stessa immagine non la decodificano tre volte.
const MAX_MARCHI = 300;
const marchi = new Map();
let ritardoMarchi = 0;

async function marchioNeiPixel(byte) {
  const k = Buffer.from(await globalThis.crypto.subtle.digest('SHA-256', byte)).toString('hex');
  let lettura = marchi.get(k);
  if (lettura) {
    marchi.delete(k);
  } else {
    lettura = (async () => {
      if (ritardoMarchi) await attesa(ritardoMarchi);
      return require('./provenienzaIsolata').cercaMarchi(byte);
    })();
    // Una lettura interrotta (un altro file ha fatto cadere il thread) non diventa un «niente marchio» per sempre.
    lettura.catch(() => { if (marchi.get(k) === lettura) marchi.delete(k); });
  }
  marchi.set(k, lettura);
  while (marchi.size > MAX_MARCHI) marchi.delete(marchi.keys().next().value);
  try { return await lettura; } catch (e) {
    console.warn('[marchi] lettura dei pixel interrotta:', e && e.message);
    return null;
  }
}

async function analizzaImmagine(byte) {
  const isolata = require('./provenienzaIsolata');
  let res = await isolata.analizza(byte, elenco());
  if (!res.trovato) {
    const P = provenienza();
    const m = await marchioNeiPixel(byte);
    return (m && P && P.esitoDaMarchio(m)) || { ...res, marchiCercati: !!m };
  }
  // «Sconosciuto» senza l'elenco provvisorio non è ancora la risposta: chi lo aspetta è chi sta arrivando.
  const inAttesa = res.firmatario === 'non_verificato' || (res.firmatario === 'sconosciuto' && mancaProvvisorio());
  if (!inAttesa) return res;
  const giro = inCorso || (automatico() && serveAggiornare() ? aggiorna() : null);
  if (!giro) return res;
  await Promise.race([giro, attesa(ATTESA_PRIMA_VOLTA_MS)]);
  if (ancore) res = await isolata.analizza(byte, elenco());
  return res;
}

// Gli appunti ricodificano un'immagine copiata e ne buttano le etichette (#946):
// l'esito letto sull'originale si ricorda per i pixel della copia, e la chat lo ritrova.
const MAX_COPIE = 500;
const copie = new Map();

async function ricordaCopia(originale, copiate) {
  const res = await analizzaImmagine(originale);
  if (!res.trovato) return false;
  let ricordata = false;
  for (const c of copiate || []) {
    const k = impronta(c);
    if (!k) continue;
    copie.delete(k);
    copie.set(k, res);
    ricordata = true;
  }
  while (copie.size > MAX_COPIE) copie.delete(copie.keys().next().value);
  return ricordata;
}

function origineDellaCopia(byte) {
  if (!copie.size) return null;
  const k = impronta(byte);
  return (k && copie.get(k)) || null;
}

function stato() {
  return {
    scaricato: !!ancore,
    certificati: ancore ? ancore.length : 0,
    autoritaMarca: ancoreTsa ? ancoreTsa.length : 0,
    provvisorio: { autorita: leggiAncore(salvato.pemProvvisorio).length, ammessi: (provenienza() ? provenienza().ammessiDaPem(salvato.pemAmmessi) : []).length },
    scaricatoIl: salvato.scaricatoIl,
    fonte: salvato.fonte,
    ultimoErrore,
  };
}

// Solo per i test: la lettura dei pixel che arriva dopo il menu, per vedere che il menu non la aspetta.
function _rallentaMarchi(ms) { ritardoMarchi = Math.max(0, Number(ms) || 0); }

// Solo per i test: si riparte come al primo avvio, senza elenco in memoria.
function _dimentica() {
  salvato = { ...VUOTO };
  ancore = null;
  ancoreTsa = null;
  versioneElenco++;
  ultimoTentativo = 0;
  ultimoErrore = '';
  copie.clear();
  marchi.clear();
}

module.exports = { FONTE, FONTE_TSA, FONTE_PROVVISORIO, FONTE_AMMESSI, init, aggiorna, analizzaImmagine, ricordaCopia, origineDellaCopia, stato, carica, _dimentica, _rallentaMarchi };
