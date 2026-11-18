// Uno o più spec sul ramo e su origin/main appena scaricata, uno accanto all'altro e senza ripetizioni: dice se un
// rosso è del ramo o c'era già (#1290, #1985, #2237.6). Non tocca la cartella: due worktree staccati, tolti alla fine.
// Prove: tests/unit/specSuMain.test.mjs.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { aggiornaMain, testoBaseMain } from './finish-local.mjs';
import { apriProvaSulCommit } from './lib/unit-sulla-fusione.mjs';
import { preparaLancioElectron } from './lib/schermo-virtuale.mjs';
import { absolutizeOutput, pinnedRepoRoot } from './lib/tools-pin.mjs';

// Dalla copia fissata degli strumenti il progetto vero lo dice la copia, come per gli altri strumenti dei ruoli.
const ROOT = process.env.FILO_REPO_ROOT ? resolve(process.env.FILO_REPO_ROOT) : (pinnedRepoRoot() || resolve(dirname(fileURLToPath(import.meta.url)), '..'));

/** Gli spec chiesti, nella forma `tests/<nome>.spec.mjs`; `errore` se uno non ha quella forma. PURA. */
export function specDaArgomenti(args) {
  const specs = [];
  for (const a of args || []) {
    const s = String(a).replace(/\\/g, '/').replace(/^\.\//, '');
    const pieno = s.endsWith('.spec.mjs') ? s : `${s}.spec.mjs`;
    if (!/^tests\/[\w./-]+\.spec\.mjs$/.test(pieno) || pieno.includes('..')) {
      return { errore: `«${String(a).slice(0, 80)}» non è uno spec: scrivilo come tests/<nome>.spec.mjs, relativo alla radice del repo.` };
    }
    specs.push(pieno);
  }
  return specs.length ? { specs } : { errore: 'Uso: node scripts/spec-su-main.mjs tests/<nome>.spec.mjs [altri spec…]' };
}

const comeEsito = (v) => (v === true ? 'verde' : v === false ? 'rosso' : v);

/**
 * Il verdetto su un solo spec: `ramo` e `main` sono 'verde', 'rosso' o 'non-corso' (true/false per verde/rosso).
 * Uno spec che da una parte non è partito non dà verdetto: «No tests found» non è un rosso (#2454). PURA.
 */
export function verdettoAffiancato({ ramo, main, copia = '' }) {
  const r = comeEsito(ramo);
  const m = comeEsito(main);
  const nota = !copia ? ''
    : m === 'rosso' ? ' Su main ho corso lo spec del ramo: se il ramo cambia anche gli aiuti che usa, il rosso di main può venire da quelli.'
      : m === 'non-corso' ? ' Su main ho corso lo spec del ramo e non è partito: forse usa aiuti che il ramo aggiunge.' : '';
  if (r === 'non-corso' && m === 'non-corso') return `Non è partito né sul ramo né su main: il confronto non si è fatto.${nota}`;
  if (r === 'non-corso') return `Sul ramo non è partito: il confronto non si è fatto (su main è ${m}).${nota}`;
  if (m === 'non-corso') return `Su main non è partito: il confronto non si è fatto, e non dice di chi è (sul ramo è ${r}).${nota}`;
  if (r === 'verde' && m === 'verde') return 'Verde su tutti e due.';
  if (r === 'rosso' && m === 'verde') return 'Rosso solo sul ramo: lo ha rotto il ramo.';
  if (r === 'verde') return `Rosso solo su main: il ramo lo corregge, o su main dipende da altro.${nota}`;
  return `Rosso su tutti e due: c'era già su main, non è del ramo.${nota}`;
}

/**
 * Dal resoconto JSON di Playwright, per ogni spec chiesto: 'rosso' se un caso è fallito, 'verde' se almeno uno è
 * passato e nessuno è fallito, 'non-corso' se non ne è partito nessuno (spec assente, import rotto, schermo che manca).
 * PURA.
 */
export function esitiPerSpec(report, specs) {
  const relativo = (s) => s.replace(/^tests\//, '');
  const perFile = new Map(specs.map((s) => [relativo(s), { stati: [], errori: 0 }]));
  const visita = (suite) => {
    for (const sp of suite.specs || []) {
      const v = perFile.get(String(sp.file || suite.file || '').replace(/\\/g, '/'));
      if (v) for (const t of sp.tests || []) v.stati.push(t.status);
    }
    for (const s of suite.suites || []) visita(s);
  };
  for (const s of (report && report.suites) || []) visita(s);
  for (const e of (report && report.errors) || []) {
    const f = String((e.location && e.location.file) || '').replace(/\\/g, '/');
    for (const [rel, v] of perFile) if (f && f.endsWith(`/${rel}`)) v.errori++;
  }
  const esiti = {};
  for (const s of specs) {
    const v = perFile.get(relativo(s));
    const partiti = v.stati.filter((x) => x !== 'skipped');
    esiti[s] = !partiti.length ? 'non-corso' : (v.stati.includes('unexpected') || v.errori) ? 'rosso' : 'verde';
  }
  return esiti;
}

/** La prima riga del primo errore del resoconto, per dire perché uno spec non è partito. PURA. */
export function motivoDelResoconto(report) {
  if (!report) return 'Playwright non ha lasciato il resoconto';
  const e = (report.errors || [])[0];
  return e ? String(e.message || '').split('\n')[0].trim().slice(0, 200) : '';
}

/**
 * Su main corre lo stesso spec del ramo: dove su main manca o è diverso, la versione del ramo va scritta nell'albero di
 * main, che è un worktree di prova e se ne va alla fine. `mancaSulRamo`: gli spec che il commit del ramo non ha.
 */
export function portaSpecDelRamo({ root, shaRamo, shaMain, specs, dir }) {
  const blob = (sha, spec) => {
    const r = spawnSync('git', ['rev-parse', '--verify', '--quiet', `${sha}:${spec}`], { cwd: root, encoding: 'utf8' });
    return r.status === 0 ? r.stdout.trim() : '';
  };
  const portati = [];
  const mancaSulRamo = [];
  for (const spec of specs) {
    const delRamo = blob(shaRamo, spec);
    if (!delRamo) { mancaSulRamo.push(spec); continue; }
    const diMain = blob(shaMain, spec);
    if (diMain === delRamo) continue;
    const r = spawnSync('git', ['cat-file', 'blob', delRamo], { cwd: root });
    if (r.status !== 0) continue;
    const dest = join(dir, ...spec.split('/'));
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, r.stdout);
    portati.push({ spec, motivo: diMain ? 'diverso' : 'manca' });
  }
  return { portati, mancaSulRamo };
}

function corri(albero, specs, etichetta) {
  process.stdout.write(`\n▸ ${etichetta}: ${specs.join(' ')} (senza ripetizioni)\n`);
  const nessuno = (motivo) => ({ esiti: Object.fromEntries(specs.map((s) => [s, 'non-corso'])), motivo });
  if (!albero.moduli) { console.error(`✗ ${etichetta}: node_modules manca, lancia npm install.`); return nessuno('node_modules manca'); }
  const cli = [join(albero.moduli, '@playwright', 'test', 'cli.js'), 'test', '--retries=0', '--reporter=list,json', ...specs];
  const l = preparaLancioElectron(process.execPath, cli);
  if (!l.ok) { console.error(`✗ ${l.motivo}`); return nessuno(l.motivo); }
  // Il resoconto sta nella base della prova, fuori dal worktree: se ne va con lei.
  const resoconto = join(albero.base, 'resoconto.json');
  spawnSync(l.cmd, l.args, { cwd: albero.dir, stdio: 'inherit', env: { ...(l.env || process.env), PLAYWRIGHT_JSON_OUTPUT_FILE: resoconto } });
  let report = null;
  try { if (existsSync(resoconto)) report = JSON.parse(readFileSync(resoconto, 'utf8')); } catch (_) { /* senza resoconto nessuno spec risulta partito */ }
  return { esiti: report ? esitiPerSpec(report, specs) : nessuno().esiti, motivo: motivoDelResoconto(report) };
}

function main() {
  absolutizeOutput(ROOT);
  const scelta = specDaArgomenti(process.argv.slice(2));
  if (scelta.errore) { console.error(scelta.errore); process.exit(1); }
  const git = (args) => spawnSync('git', args, { cwd: ROOT, encoding: 'utf8' });
  const { fetchOk, remoteRefOk } = aggiornaMain(ROOT);
  if (!remoteRefOk) { console.error('✗ Non ho origin/main: senza, il confronto non si fa.'); process.exit(1); }
  const shaMain = git(['rev-parse', 'refs/remotes/origin/main^{commit}']).stdout.trim();
  const shaRamo = git(['rev-parse', 'HEAD']).stdout.trim();
  console.log(testoBaseMain({ base: 'origin/main', sha: shaMain, fetchOk }));
  const corse = {};
  let copie = { portati: [], mancaSulRamo: [] };
  for (const [chi, sha] of [['ramo', shaRamo], ['main', shaMain]]) {
    const albero = apriProvaSulCommit({ root: ROOT, sha });
    if (albero.errore) { console.error(`✗ ${albero.errore}`); process.exit(1); }
    try {
      if (chi === 'main') {
        copie = portaSpecDelRamo({ root: ROOT, shaRamo, shaMain, specs: scelta.specs, dir: albero.dir });
        for (const p of copie.portati) console.log(`  ${p.spec}: su main ${p.motivo === 'manca' ? 'non c\'è' : 'è diverso'}, corro quello del ramo.`);
      }
      corse[chi] = corri(albero, scelta.specs, `${chi === 'ramo' ? 'Sul ramo' : 'Su origin/main'} ${sha.slice(0, 8)}`);
    } finally {
      const c = albero.chiudi();
      if (!c.ok) console.error(`(${c.motivo}: la cartella di prova resta, la toglie il prossimo giro)`);
    }
  }
  const leggibile = (e) => (e === 'non-corso' ? 'non partito' : e);
  console.log(`\n▸ Ramo ${shaRamo.slice(0, 8)}, main ${shaMain.slice(0, 8)}:`);
  for (const spec of scelta.specs) {
    const ramo = corse.ramo.esiti[spec];
    const main = corse.main.esiti[spec];
    const perche = (lato, e) => (e === 'non-corso' && corse[lato].motivo ? ` (${corse[lato].motivo})` : '');
    console.log(`  ${spec}: ramo ${leggibile(ramo)}${perche('ramo', ramo)}, main ${leggibile(main)}${perche('main', main)}.`);
    const copia = (copie.portati.find((p) => p.spec === spec) || {}).motivo || '';
    console.log(`    ${verdettoAffiancato({ ramo, main, copia })}`);
    if (copie.mancaSulRamo.includes(spec)) console.log('    Il commit del ramo non ha questo spec: un file non ancora salvato non si corre.');
  }
  console.log('  Main corre coi pacchetti di questa cartella: se il suo package-lock è diverso, un rosso lì può venire da quello.');
  process.exit(scelta.specs.every((s) => corse.ramo.esiti[s] === 'verde') ? 0 : 1);
}

if (resolve(process.argv[1] || '') === resolve(fileURLToPath(import.meta.url))) main();
