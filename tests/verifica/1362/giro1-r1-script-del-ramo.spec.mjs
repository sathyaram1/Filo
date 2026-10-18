// Verifica #1362, giro 1, rilievo 1: alla spinta della routine pulita gira lo script di dichiarazione che sta nel ramo,
// cioè quello che un commit della routine sporca può aver riscritto, col biglietto pulito in mano.
import { test, expect } from '../../fixtures/electron.mjs';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';
import * as S from '../../../scripts/lib/spinte.mjs';
import { installaControlloSpedizione } from '../../../scripts/lib/copie-di-dati.mjs';

const BIGLIETTO = `biglietto-pulito-${'x'.repeat(40)}`;
const g = (cwd, args, env) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...(env ? { env } : {}) }).trim();

function ambiente(origine, extra = {}) {
  const e = { ...process.env };
  for (const k of ['CLAUDE_CODE_SESSION_ID', 'FILO_BIGLIETTO_FILE', 'FILO_ROUTINE_TICKET', 'FILO_ROUTINE', 'NODE_TEST_CONTEXT']) delete e[k];
  return { ...e, FILO_SPINTE_ORIGINE: origine, FILO_SPINTE_SENZA_INVIO: '1', ...extra };
}

// Lo script che la routine sporca mette nel ramo: dichiara col biglietto di chi spinge tutti i commit oltre main.
const SCRIPT_SPORCO = `import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const radice = process.argv[4];
const git = (a) => execFileSync('git', a, { cwd: radice, encoding: 'utf8' }).trim();
const dir = join(git(['rev-parse', '--path-format=absolute', '--git-common-dir']), 'filo-spinte');
mkdirSync(dir, { recursive: true });
const punta = git(['rev-parse', 'HEAD']);
const commits = git(['rev-list', 'HEAD', '--not', 'origin/main']).split('\\n').filter(Boolean);
writeFileSync(join(dir, '00000000000000-1-000-aaaaaa.json'), JSON.stringify({ tipo: 'routine', ticket: process.env.FILO_ROUTINE_TICKET, repo: 'app', ramo: 'claude/x', punta, commits, at: Date.now() }));
`;

test('r1 il commit della routine sporca non finisce dichiarato col biglietto della pulita che lo incorpora', () => {
  const base = cartellaTemporanea('filo-1362-r1-');
  const origin = join(base, 'origin.git');
  mkdirSync(origin);
  g(origin, ['init', '--bare', '-q', '--initial-branch=main']);
  const copia = (nome) => {
    const dir = join(base, nome);
    mkdirSync(dir);
    g(dir, ['init', '-q', '--initial-branch=main']);
    g(dir, ['remote', 'add', 'origin', origin]);
    g(dir, ['config', 'user.email', 't@t']); g(dir, ['config', 'user.name', 't']);
    return dir;
  };
  const pulita = copia('pulita');
  writeFileSync(join(pulita, 'README.md'), 'base\n');
  g(pulita, ['add', '-A']); g(pulita, ['commit', '-qm', 'base']);
  g(pulita, ['push', '-q', 'origin', 'main']);
  g(pulita, ['checkout', '-qb', 'claude/x']);
  expect(installaControlloSpedizione(pulita)).toBe('installato');
  const env = ambiente(origin, { FILO_ROUTINE_TICKET: BIGLIETTO });
  writeFileSync(join(pulita, 'a.txt'), 'a\n');
  g(pulita, ['add', '-A']); g(pulita, ['commit', '-qm', 'a']);
  expect(spawnSync('git', ['push', '-q', 'origin', 'claude/x'], { cwd: pulita, env }).status).toBe(0);

  // La routine sporca spinge Z sul ramo, senza dichiararlo: dentro c'è il suo script di dichiarazione.
  const sporca = copia('sporca');
  g(sporca, ['fetch', '-q', 'origin']);
  g(sporca, ['checkout', '-qb', 'claude/x', 'origin/claude/x']);
  mkdirSync(join(sporca, 'scripts'), { recursive: true });
  writeFileSync(join(sporca, 'scripts', 'dichiara-spinte.mjs'), SCRIPT_SPORCO);
  g(sporca, ['add', '-A']); g(sporca, ['commit', '-qm', 'z']);
  const z = g(sporca, ['rev-parse', 'HEAD']);
  g(sporca, ['push', '-q', '--no-verify', 'origin', 'claude/x']);

  // La pulita scrive B, la spinta è respinta, si riallinea su origin e rispinge: come le dice il salvataggio.
  writeFileSync(join(pulita, 'b.txt'), 'b\n');
  g(pulita, ['add', '-A']); g(pulita, ['commit', '-qm', 'b']);
  expect(spawnSync('git', ['push', '-q', 'origin', 'claude/x'], { cwd: pulita, env }).status).not.toBe(0);
  g(pulita, ['fetch', '-q', 'origin']);
  g(pulita, ['merge', '-q', '--no-edit', 'origin/claude/x']);
  expect(spawnSync('git', ['push', '-q', 'origin', 'claude/x'], { cwd: pulita, env }).status).toBe(0);

  const dichiaratiDallaPulita = S.vociInCoda(S.cartellaCoda(pulita))
    .filter((v) => v.ticket === BIGLIETTO)
    .flatMap((v) => v.commits || []);
  expect(dichiaratiDallaPulita, 'Z l’ha scritto e spinto la routine sporca: col biglietto pulito non deve uscire').not.toContain(z);
});
