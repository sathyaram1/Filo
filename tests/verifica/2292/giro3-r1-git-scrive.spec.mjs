// #2292 giro 3 — i comandi git «di lettura» con un'opzione che scrive non restano una lettura libera:
// `--output` svuota o riscrive un file qualsiasi (anche fuori da un repository, con --no-index), `reflog expire` cancella.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { cartellaTemporanea, togliCartella } from '../../helpers/percorsi.mjs';

const require = createRequire(import.meta.url);
for (const f of ['constants.js', 'contenutoEsterno.js', 'capabilities.js', 'themeTokens.js', 'cmdClassify.js',
  'zoomPagina.js', 'autonomia.js', 'preferences.js', 'actionLevels.js']) {
  require(`../../../src/shared/${f}`);
}
const C = globalThis.SN_CMD_CLASSIFY;
const A = globalThis.SN_AUTONOMIA;
const AL = globalThis.SN_ACTION_LEVELS;

const LINUX = { cwd: '/home/mario', home: '/home/mario', win: false, shell: 'sh', gitLancia: () => '' };
const MAC = { cwd: '/Users/mario', home: '/Users/mario', win: false, maiuscole: true, shell: 'sh', gitLancia: () => '' };
const PS = { cwd: 'C:\\Users\\Mario', home: 'C:\\Users\\Mario', win: true, maiuscole: true, shell: 'powershell', gitLancia: () => '' };

const SCRIVONO = [
  'git diff --no-index --output=Documenti/tesi.txt Documenti Documenti',
  'git log -1 --format=format:x --output=progetto/package.json',
  'git log -1 --format=format:x --output=.bashrc',
  'git log --output Documenti/tesi.txt',
  'git show --output=Documenti/tesi.txt',
  'git log -1 --format=format:x --output=.git/config && git status',
  'git reflog expire --expire=now --all',
];

test('r1 un comando git che scrive un file non parte senza domanda a compito contaminato', () => {
  for (const comando of SCRIVONO) {
    for (const ctx of [LINUX, MAC, PS]) {
      expect(C.classify(comando, ctx), comando).toBeGreaterThanOrEqual(2);
      const costo = AL.costoFor({ type: 'ESEGUI_COMANDO', comando, _perimetro: ctx });
      const d = A.decideDettaglio({ livello: 'default', stato: 'contaminato', costo, campo: 'terminale' });
      expect(d.risposta, comando).not.toBe('si');
    }
  }
});

test('r1 la stessa lettura senza file d\'uscita resta libera', () => {
  for (const comando of ['git diff', 'git log -1 --format=format:%s', 'git show HEAD', 'git reflog']) {
    expect(C.classify(comando, LINUX), comando).toBe(1);
  }
});

test('r1 il danno è vero: git diff --no-index --output svuota il file anche fuori da un repository', () => {
  const casa = cartellaTemporanea('filo-2292-g3-');
  try {
    mkdirSync(join(casa, 'Documenti'));
    writeFileSync(join(casa, 'Documenti', 'tesi.txt'), 'trecento pagine');
    try {
      execFileSync('git', ['diff', '--no-index', '--output=Documenti/tesi.txt', 'Documenti', 'Documenti'], { cwd: casa, stdio: 'ignore' });
    } catch (_) {}
    expect(readFileSync(join(casa, 'Documenti', 'tesi.txt'), 'utf8')).toBe('');
  } finally {
    togliCartella(casa);
  }
});
