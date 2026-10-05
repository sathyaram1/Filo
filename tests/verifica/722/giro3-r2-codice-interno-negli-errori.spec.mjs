// #722 giro 3, rilievo 2: un errore di sintassi in un comando PowerShell dell'assistente (o della dashboard con un
// accento) mostra nella vista d'errore di Windows PowerShell la riga interna di Filo (Invoke-Expression + base64).
// Su Windows gira col sistema; altrove `pwsh` con la vista d'errore di Windows PowerShell 5.1 (NormalView) davanti.

import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { delimiter, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { cartellaTemporanea, collegaFile } from '../../helpers/percorsi.mjs';

const require = createRequire(import.meta.url);
const ROOT = resolve(fileURLToPath(import.meta.url), '..', '..', '..', '..');
const T = require(join(ROOT, 'src', 'main', 'services', 'terminal.js'));
const S = require(join(ROOT, 'src', 'main', 'services', 'shell.js'));

const SU_WINDOWS = process.platform === 'win32';
const TMP = cartellaTemporanea('filo-v722-g3r2-');

function trovaPwsh() {
  if (SU_WINDOWS) return 'powershell.exe';
  const dove = spawnSync('sh', ['-c', 'command -v pwsh'], { encoding: 'utf8' });
  const pwsh = dove.status === 0 ? dove.stdout.trim() : '';
  if (!pwsh) return '';
  const bin = join(TMP, 'bin');
  mkdirSync(bin, { recursive: true });
  collegaFile(pwsh, join(bin, 'powershell.exe'));
  process.env.PATH = `${bin}${delimiter}${process.env.PATH}`;
  process.env.TERM = 'dumb';
  return pwsh;
}
const PWSH = trovaPwsh();

function comeSuWindows(fn) {
  if (SU_WINDOWS) return fn();
  const prima = Object.getOwnPropertyDescriptor(process, 'platform');
  Object.defineProperty(process, 'platform', { value: 'win32' });
  try { return fn(); } finally { Object.defineProperty(process, 'platform', prima); }
}

const VISTA_51 = "$ErrorView='NormalView'\n";

// Le stesse righe che Filo manda sullo stdin, con davanti la vista d'errore di serie di Windows PowerShell.
function eseguiStdin(file, args, stdin) {
  const r = spawnSync(file, args, { cwd: TMP, input: (SU_WINDOWS ? '' : VISTA_51) + stdin, encoding: 'utf8', timeout: 120_000 });
  return String(r.stderr || '') + String(r.stdout || '');
}

function assistente(comando) {
  const inv = comeSuWindows(() => T.invocazione('powershell', comando, { trackCwd: true, mark: 'FILO_V722' }));
  return eseguiStdin(SU_WINDOWS ? inv.file : PWSH, inv.args, inv.stdin);
}

function dashboardConAccento(comando) {
  const righe = T.PREPARA_STDIN_POWERSHELL + T.righePowerShell(comando, 'FILO_V722', S.comandoPerPowerShell);
  return eseguiStdin(SU_WINDOWS ? 'powershell.exe' : PWSH, ['-NoLogo', '-NoProfile', '-Command', '-'], righe);
}

const INTERNO = /FromBase64String|Invoke-Expression/;

test.afterAll(() => { try { rmSync(TMP, { recursive: true, force: true }); } catch (_) {} });

test('un errore di sintassi mostra il comando scritto, non la riga interna di Filo', () => {
  test.skip(!PWSH, 'PowerShell non c\'è su questa macchina');
  test.setTimeout(300_000);
  for (const comando of ['Write-Output "ciao', 'Get-ChildItem | Where-Object { $_.Length -gt 1kb']) {
    const uscita = assistente(comando);
    expect(uscita, `assistente, «${comando}»: l'errore deve arrivare`).toMatch(/terminator|closing/);
    expect(uscita, `assistente, «${comando}»: mostra la riga interna di Filo`).not.toMatch(INTERNO);
  }
  const conAccento = 'Write-Output "città';
  const uscita = dashboardConAccento(conAccento);
  expect(uscita, `dashboard, «${conAccento}»: l'errore deve arrivare`).toMatch(/terminator/);
  expect(uscita, `dashboard, «${conAccento}»: mostra la riga interna di Filo`).not.toMatch(INTERNO);
});
