// Verifica #718, giro 2: l'errore di PowerShell indica la riga che l'utente ha scritto, col suo testo.
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

// Riga e testo che PowerShell mostra nell'errore: «Line | / 3 |  testo» (7) o «At line:3 char:1 / + testo» (5.1).
function rigaErrore(stderr) {
  const s = stderr.replace(/\r/g, '');
  const nuovo = s.match(/Line \|\n\s*(\d+) \|\s(.*)/);
  if (nuovo) return { riga: Number(nuovo[1]), testo: nuovo[2].trim() };
  const vecchio = s.match(/At line:(\d+) char:\d+\n\+\s(.*)/);
  return vecchio ? { riga: Number(vecchio[1]), testo: vecchio[2].trim() } : null;
}

test.describe('#718 riga dell\'errore', () => {
  test.skip(!POWERSHELL, 'nessuna PowerShell su questa macchina');
  const TMP = cartellaTemporanea('filo-v718-');
  const MANCA = `Get-Content "${join(TMP, 'manca.txt')}"`;
  test.afterAll(() => rmSync(TMP, { recursive: true, force: true }));

  test('r1 comando dell\'assistente su tre righe: l\'errore indica la terza', () => {
    const mark = T.nuovoMarcatore();
    const comando = `Write-Output uno\nWrite-Output due\n${MANCA}`;
    const inv = comeSuWindows(() => T.invocazione('powershell', comando, { trackCwd: true, mark }));
    const r = spawnSync(POWERSHELL, inv.args, { cwd: TMP, env: ENV, input: inv.stdin, encoding: 'utf8', timeout: 60_000 });
    expect(rigaErrore(r.stderr), r.stderr).toEqual({ riga: 3, testo: MANCA });
  });

  test('r1 terminale della dashboard, due comandi su una riga: l\'errore indica la riga scritta', () => {
    const comando = `Write-Output x; ${MANCA}`;
    const stdin = T.PREPARA_STDIN_POWERSHELL + T.righePowerShell(comando, 'FILO_META_v718', S.comandoPerPowerShell) + 'exit\n';
    const r = spawnSync(POWERSHELL, ['-NoLogo', '-NoProfile', '-Command', '-'], { cwd: TMP, env: ENV, input: stdin, encoding: 'utf8', timeout: 60_000 });
    expect(rigaErrore(r.stderr), r.stderr).toEqual({ riga: 1, testo: comando });
  });
});
