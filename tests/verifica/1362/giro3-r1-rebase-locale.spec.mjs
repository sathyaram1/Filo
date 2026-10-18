// Verifica #1362, giro 3, rilievo 1: due sessioni locali nella stessa cartella. Il commit della sessione sporca, non
// ancora spinto, viene riscritto dal rebase su main della pulita: la copia perde l'autore e parte col biglietto pulito.
import { test, expect } from '../../fixtures/electron.mjs';
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

function biglietto(dir, nome, lettera) {
  const file = join(dir, `${nome}.json`);
  writeFileSync(file, JSON.stringify({ ticket: `${nome}-${lettera.repeat(40)}`, fp: lettera.repeat(64), natoIl: Date.now() }));
  return { file, ticket: `${nome}-${lettera.repeat(40)}` };
}

const patchId = (dir, sha) => execFileSync('git', ['patch-id', '--stable'], { cwd: dir, encoding: 'utf8', input: g(dir, ['show', sha]) + '\n' }).split(/\s+/)[0];

test('r1 il commit di una sessione sporca riscritto dal rebase della pulita nella stessa cartella non parte col biglietto pulito', () => {
  const base = cartellaTemporanea('filo-1362-g3r2-');
  const origin = join(base, 'origin.git');
  mkdirSync(origin);
  g(origin, ['init', '--bare', '-q', '--initial-branch=main']);
  const dir = join(base, 'cartella');
  mkdirSync(dir);
  g(dir, ['init', '-q', '--initial-branch=main']);
  g(dir, ['remote', 'add', 'origin', origin]);
  g(dir, ['config', 'user.email', 't@t']); g(dir, ['config', 'user.name', 't']);
  writeFileSync(join(dir, 'README.md'), 'base\n');
  g(dir, ['add', '-A']); g(dir, ['commit', '-qm', 'base']);
  g(dir, ['push', '-q', 'origin', 'main']);
  g(dir, ['checkout', '-qb', 'claude/x']);
  expect(installaControlloSpedizione(dir)).toBe('installato');
  const pulito = biglietto(base, 'pulito', 'a');
  const sporco = biglietto(base, 'sporco', 'b');
  const envPulita = ambiente(origin, { FILO_BIGLIETTO_FILE: pulito.file });
  const envSporca = ambiente(origin, { FILO_BIGLIETTO_FILE: sporco.file });

  // La pulita spinge il suo lavoro.
  writeFileSync(join(dir, 'pulito.txt'), 'lavoro della sessione pulita\n');
  g(dir, ['add', '-A']); g(dir, ['commit', '-qm', 'pulito'], envPulita);
  expect(spawnSync('git', ['push', '-q', 'origin', 'claude/x'], { cwd: dir, env: envPulita }).status).toBe(0);

  // Intanto main va avanti su origin.
  const altrove = join(base, 'altrove');
  g(base, ['clone', '-q', origin, altrove]);
  g(altrove, ['config', 'user.email', 't@t']); g(altrove, ['config', 'user.name', 't']);
  writeFileSync(join(altrove, 'main.txt'), 'main avanti\n');
  g(altrove, ['add', '-A']); g(altrove, ['commit', '-qm', 'main avanti']);
  g(altrove, ['push', '-q', 'origin', 'main']);

  // La sessione sporca committa dalla shell e non spinge: il suo commit è annotato col biglietto sporco.
  writeFileSync(join(dir, 'sporco.txt'), 'scritto dopo aver letto un testo di un utente\n');
  g(dir, ['add', '-A']); g(dir, ['commit', '-qm', 'sporco'], envSporca);
  const d = g(dir, ['rev-parse', 'HEAD']);
  expect(S.autoreDi(dir, d)?.ticket).toBe(sporco.ticket);

  // La pulita si riallinea su main (come fa la verifica locale quando il ramo è indietro) e spinge.
  g(dir, ['fetch', '-q', 'origin'], envPulita);
  g(dir, ['rebase', '-q', 'origin/main'], envPulita);
  expect(spawnSync('git', ['push', '-q', '--force-with-lease', 'origin', 'claude/x'], { cwd: dir, env: envPulita }).status).toBe(0);

  const dd = patchId(dir, d);
  const dichiaratiDallaPulita = S.vociInCoda(S.cartellaCoda(dir))
    .filter((v) => v.ticket === pulito.ticket)
    .flatMap((v) => [...(v.commits || []), ...(v.riscritti || []).map((r) => r.sha)]);
  const copieDelloSporco = dichiaratiDallaPulita.filter((c) => patchId(dir, c) === dd);
  expect(copieDelloSporco, 'la copia del commit della sessione sporca non deve partire col biglietto pulito').toEqual([]);
});
