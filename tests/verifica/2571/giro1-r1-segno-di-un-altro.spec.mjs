// Verifica #2571 giro 1, rilievo 1: il segno di un finish:check ucciso resta nella cartella git del clone, che passa al
// worker dopo. Chi arriva su un altro ramo e non ha lanciato niente non deve sentirsi dire che la «sua» corsa è morta.

import '../../helpers/senzaSessione.mjs';
import { test, expect } from '@playwright/test';
import { spawn, execFileSync } from 'node:child_process';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const { apriCorsa } = await import('../../../scripts/lib/corsa-controlli.mjs');
const { autopsiaDelWorker } = await import('../../../scripts/lib/veglia-worker.mjs');

const git = (d, ...a) => execFileSync('git', ['-C', d, '-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { encoding: 'utf8' }).trim();

function cloneConSegnoDelWorkerDiPrima() {
  const d = cartellaTemporanea('filo-clone-riusato-');
  execFileSync('git', ['init', '-q', '-b', 'worker/primo', d]);
  git(d, 'commit', '-q', '--allow-empty', '-m', 'primo');
  // Il worker di prima: finish:check ucciso con SIGKILL sul suo ramo (pid che non c'è più).
  apriCorsa(d, { sha: git(d, 'rev-parse', 'HEAD'), proc: { pid: 2 ** 22 + 13, on: () => {} }, memoria: () => ({}) });
  // Il clone passa al worker dopo, su un altro lavoro.
  git(d, 'checkout', '-q', '--orphan', 'worker/secondo');
  git(d, 'commit', '-q', '--allow-empty', '-m', 'secondo');
  return d;
}

test('r1 aspetta, nel clone passato a un altro lavoro, non attribuisce al worker nuovo la corsa morta di quello prima', async () => {
  test.skip(process.platform !== 'linux', 'i processi si leggono da /proc');
  const root = cloneConSegnoDelWorkerDiPrima();
  const r = await new Promise((ok) => {
    const p = spawn(process.execPath, [join(REPO, 'scripts', 'routine-channel.mjs'), 'aspetta', 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcde'], {
      cwd: root, env: { ...process.env, FILO_REPO_ROOT: root, FILO_NO_BEAT: '1', FILO_ASPETTA_FETTA_MS: '0' },
    });
    let so = '';
    p.stdout.on('data', (c) => { so += c; });
    p.stderr.on('data', (c) => { so += c; });
    p.on('close', (code) => ok({ code, so }));
  });
  expect(r.code, r.so).toBe(0);
  expect(r.so).not.toMatch(/finish:check è morta senza finire/);
  expect(r.so).not.toMatch(/--guasto/);
});

test('r1 la veglia, nel clone passato a un altro lavoro, non scrive nel guasto del worker nuovo la corsa di quello prima', () => {
  const root = cloneConSegnoDelWorkerDiPrima();
  expect(autopsiaDelWorker(root, { mio: true }, { memoria: () => ({}) }).corsa).toBeNull();
});
