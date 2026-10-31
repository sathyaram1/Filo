// Un ramo riallineato (rebase) in un clone di worker deve arrivare su origin, dal rilascio e dall'hook di salvataggio
// (#1930): `git clone` scrive i ref di tracciamento senza reflog e --force-if-includes, senza, rifiuta sempre. Git vero
// con un origin nudo locale; la regola sta in assicuraReflogTracciamento (scripts/lib/branch-integrity.mjs).

import '../helpers/senzaSessione.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea, togliCartella } from '../helpers/percorsi.mjs';
import { preparaClone } from '../../scripts/lib/clone-worker.mjs';
import { PINNED_PATHS } from '../../scripts/lib/tools-pin.mjs';
import { assicuraReflogTracciamento, prepareBranch } from '../../scripts/lib/branch-integrity.mjs';
import { pushRamoCorrente } from '../../scripts/routine-channel.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const HOOK = resolve(ROOT, '.claude', 'hooks', 'auto-commit-merge.sh');
const RAMO = 'worker/riallineato-20261031T000000Z';
const git = (cwd, args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const haReflog = (cwd, ref) => spawnSync('git', ['reflog', 'exists', ref], { cwd }).status === 0;
const npmMai = () => { throw new Error('npm ci lanciato con lo stesso package-lock'); };
function commitFile(cwd, nome) {
  writeFileSync(resolve(cwd, nome), `${nome}\n`, 'utf8');
  git(cwd, ['add', '-A']);
  git(cwd, ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', nome]);
  return git(cwd, ['rev-parse', 'HEAD']);
}

/**
 * Il giro della segnalazione: un worker di prima ha spinto il ramo, il clone del worker nuovo nasce dopo (con quel ramo
 * fra i ref di tracciamento), dispatch lo posiziona, main va avanti e il worker riallinea.
 */
function scena(t) {
  const base = cartellaTemporanea('filo-rinvio-rebase-');
  t.after(() => togliCartella(base));
  const origin = resolve(base, 'origin.git');
  mkdirSync(origin);
  git(origin, ['init', '--bare', '-q', '--initial-branch=main']);
  const principale = resolve(base, 'principale');
  execFileSync('git', ['clone', '-q', origin, principale], { stdio: 'ignore' });
  git(principale, ['config', 'core.autocrlf', 'false']);
  writeFileSync(resolve(principale, 'package-lock.json'), '{"lockfileVersion":3}\n', 'utf8');
  writeFileSync(resolve(principale, '.gitignore'), 'node_modules\n', 'utf8');
  git(principale, ['add', '-A']);
  git(principale, ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'base']);
  git(principale, ['push', '-q', 'origin', 'main']);
  mkdirSync(resolve(principale, 'node_modules', 'pacchetto'), { recursive: true });
  writeFileSync(resolve(principale, 'node_modules', '.package-lock.json'), '{}\n', 'utf8');
  const strumenti = resolve(base, 'strumenti');
  for (const p of PINNED_PATHS) {
    if (p.endsWith('.js')) { mkdirSync(dirname(resolve(strumenti, p)), { recursive: true }); writeFileSync(resolve(strumenti, p), '', 'utf8'); } else mkdirSync(resolve(strumenti, p), { recursive: true });
  }

  git(principale, ['checkout', '-q', '-b', RAMO]);
  const vecchia = commitFile(principale, 'lavoro.js');
  git(principale, ['push', '-q', 'origin', `${RAMO}:refs/heads/${RAMO}`]);
  git(principale, ['checkout', '-q', 'main']);

  const clone = resolve(base, 'lavori', '1');
  const c = preparaClone(principale, 1, { dest: clone, strumentiDa: strumenti, basePin: resolve(base, 'pin'), npmCi: npmMai, registra: false });
  assert.equal(c.ok, true, c.why);
  git(clone, ['config', 'user.email', 't@t']);
  git(clone, ['config', 'user.name', 't']);
  const p = prepareBranch({ root: clone, branch: RAMO });
  assert.equal(p.ok, true, p.message);
  assert.equal(p.avviso, undefined, p.avviso);
  // Senza reflog git 2.43 legge un'ora indefinita: il rifiuto dipende dal processo (nell'hook c'era sempre).
  assert.equal(haReflog(clone, `refs/remotes/origin/${RAMO}`), true, 'dopo il posizionamento il ref di tracciamento ha il suo reflog');

  commitFile(principale, 'main-avanti.js');
  git(principale, ['push', '-q', 'origin', 'main']);
  git(clone, ['fetch', '-q', 'origin', 'main']);
  git(clone, ['rebase', '-q', 'origin/main']);
  const riallineata = git(clone, ['rev-parse', 'HEAD']);
  assert.notEqual(riallineata, vecchia);
  return { base, origin, principale, clone, vecchia, riallineata };
}

const suOrigin = (origin) => git(origin, ['rev-parse', `refs/heads/${RAMO}`]);

test('il ramo riallineato nel clone del worker arriva su origin dal rilascio', (t) => {
  const s = scena(t);
  const r = pushRamoCorrente(s.clone);
  assert.equal(r.ok, true, r.reason);
  assert.equal(r.forced, true, 'è la storia riscritta dal rebase, spedita col lease');
  assert.equal(suOrigin(s.origin), s.riallineata, 'su origin c\'è il ramo riallineato, non quello vecchio');
});

test('il ramo riallineato arriva su origin anche dall\'hook di salvataggio, alla prima modifica dopo il rebase', { skip: process.platform === 'win32' ? 'hook bash' : false }, (t) => {
  const s = scena(t);
  writeFileSync(resolve(s.clone, 'dopo-il-rebase.js'), 'x\n', 'utf8');
  const out = spawnSync('bash', [HOOK], { cwd: s.clone, encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: s.clone, FILO_MAIN_BRANCH: 'main' } });
  assert.equal(out.status, 0, out.stderr);
  assert.doesNotMatch(out.stderr, /NON e' arrivato su origin/, out.stderr);
  const punta = suOrigin(s.origin);
  assert.equal(punta, git(s.clone, ['rev-parse', 'HEAD']), `stderr dell'hook: ${out.stderr}`);
  assert.equal(git(s.clone, ['rev-parse', 'HEAD~1']), s.riallineata, 'sopra il ramo riallineato, non sopra quello vecchio');
});

test('il lease resta una guardia: chi ha spinto dopo il posizionamento non viene sovrascritto dal rinvio', (t) => {
  const s = scena(t);
  const altro = resolve(s.base, 'altro');
  execFileSync('git', ['clone', '-q', '--branch', RAMO, s.origin, altro], { stdio: 'ignore' });
  const suo = commitFile(altro, 'di-un-altro.js');
  git(altro, ['push', '-q', 'origin', `${RAMO}:refs/heads/${RAMO}`]);
  git(s.clone, ['fetch', '-q', 'origin']);
  const r = pushRamoCorrente(s.clone);
  assert.equal(r.ok, false, JSON.stringify(r));
  assert.equal(suOrigin(s.origin), suo, 'il commit dell\'altro resta su origin');
});

test('il ref di tracciamento scritto da git clone prende un reflog, allo stesso commit, una volta sola', (t) => {
  const base = cartellaTemporanea('filo-reflog-tracciamento-');
  t.after(() => togliCartella(base));
  const origin = resolve(base, 'origin.git');
  const seme = resolve(base, 'seme');
  mkdirSync(origin);
  git(origin, ['init', '--bare', '-q', '--initial-branch=main']);
  execFileSync('git', ['clone', '-q', origin, seme], { stdio: 'ignore' });
  commitFile(seme, 'a.js');
  git(seme, ['push', '-q', 'origin', 'HEAD:refs/heads/main', `HEAD:refs/heads/${RAMO}`]);
  const clone = resolve(base, 'clone');
  execFileSync('git', ['clone', '-q', origin, clone], { stdio: 'ignore' });
  const ref = `refs/remotes/origin/${RAMO}`;
  const sha = git(clone, ['rev-parse', ref]);
  assert.equal(haReflog(clone, ref), false, 'la condizione della segnalazione: git clone lo scrive senza');
  assert.deepEqual(assicuraReflogTracciamento(clone, RAMO), { ok: true, creato: true, motivo: '' });
  assert.equal(haReflog(clone, ref), true);
  assert.equal(git(clone, ['rev-parse', ref]), sha, 'lo stesso commit di prima');
  assert.deepEqual(assicuraReflogTracciamento(clone, RAMO), { ok: true, creato: false, motivo: '' });
  assert.equal(git(clone, ['reflog', 'show', '--format=%H', ref]).split('\n').length, 1, 'una voce sola');
  assert.equal(assicuraReflogTracciamento(clone, 'worker/mai-esistito').ok, false);
});
