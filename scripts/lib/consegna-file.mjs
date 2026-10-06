// consegna-file.mjs — i pezzi grossi del payload di dispatch e le immagini escono dalla stampa e vanno,
// interi, in file fuori dal repo. Non tronca mai: la stampa cita il percorso assoluto.
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

// Il server riconosce il tipo dai primi byte (contratto #900); l'estensione fa aprire il file come immagine.
const ESTENSIONE_IMMAGINE = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/bmp': 'bmp' };

// Una voce di `immagini` aperta diventa un file: `file` al posto di `base64`. Fallite e rinviate restano
// com'erano, col loro motivo. Byte diversi da quelli dichiarati sono un'immagine rotta, non da aprire.
export function immagineSuFile(voce, scriviByte) {
  if (!voce || typeof voce !== 'object' || typeof voce.base64 !== 'string') return voce;
  const { base64, ...resto } = voce;
  const byte = Buffer.from(base64, 'base64');
  if (!byte.length) return { ...resto, errore: 'immagine arrivata vuota' };
  if (Number.isFinite(voce.byte) && byte.length !== voce.byte) {
    return { ...resto, errore: `immagine arrivata incompleta (${byte.length} byte invece di ${voce.byte})` };
  }
  // Chi lavora apre le immagini con uno strumento che non legge le bmp: arrivano rifatte png.
  if (voce.tipo === 'image/bmp') {
    let rifatta;
    try { rifatta = bmpInPng(byte); } catch (e) {
      return { ...resto, errore: `immagine bmp che non si apre: ${e.message}` };
    }
    return { ...resto, tipo: 'image/png', byte: rifatta.length, convertitaDa: 'image/bmp', file: scriviByte(`immagine-${voce.id}`, rifatta, 'png') };
  }
  return { ...resto, file: scriviByte(`immagine-${voce.id}`, byte, ESTENSIONE_IMMAGINE[voce.tipo] || 'bin') };
}

function scriviFile(dir, nome, contenuto, est) {
  // Solo per chi lavora: dentro c'è materiale di un utente, e la cartella temporanea è di tutti.
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const f = join(dir, `${nome.replace(/[^\w.-]+/g, '_')}.${est}`);
  writeFileSync(f, contenuto, typeof contenuto === 'string' ? { encoding: 'utf8', mode: 0o600 } : { mode: 0o600 });
  return f;
}

// Un'immagine rinviata chiesta da sola: va accanto alle altre senza svuotare la cartella, che è ancora
// quella della consegna in corso.
export function scriviImmagine(voce, { root, base } = {}) {
  const dir = cartellaConsegna(root, base);
  return immagineSuFile(voce, (nome, byte, est) => scriviFile(dir, nome, byte, est));
}

// Se i file non si possono scrivere, i byte non vanno in stampa (fino a 16 MB): la voce dice il perché.
export function immaginiSenzaByte(payload, motivo) {
  if (!payload || !Array.isArray(payload.immagini)) return payload;
  return {
    ...payload,
    immagini: payload.immagini.map((v) => {
      if (!v || typeof v !== 'object' || typeof v.base64 !== 'string') return v;
      const { base64, ...resto } = v;
      return { ...resto, errore: `immagine non scritta su disco (${motivo})` };
    }),
  };
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
  const scrivi = (nome, contenuto, est = 'txt') => scriviFile(dir, `${String(++n).padStart(2, '0')}-${nome}`, contenuto, est);
  if (Array.isArray(out.immagini)) out.immagini = out.immagini.map((v) => immagineSuFile(v, scrivi));
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
