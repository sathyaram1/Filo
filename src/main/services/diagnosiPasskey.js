// Il registro della diagnostica delle passkey (#1608): una riga JSON per richiesta WebAuthn, scritta solo con
// FILO_DIAGNOSI_PASSKEY acceso. Della pagina passano solo campi noti e tagliati; pagina, frame e sessione li dice il main.
// Il riassunto nasce in preload/diagnosi-passkey.js; prove: tests/unit/diagnosiPasskey.test.mjs, tests/diagnosi-passkey.spec.mjs.

'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { modoDiagnosiPasskey, VARIABILE_PASSKEY } = require('../../preload/diagnosi-passkey');

const NOME_FILE = 'diagnosi-passkey.log';
// Una prova d'accesso scrive qualche decina di righe: il tetto serve solo a non riempire il disco se resta acceso.
const TETTO_BYTE = 8 * 1024 * 1024;

const TESTI = { tipo: 40, nome: 80, marchi: 300, mediazione: 40, rpId: 255, verifica: 40, collegamento: 40, residente: 40,
  attestazione: 40, esito: 20, errore: 60, messaggio: 300, usato: 40, riassunto: 60 };
const NUMERI = ['timeout', 'quante', 'ms'];
const ELENCHI = ['suggerimenti', 'estensioni', 'trasportiRisposta'];

function elenco(v) {
  if (!Array.isArray(v)) return undefined;
  return v.slice(0, 16).map((x) => String(x).slice(0, 40));
}

// Il JSON arriva dal mondo della pagina: chiunque sul sito può scriverlo, quindi passa solo la forma attesa.
function pulisci(grezzo) {
  let rec;
  try { rec = JSON.parse(String(grezzo).slice(0, 32768)); } catch (_) { return null; }
  if (!rec || typeof rec !== 'object' || Array.isArray(rec)) return null;
  const out = {};
  for (const [k, max] of Object.entries(TESTI)) if (typeof rec[k] === 'string') out[k] = rec[k].slice(0, max);
  if (!out.tipo) return null;
  for (const k of NUMERI) if (Number.isFinite(rec[k])) out[k] = rec[k];
  for (const k of ELENCHI) { const l = elenco(rec[k]); if (l) out[k] = l; }
  if (Array.isArray(rec.credenziali)) {
    out.credenziali = rec.credenziali.slice(0, 64).map((c) => ({
      lunghezzaId: Number.isFinite(c?.lunghezzaId) ? c.lunghezzaId : null,
      trasporti: elenco(c?.trasporti) ?? null,
      ...(c?.aggiunto === true ? { aggiunto: true } : {}),
    }));
  }
  if (rec.risposta !== undefined) {
    if (typeof rec.risposta === 'boolean') out.risposta = rec.risposta;
    else if (rec.risposta && typeof rec.risposta === 'object') {
      out.risposta = {};
      for (const [k, v] of Object.entries(rec.risposta).slice(0, 32)) if (typeof v === 'boolean') out.risposta[String(k).slice(0, 60)] = v;
    }
  }
  return out;
}

// Della pagina si tiene origine e percorso: nella query di un accesso viaggiano gettoni.
function paginaDi(url) {
  try { const u = new URL(String(url)); return u.origin + u.pathname; } catch (_) { return ''; }
}

let coda = Promise.resolve();
let intestata = false;

function modo() { return modoDiagnosiPasskey(process.env[VARIABILE_PASSKEY]); }
function fileDi(app) { return path.join(app.getPath('userData'), NOME_FILE); }

function scrivi(app, righe) {
  const file = fileDi(app);
  coda = coda.then(async () => {
    try {
      const st = await fs.promises.stat(file).catch(() => null);
      if (st && st.size > TETTO_BYTE) {
        await fs.promises.rename(file, file + '.1').catch(() => {});
        righe.unshift(JSON.stringify({ quando: new Date().toISOString(), nota: `il registro ha passato ${TETTO_BYTE} byte: le righe di prima sono in ${NOME_FILE}.1` }));
      }
      await fs.promises.appendFile(file, righe.join('\n') + '\n', 'utf8');
    } catch (e) {
      console.warn('[diagnosi-passkey] non scrivo il registro:', e && e.message);
    }
  });
  return coda;
}

function intestazione(m) {
  return JSON.stringify({
    quando: new Date().toISOString(), avvio: true, modo: m.ibrido ? 'ibrido' : 'registra',
    filo: require('electron').app.getVersion(), electron: process.versions.electron, chromium: process.versions.chrome,
    sistema: process.platform, versioneSistema: os.release(), architettura: process.arch,
  });
}

// All'avvio, così un registro con la sola intestazione dice che la pagina non ha mai chiesto una passkey.
function avvia() {
  const m = modo();
  if (!m || intestata) return null;
  intestata = true;
  return scrivi(require('electron').app, [intestazione(m)]);
}

function registra(event, grezzo) {
  const m = modo();
  if (!m) return null;
  const rec = pulisci(grezzo);
  if (!rec) return null;
  const wc = event && event.sender;
  const frame = event && event.senderFrame;
  const riga = { quando: new Date().toISOString(), pagina: paginaDi(frame && frame.url), ...rec };
  try { riga.principale = !!frame && frame === wc.mainFrame; } catch (_) {}
  // In Electron una sessione senza «persist:» è privata, e Chromium lo dice a Windows (bBrowserInPrivateMode).
  try { riga.sessionePersistente = wc.session.isPersistent(); } catch (_) {}
  const righe = [JSON.stringify(riga)];
  if (!intestata) { intestata = true; righe.unshift(intestazione(m)); }
  return scrivi(require('electron').app, righe);
}

module.exports = { avvia, registra, pulisci, paginaDi, NOME_FILE };
