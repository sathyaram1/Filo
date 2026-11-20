// #473 — dove è finito un file scaricato e poi spostato: stesso nome e stessa dimensione, nelle cartelle date più un
// livello di sottocartelle. Parte solo a un clic dell'utente, mai per marcare un elenco; niente ricerca sul disco intero.
// Regole: tests/unit/ritrovaFile.test.mjs.

const fs = require('node:fs');
const path = require('node:path');

// Largo: una cartella Documenti piena su un disco lento. Scaduto, l'esito lo dice (mai un «non c'è» falso).
const TETTO_MS = 10_000;

function stessoNome(a, b) {
  return process.platform === 'win32' || process.platform === 'darwin' ? a.toLowerCase() === b.toLowerCase() : a === b;
}

// `radici`: [{ dir, nome }], `nome` è come l'utente chiama quella cartella («Documenti»). `dimensione` 0 = non nota:
// basta il nome. Risolve { trovato: percorso, dove: «Documenti/Bollette» } o { trovato: '', scaduto }.
async function cerca(nomeFile, dimensione, radici, { tettoMs = TETTO_MS, escludi = '' } = {}) {
  const nome = path.basename(String(nomeFile || ''));
  if (!nome) return { trovato: '', scaduto: false };
  const fine = Date.now() + Math.max(0, Number(tettoMs) || 0);
  const peso = Number(dimensione) > 0 ? Number(dimensione) : 0;
  const visti = new Set();
  const giusto = async (p) => {
    if (escludi && p === escludi) return false;
    try {
      const st = await fs.promises.stat(p);
      return st.isFile() && (!peso || st.size === peso);
    } catch (_) { return false; }
  };
  for (const { dir, nome: etichetta } of radici || []) {
    if (!dir) continue;
    const radice = path.resolve(dir);
    if (visti.has(radice)) continue;
    visti.add(radice);
    let voci;
    try { voci = await fs.promises.readdir(radice, { withFileTypes: true }); } catch (_) { continue; }
    const sotto = [];
    for (const v of voci) {
      if (Date.now() >= fine) return { trovato: '', scaduto: true };
      if (v.isFile() && stessoNome(v.name, nome) && await giusto(path.join(radice, v.name))) {
        return { trovato: path.join(radice, v.name), dove: etichetta || path.basename(radice) };
      }
      if (v.isDirectory() && !v.name.startsWith('.')) sotto.push(v.name);
    }
    for (const s of sotto) {
      if (Date.now() >= fine) return { trovato: '', scaduto: true };
      let dentro;
      try { dentro = await fs.promises.readdir(path.join(radice, s), { withFileTypes: true }); } catch (_) { continue; }
      for (const v of dentro) {
        if (!v.isFile() || !stessoNome(v.name, nome)) continue;
        const p = path.join(radice, s, v.name);
        if (await giusto(p)) return { trovato: p, dove: `${etichetta || path.basename(radice)}/${s}` };
      }
    }
  }
  return { trovato: '', scaduto: false };
}

// Le cartelle solite, chieste al sistema: vale su Windows, Mac e Linux. `prima`: la cartella dov'era, che può non essere
// nessuna di queste.
function radiciSolite(app, prima = []) {
  const chiedi = (k) => { try { return app.getPath(k); } catch (_) { return ''; } };
  return [
    ...prima,
    { dir: chiedi('downloads'), nome: 'Download' },
    { dir: chiedi('desktop'), nome: 'Scrivania' },
    { dir: chiedi('documents'), nome: 'Documenti' },
  ].filter((r) => r.dir);
}

module.exports = { cerca, radiciSolite, TETTO_MS };
