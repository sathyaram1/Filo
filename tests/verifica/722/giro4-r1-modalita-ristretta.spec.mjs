// #722 giro 4, rilievo 1: con PowerShell in modalità ristretta (ConstrainedLanguage, PC aziendali bloccati)
// ogni comando dell'assistente non stampa niente e risulta fallito; su main girava.
// Su Windows gira col sistema; altrove `pwsh` con la modalità ristretta impostata davanti.

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

const SU_WINDOWS = process.platform === 'win32';
const TMP = cartellaTemporanea('filo-v722-g4r1-');

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

const RISTRETTA = "$ExecutionContext.SessionState.LanguageMode='ConstrainedLanguage'\n";

function assistente(comando) {
  const mark = 'FILO_V722G4';
  const inv = comeSuWindows(() => T.invocazione('powershell', comando, { trackCwd: true, mark }));
  const r = spawnSync(SU_WINDOWS ? inv.file : PWSH, inv.args, { cwd: TMP, input: RISTRETTA + inv.stdin, encoding: 'utf8', timeout: 120_000 });
  const out = String(r.stdout || '');
  const m = out.match(new RegExp(`${mark}:(-?\\d*):`));
  return { out, codice: m ? m[1] : null, err: String(r.stderr || '') };
}

test.afterAll(() => { try { rmSync(TMP, { recursive: true, force: true }); } catch (_) {} });

test('in modalità ristretta un comando dell\'assistente gira e risulta riuscito', () => {
  test.skip(!PWSH, 'PowerShell non c\'è su questa macchina');
  test.setTimeout(120_000);
  const r = assistente('Write-Output ciao-filo');
  expect(r.out, `uscita: ${r.out}\nerrori: ${r.err}`).toContain('ciao-filo');
  expect(r.codice, `errori: ${r.err}`).toBe('0');
});
