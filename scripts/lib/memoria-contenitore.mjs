// La memoria che resta ai comandi (#2571): in cloud il tetto vero è il cgroup dei comandi (13,4 GB su 16), non la RAM, e
// MemFree non conta la cache che si libera. La leggono il battito, i controlli prima di partire e la veglia per dire cosa è
// morto. Solo letture. Regole: tests/unit/processoUcciso.test.mjs.

import { readFileSync } from 'node:fs';

const MB = 1048576;
// In v1 «senza tetto» è un numero vicino a 2^63.
const SENZA_TETTO = 2 ** 60;

export function leggiFile(p) {
  try { return readFileSync(p, 'utf8'); } catch (_) { return null; }
}

const numero = (s) => { const t = String(s == null ? '' : s).trim(); const n = t === '' ? NaN : Number(t); return Number.isFinite(n) ? n : NaN; };
const chiave = (testo, nome) => {
  const m = new RegExp(`^${nome}\\s+(\\d+)`, 'm').exec(String(testo || ''));
  return m ? Number(m[1]) : NaN;
};

/** Il cgroup della memoria di questo processo, da /proc/self/cgroup: { v: 1|2, rel } o null. PURA. */
export function cgroupDi(testo) {
  const righe = String(testo || '').split('\n');
  const v1 = righe.map((r) => r.split(':')).find((p) => p.length >= 3 && p[1].split(',').includes('memory'));
  if (v1) return { v: 1, rel: p3(v1) };
  const v2 = righe.map((r) => r.split(':')).find((p) => p.length >= 3 && p[0] === '0' && p[1] === '');
  return v2 ? { v: 2, rel: p3(v2) } : null;
}
function p3(p) { const r = p.slice(2).join(':').trim(); return r === '/' ? '' : r.replace(/\/+$/, ''); }

/** Le cartelle dal cgroup alla radice: un tetto può stare su un genitore. */
function livelli(base, rel) {
  const out = [];
  let r = rel;
  for (;;) {
    out.push(`${base}${r}`);
    if (!r) return out;
    r = r.slice(0, r.lastIndexOf('/'));
  }
}

/**
 * Quando è partito il contenitore, in secondi dall'epoca: avvio del kernel più l'avvio del suo processo 1 (100 tick al
 * secondo). Due letture diverse vogliono dire un contenitore ripartito, e contatori ripartiti da zero. PURA.
 */
export function avvioContenitoreS(leggi = leggiFile) {
  const boot = chiave(leggi('/proc/stat'), 'btime');
  const stat = String(leggi('/proc/1/stat') || '');
  const tick = Number(stat.slice(stat.lastIndexOf(')') + 2).trim().split(/\s+/)[19]);
  return Number.isFinite(boot) && stat && Number.isFinite(tick) ? boot + tick / 100 : NaN;
}

/**
 * La memoria vista dai comandi, in MB: `disponibileMb` è il minimo fra quella del sistema (MemAvailable) e il margine
 * di ogni cgroup con un tetto, al netto della cache che si libera; `usataMb` è dello stesso cgroup di `tettoMb` (senza
 * tetto, di quello dei comandi). `piccoMb` e `uccisioniComandi` sono del cgroup dei comandi, `uccisioniSistema`
 * dell'intera macchina dall'avvio. Senza /proc/self/cgroup vale la radice. Un numero che non si legge resta NaN. PURA.
 */
export function letturaMemoria(leggi = leggiFile) {
  const info = leggi('/proc/meminfo');
  const sistemaMb = chiave(info, 'MemAvailable:') / 1024;
  const totaleMb = chiave(info, 'MemTotal:') / 1024;
  const uccisioniSistema = chiave(leggi('/proc/vmstat'), 'oom_kill');
  const out = { disponibileMb: sistemaMb, totaleMb, tettoMb: NaN, usataMb: NaN, piccoMb: NaN, uccisioniComandi: NaN, uccisioniSistema, avvioS: avvioContenitoreS(leggi) };
  const cg = cgroupDi(leggi('/proc/self/cgroup'))
    || (leggi('/sys/fs/cgroup/memory.current') !== null ? { v: 2, rel: '' } : { v: 1, rel: '' });
  const base = cg.v === 1 ? '/sys/fs/cgroup/memory' : '/sys/fs/cgroup';
  const f = cg.v === 1
    ? { uso: 'memory.usage_in_bytes', tetto: 'memory.limit_in_bytes', picco: 'memory.max_usage_in_bytes', oom: 'memory.oom_control', cache: 'total_inactive_file' }
    : { uso: 'memory.current', tetto: 'memory.max', picco: 'memory.peak', oom: 'memory.events', cache: 'inactive_file' };
  // In un contenitore col proprio spazio dei cgroup il percorso del file non esiste: lì il proprio è la radice.
  const visti = livelli(base, cg.rel).filter((d) => leggi(`${d}/${f.uso}`) !== null);
  if (!visti.length) return arrotonda(out);
  const mio = visti[0];
  const vera = (d) => {
    const cache = chiave(leggi(`${d}/memory.stat`), f.cache);
    return numero(leggi(`${d}/${f.uso}`)) - (Number.isFinite(cache) ? cache : 0);
  };
  out.usataMb = vera(mio) / MB;
  let margine = Infinity;
  for (const d of visti) {
    const tetto = numero(leggi(`${d}/${f.tetto}`));
    if (!Number.isFinite(tetto) || tetto >= SENZA_TETTO) continue;
    const usata = vera(d);
    if (!Number.isFinite(usata)) continue;
    if ((tetto - vera) / MB < margine) {
      margine = (tetto - vera) / MB;
      out.tettoMb = tetto / MB;
      out.usataMb = vera / MB;
    }
  }
  if (Number.isFinite(margine)) out.disponibileMb = Number.isFinite(sistemaMb) ? Math.min(sistemaMb, margine) : margine;
  out.piccoMb = numero(leggi(`${mio}/${f.picco}`)) / MB;
  out.uccisioniComandi = chiave(leggi(`${mio}/${f.oom}`), 'oom_kill');
  return arrotonda(out);
}

function arrotonda(o) {
  const r = {};
  for (const [k, v] of Object.entries(o)) r[k] = Number.isFinite(v) ? Math.max(0, Math.round(v)) : NaN;
  return r;
}

const gb = (mb) => `${(mb / 1024).toFixed(1).replace('.', ',')} GB`;

/**
 * La memoria in una riga, per un guasto o una stampa: solo i numeri letti. `prima` (una lettura precedente) fa contare
 * le uccisioni da allora invece che dall'avvio. PURA.
 */
export function testoMemoria(m, prima = null) {
  if (!m) return 'memoria: non letta';
  const parti = [];
  if (Number.isFinite(m.disponibileMb)) parti.push(`disponibili ${gb(m.disponibileMb)}${Number.isFinite(m.tettoMb) ? ` su un tetto dei comandi di ${gb(m.tettoMb)}` : Number.isFinite(m.totaleMb) ? ` su ${gb(m.totaleMb)}` : ''}`);
  if (Number.isFinite(m.piccoMb)) parti.push(`picco dei comandi ${gb(m.piccoMb)}`);
  const da = (k) => (prima && Number.isFinite(prima[k]) && Number.isFinite(m[k]) ? m[k] - prima[k] : m[k]);
  const cosa = prima ? 'da allora' : 'dall\'avvio';
  const uc = da('uccisioniComandi');
  const us = da('uccisioniSistema');
  if (Number.isFinite(uc) || Number.isFinite(us)) {
    parti.push(`processi uccisi per memoria ${cosa}: ${[Number.isFinite(us) ? `${us} nella macchina` : '', Number.isFinite(uc) ? `${uc} fra i comandi` : ''].filter(Boolean).join(', ')}`);
  }
  return parti.length ? `memoria: ${parti.join('; ')}` : 'memoria: non letta';
}

/** Ci sono state uccisioni per memoria fra `prima` e `dopo`? null se non si sa. PURA. */
export function uccisiPerMemoria(dopo, prima = null) {
  const conta = (k) => (dopo && Number.isFinite(dopo[k]) ? dopo[k] - (prima && Number.isFinite(prima[k]) ? prima[k] : 0) : NaN);
  const n = [conta('uccisioniSistema'), conta('uccisioniComandi')].filter(Number.isFinite);
  return n.length ? n.some((x) => x > 0) : null;
}
