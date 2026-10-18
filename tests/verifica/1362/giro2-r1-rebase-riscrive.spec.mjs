// Verifica #1362, giro 2, rilievo 1: un rebase della routine pulita riscrive anche il commit che una sporca ha spinto sul
// suo ramo, e il pre-push dichiara la copia riscritta col biglietto pulito. Git vero, pre-push vero, nessun server.
import { test, expect } from './../../fixtures/electron.mjs';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';
import * as S from '../../../scripts/lib/spinte.mjs';
import { installaControlloSpedizione } from '../../../scripts/lib/copie-di-dati.mjs';

const BIGLIETTO = `biglietto-pulito-${'x'.repeat(40)}`;
const g = (cwd, args, opt = {}) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], ...opt }).trim();

function ambiente(origine, extra = {}) {
  const e = { ...process.env };
  for (const k of ['CLAUDE_CODE_SESSION_ID', 'FILO_BIGLIETTO_FILE', 'FILO_ROUTINE_TICKET', 'FILO_ROUTINE', 'NODE_TEST_CONTEXT']) delete e[k];
  return { ...e, FILO_SPINTE_ORIGINE: origine, FILO_SPINTE_SENZA_INVIO: '1', ...extra };
}

function copia(base, origin, nome) {
  const dir = join(base, nome);
  mkdirSync(dir);
  g(dir, ['init', '-q', '--initial-branch=main']);
  g(dir, ['remote', 'add', 'origin', origin]);
  g(dir, ['config', 'user.email', 'claude@routine']);
  g(dir, ['config', 'user.name', 'claude-routine']);
  return dir;
}

function commit(dir, file) {
  writeFileSync(join(dir, file), `${file}\n`);
  g(dir, ['add', '-A']);
  g(dir, ['commit', '-qm', file]);
  return g(dir, ['rev-parse', 'HEAD']);
}

const patchId = (dir, sha) => g(dir, ['patch-id', '--stable'], { input: g(dir, ['show', sha]) + '\n' }).split(/\s+/)[0];

test('r1 la pulita che fa il rebase su main dopo aver preso il commit della sporca non lo dichiara come suo', () => {
  const base = cartellaTemporanea('filo-1362-rebase-');
  const origin = join(base, 'origin.git');
  mkdirSync(origin);
  g(origin, ['init', '--bare', '-q', '--initial-branch=main']);
  const pulita = copia(base, origin, 'pulita');
  commit(pulita, 'README.md');
  g(pulita, ['push', '-q', 'origin', 'main']);
  g(pulita, ['checkout', '-qb', 'worker/x']);
  expect(installaControlloSpedizione(pulita)).toBe('installato');
  const env = ambiente(origin, { FILO_ROUTINE_TICKET: BIGLIETTO });
  const spingi = (...piu) => spawnSync('git', ['push', '-q', ...piu, 'origin', 'HEAD:refs/heads/worker/x'], { cwd: pulita, encoding: 'utf8', env });

  // La correzione pulita spinge il suo lavoro: dichiarato col suo biglietto.
  commit(pulita, 'lavoro.txt');
  expect(spingi().status).toBe(0);

  // Intanto main va avanti, e una routine sporca spinge Z sul ramo senza dichiararlo (il server rifiuta comunque le sue
  // dichiarazioni su un ramo che non è il suo).
  const sporca = copia(base, origin, 'sporca');
  g(sporca, ['fetch', '-q', 'origin']);
  g(sporca, ['checkout', '-qb', 'main', 'origin/main']);
  commit(sporca, 'main-avanti.txt');
  g(sporca, ['push', '-q', '--no-verify', 'origin', 'main']);
  g(sporca, ['checkout', '-qb', 'worker/x', 'origin/worker/x']);
  const z = commit(sporca, 'z-sporco.txt');
  g(sporca, ['push', '-q', '--no-verify', 'origin', 'worker/x']);

  // Il riallineamento pulito (ruolo resolver: git fetch origin main && git rebase origin/main) parte dal ramo com'è su
  // origin, quindi con Z dentro, e rispinge la storia riscritta.
  g(pulita, ['fetch', '-q', 'origin']);
  g(pulita, ['reset', '-q', '--hard', 'origin/worker/x']);
  g(pulita, ['rebase', '-q', 'origin/main']);
  expect(spingi('--force-with-lease').status).toBe(0);

  const zz = patchId(pulita, z);
  const dichiaratiDallaPulita = S.vociInCoda(S.cartellaCoda(pulita)).filter((v) => v.ticket === BIGLIETTO).flatMap((v) => v.commits);
  const riscrittoDiZ = dichiaratiDallaPulita.filter((c) => patchId(pulita, c) === zz);
  expect(riscrittoDiZ, 'la copia riscritta di Z l’ha spinta la sporca: dichiararla col biglietto pulito la fa entrare come lavoro fidato').toEqual([]);
});
