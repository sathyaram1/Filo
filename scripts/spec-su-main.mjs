// Uno o più spec sul ramo e su origin/main appena scaricata, uno accanto all'altro e senza ripetizioni: dice se un
// rosso è del ramo o c'era già (#1290, #1985, #2237.6). Non tocca la cartella: due worktree staccati, tolti alla fine.
// Prove: tests/unit/specSuMain.test.mjs.
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { aggiornaMain, testoBaseMain } from './finish-local.mjs';
import { apriProvaSulCommit } from './lib/unit-sulla-fusione.mjs';
import { preparaLancioElectron } from './lib/schermo-virtuale.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

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

/** Il verdetto sui due esiti (true = verde). PURA. */
export function verdettoAffiancato({ ramo, main }) {
  if (ramo && main) return 'Verde su tutti e due.';
  if (!ramo && main) return 'Rosso solo sul ramo: lo ha rotto il ramo.';
  if (ramo && !main) return 'Rosso solo su main: il ramo lo corregge, o su main dipende da altro.';
  return 'Rosso su tutti e due: c\'era già su main, non è del ramo.';
}

function corri(albero, specs, etichetta) {
  process.stdout.write(`\n▸ ${etichetta}: ${specs.join(' ')} (senza ripetizioni)\n`);
  if (!albero.moduli) { console.error(`✗ ${etichetta}: node_modules manca, lancia npm install.`); return false; }
  const l = preparaLancioElectron(process.execPath, [join(albero.moduli, '@playwright', 'test', 'cli.js'), 'test', '--retries=0', ...specs]);
  if (!l.ok) { console.error(`✗ ${l.motivo}`); return false; }
  const r = spawnSync(l.cmd, l.args, { cwd: albero.dir, stdio: 'inherit', ...(l.env ? { env: l.env } : {}) });
  return r.status === 0;
}

function main() {
  const scelta = specDaArgomenti(process.argv.slice(2));
  if (scelta.errore) { console.error(scelta.errore); process.exit(1); }
  const git = (args) => spawnSync('git', args, { cwd: ROOT, encoding: 'utf8' });
  const { fetchOk, remoteRefOk } = aggiornaMain(ROOT);
  if (!remoteRefOk) { console.error('✗ Non ho origin/main: senza, il confronto non si fa.'); process.exit(1); }
  const shaMain = git(['rev-parse', 'refs/remotes/origin/main^{commit}']).stdout.trim();
  const shaRamo = git(['rev-parse', 'HEAD']).stdout.trim();
  console.log(testoBaseMain({ base: 'origin/main', sha: shaMain, fetchOk }));
  const esiti = {};
  for (const [chi, sha] of [['ramo', shaRamo], ['main', shaMain]]) {
    const albero = apriProvaSulCommit({ root: ROOT, sha });
    if (albero.errore) { console.error(`✗ ${albero.errore}`); process.exit(1); }
    try {
      esiti[chi] = corri(albero, scelta.specs, `${chi === 'ramo' ? 'Sul ramo' : 'Su origin/main'} ${sha.slice(0, 8)}`);
    } finally {
      const c = albero.chiudi();
      if (!c.ok) console.error(`(${c.motivo}: la cartella di prova resta, la toglie il prossimo giro)`);
    }
  }
  const verde = (v) => (v ? 'verde' : 'rosso');
  console.log(`\n▸ Ramo ${shaRamo.slice(0, 8)}: ${verde(esiti.ramo)}. Main ${shaMain.slice(0, 8)}: ${verde(esiti.main)}.`);
  console.log(`  ${verdettoAffiancato(esiti)}`);
  console.log('  Main corre coi pacchetti di questa cartella: se il suo package-lock è diverso, un rosso lì può venire da quello.');
  process.exit(esiti.ramo ? 0 : 1);
}

if (resolve(process.argv[1] || '') === resolve(fileURLToPath(import.meta.url))) main();
