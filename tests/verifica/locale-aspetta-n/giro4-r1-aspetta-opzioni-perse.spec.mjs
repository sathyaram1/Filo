// Verifica locale di «aspetta #N», giro 4: da riga di comando un'opzione che non si applica alle attese va rifiutata, non persa.
import { test, expect } from '@playwright/test';
import { spawnSync } from 'node:child_process';

// Un id finto: il rifiuto deve arrivare prima di cercarlo, come per --frase o --priorita.
function lancia(...args) {
  const r = spawnSync(process.execPath, ['scripts/owner-feedback.mjs', 'zzFintoId000', ...args, '--dry-run'], { encoding: 'utf8', timeout: 60000 });
  return { code: r.status, out: `${r.stdout || ''}${r.stderr || ''}` };
}

for (const altra of [['--branch', 'claude/x'], ['--reason', 'motivo'], ['--come-routine']]) {
  for (const attesa of [['--aspetta', '663.2'], ['--aspetta-niente']]) {
    test(`r1 ${attesa.join(' ')} con ${altra[0]} rifiuta invece di lasciarla cadere`, () => {
      const r = lancia(...attesa, ...altra);
      expect(r.out).toMatch(/RIFIUTATO: --aspetta(-niente)? va da solo|RIFIUTATO:.*--(branch|reason|come-routine)/);
      expect(r.code).toBe(1);
    });
  }
}
