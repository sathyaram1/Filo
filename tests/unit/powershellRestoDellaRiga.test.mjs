// #722: in PowerShell un errore che ferma solo la sua istruzione (comando sconosciuto, eccezione di un metodo)
// non deve fermare il resto della riga, né nei comandi dell'assistente né nel terminale della dashboard.
// Gira con la PowerShell vera: su Windows quella di sistema, altrove `pwsh` se c'è (i runner di GitHub ce l'hanno).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { delimiter, dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { cartellaTemporanea, collegaFile } from '../helpers/percorsi.mjs';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const T = require(join(ROOT, 'src', 'main', 'services', 'terminal.js'));
const S = require(join(ROOT, 'src', 'main', 'services', 'shell.js'));

const SU_WINDOWS = process.platform === 'win32';
const ATTESA = 300_000;
const TMP = cartellaTemporanea('filo-ps-riga-');
process.on('exit', () => { try { rmSync(TMP, { recursive: true, force: true }); } catch (_) {} });

// Fuori da Windows Filo non lancia mai PowerShell: per provarne le righe si presenta `pwsh` col nome che Filo
// cerca e si finge Windows solo mentre la shell parte. TERM=dumb: pwsh su Linux scrive sequenze di tasti in testa.
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
const SALTA = C_E ? false : 'PowerShell non c\'è su questa macchina';

function comeSuWindows(fn) {
  if (SU_WINDOWS) return fn();
  const prima = Object.getOwnPropertyDescriptor(process, 'platform');
  Object.defineProperty(process, 'platform', { value: 'win32' });
  try { return fn(); } finally { Object.defineProperty(process, 'platform', prima); }
}

const assistente = (comando) => comeSuWindows(() => T.runCommand(comando, { cwd: TMP, trackCwd: true, timeoutMs: ATTESA }));

async function conDashboard(fn) {
  const sessione = comeSuWindows(() => S.createSession({ shell: 'powershell', cwd: TMP }));
  const esegui = (comando) => new Promise((risolvi, rifiuta) => {
    let stdout = '';
    const stop = setTimeout(() => rifiuta(new Error(`la shell non ha risposto: ${comando}`)), 60_000);
    sessione.exec(comando, {
      onData: ({ chunk, stream }) => { if (stream === 'stdout') stdout += chunk; },
      onExit: ({ code, cwd }) => { clearTimeout(stop); risolvi({ stdout, code, cwd }); },
      onError: ({ message }) => { clearTimeout(stop); rifiuta(new Error(message)); },
    });
  });
  try { return await fn(esegui); } finally { sessione.kill(); }
}

const righe = (s) => String(s).split(/\r?\n/).map((r) => r.trim()).filter(Boolean);

// Errori che in una shell fermano solo la loro istruzione: il resto gira e, come in bash, conta l'ultimo comando.
const CASI = [
  'comandoinesistente; Write-Output dopo',
  'comandoinesistente\nWrite-Output dopo',
  '[int]::Parse("x"); Write-Output dopo',
  'Get-ChildItem -OpzioneCheNonEsiste; Write-Output dopo',
  'function f { comandoinesistente; Write-Output dopo }; f',
  'Write-Output "città — à" | Out-Null; comandoinesistente; Write-Output dopo',
];

test('un comando sconosciuto a metà riga non ferma il resto: comandi dell\'assistente', { skip: SALTA }, async () => {
  for (const comando of CASI) {
    const r = await assistente(comando);
    assert.deepEqual(righe(r.stdout), ['dopo'], `«${comando}»: uscita ${JSON.stringify(r.stdout)}, errore ${r.stderr.slice(0, 200)}`);
    assert.equal(r.code, 0, `«${comando}»: l'ultimo comando è riuscito, codice ${r.code}`);
    assert.equal(r.cwd, TMP);
  }
});

test('l\'assistente e il terminale della dashboard danno la stessa risposta', { skip: SALTA }, async () => {
  const sotto = join(TMP, 'qui');
  mkdirSync(sotto, { recursive: true });
  const tutti = [...CASI, `Set-Location "${sotto}"; throw "fermo"; Write-Output dopo`, 'Write-Output "città"'];
  await conDashboard(async (esegui) => {
    for (const comando of tutti) {
      await esegui(`Set-Location "${TMP}"`);
      const d = await esegui(comando);
      const a = await assistente(comando);
      assert.deepEqual(righe(a.stdout), righe(d.stdout), `«${comando}»: le due strade stampano cose diverse`);
      assert.equal(a.code === 0, d.code === 0, `«${comando}»: assistente ${a.code}, dashboard ${d.code}`);
      assert.equal(a.cwd, d.cwd, `«${comando}»: le due strade finiscono in cartelle diverse`);
    }
  });
});

test('throw e -ErrorAction Stop fermano ancora il resto, e la cartella raggiunta resta', { skip: SALTA }, async () => {
  const sotto = join(TMP, 'fermo-qui');
  mkdirSync(sotto, { recursive: true });
  for (const fermo of ['throw "fermo"', `Get-Item "${join(TMP, 'manca')}" -ErrorAction Stop`]) {
    const comando = `Set-Location "${sotto}"; ${fermo}; Write-Output dopo`;
    const r = await assistente(comando);
    assert.ok(!righe(r.stdout).includes('dopo'), `«${comando}»: dopo un errore che ferma, il resto è girato`);
    assert.notEqual(r.code, 0, `«${comando}»: risulta riuscito`);
    assert.equal(r.cwd, sotto);
  }
  for (const [comando, atteso] of [['exit 3', 3], ['exit 0', 0]]) {
    assert.equal((await assistente(comando)).code, atteso, `«${comando}»`);
  }
});

// Un return o un break fuori da un ciclo saltano la riga che scrive l'esito, ma il comando è riuscito: anche
// con gli accenti, che nella dashboard prendono la stessa strada dell'assistente.
test('return e break fuori da un ciclo non fanno risultare fallito un comando riuscito, su tutte e due le strade', { skip: SALTA }, async () => {
  const casi = [
    ['1..5 | ForEach-Object { if ($_ -eq 3) { break }; $_ }', ['1', '2']],
    ['if (Test-Path "manca-qui") { Write-Output si } else { return }', []],
    ['Write-Output a; return; Write-Output b', ['a']],
    ['Write-Output città; return', ['città']],
  ];
  await conDashboard(async (esegui) => {
    for (const [comando, attese] of casi) {
      await esegui(`Set-Location "${TMP}"`);
      for (const [strada, r] of [['dashboard', await esegui(comando)], ['assistente', await assistente(comando)]]) {
        assert.deepEqual(righe(r.stdout), attese, `${strada}, «${comando}»`);
        assert.equal(r.code, 0, `${strada}, «${comando}»: riuscito ma risulta fallito`);
      }
    }
  });
});

// Anche dopo un errore zittito (-ErrorAction SilentlyContinue) o gestito (try/catch): in $Error ci finiscono pure
// quelli, e il comando che poi esce con return o break è riuscito.
test('return e break dopo un errore zittito o gestito non fanno risultare fallito un comando riuscito', { skip: SALTA }, async () => {
  const casi = [
    ['if (-not (Get-Command programma-che-non-c-e -ErrorAction SilentlyContinue)) { Write-Output manca; return }; Write-Output c', ['manca']],
    ['try { Get-Item "manca-qui" -ErrorAction Stop } catch { Write-Output gestito; return }; Write-Output c', ['gestito']],
    ['1..3 | ForEach-Object { $null = Get-Item "manca-qui" -ErrorAction SilentlyContinue; if ($_ -eq 2) { break }; "n$_" }', ['n1']],
    ['if (-not (Get-Command programma-che-non-c-e -ErrorAction SilentlyContinue)) { Write-Output città; return }', ['città']],
  ];
  await conDashboard(async (esegui) => {
    for (const [comando, attese] of casi) {
      await esegui(`Set-Location "${TMP}"`);
      for (const [strada, r] of [['dashboard', await esegui(comando)], ['assistente', await assistente(comando)]]) {
        assert.deepEqual(righe(r.stdout), attese, `${strada}, «${comando}»`);
        assert.equal(r.code, 0, `${strada}, «${comando}»: riuscito ma risulta fallito`);
      }
    }
  });
});

// Gli errori parlano del comando scritto, mai delle righe con cui Filo lo esegue. La vista d'errore di serie di
// Windows PowerShell (NormalView) mostra la riga che ha causato l'errore: fuori da Windows la si chiede a pwsh.
test('un errore di sintassi o che ferma mostra il comando scritto, non le righe interne di Filo', { skip: SALTA }, () => {
  const pwsh = SU_WINDOWS ? 'powershell.exe' : spawnSync('sh', ['-c', 'command -v pwsh'], { encoding: 'utf8' }).stdout.trim();
  const esegui = (args, stdin) => {
    const r = spawnSync(pwsh, args, { cwd: TMP, input: (SU_WINDOWS ? '' : "$ErrorView='NormalView'\n") + stdin, encoding: 'utf8', timeout: ATTESA });
    return { uscita: `${r.stderr}${r.stdout}`, codice: /FILO_PROVA:(\d+):/.exec(r.stdout)?.[1] };
  };
  const assistenteGrezzo = (comando) => {
    const inv = comeSuWindows(() => T.invocazione('powershell', comando, { trackCwd: true, mark: 'FILO_PROVA' }));
    return esegui(inv.args, inv.stdin);
  };
  const dashboardGrezza = (comando) => esegui(['-NoLogo', '-NoProfile', '-Command', '-'],
    T.PREPARA_STDIN_POWERSHELL + T.righePowerShell(comando, 'FILO_PROVA', S.comandoPerPowerShell));
  const casi = [
    ['Write-Output "ciao', /ciao/],
    ['Write-Output (', /Write-Output \(/],
    ['Get-ChildItem | Where-Object { $_.Length -gt 1kb', /Where-Object/],
    ["$ErrorActionPreference='Stop'; comandoinesistente; Write-Output dopo", /comandoinesistente/],
  ];
  for (const [comando, mostra] of casi) {
    for (const [strada, r] of [['assistente', assistenteGrezzo(comando)], ['dashboard con un accento', dashboardGrezza(`${comando} # à`)]]) {
      assert.equal(r.codice, '1', `${strada}, «${comando}»: deve risultare fallito`);
      assert.match(r.uscita, mostra, `${strada}, «${comando}»: l'errore deve mostrare il comando`);
      assert.doesNotMatch(r.uscita, /__filo|FromBase64String|ScriptBlock|Invoke-Expression/, `${strada}, «${comando}»: mostra le righe interne di Filo`);
    }
  }
});

// Nei PC aziendali bloccati PowerShell gira in modalità ristretta, dove le chiamate a metodi .NET sono vietate:
// i comandi dell'assistente, e quelli accentati della dashboard, devono girare lo stesso.
test('in modalità ristretta i comandi girano su tutte e due le strade', { skip: SALTA }, () => {
  const pwsh = SU_WINDOWS ? 'powershell.exe' : spawnSync('sh', ['-c', 'command -v pwsh'], { encoding: 'utf8' }).stdout.trim();
  const esegui = (args, stdin) => {
    const r = spawnSync(pwsh, args, { cwd: TMP, input: "$ExecutionContext.SessionState.LanguageMode='ConstrainedLanguage'\n" + stdin, encoding: 'utf8', timeout: ATTESA });
    const uscita = String(r.stdout);
    const i = uscita.lastIndexOf('FILO_PROVA:');
    return { righe: righe(i < 0 ? uscita : uscita.slice(0, i)), codice: /FILO_PROVA:(\d+):/.exec(uscita)?.[1], errori: String(r.stderr) };
  };
  const assistenteGrezzo = (comando) => {
    const inv = comeSuWindows(() => T.invocazione('powershell', comando, { trackCwd: true, mark: 'FILO_PROVA' }));
    return esegui(inv.args, inv.stdin);
  };
  const dashboardGrezza = (comando) => esegui(['-NoLogo', '-NoProfile', '-Command', '-'],
    T.PREPARA_STDIN_POWERSHELL + T.righePowerShell(comando, 'FILO_PROVA', S.comandoPerPowerShell));
  const casi = [
    ['Write-Output ciao', ['ciao'], '0'],
    ['Write-Output "città — è"', ['città — è'], '0'],
    ['comandoinesistente; Write-Output dopo', ['dopo'], '0'],
    ['Write-Output a; return; Write-Output b', ['a'], '0'],
    ['throw "fermo"; Write-Output dopo', [], '1'],
    ['Write-Output "rotto', [], '1'],
  ];
  for (const [comando, attese, codice] of casi) {
    for (const [strada, r] of [['assistente', assistenteGrezzo(comando)], ['dashboard con un accento', dashboardGrezza(`${comando} # à`)]]) {
      assert.deepEqual(r.righe, attese, `${strada}, «${comando}»: ${r.errori.slice(0, 300)}`);
      assert.equal(r.codice, codice, `${strada}, «${comando}»: ${r.errori.slice(0, 300)}`);
    }
  }
});
