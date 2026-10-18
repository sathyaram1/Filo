// Verifica #1362, giro 1, rilievo 3: due sessioni locali nella stessa cartella. Il commit che la sessione sporca ha
// fatto e non ha spinto parte con la spinta della pulita, e si dichiara col biglietto di quest'ultima.
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

test('r3 il commit di una sessione sporca, spinto dal salvataggio di una pulita nella stessa cartella, non si dichiara col biglietto pulito', () => {
  const base = cartellaTemporanea('filo-1362-r3-');
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

  // La sessione sporca committa dalla shell e non spinge (o la sua spinta fallisce).
  writeFileSync(join(dir, 'sporco.txt'), 'scritto dopo aver letto un testo di un utente\n');
  g(dir, ['add', '-A']); g(dir, ['commit', '-qm', 'sporco'], envSporca);
  const d = g(dir, ['rev-parse', 'HEAD']);
  // La pulita salva il suo lavoro: commit e spinta col suo biglietto.
  writeFileSync(join(dir, 'pulito.txt'), 'lavoro della sessione pulita\n');
  g(dir, ['add', '-A']); g(dir, ['commit', '-qm', 'pulito'], envPulita);
  expect(spawnSync('git', ['push', '-q', 'origin', 'claude/x'], { cwd: dir, env: envPulita }).status).toBe(0);

  const dichiaratiDallaPulita = S.vociInCoda(S.cartellaCoda(dir))
    .filter((v) => v.ticket === pulito.ticket)
    .flatMap((v) => v.commits || []);
  expect(dichiaratiDallaPulita, 'il commit l’ha scritto la sessione sporca').not.toContain(d);
});
