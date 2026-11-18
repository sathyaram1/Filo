// Nella corsa Unit sulla fusione il codice del ramo provato (installazione, binario di Electron, prove) non riceve i file
// con cui Actions raccoglie uscite, ambiente e PATH dei passi dopo: li tiene solo lo strumento di main che scrive
// l'esito (#2225, #2558). Le prove sulla fusione stessa stanno in unitFusioneAzione e specFusioneAzione.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea, togliCartella } from '../helpers/percorsi.mjs';
import { TETTO_ATTESA_MS } from '../helpers/attese.mjs';
import { COMANDI_DI_ACTIONS, senzaComandiDiActions, prendiComandiDiActions } from '../../scripts/lib/comandi-di-actions.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const LANCIATORE = join(ROOT, 'scripts', 'senza-comandi-di-actions.mjs');

test('i file dei comandi: tolti da una copia, o presi dall\'ambiente da chi scrive l\'esito', () => {
  assert.deepEqual([...COMANDI_DI_ACTIONS].sort(), ['GITHUB_ENV', 'GITHUB_OUTPUT', 'GITHUB_PATH', 'GITHUB_STATE', 'GITHUB_STEP_SUMMARY']);
  const fuori = Object.fromEntries(COMANDI_DI_ACTIONS.map((k) => [k, `/runner/${k}`]));
  const env = { ...fuori, PATH: '/bin' };
  assert.deepEqual(senzaComandiDiActions(env), { PATH: '/bin' });
  assert.equal(env.GITHUB_OUTPUT, '/runner/GITHUB_OUTPUT', 'la copia non tocca l\'originale');
  assert.deepEqual(prendiComandiDiActions(env), fuori);
  assert.deepEqual(env, { PATH: '/bin' }, 'dopo la presa i figli non li ereditano più');
  assert.deepEqual(prendiComandiDiActions({ PATH: '/bin' }), {});
});

test('uno script del ramo lanciato dal passo non scrive nei file dei comandi, e il suo esito arriva intero', () => {
  const dir = cartellaTemporanea('filo-2558-');
  try {
    const file = Object.fromEntries(COMANDI_DI_ACTIONS.map((k) => [k, join(dir, `${k}.txt`)]));
    for (const f of Object.values(file)) writeFileSync(f, '', 'utf8');
    const ramo = join(dir, 'del-ramo.mjs');
    // Quello che farebbe un postinstall ostile: NODE_OPTIONS nei passi dopo, un esito finto, un `node` suo nel PATH.
    writeFileSync(ramo, [
      "import { appendFileSync } from 'node:fs';",
      'const scrivi = (k, t) => { if (process.env[k]) appendFileSync(process.env[k], t); };',
      "scrivi('GITHUB_ENV', 'NODE_OPTIONS=--require /ramo/spia.js\\n');",
      "scrivi('GITHUB_OUTPUT', 'campo={\"esito\":\"verde\"}\\n');",
      "scrivi('GITHUB_PATH', '/ramo/bin\\n');",
      "scrivi('GITHUB_STATE', 'x=1\\n');",
      "scrivi('GITHUB_STEP_SUMMARY', 'verde\\n');",
      "process.stdout.write(`argomenti ${process.argv.slice(2).join(',')} percorso ${process.env.FILO_SPIA_2558}\\n`);",
      'process.exit(7);',
    ].join('\n'), 'utf8');
    const r = spawnSync(process.execPath, [LANCIATORE, ramo, 'uno', 'due'], {
      cwd: dir, env: { ...process.env, ...file, FILO_SPIA_2558: 'resta' }, encoding: 'utf8', timeout: TETTO_ATTESA_MS,
    });
    assert.equal(r.status, 7, `il codice d'uscita dello script arriva al passo:\n${r.stdout}${r.stderr}`);
    assert.match(r.stdout, /argomenti uno,due percorso resta/, 'argomenti e resto dell\'ambiente arrivano allo script');
    for (const [k, f] of Object.entries(file)) assert.equal(readFileSync(f, 'utf8'), '', `${k}: il codice del ramo ci ha scritto`);
  } finally {
    togliCartella(dir);
  }
});

test('lanciatore senza script: rosso, non verde', () => {
  const r = spawnSync(process.execPath, [LANCIATORE], { encoding: 'utf8', timeout: TETTO_ATTESA_MS });
  assert.equal(r.status, 2);
});

// I passi che lavorano nel ramo eseguono il suo codice; gli strumenti di main lanciati dalla radice prendono i file da sé.
test('nel workflow ogni passo che lavora nel ramo passa dal lanciatore di main', () => {
  const yml = readFileSync(join(ROOT, '.github', 'workflows', 'unit-fusione.yml'), 'utf8');
  const passi = yml.split(/\r?\n/).filter((r) => !/^\s*#/.test(r)).join('\n').split(/^ {6}- (?=name: |uses: |run: )/m).slice(1);
  const nelRamo = passi.filter((p) => /^\s*working-directory:\s*prova\s*$/m.test(p));
  assert.ok(nelRamo.length >= 4, `trovati ${nelRamo.length} passi nel ramo: tre installazioni e il binario di Electron`);
  for (const p of nelRamo) {
    assert.match(p, /^\s*run: node \.\.\/strumenti\/scripts\/senza-comandi-di-actions\.mjs \S/m, `un passo esegue il codice del ramo coi file dei comandi:\n${p.slice(0, 300)}`);
    assert.doesNotMatch(p, /run: \|/, 'un passo a più righe sfuggirebbe al lanciatore');
  }
  for (const p of passi.filter((x) => /^\s*run: .*\bprova\b/m.test(x) && !nelRamo.includes(x))) {
    assert.match(p, /run: (?:xvfb-run -a )?node strumenti\/scripts\/(?:unit|spec)-fusione-azione\.mjs /, `passo sul ramo fuori dagli strumenti di main:\n${p.slice(0, 300)}`);
  }
});
