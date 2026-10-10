// Verifica locale «unit-senza-tempo», giro 6, rilievo 1: un file di unit che aspetta un processo vero non deve
// dipendere da quanto la macchina ci mette a farlo partire. Qui il server finto dei test parte in sedici secondi, come
// un processo sul PC carico: i file che lo aspettano non devono cadere né restare appesi.
import { test, expect } from '@playwright/test';
import { spawn, spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';

const ROOT = resolve(process.cwd());
const FILE = ['tests/unit/ramoServer.test.mjs', 'tests/unit/verifyLocal.test.mjs'];
const PARTENZA_MS = 16_000;
// Solo contro l'appeso: da soli, a macchina carica e col server lento, questi file si caricano in meno di un minuto.
const APPESO_MS = 5 * 60_000;

test.setTimeout(15 * 60_000);

test('r1 un server finto che parte lento non fa cadere né appendere i file di unit che lo aspettano', async () => {
  const lento = join(cartellaTemporanea('server-finto-lento-'), 'lento.mjs');
  writeFileSync(lento, `if (/finto-config-routines\\.mjs$/.test(process.argv[1] || '')) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ${PARTENZA_MS});\n`);
  const carica = (file) => new Promise((ok) => {
    // Nessun test scelto: si carica il file, che è dove aspetta il server finto.
    const p = spawn(process.execPath, ['--test', '--test-name-pattern=^nessuno$', file], {
      cwd: ROOT, env: { ...process.env, NODE_OPTIONS: `--import=${pathToFileURL(lento).href}` }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    let appeso = false;
    p.stdout.on('data', (c) => { out += c; });
    p.stderr.on('data', (c) => { out += c; });
    const stop = setTimeout(() => {
      appeso = true;
      spawnSync('taskkill', ['/pid', String(p.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
      if (process.platform !== 'win32') p.kill('SIGKILL');
    }, APPESO_MS);
    p.on('close', (code) => {
      clearTimeout(stop);
      const errore = (out.match(/server finto[^\n"]*/) || [''])[0];
      ok({ file, code, appeso, errore });
    });
  });
  const esiti = await Promise.all(FILE.map(carica));
  const rossi = esiti.filter((e) => e.code !== 0 || e.appeso)
    .map((e) => `${e.file}: ${e.appeso ? `ancora aperto dopo ${APPESO_MS / 60_000} minuti` : `uscito con ${e.code}`}${e.errore ? ` (${e.errore})` : ''}`);
  expect(rossi, 'file caduti o appesi col server finto lento a partire').toEqual([]);
});
