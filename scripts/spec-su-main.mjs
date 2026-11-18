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
import { FUORI_DAI_CASI, normalizzaSpec, primaRiga, raccogliCasi, verdetto } from './suite-verdict.mjs';

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
// Un lato è 'verde'/'rosso'/'non-corso' (o true/false), oppure l'esito di esitiPerSpec, che porta i casi rossi.
const comeLato = (x) => (x && typeof x === 'object' ? { esito: x.esito, rossi: Array.isArray(x.rossi) ? x.rossi : null } : { esito: comeEsito(x), rossi: null });
const elenco = (titoli) => titoli.slice(0, 5).map((t) => `«${t}»`).join(', ') + (titoli.length > 5 ? ` e altri ${titoli.length - 5}` : '');

/**
 * Il verdetto su un solo spec, caso per caso quando i lati portano i loro rossi: un caso rosso sul ramo che su main non
 * lo è è del ramo, anche se un altro caso dello stesso file è rosso su tutti e due (#2454). Uno spec che da una parte
 * non è partito non dà verdetto: «No tests found» non è un rosso. PURA.
 */
export function verdettoAffiancato({ ramo, main, copia = '' }) {
  const R = comeLato(ramo);
  const M = comeLato(main);
  const r = R.esito;
  const m = M.esito;
  const nota = !copia ? ''
    : m === 'rosso' ? ' Su main ho corso lo spec del ramo: se il ramo cambia anche gli aiuti che usa, il rosso di main può venire da quelli.'
      : m === 'non-corso' ? ' Su main ho corso lo spec del ramo e non è partito: forse usa aiuti che il ramo aggiunge.' : '';
  if (r === 'non-corso' && m === 'non-corso') return `Non è partito né sul ramo né su main: il confronto non si è fatto.${nota}`;
  if (r === 'non-corso') return `Sul ramo non è partito: il confronto non si è fatto (su main è ${m}).${nota}`;
  if (m === 'non-corso') return `Su main non è partito: il confronto non si è fatto, e non dice di chi è (sul ramo è ${r}).${nota}`;
  if (r === 'verde' && m === 'verde') return 'Verde su tutti e due.';
  if (r === 'rosso' && m === 'verde') return 'Rosso solo sul ramo: lo ha rotto il ramo.';
  if (r === 'verde') return `Rosso solo su main: il ramo lo corregge, o su main dipende da altro.${nota}`;
  if (R.rossi && M.rossi) {
    const soloRamo = R.rossi.filter((t) => !M.rossi.includes(t));
    const giaSuMain = R.rossi.length - soloRamo.length;
    if (soloRamo.length) {
      const quanti = soloRamo.length === 1 ? 'un caso è rosso' : `${soloRamo.length} casi sono rossi`;
      const resto = giaSuMain ? ` Gli altri rossi del ramo (${giaSuMain}) c'erano già su main.${nota}` : '';
      return `Rosso su tutti e due, ma ${quanti} solo sul ramo, e quello è del ramo: ${elenco(soloRamo)}.${resto}`;
    }
  }
  return `Rosso su tutti e due: c'era già su main, non è del ramo.${nota}`;
}

/**
 * Dal resoconto JSON di Playwright, per ogni spec chiesto: { esito, rossi, motivo }. La lettura è quella del verdetto
 * della suite (casi ed errori fuori dai casi), così uno spec rosso in GitHub è rosso anche qui. `esito`: 'rosso' se un
 * caso o un errore del file è rosso, 'verde' se almeno un caso è passato, 'non-corso' se non ne è partito nessuno
 * (spec assente, import rotto, schermo che manca). `rossi`: i titoli dei casi rossi, più FUORI_DAI_CASI. PURA.
 */
export function esitiPerSpec(report, specs) {
  const casi = raccogliCasi(report);
  const v = verdetto(report || {}, []);
  const fuori = v.nuovi.filter((c) => c.spec === FUORI_DAI_CASI && !c.strascicoDi);
  const partiti = (n) => casi.some((c) => c.spec === n && c.stato !== 'skipped');
  const esiti = {};
  for (const s of specs) {
    const n = normalizzaSpec(s);
    const suoi = fuori.filter((c) => c.file && normalizzaSpec(c.file) === n);
    if (!partiti(n)) {
      const motivo = suoi.length ? suoi[0].titolo : motivoDelResoconto(report);
      esiti[s] = { esito: 'non-corso', rossi: [], motivo };
      continue;
    }
    const rossi = v.nuovi.filter((c) => c.spec === n).map((c) => c.titoloCompleto);
    // Un errore che non nomina un file sta nella corsa e non si sa di chi è: come nel verdetto della suite, fa rosso.
    if (suoi.length || fuori.some((c) => !c.file && !c.tetto)) rossi.push(FUORI_DAI_CASI);
    if (v.nuovi.some((c) => c.tetto) && casi.some((c) => c.spec === n && c.nonGirato)) rossi.push(FUORI_DAI_CASI);
    const unici = [...new Set(rossi)];
    esiti[s] = { esito: unici.length ? 'rosso' : 'verde', rossi: unici, motivo: '' };
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

/**
 * Gli spec da rifare da soli dopo una corsa insieme: quelli non partiti, se nella stessa corsa ce n'erano altri. Uno
 * spec che non si carica ferma tutta la corsa di Playwright, e non deve togliere il confronto agli altri (#2454). PURA.
 */
export function specDaRifareDaSoli(esiti, specs) {
  if (specs.length < 2) return [];
  return specs.filter((s) => esiti[s] && esiti[s].esito === 'non-corso');
}

function corriUnaVolta(albero, specs) {
  const nessuno = (motivo) => ({ esiti: Object.fromEntries(specs.map((s) => [s, { esito: 'non-corso', rossi: [], motivo }])), lancioFallito: true });
  if (!albero.moduli) { console.error('✗ node_modules manca, lancia npm install.'); return nessuno('node_modules manca'); }
  const cli = [join(albero.moduli, '@playwright', 'test', 'cli.js'), 'test', '--retries=0', '--reporter=list,json', ...specs];
  const l = preparaLancioElectron(process.execPath, cli);
  if (!l.ok) { console.error(`✗ ${l.motivo}`); return nessuno(l.motivo); }
  // Il resoconto sta nella base della prova, fuori dal worktree: se ne va con lei.
  const resoconto = join(albero.base, 'resoconto.json');
  rmSync(resoconto, { force: true });
  spawnSync(l.cmd, l.args, { cwd: albero.dir, stdio: 'inherit', env: { ...(l.env || process.env), PLAYWRIGHT_JSON_OUTPUT_FILE: resoconto } });
  let report = null;
  try { if (existsSync(resoconto)) report = JSON.parse(readFileSync(resoconto, 'utf8')); } catch (_) { /* senza resoconto nessuno spec risulta partito */ }
  return { esiti: esitiPerSpec(report, specs), lancioFallito: false };
}

function corri(albero, specs, etichetta) {
  process.stdout.write(`\n▸ ${etichetta}: ${specs.join(' ')} (senza ripetizioni)\n`);
  const prima = corriUnaVolta(albero, specs);
  if (prima.lancioFallito) return prima;
  for (const spec of specDaRifareDaSoli(prima.esiti, specs)) {
    process.stdout.write(`\n▸ ${etichetta}: ${spec} non è partito insieme agli altri, lo rifaccio da solo\n`);
    prima.esiti[spec] = corriUnaVolta(albero, [spec]).esiti[spec];
  }
  return prima;
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
  const leggibile = (e) => (e.esito === 'non-corso' ? `non partito${e.motivo ? ` (${e.motivo})` : ''}` : e.esito);
  console.log(`\n▸ Ramo ${shaRamo.slice(0, 8)}, main ${shaMain.slice(0, 8)}:`);
  for (const spec of scelta.specs) {
    const suRamo = corse.ramo.esiti[spec];
    const suMain = corse.main.esiti[spec];
    console.log(`  ${spec}: ramo ${leggibile(suRamo)}, main ${leggibile(suMain)}.`);
    const copia = (copie.portati.find((p) => p.spec === spec) || {}).motivo || '';
    console.log(`    ${verdettoAffiancato({ ramo: suRamo, main: suMain, copia })}`);
    if (copie.mancaSulRamo.includes(spec)) console.log('    Il commit del ramo non ha questo spec: un file non ancora salvato non si corre.');
  }
  console.log('  Main corre coi pacchetti di questa cartella: se il suo package-lock è diverso, un rosso lì può venire da quello.');
  process.exit(scelta.specs.every((s) => corse.ramo.esiti[s] === 'verde') ? 0 : 1);
}

if (resolve(process.argv[1] || '') === resolve(fileURLToPath(import.meta.url))) main();
