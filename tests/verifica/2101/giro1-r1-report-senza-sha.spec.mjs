// Verifica #2101 giro 1: la punta è ancora il commit verificato ma il report di chi ha rifatto la base non scrive lo sha
// di main («Riallineato su main attuale»): il rebase manca lo stesso, e chi verifica deve saperlo come nel caso con lo sha.
import '../../helpers/senzaSessione.mjs';
import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cartellaTemporanea, togliCartella } from '../../helpers/percorsi.mjs';

const git = (dir, args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const identita = (dir) => { git(dir, ['config', 'user.email', 't@t']); git(dir, ['config', 'user.name', 't']); git(dir, ['config', 'commit.gpgsign', 'false']); };
const commit = (dir, file, testo, msg) => { writeFileSync(join(dir, file), testo); git(dir, ['add', '-A']); git(dir, ['commit', '-qm', msg]); return git(dir, ['rev-parse', 'HEAD']); };

test('r1 sulla punta verificata, con un report che non nomina lo sha di main, il compito dice che il riallineamento non c\'è', async () => {
  const BASE = cartellaTemporanea('verifica-2101-');
  const STRUMENTI = cartellaTemporanea('verifica-2101-strumenti-');
  const TEMP = cartellaTemporanea('verifica-2101-tmp-');
  try {
    const origin = join(BASE, 'origin.git'); const work = join(BASE, 'work'); const altro = join(BASE, 'altro'); const copia = join(BASE, 'copia');
    mkdirSync(origin); mkdirSync(work);
    git(origin, ['init', '--bare', '-q', '--initial-branch=main']);
    git(work, ['init', '-q', '--initial-branch=main']); identita(work);
    git(work, ['remote', 'add', 'origin', `file://${origin}`]);
    writeFileSync(join(work, '.gitignore'), '.claude/\n');
    commit(work, 'a.js', 'uno\n', 'inizio');
    git(work, ['push', '-q', 'origin', 'main']);
    git(work, ['checkout', '-qb', 'worker/x']);
    const VERIFICATO = commit(work, 'b.js', 'lavoro\n', 'il lavoro di #9');
    git(work, ['push', '-q', 'origin', 'worker/x']);
    execFileSync('git', ['clone', '-q', `file://${origin}`, altro], { stdio: 'ignore' }); identita(altro);
    commit(altro, 'c.js', 'da main\n', 'arrivato su main');
    git(altro, ['push', '-q', 'origin', 'main']);
    execFileSync('git', ['clone', '-q', '--branch', 'worker/x', `file://${origin}`, copia], { stdio: 'ignore' }); identita(copia);

    mkdirSync(join(STRUMENTI, 'routines', 'roles'), { recursive: true });
    writeFileSync(join(STRUMENTI, 'routines', 'roles', 'verifier-riallineamento.md'), '# verifica dopo il riallineamento\n');
    Object.assign(process.env, {
      FILO_DISPATCH_STATE_DIR: cartellaTemporanea('verifica-2101-stato-'),
      FILO_REPO_ROOT: copia, FILO_TOOLS_ROOT: STRUMENTI, TMPDIR: TEMP, TEMP, TMP: TEMP,
    });
    const { emit, serverCtx } = await import('../../../scripts/dispatch.mjs');
    const bucket = { role: 'verifier', id: 'x', num: '#9', branch: 'worker/x' };
    const perimetro = { shaVerificato: VERIFICATO, reportRebase: 'Riallineato su main attuale. Conflitto in b.js, solo meccanico. Unit tutti verdi.' };
    let out = '';
    const o = process.stdout.write; const e = process.stderr.write;
    process.stdout.write = (s) => { out += s; return true; };
    process.stderr.write = () => true;
    try { emit(bucket, serverCtx(bucket, { payload: { feedback: { text: 't' }, scope: 'riallineamento', perimetro } })); } finally {
      process.stdout.write = o; process.stderr.write = e;
    }
    const istruzioni = JSON.parse(out).instructions;
    expect(istruzioni).toMatch(/Il riallineamento non è su questo ramo/);
  } finally {
    for (const d of [BASE, STRUMENTI, TEMP]) { try { togliCartella(d); } catch (_) {} }
  }
});
