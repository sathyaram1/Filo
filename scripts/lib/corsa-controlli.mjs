// Il segno di finish:check in corso, nella cartella git (#2571): una corsa interrotta non lo toglie, e chi viene dopo sul
// suo ramo (aspetta, la veglia, il lancio seguente) sa cosa si è fermato, in che fase, con quanta memoria e se la sessione
// è ripartita. Il segno non sa con quale segnale: niente numeri d'uscita. Regole: tests/unit/processoUcciso.test.mjs.

import { readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { gitIn } from './branch-integrity.mjs';
import { leggiFile, letturaMemoria, ripartito, testoMemoria, uccisiPerMemoria } from './memoria-contenitore.mjs';

export const FILE_CORSA = 'filo-controlli-in-corso.json';

// Un guasto finisce fra virgolette doppie in una riga di comando e nelle note: una riga, senza virgolette, apici
// inversi, dollari. Lo usano anche i testi della veglia: una copia sola.
export const pulito = (t) => String(t || '').replace(/\\/g, '/').replace(/["`$]/g, "'").replace(/\s+/g, ' ').trim();
/** Un'ora del guasto, da millisecondi o da una data ISO: sempre nella stessa forma. PURA. */
export const oraUtc = (t) => {
  const ms = typeof t === 'number' ? t : Date.parse(String(t || ''));
  return Number.isFinite(ms) ? `${new Date(ms).toISOString().slice(11, 19)} UTC` : 'ora ignota';
};

export function fileCorsa(root) {
  const r = gitIn(root)(['rev-parse', '--git-path', FILE_CORSA]);
  return r.ok && r.out ? resolve(root, r.out) : '';
}

function ramoDi(root) {
  const r = gitIn(root)(['rev-parse', '--abbrev-ref', 'HEAD']);
  return r.ok ? r.out : '';
}

/**
 * Apre il segno della corsa: `fase(nome)` lo aggiorna, l'uscita normale lo toglie, `bilancio()` dice la memoria da
 * quando è partita. I segnali non si intercettano: durante una prova lanciata in modo sincrono il gestore non girerebbe
 * fino alla sua fine, e la corsa fermata andrebbe avanti; un segno col processo morto dice già «interrotta».
 */
export function apriCorsa(root, { sha = '', ramo = ramoDi(root), proc = process, ora = () => new Date().toISOString(), memoria = letturaMemoria } = {}) {
  const file = fileCorsa(root);
  const segno = { pid: proc.pid, sha, ramo, inizio: ora(), fase: 'avvio', faseDa: ora(), memoria: memoria() };
  const scrivi = () => { if (file) { try { writeFileSync(file, `${JSON.stringify(segno)}\n`); } catch (_) { /* il segno è un aiuto, non un controllo */ } } };
  scrivi();
  proc.on('exit', () => { if (file) { try { unlinkSync(file); } catch (_) { /* già tolto */ } } });
  return {
    file,
    fase(nome) { segno.fase = String(nome || ''); segno.faseDa = ora(); scrivi(); },
    bilancio: () => testoMemoria(memoria(), segno.memoria),
  };
}

/** Il processo `pid` è vivo ed è ancora finish:check (dopo un riavvio il numero può essere di un altro). */
export function corsaViva(pid, leggi = leggiFile) {
  try { process.kill(pid, 0); } catch (e) { return !!(e && e.code === 'EPERM'); }
  const cmd = leggi(`/proc/${pid}/cmdline`);
  return cmd === null ? true : /finish-local/.test(cmd);
}

/**
 * Il segno di una corsa morta senza finire, o null: nessun segno, la corsa vive ancora, o è di un altro ramo (il clone
 * passa da un lavoro all'altro, e il segno di quello prima non è del worker di adesso).
 */
export function corsaInterrotta(root, { file = fileCorsa(root), viva = corsaViva, ramo = () => ramoDi(root) } = {}) {
  if (!file) return null;
  let s = null;
  try { s = JSON.parse(readFileSync(file, 'utf8')); } catch (_) { return null; }
  if (!s || typeof s !== 'object' || !Number.isInteger(s.pid)) return null;
  if (s.ramo && s.ramo !== ramo()) return null;
  return viva(s.pid) ? null : s;
}

/** L'uscita di una corsa interrotta: 137, il colpo che in cloud lascia il segno senza processo. PURA. */
export function codiceDellaCorsa() {
  return CODICE_SIGKILL;
}

/** Il contenitore è ripartito dopo `daMs`, o fra `prima` e `memoria`? PURA. */
function contenitoreRipartito(memoria, prima, daMs) {
  const avvio = memoria && memoria.avvioS;
  if (!Number.isFinite(avvio)) return false;
  if (prima && Number.isFinite(prima.avvioS)) return Math.abs(avvio - prima.avvioS) > 5;
  return Number.isFinite(daMs) && avvio * 1000 > daMs + 5000;
}

/** Perché è morto, per quanto si legge: memoria, ripartenza del contenitore o dei comandi, o un colpo da fuori. PURA. */
function causaDellUccisione(memoria, prima, daMs) {
  if (contenitoreRipartito(memoria, prima, daMs)) {
    return `il contenitore è ripartito alle ${oraUtc(memoria.avvioS * 1000)}, dopo la partenza: i contatori della memoria ripartono da zero e non dicono se prima è stata la memoria`;
  }
  if (ripartito(memoria, prima)) return 'i contatori delle uccisioni per memoria sono tornati indietro (i comandi sono ripartiti): non dicono se è stata la memoria';
  const perMemoria = uccisiPerMemoria(memoria, prima);
  if (perMemoria === true) return 'il kernel ha ucciso processi per memoria';
  if (perMemoria === null) return 'causa non leggibile';
  const avvioNoto = memoria && Number.isFinite(memoria.avvioS) && ((prima && Number.isFinite(prima.avvioS)) || Number.isFinite(daMs));
  return avvioNoto
    ? 'nessun processo ucciso per memoria e il contenitore non è ripartito, quindi un colpo da fuori dei comandi (la sessione o l\'harness)'
    : 'nessun processo ucciso per memoria, quindi un colpo da fuori dei comandi (la sessione, l\'harness o un riavvio del contenitore)';
}

/**
 * Il guasto di un processo ucciso, col gruppo davanti (`guasto: strumento <programma>`): `cosa` è quello che girava,
 * `codice` l'uscita (NaN se non si sa), `memoria` la lettura di adesso, `prima` quella di quando è partito e `daMs`
 * quando è partito, se la lettura di allora manca. PURA.
 */
export function testoUcciso({ programma = 'worker', cosa = '', codice = NaN, memoria = null, prima = null, daMs = NaN, coda = '' } = {}) {
  const nome = String(programma || 'worker').toLowerCase().replace(/[^a-z0-9._-]/g, '') || 'worker';
  const parti = [
    `guasto: strumento ${nome}: processo ucciso${Number.isFinite(codice) ? ` (${codice})` : ''}${cosa ? ` durante ${pulito(cosa)}` : ''}`,
    `${causaDellUccisione(memoria, prima, daMs)}; ${testoMemoria(memoria, prima)}.`,
  ];
  return pulito(`${parti.join(': ')}${coda ? ` ${coda}` : ''}`);
}

/** Il guasto di una corsa di finish:check morta senza finire. PURA. */
export function guastoDellaCorsa(segno, memoria, coda = '') {
  const cosa = `finish:check (fase ${pulito(segno.fase) || 'ignota'} dalle ${oraUtc(segno.faseDa)}, partito alle ${oraUtc(segno.inizio)} su ${String(segno.sha || '').slice(0, 8) || 'commit ignoto'})`;
  return testoUcciso({
    programma: 'finish-check', cosa, codice: codiceDellaCorsa(segno), memoria, prima: segno.memoria || null, daMs: Date.parse(String(segno.inizio || '')), coda,
  });
}

/** Cosa fa il worker che trova la sua corsa morta: rilanciarla una volta, poi il guasto già scritto. PURA. */
export function testoPerIlWorker(segno, memoria) {
  return `La corsa di finish:check è morta senza finire: ${guastoDellaCorsa(segno, memoria).replace(/^guasto: strumento finish-check: /, '')}\n`
    + 'Rilanciala una volta, in sottofondo: gli spec già verdi su questo contenuto non si rifanno. Se muore di nuovo, non insistere: '
    + `rilascia col guasto, così:\n  --guasto "${guastoDellaCorsa(segno, memoria)}"`;
}
