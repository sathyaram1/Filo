// Le pubblicità di YouTube tolte prima che partano (#1974): scarica ogni giorno le liste di uAssets, ne tiene le regole
// di iniezione per YouTube e le dà al preload di ogni frame di YouTube. Quando non reggono, la scheda torna al solo «Salta».
// Interruttore: settings.security.youtubeAds.enabled. Regole: tests/unit/bloccoYouTube.test.mjs.
'use strict';

const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const R = require('./regoleYouTube');

// Le liste di uBlock Origin: i file «!#include» di filters.txt stanno accanto, nella stessa cartella.
const CARTELLA_LISTE = 'https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters/';
const SORGENTI = ['filters.txt', 'quick-fixes.txt'];
const MAX_INCLUSI = 24;
// I manutentori le aggiornano più volte a settimana quando YouTube cambia: una al giorno.
const OGNI_MS = 24 * 60 * 60 * 1000;
// Dopo un ripiego le regole si riscaricano subito, ma non più di una volta all'ora.
const FORZATO_MS = 60 * 60 * 1000;
const FORMATO = 1;

let acceso = true;
let insieme = { regole: [], eccezioni: [], ignote: [] };
let versione = '';
let aggiornateIl = 0;
let ultimoForzato = 0;
let giro = null;
let timer = null;
// Le schede dove il blocco non regge: tornano al blocco quando le regole cambiano.
const spente = new Map();
// Le schede che hanno ricevuto regole nel documento di adesso: solo loro possono dirle rotte.
const conRegole = new Set();

function attivo(settings) {
  return settings?.security?.youtubeAds?.enabled !== false;
}

function impronta(ins) {
  return crypto.createHash('sha256').update(JSON.stringify([ins.regole, ins.eccezioni])).digest('hex').slice(0, 16);
}

function usa(nuovo, quando) {
  const v = impronta(nuovo);
  insieme = nuovo;
  aggiornateIl = quando;
  if (v !== versione) {
    versione = v;
    spente.clear();
  }
}

function inTest() { return process.env.NODE_ENV === 'test' || !!process.env.FILO_SMOKE; }

// ─── cache su disco ─────────────────────────────────────────────────────────

function fileCache() {
  let base = '';
  try { base = require('electron').app.getPath('userData'); } catch (_) { base = process.env.FILO_USER_DATA || '.'; }
  return path.join(base, 'adblock', 'youtube.json');
}

async function caricaCache() {
  try {
    const d = JSON.parse(await fsp.readFile(fileCache(), 'utf8'));
    if (d && d.formato === FORMATO && d.insieme && Array.isArray(d.insieme.regole)) {
      usa({ regole: d.insieme.regole, eccezioni: d.insieme.eccezioni || [], ignote: d.insieme.ignote || [] }, Number(d.aggiornateIl) || 0);
      return true;
    }
  } catch (_) {}
  return false;
}

async function salvaCache() {
  try {
    await fsp.mkdir(path.dirname(fileCache()), { recursive: true });
    await fsp.writeFile(fileCache(), JSON.stringify({ formato: FORMATO, aggiornateIl, versione, insieme }), 'utf8');
  } catch (_) {}
}

// ─── scaricamento ───────────────────────────────────────────────────────────

/** I testi della lista e dei suoi «!#include»: null se la lista principale non arriva. */
async function scaricaLista(nome, prendi) {
  const testo = await prendi(CARTELLA_LISTE + nome);
  if (!testo) return null;
  const altri = R.inclusi(testo).slice(0, MAX_INCLUSI);
  const inclusi = await Promise.all(altri.map((n) => prendi(CARTELLA_LISTE + n)));
  return [testo, ...inclusi.filter(Boolean)];
}

/**
 * Riscarica le liste. Senza `forza` salta se la copia ha meno di un giorno. Una lista che non arriva lascia le regole
 * di prima: meglio regole di ieri che nessuna.
 */
function aggiorna({ forza = false, prendi = require('./adblock').fetchList } = {}) {
  if (giro) return giro;
  giro = (async () => {
    if (!forza && aggiornateIl && Date.now() - aggiornateIl < OGNI_MS) return { ok: true, saltato: true, versione };
    const pezzi = await Promise.all(SORGENTI.map((n) => scaricaLista(n, prendi)));
    if (pezzi.some((p) => !p)) return { ok: false, errore: 'download_failed', versione };
    const nuovo = R.leggi(...pezzi.flat());
    if (!nuovo.regole.length) return { ok: false, errore: 'vuote', versione };
    const prima = versione;
    usa(nuovo, Date.now());
    await salvaCache();
    return { ok: true, versione, cambiate: prima !== versione };
  })().catch((e) => ({ ok: false, errore: String((e && e.message) || e), versione }))
    .finally(() => { giro = null; });
  return giro;
}

const inSottofondo = require('./retryList').makeRetry(() => aggiorna(), () => acceso && !inTest());

function seguiOgniGiorno() {
  if (timer) return;
  timer = setInterval(() => { if (acceso) inSottofondo().catch(() => {}); }, OGNI_MS);
  if (timer.unref) timer.unref();
}

async function init(settings) {
  acceso = attivo(settings);
  await caricaCache();
  if (inTest() || !acceso) return;
  seguiOgniGiorno();
  if (!aggiornateIl || Date.now() - aggiornateIl >= OGNI_MS) inSottofondo().catch(() => {});
}

function configureFromSettings(settings) {
  const era = acceso;
  acceso = attivo(settings);
  if (inTest() || !acceso || era) return;
  seguiOgniGiorno();
  if (!aggiornateIl || Date.now() - aggiornateIl >= OGNI_MS) inSottofondo().catch(() => {});
}

// ─── pagine ─────────────────────────────────────────────────────────────────

/** Le regole per il documento che sta nascendo in quel frame; [] se non tocca a lui. */
function regolePer(href, wc) {
  const host = R.hostDi(href);
  if (!acceso || !R.hostYouTube(host)) return [];
  const id = wc && typeof wc.id === 'number' ? wc.id : null;
  if (id !== null && spente.get(id) === versione) return [];
  const out = R.perHost(insieme, host);
  if (out.length && id !== null) conRegole.add(id);
  return out;
}

/**
 * Il preload di un frame di YouTube vede il video rotto. La scheda torna al solo «Salta» finché le regole non cambiano;
 * il frame si ricarica una volta. Ritorna cosa ha fatto, per i test e per chi chiama.
 */
function rotto(wc, frame, motivo, { avvisa = avvisoDiRipiego, ricarica = ricaricaFrame } = {}) {
  const id = wc && typeof wc.id === 'number' ? wc.id : null;
  if (id === null || !conRegole.has(id)) return { fatto: false, perche: 'senza_regole' };
  if (spente.get(id) === versione) return { fatto: false, perche: 'gia_spenta' };
  let url = '';
  try { url = String(frame && frame.url); } catch (_) { url = ''; }
  if (!R.hostYouTube(R.hostDi(url))) return { fatto: false, perche: 'non_youtube' };
  spente.set(id, versione);
  conRegole.delete(id);
  try { avvisa(motivo); } catch (_) {}
  try { ricarica(wc, frame); } catch (_) {}
  if (!inTest() && Date.now() - ultimoForzato >= FORZATO_MS) {
    ultimoForzato = Date.now();
    aggiorna({ forza: true }).catch(() => {});
  }
  return { fatto: true };
}

const TESTO_RIPIEGO = 'Oggi il blocco delle pubblicità su YouTube non funziona: aggiorno le regole e riprovo';

function avvisoDiRipiego() {
  require('./avvisoFinestra').avvisoNellaFinestra(TESTO_RIPIEGO, { chiave: 'blocco-youtube', durataSec: 10, tipo: 'blocco_youtube_ripiego' });
}

function ricaricaFrame(wc, frame) {
  if (!wc || wc.isDestroyed()) return;
  const principale = (() => { try { return frame === wc.mainFrame || frame.frameTreeNodeId === wc.mainFrame.frameTreeNodeId; } catch (_) { return true; } })();
  if (principale) wc.reload(); else frame.reload();
}

// Un documento nuovo nella scheda chiede di nuovo le regole: quello di prima non può più dirle rotte.
function documentoNuovo(wc) {
  if (wc && typeof wc.id === 'number') conRegole.delete(wc.id);
}

function status() {
  return { enabled: acceso, regole: insieme.regole.length, ignote: insieme.ignote.slice(), versione, aggiornateIl, spente: spente.size };
}

// Solo per i test: le liste come se fossero arrivate dalla rete, senza rete.
function impostaListePerTest(testi) {
  usa(R.leggi(...(Array.isArray(testi) ? testi : [testi])), Date.now());
  return status();
}

function spentaPerTest(id) { return spente.get(id) === versione; }

module.exports = {
  CARTELLA_LISTE, SORGENTI, OGNI_MS, FORZATO_MS, TESTO_RIPIEGO,
  attivo, init, configureFromSettings, aggiorna, regolePer, rotto, documentoNuovo, status, impostaListePerTest, spentaPerTest,
};
