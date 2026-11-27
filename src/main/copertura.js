// Cosa di src/ usa il processo main, per la mappa prova → file (#2502): le funzioni eseguite e i file serviti alle
// pagine. Acceso solo da FILO_COPERTURA (la suite in GitHub): fuori da lì non registra niente e non tocca l'app.
// Formato e regole: scripts/lib/mappaProve.mjs, sentinelle tests/unit/mappaProve.test.mjs e coperturaProve.test.mjs.

const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const SRC_URL = `${pathToFileURL(path.resolve(__dirname, '..')).href}/`;

/**
 * La regola sola, per il main e per le pagine (scripts/lib/copertura-prove.mjs): una funzione conta come eseguita se
 * il suo primo intervallo ha contato. Accumula in `viste` (indirizzo → insieme di "da:a") un Profiler.takePreciseCoverage.
 */
function accumula(viste, risultato, tieni = () => true) {
  for (const s of risultato?.result || []) {
    if (!s.url || !tieni(s.url)) continue;
    let set = viste.get(s.url);
    if (!set) viste.set(s.url, (set = new Set()));
    for (const f of s.functions || []) {
      const r = f.ranges && f.ranges[0];
      if (r && r.count > 0) set.add(`${r.startOffset}:${r.endOffset}`);
    }
  }
}

function comeIndirizzi(viste) {
  const out = {};
  for (const [u, set] of viste) out[u] = [...set].map((x) => x.split(':').map(Number));
  return out;
}

let registrate = null;

/** Un file che il protocollo filo:// serve (un foglio di stile, un HTML): lo carica la prova in corsa. */
function servito(indirizzo) {
  if (!registrate) return;
  let u;
  try { u = new URL(String(indirizzo)); } catch (_) { return; }
  const chiave = `${u.protocol}//${u.host}${u.pathname}`;
  if (!registrate.has(chiave)) registrate.set(chiave, new Set());
}

function accendi(app) {
  const dir = process.env.FILO_COPERTURA;
  if (!dir) return;
  const inspector = require('node:inspector');
  const sessione = new inspector.Session();
  try {
    sessione.connect();
    sessione.post('Profiler.enable');
    // Binaria e per funzione: basta sapere che una funzione è partita, e costa meno dei conteggi.
    sessione.post('Profiler.startPreciseCoverage', { callCount: false, detailed: false });
  } catch (_) { return; }
  // Ogni presa riporta solo le funzioni nuove: si accumulano, e il file si riscrive intero.
  const viste = new Map();
  registrate = viste;
  const prendi = () => {
    try {
      sessione.post('Profiler.takePreciseCoverage', (err, res) => { if (!err) accumula(viste, res, (u) => u.startsWith(SRC_URL)); });
    } catch (_) {}
  };
  const nome = path.join(dir, `main-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`);
  const scrivi = () => {
    prendi();
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(nome, JSON.stringify({ prova: process.env.FILO_COPERTURA_PROVA || '', processo: 'main', indirizzi: comeIndirizzi(viste) }));
    } catch (_) {}
  };
  // Un'app uccisa a metà (chiudiApp dopo cinque secondi) lascia almeno l'ultima scrittura.
  const timer = setInterval(scrivi, 5000);
  timer.unref?.();
  app.on('will-quit', scrivi);
  process.on('exit', scrivi);
}

module.exports = { accendi, accumula, comeIndirizzi, servito };
