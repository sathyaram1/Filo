// Il percorso intero di un programma avviato per nome. Su Windows un nome nudo si cerca prima nella cartella di
// lavoro (#2292): un git.exe o un powershell.exe arrivati con un archivio prenderebbero il posto di quelli veri.
// Fuori da Windows il nome resta com'è: lì la cartella di lavoro non entra nella ricerca. Sentinella: programmaIntero.test.mjs.

const fs = require('node:fs');
const path = require('node:path');

// Dove stanno se il PATH non li ha: i programmi di sistema che Filo avvia con una cartella dell'utente.
const DI_SISTEMA = {
  'powershell.exe': ['System32', 'WindowsPowerShell', 'v1.0'],
  'cmd.exe': ['System32'],
  'where.exe': ['System32'],
  'wsl.exe': ['System32'],
};

const unFile = (p) => { try { return fs.statSync(p).isFile(); } catch (_) { return false; } };

// null se il programma non sta in nessuna cartella del PATH né fra quelle di sistema: chi chiama non lo avvia per nome.
function programmaIntero(nome, { env = process.env } = {}) {
  const n = String(nome || '');
  if (process.platform !== 'win32' || !n || /[\\/]/.test(n) || path.isAbsolute(n)) return n;
  // Come la ricerca di Windows: il nome com'è se ha un'estensione, poi .com e .exe.
  const nomi = /\.[^.]+$/.test(n) ? [n, `${n}.com`, `${n}.exe`] : [`${n}.com`, `${n}.exe`];
  const cartelle = String(env.PATH || env.Path || '').split(path.delimiter)
    // Una voce vuota o relativa è di nuovo la cartella di lavoro.
    .map((d) => d.trim().replace(/^"(.*)"$/, '$1')).filter((d) => d && path.isAbsolute(d));
  for (const d of cartelle) {
    for (const x of nomi) {
      const p = path.join(d, x);
      if (unFile(p)) return p;
    }
  }
  const sistema = DI_SISTEMA[n.toLowerCase()];
  const radice = env.SystemRoot || env.windir;
  return sistema && radice ? path.join(radice, ...sistema, n) : null;
}

module.exports = { programmaIntero };
