// Il disco per le virgolette ai percorsi del terminale della home (#968): la shell effettiva e se un percorso
// esiste, visto dalla cartella del terminale. La regola sta in src/shared/virgoletteShell.js; qui niente comandi.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { resolveShell } = require('./terminal');

const V = globalThis.SN_VIRGOLETTE || (require('../../shared/virgoletteShell.js'), globalThis.SN_VIRGOLETTE);

// La cartella da cui il terminale leggerebbe il percorso: quella che mostra, o la home se non c'è più.
function cartellaDiPartenza(cwd) {
  try { return require('./shell').cartellaPerComando(cwd).cwd || os.homedir(); } catch (_) { return os.homedir(); }
}

async function tipoDelPercorso(testo, shell, cwd) {
  let p = String(testo || '');
  if (!p || p.includes('\0')) return null;
  if (shell !== 'cmd' && /^~(?=$|[\\/])/.test(p)) p = os.homedir() + p.slice(1);
  try {
    const st = await fs.promises.stat(path.resolve(cartellaDiPartenza(cwd), p));
    if (st.isDirectory()) return 'cartella';
    return st.isFile() ? 'file' : null;
  } catch (_) {
    return null;
  }
}

async function virgoletteIncollando({ riga, inizio, fine, shell, cwd } = {}) {
  if (typeof riga !== 'string') return null;
  const effettiva = resolveShell(shell);
  return V.virgoletteIncollando({ riga, inizio, fine, shell: effettiva }, (p) => tipoDelPercorso(p, effettiva, cwd));
}

async function propostaVirgolette({ comando, shell, cwd } = {}) {
  if (typeof comando !== 'string') return null;
  const effettiva = resolveShell(shell);
  return V.propostaVirgolette(comando, effettiva, (p) => tipoDelPercorso(p, effettiva, cwd));
}

module.exports = { virgoletteIncollando, propostaVirgolette, tipoDelPercorso };
