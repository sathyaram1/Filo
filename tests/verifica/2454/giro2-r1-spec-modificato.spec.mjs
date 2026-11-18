// Prova del giro 2 di #2454: uno spec che main ha e il ramo modifica, lanciato davvero nello strumento di confronto
// su un clone di prova (main e ramo finti, costruiti qui), senza toccare il repo.
import { test, expect } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { symlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';

const ROOT = resolve('.');
const SPEC = 'tests/verifica/2454/giro2-r1-materiale.spec.mjs';
const DATO = 'tests/verifica/2454/giro2-r1-comportamento.txt';
const spec = (atteso) => `import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
test('comportamento', () => { expect(readFileSync('${DATO}', 'utf8').trim()).toBe('${atteso}'); });
`;

function git(cwd, args, extra = {}) {
  const r = spawnSync('git', ['-c', 'user.name=prova', '-c', 'user.email=prova@example.invalid', ...args], { cwd, encoding: 'utf8', ...extra });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
}

/** Un commit sopra `padre` con i file dati, scritto senza albero di lavoro. */
function commit(repo, padre, file, msg) {
  const env = { ...process.env, GIT_INDEX_FILE: join(repo, '.git', `indice-${msg}`) };
  git(repo, ['read-tree', padre], { env });
  for (const [percorso, testo] of Object.entries(file)) {
    const blob = git(repo, ['hash-object', '-w', '--stdin'], { input: testo });
    git(repo, ['update-index', '--add', '--cacheinfo', `100644,${blob},${percorso}`], { env });
  }
  return git(repo, ['commit-tree', git(repo, ['write-tree'], { env }), '-p', padre, '-m', msg]);
}

test('r1 un caso che il ramo modifica e che su main, con la versione di main, è verde non diventa «c\'era già su main»', () => {
  test.setTimeout(300_000);
  const repo = join(cartellaTemporanea('filo-2454-'), 'repo');
  git(ROOT, ['clone', '--quiet', '--shared', '--no-checkout', ROOT, repo]);
  git(repo, ['remote', 'set-url', 'origin', join(repo, 'origine-che-non-esiste')]);
  symlinkSync(join(ROOT, 'node_modules'), join(repo, 'node_modules'), 'junction');
  const base = git(ROOT, ['rev-parse', 'HEAD']);
  // Main: lo spec si aspetta il comportamento vecchio, che c'è. Ramo: lo spec si aspetta quello nuovo, che il ramo rompe.
  const suMain = commit(repo, base, { [SPEC]: spec('vecchio'), [DATO]: 'vecchio\n' }, 'main');
  const sulRamo = commit(repo, suMain, { [SPEC]: spec('nuovo'), [DATO]: 'rotto\n' }, 'ramo');
  git(repo, ['update-ref', 'refs/remotes/origin/main', suMain]);
  git(repo, ['update-ref', 'HEAD', sulRamo]);

  const env = { ...process.env, FILO_REPO_ROOT: repo };
  for (const k of Object.keys(env)) if (/^(TEST_|PW_|PLAYWRIGHT_)/.test(k)) delete env[k];
  const r = spawnSync(process.execPath, [join(ROOT, 'scripts', 'spec-su-main.mjs'), SPEC], { encoding: 'utf8', env, timeout: 280_000 });
  const out = `${r.stdout || ''}\n${r.stderr || ''}`;
  const verdetto = out.slice(out.lastIndexOf('▸ Ramo '));
  expect(verdetto).toContain('giro2-r1-materiale.spec.mjs: ramo rosso');
  // Con la versione di main il caso su main è verde: il rosso è del ramo, che ha cambiato lo spec e il comportamento.
  expect(verdetto).not.toMatch(/c'era già su main/);
  expect(verdetto).toMatch(/solo sul ramo|rotto il ramo|è del ramo/);
});
