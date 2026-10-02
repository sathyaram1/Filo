// Verifica locale «sforzo per ruolo», giro 1, rilievo 1: dopo che un worker si è posizionato su un ramo nato prima
// della modifica, l'orchestratore deve trovare ancora gli agenti decisi (primo lavoro xhigh, gli altri high).
// Clone temporaneo che condivide gli oggetti del repo; non apre Filo, non tocca origin.
import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';

const ROOT = join(import.meta.dirname, '..', '..', '..');
const git = (cwd, args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const sforzo = (dir, nome) => {
  const f = join(dir, '.claude', 'agents', `${nome}.md`);
  if (!existsSync(f)) return 'assente';
  const m = readFileSync(f, 'utf8').match(/^effort:\s*(\S+)/m);
  return m ? m[1] : 'non dichiarato';
};

test('il worker successivo a uno su un ramo vecchio parte con lo sforzo deciso per il suo ruolo', async () => {
  const { prepareBranch } = await import(pathToFileURL(join(ROOT, 'scripts/lib/branch-integrity.mjs')).href);
  const testa = git(ROOT, ['rev-parse', 'HEAD']);
  const vecchio = git(ROOT, ['merge-base', 'HEAD', 'origin/main']);
  const tmp = cartellaTemporanea('sforzo-ruoli-');
  const clone = join(tmp, 'clone');
  try {
    git(tmp, ['clone', '--shared', '--no-checkout', '--quiet', ROOT, clone]);
    git(clone, ['checkout', '--quiet', '-B', 'main', testa]);
    git(clone, ['branch', 'worker/prova-ramo-vecchio', vecchio]);
    // Quello che fa un verificatore su un ramo aperto prima che la modifica arrivasse su main.
    const r = prepareBranch({ root: clone, branch: 'worker/prova-ramo-vecchio', mainBranch: 'main' });
    expect(r.ok, r.message).toBe(true);
    // L'orchestratore resta nella stessa cartella e sceglie il prossimo worker da lì.
    expect({
      'routine-nuovo-lavoro': sforzo(clone, 'routine-nuovo-lavoro'),
      'routine-worker': sforzo(clone, 'routine-worker'),
      'routine-secaudit': sforzo(clone, 'routine-secaudit'),
    }).toEqual({ 'routine-nuovo-lavoro': 'xhigh', 'routine-worker': 'high', 'routine-secaudit': 'high' });
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
