// #722 giro 5, rilievo 1: con PowerShell in modalità ristretta (PC aziendali bloccati) un comando dell'assistente
// che fallisce risulta riuscito e mostra un errore interno sui metodi non permessi; su main risultava fallito.
// Su Windows gira col sistema (solo l'assistente); altrove `pwsh` con la modalità ristretta impostata davanti.

import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { delimiter, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';

const require = createRequire(import.meta.url);
const ROOT = resolve(fileURLToPath(import.meta.url), '..', '..', '..', '..');
const T = require(join(ROOT, 'src', 'main', 'services', 'terminal.js'));
const S = require(join(ROOT, 'src', 'main', 'services', 'shell.js'));

const SU_WINDOWS = process.platform === 'win32';
const TMP = cartellaTemporanea('filo-v722-g5r1-');
const RISTRETTA = "$ExecutionContext.SessionState.LanguageMode='ConstrainedLanguage'";

// Fuori da Windows `powershell.exe` è un involucro che mette la modalità ristretta in testa allo stdin, così sia
// l'assistente sia la dashboard girano dal loro cammino vero.
function preparaPowerShell() {
  if (SU_WINDOWS) return 'powershell.exe';
  const dove = spawnSync('sh', ['-c', 'command -v pwsh'], { encoding: 'utf8' });
  const pwsh = dove.status === 0 ? dove.stdout.trim() : '';
  if (!pwsh) return '';
  const bin = join(TMP, 'bin');
  mkdirSync(bin, { recursive: true });
  const involucro = join(bin, 'powershell.exe');
  writeFileSync(involucro, `#!/bin/sh\n{ printf '%s\\n' "${RISTRETTA.replace(/\$/g, '\\$')}"; cat; } | exec "${pwsh}" "$@"\n`);
  chmodSync(involucro, 0o755);
  process.env.PATH = `${bin}${delimiter}${process.env.PATH}`;
  process.env.TERM = 'dumb';
  return pwsh;
}
const PWSH = preparaPowerShell();

function comeSuWindows(fn) {
  if (SU_WINDOWS) return fn();
  const prima = Object.getOwnPropertyDescriptor(process, 'platform');
  Object.defineProperty(process, 'platform', { value: 'win32' });
  try { return fn(); } finally { Object.defineProperty(process, 'platform', prima); }
}

// Su Windows la modalità ristretta si mette a mano in testa allo stdin; l'esito si legge come runCommand:
// quello del segno se c'è, altrimenti quello del processo.
async function assistente(comando) {
  if (!SU_WINDOWS) {
    const r = await comeSuWindows(() => T.runCommand(comando, { cwd: TMP, trackCwd: true, timeoutMs: 120_000 }));
    return { codice: r.code, err: String(r.stderr || '') };
  }
  const mark = 'FILO_V722G5';
  const inv = T.invocazione('powershell', comando, { trackCwd: true, mark });
  const r = spawnSync(inv.file, inv.args, { cwd: TMP, input: `${RISTRETTA}\n${inv.stdin}`, encoding: 'utf8', timeout: 120_000 });
  const m = String(r.stdout || '').match(new RegExp(`${mark}:(-?\\d*):`));
  return { codice: m && m[1] !== '' ? Number(m[1]) : r.status, err: String(r.stderr || '') };
}

async function dashboard(comandi) {
  const sessione = comeSuWindows(() => S.createSession({ shell: 'powershell', cwd: TMP }));
  const esiti = [];
  try {
    for (const comando of comandi) {
      esiti.push(await new Promise((risolvi, rifiuta) => {
        let stderr = '';
        const stop = setTimeout(() => rifiuta(new Error(`la shell non ha risposto: ${comando}`)), 60_000);
        sessione.exec(comando, {
          onData: ({ chunk, stream }) => { if (stream === 'stderr') stderr += chunk; },
          onExit: ({ code }) => { clearTimeout(stop); risolvi({ codice: code, err: stderr }); },
          onError: ({ message }) => { clearTimeout(stop); rifiuta(new Error(message)); },
        });
      }));
    }
  } finally { sessione.kill(); }
  return esiti;
}

const FALLITI = ['Get-Item file-che-non-c-e', 'comandoinesistente'];

test.afterAll(() => { try { rmSync(TMP, { recursive: true, force: true }); } catch (_) {} });

test('in modalità ristretta un comando fallito dell\'assistente risulta fallito, senza errori interni', async () => {
  test.skip(!PWSH, 'PowerShell non c\'è su questa macchina');
  test.setTimeout(240_000);
  for (const comando of FALLITI) {
    const r = await assistente(comando);
    expect(r.codice, `${comando}\nerrori: ${r.err}`).not.toBe(0);
    expect(r.err, comando).not.toMatch(/Method invocation|Cannot invoke method|metodo/i);
  }
});

test('in modalità ristretta un comando fallito nella dashboard risulta fallito, senza errori interni', async () => {
  test.skip(!PWSH || SU_WINDOWS, 'serve pwsh fuori da Windows per mettere la sessione in modalità ristretta');
  test.setTimeout(240_000);
  const esiti = await dashboard(FALLITI);
  esiti.forEach((r, i) => {
    expect(r.codice, `${FALLITI[i]}\nerrori: ${r.err}`).not.toBe(0);
    expect(r.err, FALLITI[i]).not.toMatch(/Method invocation|Cannot invoke method|metodo/i);
  });
});
