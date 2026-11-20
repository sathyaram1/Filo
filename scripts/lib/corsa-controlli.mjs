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

// Due avvii più vicini di così sono lo stesso: i tick di /proc e l'arrotondamento al secondo.
const SCARTO_MS = 5000;

/** Il contenitore è ripartito dopo `daMs`, o fra `prima` e `memoria`? PURA. */
function contenitoreRipartito(memoria, prima, daMs) {
  const avvio = memoria && memoria.avvioS;
  if (!Number.isFinite(avvio)) return false;
  if (prima && Number.isFinite(prima.avvioS)) return Math.abs(avvio - prima.avvioS) * 1000 > SCARTO_MS;
  return Number.isFinite(daMs) && avvio * 1000 > daMs + SCARTO_MS;
}

/**
 * La sessione di Claude Code che ospitava il processo (#2571.1): 'ripartita' (epoca del lavoratore cresciuta, o il
 * Claude Code di adesso nato dopo la partenza), 'stessa' (lo stesso processo, nato prima), '' se non si sa (fuori da
 * Claude Code, o chi legge è un'altra sessione). PURA.
 */
export function sessioneDellaCorsa(memoria, prima, daMs) {
  if (!memoria) return '';
  const { epoca, claudePid: pid, claudeAvvioS: avvio } = memoria;
  if (prima && Number.isFinite(prima.epoca) && Number.isFinite(epoca) && epoca > prima.epoca) return 'ripartita';
  if (Number.isFinite(avvio) && Number.isFinite(daMs) && avvio * 1000 > daMs + SCARTO_MS) return 'ripartita';
  if (!Number.isFinite(pid)) return '';
  if (prima && Number.isFinite(prima.claudePid)) return prima.claudePid === pid ? 'stessa' : '';
  return Number.isFinite(avvio) && Number.isFinite(daMs) ? 'stessa' : '';
}

const STESSA = 'la sessione di Claude Code che l\'ha lanciato è la stessa, ancora viva: l\'ha fermato lei (lo strumento che ferma i comandi, il tempo massimo del comando, un sotto-agente fermato o interrotto) o un colpo mirato al processo';

/** Perché si è fermato, per quanto si legge: ripartenze del contenitore, della sessione o dei comandi, memoria. PURA. */
function causaDellUccisione(memoria, prima, daMs) {
  if (contenitoreRipartito(memoria, prima, daMs)) {
    return `il contenitore è ripartito alle ${oraUtc(memoria.avvioS * 1000)}, dopo la partenza: i contatori della memoria ripartono da zero e non dicono se prima è stata la memoria`;
  }
  const sessione = sessioneDellaCorsa(memoria, prima, daMs);
  const contatori = ripartito(memoria, prima);
  const perMemoria = contatori ? null : uccisiPerMemoria(memoria, prima);
  if (sessione === 'ripartita') {
    const ora = Number.isFinite(memoria.claudeAvvioS) ? ` alle ${oraUtc(memoria.claudeAvvioS * 1000)}` : '';
    const epoca = prima && Number.isFinite(prima.epoca) && Number.isFinite(memoria.epoca) && memoria.epoca !== prima.epoca ? ` (epoca del lavoratore da ${prima.epoca} a ${memoria.epoca})` : '';
    return `la sessione di Claude Code è ripartita${ora}${epoca}, dopo la partenza: con lei muoiono tutti i suoi comandi e i suoi sotto-agenti${perMemoria === true ? '; prima il kernel aveva ucciso processi per memoria' : ''}`;
  }
  if (contatori) return 'i contatori delle uccisioni per memoria sono tornati indietro (i comandi sono ripartiti): non dicono se è stata la memoria';
  if (perMemoria === true) return 'il kernel ha ucciso processi per memoria';
  if (perMemoria === null) return sessione === 'stessa' ? `memoria non leggibile; ${STESSA}` : 'causa non leggibile (fermato a mano, al tempo massimo del comando o da un colpo da fuori)';
  if (sessione === 'stessa') return `nessun processo ucciso per memoria e ${STESSA}`;
  const avvioNoto = memoria && Number.isFinite(memoria.avvioS) && ((prima && Number.isFinite(prima.avvioS)) || Number.isFinite(daMs));
  return avvioNoto
    ? 'nessun processo ucciso per memoria e il contenitore non è ripartito: fermato da chi l\'ha lanciato (a mano, o al tempo massimo del comando) o da un colpo da fuori dei comandi (la sessione o l\'harness)'
    : 'nessun processo ucciso per memoria: fermato da chi l\'ha lanciato (a mano, o al tempo massimo del comando) o da un colpo da fuori dei comandi (la sessione, l\'harness o un riavvio del contenitore)';
}

function guasto(programma, titolo, { memoria = null, prima = null, daMs = NaN, coda = '' } = {}) {
  const nome = String(programma || 'worker').toLowerCase().replace(/[^a-z0-9._-]/g, '') || 'worker';
  return pulito(`guasto: strumento ${nome}: ${titolo}: ${causaDellUccisione(memoria, prima, daMs)}; ${testoMemoria(memoria, prima)}.${coda ? ` ${coda}` : ''}`);
}

/**
 * Il guasto di un processo fermato, col gruppo davanti (`guasto: strumento <programma>`): `cosa` è quello che girava,
 * `codice` l'uscita letta dal risultato dello strumento (NaN se non si sa: allora niente numero), `memoria` la lettura
 * di adesso, `prima` quella di quando è partito e `daMs` quando è partito, se la lettura di allora manca. PURA.
 */
export function testoUcciso({ programma = 'worker', cosa = '', codice = NaN, memoria = null, prima = null, daMs = NaN, coda = '' } = {}) {
  const titolo = `${Number.isFinite(codice) ? `processo ucciso (${codice})` : 'processo interrotto'}${cosa ? ` durante ${pulito(cosa)}` : ''}`;
  return guasto(programma, titolo, { memoria, prima, daMs, coda });
}

const doveDellaCorsa = (segno) => `fase ${pulito(segno.fase) || 'ignota'} dalle ${oraUtc(segno.faseDa)}, partito alle ${oraUtc(segno.inizio)} su ${String(segno.sha || '').slice(0, 8) || 'commit ignoto'}`;
export const PREFISSO_CORSA = 'guasto: strumento finish-check: ';
const TITOLO_CORSA = 'finish:check interrotto senza finire ';

/** Il guasto di una corsa di finish:check rimasta a metà: interrotta, mai un numero che il segno non sa. PURA. */
export function guastoDellaCorsa(segno, memoria, coda = '') {
  return guasto('finish-check', `${TITOLO_CORSA}(${doveDellaCorsa(segno)})`, {
    memoria, prima: segno.memoria || null, daMs: Date.parse(String(segno.inizio || '')), coda,
  });
}

/**
 * Cosa fa il worker che trova la sua corsa interrotta: niente, se l'ha fermata lui; col tetto più largo, se l'ha fermata
 * il tempo massimo; altrimenti rilanciarla una volta, poi il guasto già scritto. PURA.
 */
export function testoPerIlWorker(segno, memoria) {
  const g = guastoDellaCorsa(segno, memoria);
  return `La corsa di finish:check si è interrotta senza finire ${g.slice(PREFISSO_CORSA.length + TITOLO_CORSA.length)}\n`
    + 'Se l\'hai fermata tu (lo strumento che ferma i comandi in sottofondo, Ctrl+C) non è un guasto: rilanciala solo se ti serve ancora. '
    + 'Se l\'ha fermata il tempo massimo del comando, rilanciala in sottofondo col tetto più largo.\n'
    + 'Altrimenti rilanciala una volta, in sottofondo: gli spec già verdi su questo contenuto non si rifanno. Se si interrompe di nuovo, non insistere: '
    + `rilascia col guasto, così:\n  --guasto "${g}"`;
}
