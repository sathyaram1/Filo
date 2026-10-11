#!/usr/bin/env node
// Misura di K (SPEC-DOMANDE.md §12.2, #1157): quanti worker reggono insieme, `finish:check` in un clone ciascuno. Dati
// e log solo in <tmpdir>/filo-k/, mai nel repo; i clone spediscono su un repo nudo locale, mai su GitHub. Prove: misuraK.
//   node scripts/misura-k.mjs [--corse 1,1,2,3,4] [--comando "npm run finish:check"] [--ramo <ref>] [--spec a,b] [--tieni]

import { spawn, spawnSync } from 'node:child_process';
import { appendFileSync, createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { allineaPacchetti, preparaClone, togliClone } from './lib/clone-worker.mjs';
import { preparaLancioElectron } from './lib/schermo-virtuale.mjs';
import { pinnedRepoRoot, TOOLS_ROOT } from './lib/tools-pin.mjs';
import { memoriaContenitore, statoContenitore } from './routine-channel.mjs';

// Per ogni N: ogni worker finisce tutti i test, nessun rosso in più di un worker solo (rossi noti esclusi), nessun
// guasto d'infrastruttura, picco di memoria sotto l'85% del tetto, tempo medio entro 1,5 volte quello di uno solo.
export const SOGLIE = Object.freeze({ memoria: 0.85, tempo: 1.5 });
export const CORSE_PREDEFINITE = Object.freeze([1, 1, 2, 3, 4]);
export const CAMPIONE_MS = 5000;
// Sul ramo della misura finish:check non trova aree toccate e non corre spec: senza questi la misura vedrebbe solo gli
// unit. Quattro spec di aree diverse, quanti ne sceglie la mediana di un ramo vero, lanciati dopo il comando come li
// lancia finish:check, perché pesino Electron e i display come in un lavoro.
export const SPEC_MISURA = Object.freeze(['tab-archive', 'options-default-models', 'feedback-attach-files', 'context-menu']);

/** L'ambiente di un worker della corsa: il suo numero e quanti insieme. PURA. */
export function ambienteWorker(env, indice, paralleli) {
  // FILO_NO_BEAT o FILO_REPO_ROOT ereditate arriverebbero ai test e li farebbero rossi per conto loro (provato a
  // secco: sette rossi del battito).
  const { FILO_NO_BEAT: _b, FILO_REPO_ROOT: _r, ...resto } = env || {};
  return { ...resto, FILO_WORKER: String(indice), FILO_WORKER_PARALLELI: String(paralleli) };
}

/**
 * I passi di un worker: il comando, poi gli spec dal lancio preparato degli strumenti che girano (non da quelli del
 * clone, che sta sul ramo della misura), con la base di display del worker. `{ ok, passi }` o `{ ok: false, motivo }`.
 * PURA se `haXvfb` è finta.
 */
export function passiWorker(comando, spec, { indice, paralleli, env = {}, platform = process.platform, haXvfb } = {}) {
  const passi = [{ cmd: comando, args: [], env, shell: true }];
  if (!spec.length) return { ok: true, passi };
  const file = spec.map((s) => `tests/${String(s).replace(/\\/g, '/').replace(/^tests\//, '').replace(/\.spec\.mjs$/, '')}.spec.mjs`);
  const l = preparaLancioElectron('npx', ['playwright', 'test', ...file], { platform, env, worker: { indice, paralleli }, ...(haXvfb ? { haXvfb } : {}) });
  if (!l.ok) return { ok: false, motivo: l.motivo, passi: [] };
  passi.push({ cmd: l.cmd, args: l.args, env: l.env || env, shell: platform === 'win32' });
  return { ok: true, passi };
}

const INFRASTRUTTURA = [
  ['xvfb', /Xvfb failed to start|xvfb-run: error|Cannot open display/i],
  ['porta', /EADDRINUSE/],
  ['lock', /index\.lock|cannot lock ref|Unable to create '.*\.lock'/i],
  ['disco', /ENOSPC|No space left on device/i],
  ['ucciso', /\bKilled\b|exit code 137|SIGKILL|out of memory/i],
  ['avvio', /Process failed to launch|0xC0000142/i],
];

/**
 * Le righe di un log, ciascuna con `tap` vero se viene dal TAP di node --test: risultati, titoli, l'uscita dei test
 * come diagnostica `#`, blocchi YAML. Lì dentro parlano i test, verdi compresi, non la macchina. PURA.
 */
export function righeDelLog(testo) {
  const righe = [];
  // Il blocco YAML segue la riga del risultato, allo stesso rientro dei suoi campi, e chiude con `...`.
  let yaml = null;
  let dopoRisultato = false;
  for (const riga of String(testo || '').split(/\r?\n/)) {
    if (yaml !== null) {
      const rientro = riga.match(/^\s*/)[0].length;
      if (riga.trim() === '...' && rientro === yaml) { yaml = null; righe.push({ riga, tap: true }); continue; }
      if (!riga.trim() || rientro >= yaml) { righe.push({ riga, tap: true }); continue; }
      yaml = null;
    }
    const apre = dopoRisultato && riga.match(/^(\s*)---\s*$/);
    dopoRisultato = /^\s*(not )?ok \d+\b/.test(riga);
    if (apre) yaml = apre[1].length;
    righe.push({ riga, tap: !!apre || /^\s*(#|(not )?ok \d+\b|1\.\.\d+\s*$|TAP version)/.test(riga) });
  }
  return righe;
}

const TITOLO_DI_TEST = (riga) => /^\s*(ok|x|✓|✘|✖|×|-|°)\s+\d+\s/.test(riga) || /^\s*\d+\)\s/.test(riga) || /[✘✖×]/.test(riga);

/**
 * Le righe che non vengono dai rapporti dei test: fuori il TAP e i titoli di Playwright e dell'elenco dei rossi. Un
 * test verde che si chiama «index.lock a terra» non è un guasto della macchina; uno che cade per un guasto vero è già
 * un rosso. PURA.
 */
export function righeFuoriDaiTest(testo) {
  return righeDelLog(testo).filter((r) => !r.tap && !TITOLO_DI_TEST(r.riga)).map((r) => r.riga).join('\n');
}

/** I nomi delle famiglie d'errore d'infrastruttura trovate in un log, fuori dai rapporti dei test. PURA. */
export function erroriInfrastruttura(testo) {
  const t = righeFuoriDaiTest(testo);
  return INFRASTRUTTURA.filter(([, re]) => re.test(t)).map(([nome]) => nome);
}

/**
 * Un test di Playwright in una riga: file, posizione e titolo, senza durata, tentativo e tratti di chiusura, così che
 * la riga del tentativo, l'elenco degli errori e il riepilogo diano lo stesso testo. '' se la riga non ne nomina. PURA.
 */
export function testDiPlaywright(riga) {
  const m = String(riga || '').match(/(tests[\\/][\w.\\/ -]+?\.spec\.mjs)(:\d+:\d+)?(?:\s+›\s+(.*))?$/);
  if (!m) return '';
  let titolo = String(m[3] || '').replace(/[\s─]+$/, '');
  for (let prima = ''; prima !== titolo;) {
    prima = titolo;
    titolo = titolo.replace(/\s*\((?:retry #\d+|\d+(?:\.\d+)?(?:ms|s|m|h))\)$/, '').replace(/[\s─]+$/, '');
  }
  return `${m[1].replace(/\\+/g, '/')}${m[2] || ''} › ${titolo}`;
}

/** I test che il riepilogo di Playwright elenca sotto «N flaky»: caduti a un tentativo e passati a uno dopo. PURA. */
export function instabiliDiPlaywright(righe) {
  const instabili = new Set();
  let sezione = '';
  for (const riga of righe) {
    const titolo = riga.match(/^\s*\d+ (failed|flaky|interrupted|skipped|did not run|passed)\b/);
    if (titolo) { sezione = titolo[1]; continue; }
    if (!/^\s{4}/.test(riga)) { sezione = ''; continue; }
    const t = sezione === 'flaky' ? testDiPlaywright(riga) : '';
    if (t) instabili.add(t);
  }
  return instabili;
}

/**
 * I rossi di un log di `finish:check`, senza doppioni: i file di Playwright e del riepilogo degli unit, e i test di
 * primo livello del TAP che `node --test` scrive quando l'uscita non è un terminale (lì il nome del test). Su Windows
 * Playwright scrive il percorso con le barre rovesciate. PURA.
 */
export function estraiRossi(testo) {
  const rossi = new Set();
  const file = (f) => f.trim().replace(/\\+/g, '/');
  const righe = righeDelLog(testo);
  const instabili = instabiliDiPlaywright(righe.filter((r) => !r.tap).map((r) => r.riga));
  for (const { riga, tap: delTap } of righe) {
    if (delTap) {
      // Del TAP contano solo i risultati di primo livello: la diagnostica è l'uscita dei test, anche dei verdi.
      const tap = riga.match(/^not ok \d+ - (.+?)(\s+#\s*(?:TODO|SKIP)\b.*)?$/i);
      if (tap && !/TODO/i.test(tap[2] || '')) rossi.add(tap[1].replace(/\\+/g, '/'));
      continue;
    }
    // Il fermo del lanciatore degli unit chiude la corsa con una riga sua: il file fermo e quelli chiusi insieme
    // restano senza esito, ed è il guasto tipico di più worker sulla stessa macchina.
    const fermo = riga.match(/^\[test:unit\] ROSSO: (?:(.+?) non è andato avanti per |per .+? non è andato avanti niente)/);
    if (fermo) { rossi.add(fermo[1] ? file(fermo[1]) : 'test:unit fermo'); continue; }
    const chiusi = riga.match(/^\[test:unit\] chiusi insieme, senza esito: (.+?)\.?\s*$/);
    if (chiusi) { for (const f of chiusi[1].split(', ')) if (f.trim()) rossi.add(file(f)); continue; }
    if (!/(✘|✖|×|^\s*\d+\)\s)/.test(riga)) continue;
    // Un tentativo caduto di un test passato a uno dopo: per Playwright e per finish:check è verde (verifica #1157 giro 5).
    if (instabili.has(testDiPlaywright(riga))) continue;
    const m = riga.match(/tests[\\/][\w.\\/ -]+?\.(?:spec|test)\.mjs/);
    if (m) rossi.add(m[0].replace(/\\+/g, '/'));
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

/**
 * La base: le corse con un worker solo (durata media, rossi di almeno una, se tutte sono uscite a zero) e i test del
 * lavoro intero, il più alto che un worker di una corsa qualunque ha finito. null senza corse da uno. PURA.
 */
export function baseDa(corse) {
  const uno = corse.filter((c) => c.n === 1);
  if (!uno.length) return null;
  const testTutti = Math.max(0, ...corse.flatMap((c) => c.fattiPerWorker || []));
  return {
    durataMs: media(uno.flatMap((c) => c.durateMs)),
    rossi: [...new Set(uno.flatMap((c) => c.rossi))].sort(),
    infra: [...new Set(uno.flatMap((c) => c.infra))],
    uscitePulite: uno.every((c) => (c.codici || []).every((k) => k === 0)),
    testTutti,
    testBase: Math.min(...uno.map((c) => Math.min(testTutti, ...(c.fattiPerWorker || [])))),
  };
}

/**
 * Quanti test ha finito un worker: i conti di `node --test` (`# tests N`, uno per gruppo) e il riepilogo di Playwright.
 * Un worker caduto a metà ne ha meno degli altri, in qualunque modo sia caduto e con o senza un rosso scritto. PURA.
 */
export function testFatti(testo) {
  let n = 0;
  for (const { riga, tap } of righeDelLog(testo)) {
    const m = tap ? riga.match(/^# tests (\d+)\s*$/) : riga.match(/^\s*(\d+) (?:passed|failed|flaky|skipped)\b/);
    if (m) n += Number(m[1]);
  }
  return n;
}

/** Una corsa contro le soglie: `{ ok, motivi, rossiInPiu, durataMs }`. PURA. */
export function valutaCorsa(corsa, base, { rossiNoti = [], soglie = SOGLIE } = {}) {
  const motivi = [];
  const noti = new Set([...(base ? base.rossi : []), ...rossiNoti]);
  const rossiInPiu = corsa.rossi.filter((r) => !noti.has(r));
  const durataMs = media(corsa.durateMs);
  if (rossiInPiu.length) motivi.push(`rossi in più: ${rossiInPiu.join(', ')}`);
  // Un worker è sano solo se ha finito tutti i test: un rosso suo, anche quello della base, non copre i test che non
  // ha fatto (verifica #1157 giro 4).
  const corti = (corsa.fattiPerWorker || []).map((f, i) => [f, i + 1]).filter(([f]) => base && f < base.testTutti);
  if (base && corsa.n > 1 && corti.length) {
    motivi.push(`test non finiti: ${corti.map(([f, i]) => `worker ${i} → ${f} su ${base.testTutti}`).join(', ')}`);
  }
  // Senza i conti dei test (un comando che non li scrive) un worker caduto si vede solo dall'uscita, giudicata worker
  // per worker: con una base già rossa, i rossi di un altro worker non lo coprono.
  const suoi = (i) => (corsa.rossiPerWorker ? corsa.rossiPerWorker[i] || [] : corsa.rossi);
  const cadute = (corsa.codici || []).map((k, i) => [k, i + 1])
    .filter(([k, i]) => k !== 0 && base && (base.uscitePulite || !suoi(i - 1).length));
  if (base && corsa.n > 1 && cadute.length) {
    const senza = base.uscitePulite ? '' : ' senza un rosso riconoscibile';
    motivi.push(`uscite diverse da zero${senza}: ${cadute.map(([k, i]) => `worker ${i} → ${k}`).join(', ')}`);
  }
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
  if (base.testBase < base.testTutti) {
    return { k: null, motivo: `una corsa con un worker solo non ha finito i suoi test (${base.testBase} su ${base.testTutti}): misura da rifare` };
  }
  if (!base.uscitePulite && !base.rossi.length) {
    return { k: null, motivo: 'la base esce con errore senza un rosso riconoscibile: la misura non vedrebbe cosa cade, da rifare' };
  }
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

// I passi uno dopo l'altro nello stesso log, anche dopo un rosso (finish:check corre gli spec anche con gli unit rossi):
// la durata è la somma, l'uscita la prima diversa da zero.
function lancia(passi, cwd, log) {
  return new Promise((ok) => {
    const inizio = Date.now();
    const out = createWriteStream(log);
    let codice = 0;
    const passo = (i) => {
      if (i >= passi.length) {
        out.end(`\n[misura-k] uscita ${codice}\n`, () => ok({ codice, durataMs: Date.now() - inizio }));
        return;
      }
      const p = passi[i];
      let finito = false;
      const fine = (k, nota) => { if (finito) return; finito = true; if (nota) out.write(nota); codice = codice || k; passo(i + 1); };
      const c = spawn(p.cmd, p.args, { cwd, env: p.env, shell: p.shell });
      c.stdout.pipe(out, { end: false });
      c.stderr.pipe(out, { end: false });
      c.on('error', (e) => fine(1, `\n[misura-k] non partito: ${e.message}\n`));
      c.on('close', (k, segnale) => fine(k ?? 137, segnale ? `\n[misura-k] segnale ${segnale}\n` : ''));
    };
    passo(0);
  });
}

async function main() {
  const args = process.argv.slice(2);
  const corseN = opzione(args, '--corse', CORSE_PREDEFINITE.join(',')).split(',').map(Number).filter((n) => Number.isInteger(n) && n > 0);
  const comando = opzione(args, '--comando', 'npm run finish:check');
  const ramo = opzione(args, '--ramo', 'origin/main');
  const spec = opzione(args, '--spec', SPEC_MISURA.join(',')).split(',').map((s) => s.trim()).filter(Boolean);
  const tieni = args.includes('--tieni');
  const principale = process.env.FILO_REPO_ROOT ? resolve(process.env.FILO_REPO_ROOT)
    : (pinnedRepoRoot() || resolve(fileURLToPath(new URL('..', import.meta.url))));
  const dir = resolve(opzione(args, '--base', join(os.tmpdir(), 'filo-k', new Date().toISOString().replace(/[:.]/g, '-'))));
  mkdirSync(dir, { recursive: true });
  const nudo = join(dir, 'nudo.git');
  if (!existsSync(nudo)) spawnSync('git', ['init', '--bare', '-q', nudo]);
  const campioni = join(dir, 'campioni.jsonl');
  const rossiNoti = rossiNotiDa(JSON.parse(leggi(join(principale, 'tests', 'rossi-noti.json')) || '{}'));
  console.log(`[misura-k] corse ${corseN.join(', ')} · comando «${comando}» · ramo ${ramo} · spec in più ${spec.join(', ') || 'nessuno'} · dati in ${dir}`);

  const corse = [];
  for (const [r, n] of corseN.entries()) {
    const cartella = join(dir, `corsa-${r + 1}-n${n}`);
    mkdirSync(cartella, { recursive: true });
    const cloni = [];
    for (let i = 1; i <= n; i++) {
      // Fuori dal registro del principale: i suoi numeri sono dei worker veri, che una misura non deve togliere.
      const p = preparaClone(principale, i, { dest: join(cartella, `clone-${i}`), paralleli: n, pushUrl: nudo, strumentiDa: TOOLS_ROOT, basePin: join(dir, 'strumenti'), registra: false });
      if (!p.ok) { console.error(`[misura-k] clone ${i} della corsa ${r + 1} non pronto: ${p.why}`); process.exitCode = 1; return; }
      const c = spawnSync('git', ['checkout', '-q', '-B', 'misura-k', ramo], { cwd: p.dir, encoding: 'utf8' });
      if (c.status !== 0) { console.error(`[misura-k] ${ramo} non si apre nel clone: ${String(c.stderr).trim()}`); process.exitCode = 1; return; }
      const pk = allineaPacchetti(p.dir, principale);
      if (!pk.ok) { console.error(`[misura-k] pacchetti del clone ${i}: ${pk.why}`); process.exitCode = 1; return; }
      cloni.push(p.dir);
    }
    const piani = cloni.map((_, k) => passiWorker(comando, spec, { indice: k + 1, paralleli: n, env: ambienteWorker(process.env, k + 1, n) }));
    const fermo = piani.find((p) => !p.ok);
    if (fermo) { console.error(`[misura-k] ${fermo.motivo}`); process.exitCode = 1; return; }
    console.log(`[misura-k] corsa ${r + 1}: ${n} insieme`);
    const prelievi = [];
    const preleva = () => { const s = { corsa: r + 1, n, ...campione() }; prelievi.push(s); appendFileSync(campioni, `${JSON.stringify(s)}\n`); };
    preleva();
    const timer = setInterval(preleva, CAMPIONE_MS);
    const esiti = await Promise.all(cloni.map((clone, k) => lancia(piani[k].passi, clone, join(cartella, `worker-${k + 1}.log`))));
    clearInterval(timer);
    preleva();
    const logs = cloni.map((_, k) => leggi(join(cartella, `worker-${k + 1}.log`)) || '');
    const max = (campo) => { const v = prelievi.map((s) => s[campo]).filter(Number.isFinite); return v.length ? Math.max(...v) : null; };
    const corsa = {
      n,
      durateMs: esiti.map((e) => e.durataMs),
      codici: esiti.map((e) => e.codice),
      rossi: [...new Set(logs.flatMap(estraiRossi))].sort(),
      rossiPerWorker: logs.map(estraiRossi),
      fattiPerWorker: logs.map(testFatti),
      infra: [...new Set(logs.flatMap(erroriInfrastruttura))],
      piccoMb: max('usataMb') || 0,
      tettoMb: max('tettoMb') || 0,
      caricoMax: max('loadAvg'),
      psiCpu: max('psiCpu'),
      psiMem: max('psiMem'),
    };
    corse.push(corsa);
    writeFileSync(join(dir, 'risultati.json'), `${JSON.stringify({ corse, comando, ramo }, null, 2)}\n`);
    console.log(`[misura-k] corsa ${r + 1} finita: uscite ${corsa.codici.join(',')}, test finiti ${corsa.fattiPerWorker.join(',')}, rossi ${corsa.rossi.length}, infrastruttura ${corsa.infra.join(',') || 'niente'}`);
    if (!tieni) for (let i = 1; i <= n; i++) togliClone(principale, i, { dest: join(cartella, `clone-${i}`), basePin: join(dir, 'strumenti'), registra: false });
  }

  const { k, motivo } = calcolaK(corse, { rossiNoti });
  console.log(`\n${tabella(corse, { rossiNoti })}\n`);
  console.log(`[misura-k] K = ${k === null ? 'non misurabile' : k}${motivo ? ` (${motivo})` : ''}`);
  writeFileSync(join(dir, 'risultati.json'), `${JSON.stringify({ corse, comando, ramo, k, motivo }, null, 2)}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main().catch((e) => { console.error(`[misura-k] ${e.stack || e}`); process.exitCode = 1; });
}
