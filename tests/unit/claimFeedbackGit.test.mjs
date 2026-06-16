// Integrazione del semaforo su git: due "routine" (due cloni dello stesso
// origin) provano a prendere in carico lo STESSO feedback. Solo la prima deve
// riuscire; la seconda deve vedere il claim e tirarsi indietro (exit 10).
//
// È il test che asserisce il SUCCESSO della feature richiesta ("se due routine
// iniziano a poca distanza non devono prendere lo stesso feedback"): senza il
// lock entrambe le acquire riuscirebbero. Usa git reale in una sandbox temporanea
// (niente Electron, niente rete) tramite FILO_REPO_ROOT.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT = resolve(__dirname, '..', '..', 'scripts', 'claim-feedback.mjs');

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

// Esegue la CLI di claim in un clone, simulando una routine con uno slug dato.
function claim(repoRoot, slug, args) {
  return spawnSync(process.execPath, [SCRIPT, ...args], {
    encoding: 'utf8',
    env: { ...process.env, FILO_REPO_ROOT: repoRoot, FILO_MAIN_BRANCH: 'main', FILO_ROUTINE_SLUG: slug },
  });
}

function hasGit() {
  try { execFileSync('git', ['--version'], { stdio: 'ignore' }); return true; }
  catch { return false; }
}

test('due routine non possono prendere in carico lo stesso feedback', { skip: !hasGit() ? 'git non disponibile' : false }, () => {
  const base = mkdtempSync(join(tmpdir(), 'filo-claim-'));
  try {
    // origin bare + un commit iniziale con la cartella feedback-triage/.
    const origin = join(base, 'origin.git');
    const seed = join(base, 'seed');
    git(base, ['init', '--bare', '-b', 'main', origin]);
    git(base, ['clone', origin, seed]);
    git(seed, ['config', 'user.email', 't@t']); git(seed, ['config', 'user.name', 't']);
    mkdirSync(join(seed, 'feedback-triage', 'claims'), { recursive: true });
    writeFileSync(join(seed, 'feedback-triage', 'claims', '.gitkeep'), '');
    git(seed, ['add', '-A']); git(seed, ['commit', '-q', '-m', 'seed']); git(seed, ['push', '-q', 'origin', 'main']);

    // Due cloni = due routine.
    const r1 = join(base, 'r1'); const r2 = join(base, 'r2');
    git(base, ['clone', '-q', origin, r1]); git(base, ['clone', '-q', origin, r2]);
    for (const r of [r1, r2]) { git(r, ['config', 'user.email', 't@t']); git(r, ['config', 'user.name', 't']); }

    // r1 acquisisce per primo → exit 0.
    const a1 = claim(r1, 'routine-1', ['acquire', 'fbX']);
    assert.equal(a1.status, 0, `r1 doveva acquisire (stdout: ${a1.stdout} stderr: ${a1.stderr})`);
    assert.ok(existsSync(join(r1, 'feedback-triage', 'claims', 'fbX.json')), 'file di claim creato in r1');

    // r2 prova lo stesso feedback → vede il claim di r1 e si tira indietro (exit 10).
    const a2 = claim(r2, 'routine-2', ['acquire', 'fbX']);
    assert.equal(a2.status, 10, `r2 doveva trovare il feedback occupato (stdout: ${a2.stdout} stderr: ${a2.stderr})`);
    assert.match(a2.stdout, /OCCUPAT/i);

    // r1 rilascia → r2 ora può prenderlo.
    const rel = claim(r1, 'routine-1', ['release', 'fbX']);
    assert.equal(rel.status, 0, `release di r1 ok (stderr: ${rel.stderr})`);
    const a3 = claim(r2, 'routine-2', ['acquire', 'fbX']);
    assert.equal(a3.status, 0, `dopo il release r2 deve poter acquisire (stdout: ${a3.stdout} stderr: ${a3.stderr})`);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});
