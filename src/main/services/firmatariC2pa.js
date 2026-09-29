// L'elenco ufficiale dei firmatari riconosciuti delle credenziali C2PA (#711): si scarica ogni tanto e resta in userData.
// Non lo sostituisce mai una lista scritta qui: finché non c'è, una firma valida resta «firmatario non verificato».
// Regole: patterns/unetichetta-di-origine-e-una-dichiarazione-non-una-prova.md

'use strict';

const fsp = require('node:fs/promises');
const path = require('node:path');

// Lo pubblica chi gestisce lo standard (programma di conformità del C2PA).
const FONTE = 'https://raw.githubusercontent.com/c2pa-org/conformance-public/main/trust-list/C2PA-TRUST-LIST.pem';
const RINFRESCO_MS = 24 * 60 * 60 * 1000;
const CONTROLLO_MS = 60 * 60 * 1000;
// Dopo un fallimento non si riprova subito: il canale del menu lo può toccare anche una pagina web.
const RIPROVA_MS = 10 * 60 * 1000;
// Alla prima immagine firmata, se l'elenco sta arrivando, lo si aspetta un poco invece di dire «non verificato».
const ATTESA_PRIMA_VOLTA_MS = 3000;
// L'elenco pesa decine di KB: oltre il tetto si rifiuta col numero nei log e si tiene quello che c'era.
const MAX_BYTE = 8 * 1024 * 1024;
const TIMEOUT_MS = 30_000;

let salvato = { pem: '', scaricatoIl: 0, fonte: '' };
let ancore = null;
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
      salvato = { pem: String(dati.pem), scaricatoIl: Number(dati.scaricatoIl) || 0, fonte: String(dati.fonte || '') };
      ancore = lette;
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
function aggiorna({ forza = false, url = FONTE } = {}) {
  if (inCorso) return inCorso;
  if (!forza && ancore && Date.now() - salvato.scaricatoIl < RINFRESCO_MS) {
    return Promise.resolve({ ok: true, saltato: true, certificati: ancore.length, scaricatoIl: salvato.scaricatoIl });
  }
  ultimoTentativo = Date.now();
  inCorso = (async () => {
    try {
      const pem = await scarica(url);
      const lette = leggiAncore(pem);
      if (!lette.length) throw new Error('nessun certificato leggibile nell’elenco scaricato');
      salvato = { pem, scaricatoIl: Date.now(), fonte: url };
      ancore = lette;
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

function serveAggiornare() {
  const vecchio = !ancore || Date.now() - salvato.scaricatoIl >= RINFRESCO_MS;
  return vecchio && Date.now() - ultimoTentativo >= RIPROVA_MS;
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
// `opzioni.marchio`: l'esito del marchio invisibile, letto da chi ha già i pixel; conta solo se il file tace.
async function analizzaImmagine(byte, opzioni) {
  const P = provenienza();
  if (!P) throw new Error('controllo non disponibile');
  let res = P.analizza(byte, { ancore });
  if (!res.trovato) return P.daMarchio(opzioni && opzioni.marchio) || res;
  if (res.firmatario !== 'non_verificato') return res;
  const giro = inCorso || (automatico() && serveAggiornare() ? aggiorna() : null);
  if (!giro) return res;
  await Promise.race([giro, attesa(ATTESA_PRIMA_VOLTA_MS)]);
  if (ancore) res = P.analizza(byte, { ancore });
  return res;
}

function stato() {
  return {
    scaricato: !!ancore,
    certificati: ancore ? ancore.length : 0,
    scaricatoIl: salvato.scaricatoIl,
    fonte: salvato.fonte,
    ultimoErrore,
  };
}

// Solo per i test: si riparte come al primo avvio, senza elenco in memoria.
function _dimentica() {
  salvato = { pem: '', scaricatoIl: 0, fonte: '' };
  ancore = null;
  ultimoTentativo = 0;
  ultimoErrore = '';
}

module.exports = { FONTE, init, aggiorna, analizzaImmagine, stato, carica, _dimentica };
