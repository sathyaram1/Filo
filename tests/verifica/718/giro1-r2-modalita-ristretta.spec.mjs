// VERIFICA #718 giro 1 — r2: su un PC in modalità ristretta lo script che finisce con un programma fallito
// deve arrivare fallito come altrove. Serve una PowerShell (`pwsh` nel PATH o in FILO_PWSH); senza, salta.
// pwsh per Linux: il tar.gz delle release di PowerShell su GitHub, scompattato e messo in FILO_PWSH.

import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';

const require = createRequire(import.meta.url);
const T = require('../../../src/main/services/terminal.js');

const ENV = { ...process.env, TERM: 'dumb', POWERSHELL_TELEMETRY_OPTOUT: '1' };
const PS = [process.env.FILO_PWSH, process.platform === 'win32' ? 'powershell.exe' : 'pwsh'].find((p) => p
  && spawnSync(p, ['-NoProfile', '-NonInteractive', '-Command', '1'], { env: ENV, timeout: 60_000 }).status === 0);

function comeSuWindows(fn) {
  if (process.platform === 'win32') return fn();
  const prima = Object.getOwnPropertyDescriptor(process, 'platform');
  Object.defineProperty(process, 'platform', { value: 'win32' });
  try { return fn(); } finally { Object.defineProperty(process, 'platform', prima); }
}

test('r2 in modalità ristretta lo script che finisce con un build fallito arriva fallito col suo codice', () => {
  test.skip(!PS, 'nessuna PowerShell su questa macchina');
  const tmp = cartellaTemporanea('filo-v718-');
  try {
    const script = join(tmp, 'costruisci.ps1');
    writeFileSync(script, `Write-Output costruisco\n& "${process.execPath}" -e "process.exit(3)"\n`, 'utf8');
    for (const comando of [`& "${script}"`, `& { & "${process.execPath}" -e "process.exit(3)" }`]) {
      const mark = T.nuovoMarcatore();
      const inv = comeSuWindows(() => T.invocazione('powershell', comando, { trackCwd: true, mark }));
      const stdin = "$ExecutionContext.SessionState.LanguageMode = 'ConstrainedLanguage'\n" + inv.stdin;
      const r = spawnSync(PS, inv.args, { cwd: tmp, env: ENV, input: stdin, encoding: 'utf8', timeout: 60_000 });
      const s = T.extractCwdMark(r.stdout, mark);
      expect(s.trovato, r.stderr).toBe(true);
      expect(s.code, `«${comando}» in modalità ristretta`).toBe(3);
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
