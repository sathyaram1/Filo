// Verifica #1968 giro 1: dopo un salto il server manda a chi riallinea di nuovo il commit approvato, che il primo rebase
// ha tolto dai rami. Nella copia nuova del correttore quel commit deve esserci, o il suo confronto alla consegna fallisce.
import { test, expect } from '@playwright/test';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea, togliCartella } from '../../helpers/percorsi.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const git = (dir, args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const identita = (dir) => { git(dir, ['config', 'user.email', 't@t']); git(dir, ['config', 'user.name', 't']); git(dir, ['config', 'commit.gpgsign', 'false']); };
const commit = (dir, file, testo, msg) => { writeFileSync(join(dir, file), testo); git(dir, ['add', '-A']); git(dir, ['commit', '-qm', msg]); return git(dir, ['rev-parse', 'HEAD']); };

test('r1 il correttore del secondo riallineamento riceve il commit approvato e lo confronta con la sua punta', () => {
  const BASE = cartellaTemporanea('verifica-1968-');
  try {
    const origin = join(BASE, 'origin.git'); const work = join(BASE, 'work'); const altro = join(BASE, 'altro'); const copia = join(BASE, 'copia');
    mkdirSync(origin); mkdirSync(work);
    git(origin, ['init', '--bare', '-q', '--initial-branch=main']);
    git(origin, ['config', 'uploadpack.allowAnySHA1InWant', 'true']);
    git(work, ['init', '-q', '--initial-branch=main']); identita(work);
    git(work, ['remote', 'add', 'origin', `file://${origin}`]);
    writeFileSync(join(work, '.gitignore'), '.claude/\n');
    commit(work, 'a.js', 'uno\n', 'inizio');
    git(work, ['push', '-q', 'origin', 'main']);
    git(work, ['checkout', '-qb', 'worker/x']);
    const APPROVATO = commit(work, 'b.js', 'lavoro\n', 'il lavoro approvato');
    git(work, ['push', '-q', 'origin', 'worker/x']);
    execFileSync('git', ['clone', '-q', `file://${origin}`, altro], { stdio: 'ignore' }); identita(altro);
    commit(altro, 'c.js', 'da main\n', 'main avanza');
    git(altro, ['push', '-q', 'origin', 'main']);
    // Primo riallineamento, saltato: la punta nuova sostituisce l'approvato sul ramo.
    git(work, ['fetch', '-q', 'origin', 'main']); git(work, ['rebase', '-q', 'origin/main']);
    git(work, ['push', '-q', '--force', 'origin', 'worker/x']);
    // Main va avanti ancora: secondo riallineamento, il correttore parte da una copia nuova.
    git(altro, ['pull', '-q', 'origin', 'main']);
    commit(altro, 'd.js', 'ancora main\n', 'main avanza ancora');
    git(altro, ['push', '-q', 'origin', 'main']);
    execFileSync('git', ['clone', '-q', '--branch', 'worker/x', `file://${origin}`, copia], { stdio: 'ignore' });

    const STRUMENTI = join(BASE, 'strumenti');
    mkdirSync(join(STRUMENTI, 'routines', 'roles'), { recursive: true });
    writeFileSync(join(STRUMENTI, 'routines', 'roles', 'fixer.md'), '# correzione\n');
    const TEMP = join(BASE, 'tmp'); mkdirSync(TEMP);
    const prova = `
      const { emit, serverCtx } = await import(${JSON.stringify(join(REPO, 'scripts', 'dispatch.mjs'))});
      const { readMarker } = await import(${JSON.stringify(join(REPO, 'scripts', 'lib', 'routine-role.mjs'))});
      const { fileRiscritti } = await import(${JSON.stringify(join(REPO, 'scripts', 'lib', 'su-main.mjs'))});
      const bucket = { role: 'fixer', id: 'x', num: '#9', branch: 'worker/x' };
      const o = process.stdout.write; process.stdout.write = () => true;
      try { emit(bucket, serverCtx(bucket, { payload: { feedback: { text: 't' }, shaVerificato: ${JSON.stringify(APPROVATO)} } })); } finally { process.stdout.write = o; }
      const dal = readMarker(${JSON.stringify(copia)}).dal;
      console.log(JSON.stringify({ dal, confronto: fileRiscritti(${JSON.stringify(copia)}, { prima: dal }) }));
    `;
    const r = spawnSync(process.execPath, ['--input-type=module', '-e', prova], {
      encoding: 'utf8',
      env: { ...process.env, FILO_REPO_ROOT: copia, FILO_TOOLS_ROOT: STRUMENTI, FILO_DISPATCH_STATE_DIR: join(BASE, 'stato'),
        CLAUDE_CONFIG_DIR: join(BASE, 'claude'), TMPDIR: TEMP, TEMP, TMP: TEMP, FILO_ROUTINE: '' },
    });
    expect(r.status, r.stderr).toBe(0);
    const esito = JSON.parse(r.stdout.trim().split('\n').pop());
    expect(esito.dal).toBe(APPROVATO);
    expect(esito.confronto.ok, esito.confronto.errore).toBe(true);
    expect(esito.confronto.file).toEqual([]);
  } finally { try { togliCartella(BASE); } catch (_) {} }
});
