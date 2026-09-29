// consegna-file.mjs — i pezzi grossi del payload di dispatch escono dalla stampa e vanno, interi, in file
// fuori dal repo. Non tronca mai: il file contiene tutto, la stampa cita il percorso assoluto.
// Regole e prove: tests/unit/consegnaFile.test.mjs.

import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';

// Tetto del solo payload quando chi chiama non misura la stampa intera (`misura`).
export const PAYLOAD_IN_STAMPA_MAX = 8000;
// Oltre 30.000 caratteri l'uscita di un comando finisce in un file d'appoggio dell'harness; il margine è
// per le righe di stderr che arrivano insieme.
export const STAMPA_MAX = 28000;
// Sotto questa taglia un pezzo resta in stampa: spostarlo costa una lettura e non libera niente.
const PEZZO_MIN = 1000;

// Una cartella per progetto: due lavoratori su due worktree non si cancellano i file a vicenda.
export function cartellaConsegna(root, base = tmpdir()) {
  const h = createHash('sha256').update(resolve(String(root || '.'))).digest('hex').slice(0, 12);
  return join(base, `filo-consegna-${h}`);
}

function pezzoPiuGrosso(nodo, percorso = []) {
  let best = null;
  if (typeof nodo !== 'object' || nodo === null) return best;
  for (const [k, v] of Object.entries(nodo)) {
    const p = [...percorso, k];
    const c = typeof v === 'string' ? { nodo, chiave: k, percorso: p, len: v.length } : pezzoPiuGrosso(v, p);
    if (c && (!best || c.len > best.len)) best = c;
  }
  return best;
}

// Tanti pezzi corti sommati sforano quanto uno lungo: finiti i testi lunghi, esce il gruppo più grosso.
function gruppoPiuGrosso(nodo, percorso = []) {
  let best = null;
  for (const [k, v] of Object.entries(nodo)) {
    if (typeof v !== 'object' || v === null || (!percorso.length && k === 'fileEsterni')) continue;
    const p = [...percorso, k];
    const len = JSON.stringify(v).length;
    if (!best || len > best.len) best = { nodo, chiave: k, percorso: p, len };
    const dentro = gruppoPiuGrosso(v, p);
    if (dentro && dentro.len > best.len) best = dentro;
  }
  return best;
}

// `sempre: ['diff']` → `diffFile` e `diffCaratteri` al posto di `diff`; poi, finché la stampa sfora, il
// testo più lungo diventa `[nel file <percorso>, …]` ed entra in `fileEsterni`. `misura(payload)` dà la
// taglia della stampa intera (ruolo compreso); senza, si misura il solo payload.
export function scaricaPayload(payload, { root, base, sempre = [], max = PAYLOAD_IN_STAMPA_MAX, misura } = {}) {
  const taglia = typeof misura === 'function' ? misura : (o) => JSON.stringify(o).length;
  const dir = cartellaConsegna(root, base);
  // Svuotata a ogni consegna: il file lasciato da un ruolo (un feedback, un diff) non deve arrivare al
  // ruolo successivo sulla stessa macchina, che per isolamento non lo deve vedere.
  rmSync(dir, { recursive: true, force: true });
  const out = structuredClone(payload && typeof payload === 'object' ? payload : {});
  let n = 0;
  const scrivi = (nome, testo) => {
    // Solo per chi lavora: dentro c'è il testo di un utente, e la cartella temporanea è di tutti.
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const f = join(dir, `${String(++n).padStart(2, '0')}-${nome.replace(/[^\w.-]+/g, '_')}.txt`);
    writeFileSync(f, testo, { encoding: 'utf8', mode: 0o600 });
    return f;
  };
  for (const k of sempre) {
    if (typeof out[k] !== 'string') continue;
    out[`${k}File`] = scrivi(k, out[k]);
    out[`${k}Caratteri`] = out[k].length;
    delete out[k];
  }
  while (taglia(out) > max) {
    let p = pezzoPiuGrosso(out);
    let json = false;
    if (!p || p.len < PEZZO_MIN) {
      p = gruppoPiuGrosso(out);
      json = true;
    }
    if (!p || p.len < PEZZO_MIN) break;
    const nome = p.percorso.join('.');
    const testo = json ? JSON.stringify(p.nodo[p.chiave], null, 2) : p.nodo[p.chiave];
    const f = scrivi(nome, testo);
    p.nodo[p.chiave] = `[nel file ${f}, ${testo.length} caratteri${json ? ' di JSON' : ''}: leggilo per intero, è il contenuto di questo campo]`;
    out.fileEsterni = { ...(out.fileEsterni || {}), [nome]: f };
  }
  return out;
}
