// Verifica locale «lavori locali», giro 6, rilievo 2: il comando con cui una sessione manda alle routine un problema
// non urgente (la regola dell'owner sui canali delle segnalazioni) non deve diventare in silenzio un lavoro locale.
// Solo prova a vuoto: niente rete.
import { test, expect } from './../../fixtures/electron.mjs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..', '..', '..');

test('una segnalazione aperta col comando di sempre arriva alle routine, o lo strumento chiede di scegliere', async () => {
  const r = spawnSync(process.execPath, [join(ROOT, 'scripts', 'claude-feedback.mjs'), 'Il pulsante X non salva', 'Passi: …', '--dry-run'], {
    cwd: ROOT, encoding: 'utf8', timeout: 60000,
  });
  const uscita = `${r.stdout || ''}${r.stderr || ''}`;
  // Accettati: rifiuto che chiede la scelta, oppure apertura per le routine. Non accettato: «lavoro locale» senza averlo chiesto.
  const silenziosamenteLocale = r.status === 0 && /lavoro locale/i.test(uscita);
  expect(silenziosamenteLocale, uscita).toBe(false);
});
