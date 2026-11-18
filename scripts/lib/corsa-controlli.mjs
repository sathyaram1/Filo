// Il segno di finish:check in corso, nella cartella git (#2571): ucciso con SIGKILL (exit 137) non lo toglie, e chi viene
// dopo (aspetta, la veglia, il lancio seguente) sa cosa è morto, in che fase e con quanta memoria. Non decide niente.
// Regole: tests/unit/corsaControlli.test.mjs.

import { readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { constants } from 'node:os';
import { resolve } from 'node:path';
import { gitIn } from './branch-integrity.mjs';
import { leggiFile, letturaMemoria, testoMemoria, uccisiPerMemoria } from './memoria-contenitore.mjs';

export const FILE_CORSA = 'filo-controlli-in-corso.json';
export const CODICE_SIGKILL = 137;
const SEGNALI = ['SIGTERM', 'SIGINT', 'SIGHUP'];

export function fileCorsa(root) {
  const r = gitIn(root)(['rev-parse', '--git-path', FILE_CORSA]);
  return r.ok && r.out ? resolve(root, r.out) : '';
}

/**
 * Apre il segno della corsa: `fase(nome)` lo aggiorna, l'uscita normale lo toglie. Un segnale che node vede (TERM, INT,
 * HUP) lo lascia con il suo nome: così un segno senza segnale e col processo morto vuol dire SIGKILL.
 */
export function apriCorsa(root, { sha = '', proc = process, ora = () => new Date().toISOString(), memoria = letturaMemoria } = {}) {
  const file = fileCorsa(root);
  const segno = { pid: proc.pid, sha, inizio: ora(), fase: 'avvio', faseDa: ora(), memoria: memoria() };
  let tieni = false;
  const scrivi = () => { if (file) { try { writeFileSync(file, `${JSON.stringify(segno)}\n`); } catch (_) { /* il segno è un aiuto, non un controllo */ } } };
  scrivi();
  proc.on('exit', () => { if (!tieni && file) { try { unlinkSync(file); } catch (_) { /* già tolto */ } } });
  for (const s of SEGNALI) {
    try {
      proc.on(s, () => { segno.segnale = s; tieni = true; scrivi(); proc.exit(128 + (constants.signals[s] || 0)); });
    } catch (_) { /* segnale che questa piattaforma non ha */ }
  }
  return {
    file,
    fase(nome) { segno.fase = String(nome || ''); segno.faseDa = ora(); scrivi(); },
  };
}

/** Il processo `pid` è vivo ed è ancora finish:check (dopo un riavvio il numero può essere di un altro). */
export function corsaViva(pid, leggi = leggiFile) {
  try { process.kill(pid, 0); } catch (e) { return !!(e && e.code === 'EPERM'); }
  const cmd = leggi(`/proc/${pid}/cmdline`);
  return cmd === null ? true : /finish-local/.test(cmd);
}

/** Il segno di una corsa morta senza finire, o null (nessun segno, o la corsa vive ancora). */
export function corsaInterrotta(root, { file = fileCorsa(root), viva = corsaViva } = {}) {
  if (!file) return null;
  let s = null;
  try { s = JSON.parse(readFileSync(file, 'utf8')); } catch (_) { return null; }
  if (!s || typeof s !== 'object' || !Number.isInteger(s.pid)) return null;
  return viva(s.pid) ? null : s;
}

/** L'uscita di una corsa interrotta: quella del segnale che ha visto, 137 senza (nessun segnale arriva da SIGKILL). PURA. */
export function codiceDellaCorsa(segno) {
  const n = segno && segno.segnale ? constants.signals[segno.segnale] : NaN;
  return Number.isFinite(n) ? 128 + n : CODICE_SIGKILL;
}

const ora = (iso) => { const ms = Date.parse(String(iso || '')); return Number.isFinite(ms) ? `${new Date(ms).toISOString().slice(11, 16)} UTC` : 'ora ignota'; };
const pulito = (t) => String(t || '').replace(/\\/g, '/').replace(/["`$]/g, "'").replace(/\s+/g, ' ').trim();

/**
 * Il guasto di un processo ucciso, col gruppo davanti (`guasto: strumento <programma>`): `cosa` è quello che girava,
 * `codice` l'uscita (NaN se non si sa), `memoria` la lettura di adesso e `prima` quella di quando è partito. PURA.
 */
export function testoUcciso({ programma = 'worker', cosa = '', codice = NaN, memoria = null, prima = null, coda = '' } = {}) {
  const nome = String(programma || 'worker').toLowerCase().replace(/[^a-z0-9._-]/g, '') || 'worker';
  const perMemoria = uccisiPerMemoria(memoria, prima);
  const causa = perMemoria === true ? 'il kernel ha ucciso processi per memoria'
    : perMemoria === false ? 'nessun processo ucciso per memoria: un riavvio del contenitore o un tetto dell\'harness'
      : 'causa non leggibile';
  const parti = [
    `guasto: strumento ${nome}: processo ucciso${Number.isFinite(codice) ? ` (${codice})` : ''}${cosa ? ` durante ${pulito(cosa)}` : ''}`,
    `${causa}; ${testoMemoria(memoria, prima)}.`,
  ];
  return pulito(`${parti.join(': ')}${coda ? ` ${coda}` : ''}`);
}

/** Il guasto di una corsa di finish:check morta senza finire. PURA. */
export function guastoDellaCorsa(segno, memoria, coda = '') {
  const cosa = `finish:check (fase ${pulito(segno.fase) || 'ignota'} dalle ${ora(segno.faseDa)}, partito alle ${ora(segno.inizio)} su ${String(segno.sha || '').slice(0, 8) || 'commit ignoto'})`;
  return testoUcciso({ programma: 'finish-check', cosa, codice: codiceDellaCorsa(segno), memoria, prima: segno.memoria || null, coda });
}

/** Cosa fa il worker che trova la sua corsa morta: rilanciarla una volta, poi il guasto già scritto. PURA. */
export function testoPerIlWorker(segno, memoria) {
  return `La corsa di finish:check è morta senza finire: ${guastoDellaCorsa(segno, memoria).replace(/^guasto: strumento finish-check: /, '')}\n`
    + 'Rilanciala una volta, in sottofondo: gli spec già verdi su questo contenuto non si rifanno. Se muore di nuovo, non insistere: '
    + `rilascia col guasto, così:\n  --guasto "${guastoDellaCorsa(segno, memoria)}"`;
}
