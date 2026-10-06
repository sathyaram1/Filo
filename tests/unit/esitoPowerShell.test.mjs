// #718: in PowerShell un programma esterno uscito con errore in un punto qualunque del comando lo fa fallito col
// suo codice, anche se dopo c'è un comando riuscito; per i cmdlet conta l'ultimo, come in bash. Vale per i comandi
// dell'assistente e per il terminale della dashboard. Gira dove c'è una PowerShell (su Linux `pwsh`), sennò salta.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { writeFileSync, rmSync, readFileSync } from 'node:fs';
import { cartellaTemporanea } from '../helpers/percorsi.mjs';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const T = require(join(ROOT, 'src', 'main', 'services', 'terminal.js'));
const S = require(join(ROOT, 'src', 'main', 'services', 'shell.js'));

const ENV = { ...process.env, TERM: 'dumb', POWERSHELL_TELEMETRY_OPTOUT: '1' };
const POWERSHELL = (() => {
  const nome = process.platform === 'win32' ? 'powershell.exe' : 'pwsh';
  const r = spawnSync(nome, ['-NoProfile', '-NonInteractive', '-Command', '1'], { env: ENV, encoding: 'utf8', timeout: 60_000 });
  return r.status === 0 ? nome : null;
})();
const salta = POWERSHELL ? false : 'nessuna PowerShell su questa macchina';

const TMP = cartellaTemporanea('filo-esito-ps-');
const NODE = `& "${process.execPath}"`;
const esce = (n) => `${NODE} -e "process.exit(${n})"`;
const COSTRUISCI = join(TMP, 'costruisci.ps1');
const RIMEDIA = join(TMP, 'rimedia.ps1');
writeFileSync(COSTRUISCI, `Write-Output costruisco\n${esce(3)}\n`, 'utf8');
writeFileSync(RIMEDIA, `${esce(3)}\nexit 0\n`, 'utf8');
const MANCA = `Get-Content "${join(TMP, 'manca.txt')}"`;

// [comando, codice atteso ('fallito' = diverso da 0), stdout atteso o null]
const CASI = [
  [`${esce(3)}; Write-Output fatto`, 3, 'fatto'],
  [`${esce(3)}; ${esce(0)}`, 3, null],
  [`${esce(4)}\n${esce(5)}`, 4, null],
  [`& { ${esce(3)} }`, 3, null],
  [`& "${COSTRUISCI}"`, 3, 'costruisco'],
  [`& "${RIMEDIA}"`, 0, null],
  [`${esce(0)}; ${MANCA}`, 'fallito', null],
  [`${MANCA}; Write-Output ok`, 0, 'ok'],
  [`${MANCA}`, 'fallito', null],
  ['Write-Output ciao # saluto', 0, 'ciao'],
  // La sonda fra un'istruzione e l'altra non cambia $? né $LASTEXITCODE a chi li legge dopo.
  [`${esce(1)}; if ($?) { 'SI' } else { 'NO' }`, 1, 'NO'],
  ["Write-Output a; if ($?) { 'SI' } else { 'NO' }", 0, 'a\nSI'],
  [`${MANCA} -ErrorAction SilentlyContinue; if ($?) { 'SI' } else { 'NO' }`, 0, 'NO'],
  [`${esce(2)}; if ($LASTEXITCODE -ne 0) { "LEC=$LASTEXITCODE" }`, 2, 'LEC=2'],
  ["$x = @'\nriga\n'@\nWrite-Output $x", 0, 'riga'],
  ["if ($true) {\n  Write-Output dentro\n}\nelse { Write-Output fuori }", 0, 'dentro'],
  ["Write-Output 'città — ok'", 0, 'città — ok'],
  ['Write-Output prima; throw "fermo"', 'fallito', null],
  ['Write-Output (1 +', 'fallito', null],
];
// Fuori da Windows Filo non lancia mai PowerShell: le righe si costruiscono fingendo Windows.
function comeSuWindows(fn) {
  if (process.platform === 'win32') return fn();
  const prima = Object.getOwnPropertyDescriptor(process, 'platform');
  Object.defineProperty(process, 'platform', { value: 'win32' });
  try { return fn(); } finally { Object.defineProperty(process, 'platform', prima); }
}
function assistente(comando) {
  const mark = T.nuovoMarcatore();
  const inv = comeSuWindows(() => T.invocazione('powershell', comando, { trackCwd: true, mark }));
  const r = spawnSync(POWERSHELL, inv.args, { cwd: TMP, env: ENV, input: inv.stdin, encoding: 'utf8', timeout: 60_000 });
  return { r, sonda: T.extractCwdMark(r.stdout, mark) };
}

const giusto = (code, atteso) => (atteso === 'fallito' ? code !== 0 : code === atteso);
const righe = (s) => s.replace(/\r/g, '').trim();

test('comando dell\'assistente: un programma fallito in un punto qualunque fa fallito il comando', { skip: salta }, () => {
  for (const [comando, atteso, uscita] of CASI) {
    const { r, sonda } = assistente(comando);
    const code = sonda.code == null ? r.status : sonda.code;
    assert.ok(sonda.trovato, `sonda persa: «${comando}» ${r.stderr.slice(0, 200)}`);
    assert.ok(giusto(code, atteso), `«${comando}»: codice ${code}, atteso ${atteso}. ${r.stderr.slice(0, 300)}`);
    if (uscita != null) assert.equal(righe(sonda.stdout), uscita, `uscita di «${comando}»`);
  }
});

test('terminale della dashboard: stessa regola, nella stessa sessione un comando dopo l\'altro', { skip: salta }, () => {
  const sid = 'prova718';
  const stdin = T.PREPARA_STDIN_POWERSHELL
    + CASI.map(([c]) => T.righePowerShell(c, `FILO_META_${sid}`, S.comandoPerPowerShell)).join('') + 'exit\n';
  const r = spawnSync(POWERSHELL, ['-NoLogo', '-NoProfile', '-Command', '-'], { cwd: TMP, env: ENV, input: stdin, encoding: 'utf8', timeout: 120_000 });
  const pezzi = r.stdout.replace(/\r/g, '').split(new RegExp(`FILO_META_${sid}:(-?\\d+):[^\\n]*\\n?`));
  const codici = pezzi.filter((_, i) => i % 2 === 1).map(Number);
  assert.equal(codici.length, CASI.length, `esiti arrivati: ${codici.length}. ${r.stderr.slice(0, 300)}`);
  CASI.forEach(([comando, atteso, uscita], i) => {
    assert.ok(giusto(codici[i], atteso), `«${comando}»: codice ${codici[i]}, atteso ${atteso}`);
    if (uscita != null) assert.equal(righe(pezzi[i * 2]), uscita, `uscita di «${comando}»`);
  });
});

test('un comando che contiene la chiusura della here-string arriva intero', { skip: salta }, () => {
  const comando = "$t = @'\nuno\n'@\n$u = @'\ndue\n'@\nWrite-Output \"$t$u\"";
  const { r, sonda } = assistente(comando);
  assert.equal(sonda.code, 0, r.stderr.slice(0, 300));
  assert.equal(righe(sonda.stdout), 'unodue');
});

test('la shell persistente incarta i comandi con la stessa regola dell\'assistente', () => {
  const src = readFileSync(join(ROOT, 'src', 'main', 'services', 'shell.js'), 'utf8');
  assert.match(src, /wrap: \(command\) => righePowerShell\(command, `FILO_META_\$\{sid\}`, comandoPerPowerShell\)/);
  assert.match(src, /function comandoPerPowerShell\(command, coda = ''\) \{\n  return invocaCodificato\(/);
});

test.after(() => rmSync(TMP, { recursive: true, force: true }));
