// #722 giro 3, rilievo 1: un comando PowerShell riuscito che esce con return o break DOPO un errore zittito
// (-ErrorAction SilentlyContinue) o gestito (try/catch) risulta fallito per l'assistente; su main riusciva,
// e la dashboard senza accenti lo dà riuscito. Gira con la PowerShell vera: su Windows quella di sistema, altrove `pwsh`.

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
const TMP = cartellaTemporanea('filo-v722-g3r1-');

function preparaPowerShell() {
  if (SU_WINDOWS) return true;
  const dove = spawnSync('sh', ['-c', 'command -v pwsh'], { encoding: 'utf8' });
  const pwsh = dove.status === 0 ? dove.stdout.trim() : '';
  if (!pwsh) return false;
  const bin = join(TMP, 'bin');
  mkdirSync(bin, { recursive: true });
  collegaFile(pwsh, join(bin, 'powershell.exe'));
  process.env.PATH = `${bin}${delimiter}${process.env.PATH}`;
  process.env.TERM = 'dumb';
  return true;
}
const C_E = preparaPowerShell();

function comeSuWindows(fn) {
  if (SU_WINDOWS) return fn();
  const prima = Object.getOwnPropertyDescriptor(process, 'platform');
  Object.defineProperty(process, 'platform', { value: 'win32' });
  try { return fn(); } finally { Object.defineProperty(process, 'platform', prima); }
}

const assistente = (comando) => comeSuWindows(() => T.runCommand(comando, { cwd: TMP, trackCwd: true, timeoutMs: 120_000 }));

async function dashboard(comando) {
  const sessione = comeSuWindows(() => S.createSession({ shell: 'powershell', cwd: TMP }));
  try {
    return await new Promise((risolvi, rifiuta) => {
      let stdout = '';
      const stop = setTimeout(() => rifiuta(new Error(`la shell non ha risposto: ${comando}`)), 60_000);
      sessione.exec(comando, {
        onData: ({ chunk, stream }) => { if (stream === 'stdout') stdout += chunk; },
        onExit: ({ code }) => { clearTimeout(stop); risolvi({ stdout, code }); },
        onError: ({ message }) => { clearTimeout(stop); rifiuta(new Error(message)); },
      });
    });
  } finally { sessione.kill(); }
}

const righe = (s) => String(s).split(/\r?\n/).map((r) => r.trim()).filter(Boolean);

const CASI = [
  ["if (-not (Get-Command programma-che-non-c-e -ErrorAction SilentlyContinue)) { Write-Output manca; return }; Write-Output trovato", ['manca']],
  ["$f = Get-Item file-che-non-c-e -ErrorAction SilentlyContinue; if (-not $f) { Write-Output 'nessun file'; return }; Write-Output $f", ['nessun file']],
  ["try { Get-Item file-che-non-c-e -ErrorAction Stop } catch { Write-Output gestito; return }; Write-Output dopo", ['gestito']],
  ["1..3 | ForEach-Object { $null = Get-Item file-che-non-c-e -ErrorAction SilentlyContinue; if ($_ -eq 2) { break }; \"n$_\" }", ['n1']],
  ["if (-not (Get-Command programma-che-non-c-e -ErrorAction SilentlyContinue)) { Write-Output città; return }", ['città']],
];

test.afterAll(() => { try { rmSync(TMP, { recursive: true, force: true }); } catch (_) {} });

test('return o break dopo un errore zittito o gestito: il comando riuscito risulta riuscito, per l\'assistente e per la dashboard', async () => {
  test.skip(!C_E, 'PowerShell non c\'è su questa macchina');
  test.setTimeout(300_000);
  for (const [comando, attese] of CASI) {
    const a = await assistente(comando);
    expect(righe(a.stdout), `assistente, «${comando}»`).toEqual(attese);
    expect(a.code, `assistente, «${comando}»: è riuscito ma risulta fallito`).toBe(0);
    const d = await dashboard(comando);
    expect(righe(d.stdout), `dashboard, «${comando}»`).toEqual(attese);
    expect(d.code, `dashboard, «${comando}»: è riuscito ma risulta fallito`).toBe(0);
  }
});
