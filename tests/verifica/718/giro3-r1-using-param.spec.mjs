// Verifica #718, giro 3: anche con `using` o `param` in testa, un programma fallito a metà fa fallito il comando.
// Gira dove c'è una PowerShell (powershell.exe su Windows, pwsh altrove), sennò salta.

import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { rmSync } from 'node:fs';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const T = require(join(ROOT, 'src', 'main', 'services', 'terminal.js'));
const S = require(join(ROOT, 'src', 'main', 'services', 'shell.js'));

const ENV = { ...process.env, TERM: 'dumb', POWERSHELL_TELEMETRY_OPTOUT: '1' };
const POWERSHELL = (() => {
  const nome = process.platform === 'win32' ? 'powershell.exe' : 'pwsh';
  const r = spawnSync(nome, ['-NoProfile', '-NonInteractive', '-Command', '1'], { env: ENV, encoding: 'utf8', timeout: 60_000 });
  return r.status === 0 ? nome : null;
})();

function comeSuWindows(fn) {
  if (process.platform === 'win32') return fn();
  const prima = Object.getOwnPropertyDescriptor(process, 'platform');
  Object.defineProperty(process, 'platform', { value: 'win32' });
  try { return fn(); } finally { Object.defineProperty(process, 'platform', prima); }
}

const NODE = `& "${process.execPath}"`;
const esce = (n) => `${NODE} -e "process.exit(${n})"`;
const COMANDI = [
  `using namespace System.Text\n${esce(3)}\nWrite-Output fatto`,
  `param($quanti = 1)\n${esce(3)}\nWrite-Output fatto`,
];

test.describe('#718 programma fallito a metà, con using o param in testa', () => {
  test.skip(!POWERSHELL, 'nessuna PowerShell su questa macchina');
  const TMP = cartellaTemporanea('filo-v718g3-');
  test.afterAll(() => rmSync(TMP, { recursive: true, force: true }));

  for (const comando of COMANDI) {
    const testa = comando.split('\n')[0];
    test(`r1 comando dell'assistente che comincia con «${testa}»: fallito col codice del programma`, () => {
      const mark = T.nuovoMarcatore();
      const inv = comeSuWindows(() => T.invocazione('powershell', comando, { trackCwd: true, mark }));
      const r = spawnSync(POWERSHELL, inv.args, { cwd: TMP, env: ENV, input: inv.stdin, encoding: 'utf8', timeout: 60_000 });
      const sonda = T.extractCwdMark(r.stdout, mark);
      expect(sonda.stdout.trim()).toBe('fatto');
      expect(sonda.code, r.stderr).toBe(3);
    });

    test(`r1 terminale della dashboard, comando che comincia con «${testa}»: fallito col codice del programma`, () => {
      const stdin = T.PREPARA_STDIN_POWERSHELL + T.righePowerShell(comando, 'FILO_META_v718g3', S.comandoPerPowerShell) + 'exit\n';
      const r = spawnSync(POWERSHELL, ['-NoLogo', '-NoProfile', '-Command', '-'], { cwd: TMP, env: ENV, input: stdin, encoding: 'utf8', timeout: 60_000 });
      const m = r.stdout.match(/FILO_META_v718g3:(-?\d+):/);
      expect(m, r.stderr).not.toBeNull();
      expect(Number(m[1]), r.stderr).toBe(3);
    });
  }
});
