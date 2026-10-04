// La chiusura delle app nei test e il modo di far morire un renderer: due cose che sul runner di GitHub
// lasciavano la scheda bianca e il worker appeso (#639).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chiudiApp } from '../fixtures/electron.mjs';

const RADICE = fileURLToPath(new URL('../..', import.meta.url));

function specs(dir) {
  const out = [];
  for (const nome of readdirSync(dir)) {
    if (nome === 'node_modules' || nome.startsWith('.')) continue;
    const p = join(dir, nome);
    if (statSync(p).isDirectory()) out.push(...specs(p));
    else if (/\.spec\.(m?js)$/.test(nome)) out.push(p);
  }
  return out;
}

test('nessuno spec fa morire un renderer con forcefullyCrashRenderer', () => {
  // Solo su Linux fa crashare davvero il renderer: dove il core dump passa da systemd-coredump il processo
  // resta a morire per minuti, la pagina d'errore non arriva e il worker non chiude. Si usa SIGKILL al processo.
  const colpevoli = specs(join(RADICE, 'tests'))
    .filter((f) => /forcefullyCrashRenderer\s*\(/.test(readFileSync(f, 'utf8')))
    .map((f) => relative(RADICE, f).replace(/\\/g, '/'));
  assert.deepEqual(colpevoli, [], `usa process.kill(wc.getOSProcessId(), 'SIGKILL'): ${colpevoli.join(', ')}`);
});

test('chiudiApp ammazza anche i figli rimasti, così le pipe si chiudono', { skip: process.platform === 'win32' && 'su Windows il gruppo di processi non esiste: resta TerminateProcess' }, async () => {
  // Come lancia Playwright: capo di un gruppo, pipe su stdout/stderr. Il figlio eredita le pipe e non esce da solo.
  const capo = spawn(process.execPath, ['-e', `
    const { spawn } = require('node:child_process');
    const figlio = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'inherit' });
    console.log('figlio ' + figlio.pid);
    setInterval(() => {}, 1000);
  `], { detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const chiuso = new Promise((r) => capo.once('close', () => r(true)));
  const pidFiglio = await new Promise((r) => capo.stdout.on('data', (b) => {
    const m = /figlio (\d+)/.exec(String(b));
    if (m) r(Number(m[1]));
  }));
  const app = { process: () => capo, close: () => new Promise(() => {}) };
  try {
    await chiudiApp(app, { tetto: 200 });
    const esito = await Promise.race([chiuso, new Promise((r) => setTimeout(() => r(false), 5000))]);
    assert.equal(esito, true, 'le pipe dell\'app non si sono chiuse: Playwright resterebbe ad aspettare');
  } finally {
    try { process.kill(pidFiglio, 'SIGKILL'); } catch (_) {}
  }
});
