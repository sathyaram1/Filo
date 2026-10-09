// Verifica locale di «aspetta #N», giro 3: priorità e attese nello stesso comando dell'owner (a vuoto, dati veri).
import { test, expect } from '@playwright/test';
import { spawnSync } from 'node:child_process';

function feedback(...args) {
  const r = spawnSync(process.execPath, ['scripts/owner-feedback.mjs', ...args], { encoding: 'utf8', timeout: 120000 });
  return { codice: r.status, testo: `${r.stdout || ''}${r.stderr || ''}` };
}

test('r3 la priorità scritta insieme alle attese non si perde in silenzio', () => {
  for (const attesa of [['--aspetta', '663.2'], ['--aspetta-niente']]) {
    const r = feedback('903', '--priorita', '1', ...attesa, '--dry-run');
    const rifiutato = r.codice !== 0 && /RIFIUTATO/.test(r.testo);
    expect(rifiutato || /priorit/i.test(r.testo), `${attesa.join(' ')}: ${r.testo}`).toBe(true);
  }
});
