// Verifica #1362, giro 4, rilievo 1: la copia che spinge conta come suo un commit di altri quando ne perde la traccia
// (uno squash nella stessa cartella, un ref remoto potato). Git vero, pre-push e post-commit veri, nessun server.
import { test, expect } from './../../fixtures/electron.mjs';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';
import * as S from '../../../scripts/lib/spinte.mjs';
import { installaControlloSpedizione } from '../../../scripts/lib/copie-di-dati.mjs';

const g = (cwd, args, env) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...(env ? { env } : {}) }).trim();

function ambiente(origine, extra = {}) {
  const e = { ...process.env };
  for (const k of ['CLAUDE_CODE_SESSION_ID', 'FILO_BIGLIETTO_FILE', 'FILO_ROUTINE_TICKET', 'FILO_ROUTINE', 'NODE_TEST_CONTEXT']) delete e[k];
  return { ...e, FILO_SPINTE_ORIGINE: origine, FILO_SPINTE_SENZA_INVIO: '1', ...extra };
}

function deposito(prefisso) {
  const base = cartellaTemporanea(prefisso);
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
  const sporca = copia('sporca');
  expect(installaControlloSpedizione(pulita)).toBe('installato');
  return { base, origin, pulita, sporca };
}

function commit(dir, file, env) {
  writeFileSync(join(dir, file), `${file}\n`);
  g(dir, ['add', '-A']);
  g(dir, ['commit', '-qm', file], env);
  return g(dir, ['rev-parse', 'HEAD']);
}

const spingi = (dir, env, ...piu) => spawnSync('git', ['push', '-q', ...piu, 'origin', 'claude/x'], { cwd: dir, encoding: 'utf8', env });
const dichiaratiDa = (dir, ticket) => S.vociInCoda(S.cartellaCoda(dir)).filter((v) => v.ticket === ticket)
  .flatMap((v) => [...(v.commits || []), ...(v.riscritti || []).map((r) => r.sha)]);
const filesDi = (dir, sha) => g(dir, ['show', '--format=', '--name-only', sha]).split('\n').filter(Boolean);

test('r1 due sessioni nella stessa cartella: lo squash della pulita sopra un commit mai partito della sporca non parte col biglietto pulito', () => {
  const d = deposito('filo-1362-squash-');
  const biglietto = (nome, lettera) => {
    const file = join(d.base, `${nome}.json`);
    writeFileSync(file, JSON.stringify({ ticket: `${nome}-${lettera.repeat(40)}`, fp: lettera.repeat(64), natoIl: 1 }));
    return { file, ticket: `${nome}-${lettera.repeat(40)}` };
  };
  const pulito = biglietto('pulito', 'a');
  const sporco = biglietto('sporco', 'b');
  const envPulita = ambiente(d.origin, { FILO_BIGLIETTO_FILE: pulito.file });
  const envSporca = ambiente(d.origin, { FILO_BIGLIETTO_FILE: sporco.file });
  commit(d.pulita, 'p.txt', envPulita);
  expect(spingi(d.pulita, envPulita).status).toBe(0);
  // La sporca committa dalla shell e non spinge; la pulita committa e poi rifà i commit non partiti in uno solo
  // (come fa da solo il salvataggio quando fra quei commit trova la forma di una copia dei dati).
  commit(d.pulita, 's.txt', envSporca);
  commit(d.pulita, 'p2.txt', envPulita);
  g(d.pulita, ['reset', '-q', '--soft', 'origin/claude/x']);
  g(d.pulita, ['commit', '-qm', 'p2 + s'], envPulita);
  const unito = g(d.pulita, ['rev-parse', 'HEAD']);
  expect(filesDi(d.pulita, unito)).toContain('s.txt');
  expect(spingi(d.pulita, envPulita).status).toBe(0);
  expect(dichiaratiDa(d.pulita, pulito.ticket), 'il commit porta il lavoro della sessione sporca: il biglietto pulito non lo copre')
    .not.toContain(unito);
});

test('r1 routine: un commit della sporca preso dalla pulita non diventa suo se il ref remoto viene potato mentre il ramo non c’è', () => {
  const d = deposito('filo-1362-potato-');
  const BIGLIETTO = `biglietto-pulito-${'x'.repeat(40)}`;
  const env = ambiente(d.origin, { FILO_ROUTINE_TICKET: BIGLIETTO });
  commit(d.pulita, 'c1.txt', env);
  expect(spingi(d.pulita, env).status).toBe(0);
  const c1 = g(d.pulita, ['rev-parse', 'HEAD']);
  // La sporca spinge X sul ramo della pulita; la pulita, respinta, si riallinea su origin e va avanti.
  g(d.sporca, ['fetch', '-q', 'origin']);
  g(d.sporca, ['checkout', '-qB', 'claude/x', 'origin/claude/x']);
  const x = commit(d.sporca, 'x.txt');
  g(d.sporca, ['push', '-q', '--no-verify', 'origin', 'claude/x']);
  g(d.pulita, ['pull', '-q', '--no-rebase', 'origin', 'claude/x'], env);
  commit(d.pulita, 'c2.txt', env);
  // La sporca toglie il ramo; la pulita aggiorna i ref con la potatura; la sporca rimette il ramo dov'era prima di X.
  g(d.sporca, ['push', '-q', '--no-verify', 'origin', '--delete', 'claude/x']);
  g(d.pulita, ['fetch', '-q', '--prune', 'origin'], env);
  g(d.sporca, ['push', '-q', '--no-verify', 'origin', `${c1}:refs/heads/claude/x`]);
  g(d.pulita, ['fetch', '-q', 'origin'], env);
  expect(spingi(d.pulita, env).status).toBe(0);
  expect(dichiaratiDa(d.pulita, BIGLIETTO), 'X l’ha scritto e spinto la sporca: la pulita non lo dichiara come suo').not.toContain(x);
});
