#!/usr/bin/env node
// Misura di K (SPEC-DOMANDE.md §12.2, #1157): quanti worker reggono insieme, `finish:check` in un clone ciascuno. Dati
// e log solo in <tmpdir>/filo-k/, mai nel repo; i clone spediscono su un repo nudo locale, mai su GitHub. Prove: misuraK.
//   node scripts/misura-k.mjs [--corse 1,1,2,3,4] [--comando "npm run finish:check"] [--ramo <ref>] [--tieni]

import { spawn, spawnSync } from 'node:child_process';
import { appendFileSync, createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { allineaPacchetti, preparaClone, togliClone } from './lib/clone-worker.mjs';
import { pinnedRepoRoot, TOOLS_ROOT } from './lib/tools-pin.mjs';
import { memoriaContenitore, statoContenitore } from './routine-channel.mjs';

export const SOGLIE = Object.freeze({ memoria: 0.85, tempo: 1.5 });
export const CORSE_PREDEFINITE = Object.freeze([1, 1, 2, 3, 4]);
export const CAMPIONE_MS = 5000;

const INFRASTRUTTURA = [
  ['xvfb', /Xvfb failed to start|xvfb-run: error|Cannot open display/i],
  ['porta', /EADDRINUSE/],
  ['lock', /index\.lock|cannot lock ref|Unable to create '.*\.lock'/i],
  ['disco', /ENOSPC|No space left on device/i],
  ['ucciso', /\bKilled\b|exit code 137|SIGKILL|out of memory/i],
  ['avvio', /Process failed to launch|0xC0000142/i],
];

/** I nomi delle famiglie d'errore d'infrastruttura trovate in un log. PURA. */
export function erroriInfrastruttura(testo) {
  const t = String(testo || '');
  return INFRASTRUTTURA.filter(([, re]) => re.test(t)).map(([nome]) => nome);
}

/** I file di prova rossi di un log di `finish:check` (Playwright e riepilogo degli unit), senza doppioni. PURA. */
export function estraiRossi(testo) {
  const rossi = new Set();
  for (const riga of String(testo || '').split(/\r?\n/)) {
    if (!/(✘|✖|×|^\s*\d+\)\s)/.test(riga)) continue;
    const m = riga.match(/tests\/[\w./ -]+?\.(?:spec|test)\.mjs/);
    if (m) rossi.add(m[0]);
  }
  return [...rossi].sort();
}

/** `some avg10=1.23 …` di /proc/pressure/*: la media su 10 s della riga `some`, o null. PURA. */
export function pressione(testo) {
  const m = String(testo || '').match(/^some\b.*?\bavg10=([\d.]+)/m);
  return m ? Number(m[1]) : null;
}

/** CPU concesse dal cgroup (`cpu.max`: "200000 100000" = 2), null senza tetto. PURA. */
export function cpuDelCgroup(testo) {
  const [quota, periodo] = String(testo || '').trim().split(/\s+/);
  const q = Number(quota); const p = Number(periodo);
  return Number.isFinite(q) && Number.isFinite(p) && p > 0 ? q / p : null;
}

/** I rossi noti dei due elenchi di tests/rossi-noti.json, come nomi di file. PURA. */
export function rossiNotiDa(json) {
  const nome = (x) => (typeof x === 'string' ? x : String((x && (x.spec || x.file)) || ''));
  const j = json || {};
  return [...(j.specs || []), ...((j.contenitore && j.contenitore.specs) || [])].map(nome).filter(Boolean);
}

const media = (v) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : NaN);

/** La base: le corse con un worker solo (durata media, rossi di almeno una). null senza corse da uno. PURA. */
export function baseDa(corse) {
  const uno = corse.filter((c) => c.n === 1);
  if (!uno.length) return null;
  return {
    durataMs: media(uno.flatMap((c) => c.durateMs)),
    rossi: [...new Set(uno.flatMap((c) => c.rossi))].sort(),
    infra: [...new Set(uno.flatMap((c) => c.infra))],
  };
}

/** Una corsa contro le soglie: `{ ok, motivi, rossiInPiu, durataMs }`. PURA. */
export function valutaCorsa(corsa, base, { rossiNoti = [], soglie = SOGLIE } = {}) {
  const motivi = [];
  const noti = new Set([...(base ? base.rossi : []), ...rossiNoti]);
  const rossiInPiu = corsa.rossi.filter((r) => !noti.has(r));
  const durataMs = media(corsa.durateMs);
  if (rossiInPiu.length) motivi.push(`rossi in più: ${rossiInPiu.join(', ')}`);
  if (corsa.infra.length) motivi.push(`infrastruttura: ${corsa.infra.join(', ')}`);
  if (corsa.tettoMb > 0 && corsa.piccoMb >= soglie.memoria * corsa.tettoMb) {
    motivi.push(`memoria ${Math.round(corsa.piccoMb)}/${Math.round(corsa.tettoMb)} MB oltre il ${Math.round(soglie.memoria * 100)}%`);
  }
  if (base && corsa.n > 1 && durataMs > soglie.tempo * base.durataMs) {
    motivi.push(`tempo ${(durataMs / base.durataMs).toFixed(2)}× quello di uno solo`);
  }
  return { ok: !motivi.length, motivi, rossiInPiu, durataMs };
}

/**
 * K dalle corse: il più grande N che rispetta le soglie salendo da 1 senza buchi (un N che passa sopra uno che cade è
 * rumore). `{ k, motivo }`; k null se la base stessa non regge. PURA.
 */
export function calcolaK(corse, { rossiNoti = [], soglie = SOGLIE } = {}) {
  const base = baseDa(corse);
  if (!base) return { k: null, motivo: 'nessuna corsa con un worker solo: manca la base' };
  if (base.infra.length) return { k: null, motivo: `la base ha errori d'infrastruttura (${base.infra.join(', ')}): misura da rifare` };
  const tetto = corse.filter((c) => c.n === 1).find((c) => c.tettoMb > 0 && c.piccoMb >= soglie.memoria * c.tettoMb);
  if (tetto) return { k: null, motivo: 'già un worker solo supera la soglia di memoria' };
  let k = 1;
  for (const n of [...new Set(corse.map((c) => c.n))].filter((x) => x > 1).sort((a, b) => a - b)) {
    const cadute = corse.filter((c) => c.n === n).map((c) => valutaCorsa(c, base, { rossiNoti, soglie })).filter((v) => !v.ok);
    if (cadute.length) return { k, motivo: `con ${n} insieme: ${cadute[0].motivi.join('; ')}` };
    k = n;
  }
  return { k, motivo: '' };
}

/** La tabella finale, una riga per corsa. PURA. */
export function tabella(corse, { rossiNoti = [], soglie = SOGLIE } = {}) {
  const base = baseDa(corse);
  const righe = ['N | durata media | lavori/ora | picco/tetto MB | carico max | PSI cpu/mem | rossi in più | infrastruttura | esito'];
  for (const c of corse) {
    const v = valutaCorsa(c, base, { rossiNoti, soglie });
    const min = (v.durataMs / 60000).toFixed(1);
    const ora = (c.n * 3600000 / v.durataMs).toFixed(1);
    const mem = `${Math.round(c.piccoMb || 0)}/${c.tettoMb ? Math.round(c.tettoMb) : '—'}`;
    const psi = `${c.psiCpu ?? '—'}/${c.psiMem ?? '—'}`;
    righe.push([c.n, `${min} min`, ora, mem, c.caricoMax ?? '—', psi, v.rossiInPiu.length, c.infra.join(',') || '—', v.ok ? 'ok' : v.motivi.join('; ')].join(' | '));
  }
  return righe.join('\n');
}

// ─── CLI ─────────────────────────────────────────────────────────────────────

const leggi = (p) => { try { return readFileSync(p, 'utf8'); } catch (_) { return null; } };

function campione() {
  const memPeak = Number(leggi('/sys/fs/cgroup/memory.peak'));
  const mb = 1048576;
  // Usata e tetto del cgroup; fuori da un contenitore, quelli della macchina.
  const cg = memoriaContenitore();
  return {
    t: Date.now(),
    ...statoContenitore(),
    usataMb: Math.round(cg ? cg.usedMb : (os.totalmem() - os.freemem()) / mb),
    tettoMb: Math.round(cg && cg.limitMb > 0 ? cg.limitMb : os.totalmem() / mb),
    memoryPeakMb: Number.isFinite(memPeak) ? Math.round(memPeak / 1048576) : null,
    psiCpu: pressione(leggi('/proc/pressure/cpu')),
    psiMem: pressione(leggi('/proc/pressure/memory')),
    nproc: typeof os.availableParallelism === 'function' ? os.availableParallelism() : os.cpus().length,
    cpuMax: cpuDelCgroup(leggi('/sys/fs/cgroup/cpu.max')),
  };
}

function opzione(args, nome, predefinito = '') {
  const i = args.indexOf(nome);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : predefinito;
}

function lancia(comando, cwd, env, log) {
  return new Promise((ok) => {
    const inizio = Date.now();
    const out = createWriteStream(log);
    const c = spawn(comando, { cwd, env, shell: true });
    c.stdout.pipe(out, { end: false });
    c.stderr.pipe(out, { end: false });
    c.on('error', (e) => { out.end(`\n[misura-k] non partito: ${e.message}\n`); ok({ codice: 1, durataMs: Date.now() - inizio }); });
    c.on('close', (codice, segnale) => {
      out.end(`\n[misura-k] uscita ${codice}${segnale ? ` segnale ${segnale}` : ''}\n`, () => ok({ codice: codice ?? 137, durataMs: Date.now() - inizio }));
    });
  });
}

async function main() {
  const args = process.argv.slice(2);
  const corseN = opzione(args, '--corse', CORSE_PREDEFINITE.join(',')).split(',').map(Number).filter((n) => Number.isInteger(n) && n > 0);
  const comando = opzione(args, '--comando', 'npm run finish:check');
  const ramo = opzione(args, '--ramo', 'origin/main');
  const tieni = args.includes('--tieni');
  const principale = process.env.FILO_REPO_ROOT ? resolve(process.env.FILO_REPO_ROOT)
    : (pinnedRepoRoot() || resolve(fileURLToPath(new URL('..', import.meta.url))));
  const dir = resolve(opzione(args, '--base', join(os.tmpdir(), 'filo-k', new Date().toISOString().replace(/[:.]/g, '-'))));
  mkdirSync(dir, { recursive: true });
  const nudo = join(dir, 'nudo.git');
  if (!existsSync(nudo)) spawnSync('git', ['init', '--bare', '-q', nudo]);
  const campioni = join(dir, 'campioni.jsonl');
  const rossiNoti = rossiNotiDa(JSON.parse(leggi(join(principale, 'tests', 'rossi-noti.json')) || '{}'));
  console.log(`[misura-k] corse ${corseN.join(', ')} · comando «${comando}» · ramo ${ramo} · dati in ${dir}`);

  const corse = [];
  for (const [r, n] of corseN.entries()) {
    const cartella = join(dir, `corsa-${r + 1}-n${n}`);
    mkdirSync(cartella, { recursive: true });
    const cloni = [];
    for (let i = 1; i <= n; i++) {
      const p = preparaClone(principale, i, { dest: join(cartella, `clone-${i}`), paralleli: n, pushUrl: nudo, strumentiDa: TOOLS_ROOT, basePin: join(dir, 'strumenti') });
      if (!p.ok) { console.error(`[misura-k] clone ${i} della corsa ${r + 1} non pronto: ${p.why}`); process.exitCode = 1; return; }
      const c = spawnSync('git', ['checkout', '-q', '-B', 'misura-k', ramo], { cwd: p.dir, encoding: 'utf8' });
      if (c.status !== 0) { console.error(`[misura-k] ${ramo} non si apre nel clone: ${String(c.stderr).trim()}`); process.exitCode = 1; return; }
      const pk = allineaPacchetti(p.dir, principale);
      if (!pk.ok) { console.error(`[misura-k] pacchetti del clone ${i}: ${pk.why}`); process.exitCode = 1; return; }
      cloni.push(p.dir);
    }
    console.log(`[misura-k] corsa ${r + 1}: ${n} insieme`);
    const prelievi = [];
    const preleva = () => { const s = { corsa: r + 1, n, ...campione() }; prelievi.push(s); appendFileSync(campioni, `${JSON.stringify(s)}\n`); };
    preleva();
    const timer = setInterval(preleva, CAMPIONE_MS);
    const esiti = await Promise.all(cloni.map((clone, k) => lancia(comando, clone, {
      ...process.env, FILO_WORKER: String(k + 1), FILO_WORKER_PARALLELI: String(n), FILO_NO_BEAT: '1', FILO_REPO_ROOT: clone,
    }, join(cartella, `worker-${k + 1}.log`))));
    clearInterval(timer);
    preleva();
    const logs = cloni.map((_, k) => leggi(join(cartella, `worker-${k + 1}.log`)) || '');
    const max = (campo) => { const v = prelievi.map((s) => s[campo]).filter(Number.isFinite); return v.length ? Math.max(...v) : null; };
    const corsa = {
      n,
      durateMs: esiti.map((e) => e.durataMs),
      codici: esiti.map((e) => e.codice),
      rossi: [...new Set(logs.flatMap(estraiRossi))].sort(),
      infra: [...new Set(logs.flatMap(erroriInfrastruttura))],
      piccoMb: max('usataMb') || 0,
      tettoMb: max('tettoMb') || 0,
      caricoMax: max('loadAvg'),
      psiCpu: max('psiCpu'),
      psiMem: max('psiMem'),
    };
    corse.push(corsa);
    writeFileSync(join(dir, 'risultati.json'), `${JSON.stringify({ corse, comando, ramo }, null, 2)}\n`);
    console.log(`[misura-k] corsa ${r + 1} finita: uscite ${corsa.codici.join(',')}, rossi ${corsa.rossi.length}, infrastruttura ${corsa.infra.join(',') || 'niente'}`);
    if (!tieni) for (let i = 1; i <= n; i++) togliClone(principale, i, { dest: join(cartella, `clone-${i}`), basePin: join(dir, 'strumenti') });
  }

  const { k, motivo } = calcolaK(corse, { rossiNoti });
  console.log(`\n${tabella(corse, { rossiNoti })}\n`);
  console.log(`[misura-k] K = ${k === null ? 'non misurabile' : k}${motivo ? ` (${motivo})` : ''}`);
  writeFileSync(join(dir, 'risultati.json'), `${JSON.stringify({ corse, comando, ramo, k, motivo }, null, 2)}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main().catch((e) => { console.error(`[misura-k] ${e.stack || e}`); process.exitCode = 1; });
}
