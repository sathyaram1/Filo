// Quali funzioni di src/ esegue il processo main, per la mappa prova → file (#2502). Acceso solo da FILO_COPERTURA
// (la suite in GitHub): fuori da lì non si carica. Non tocca l'app: scrive un JSON nella cartella e basta.
// Regole e formato: scripts/lib/mappaProve.mjs, sentinella tests/unit/mappaProve.test.mjs.

const fs = require('node:fs');
const path = require('node:path');
const inspector = require('node:inspector');

const SRC = path.resolve(__dirname, '..');

function accendi(app) {
  const dir = process.env.FILO_COPERTURA;
  if (!dir) return;
  const sessione = new inspector.Session();
  try {
    sessione.connect();
    sessione.post('Profiler.enable');
    // Binaria e per funzione: basta sapere che una funzione è partita, e costa meno dei conteggi.
    sessione.post('Profiler.startPreciseCoverage', { callCount: false, detailed: false });
  } catch (_) { return; }
  // Ogni presa riporta solo le funzioni nuove: si accumulano, e il file si riscrive intero.
  const viste = new Map();
  const prendi = () => {
    try {
      sessione.post('Profiler.takePreciseCoverage', (err, res) => {
        if (err || !res) return;
        for (const s of res.result || []) {
          if (!s.url || !s.url.startsWith('file://')) continue;
          let file;
          try { file = require('node:url').fileURLToPath(s.url); } catch (_) { continue; }
          if (!file.startsWith(SRC + path.sep)) continue;
          const rel = path.relative(path.dirname(SRC), file).split(path.sep).join('/');
          let set = viste.get(rel);
          if (!set) viste.set(rel, (set = new Set()));
          for (const f of s.functions || []) {
            const r = f.ranges && f.ranges[0];
            if (r && r.count > 0) set.add(`${r.startOffset}:${r.endOffset}`);
          }
        }
      });
    } catch (_) {}
  };
  const nome = path.join(dir, `main-${process.pid}-${Date.now()}.json`);
  const scrivi = () => {
    prendi();
    const file = {};
    for (const [rel, set] of viste) file[rel] = [...set].map((x) => x.split(':').map(Number));
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(nome, JSON.stringify({ prova: process.env.FILO_COPERTURA_PROVA || '', processo: 'main', file }));
    } catch (_) {}
  };
  // Un'app uccisa a metà (chiudiApp dopo cinque secondi) lascia almeno l'ultima scrittura.
  const timer = setInterval(scrivi, 5000);
  timer.unref?.();
  app.on('will-quit', scrivi);
  process.on('exit', scrivi);
}

module.exports = { accendi };
