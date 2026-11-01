// Verifica #1959 giro 6, r1: la prova di logica sulla riscrittura delle novità regge anche quando il blocco in cima
// al registro ha una riga sola (o nessuna), come appena si apre una versione nuova su main.
import { test, expect } from '@playwright/test';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { cartellaTemporanea, togliCartella } from '../../helpers/percorsi.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const COPIE = [
  'tests/unit/releaseNovita.test.mjs', 'tests/helpers/percorsi.mjs', 'scripts/lib/nomi-temporanee.mjs',
  'scripts/release-novita.mjs', '.github/workflows/release.yml', 'package.json',
];

function conBloccoInCima(righe) {
  const dir = cartellaTemporanea('filo-v1959-');
  for (const f of COPIE) { mkdirSync(dirname(join(dir, f)), { recursive: true }); copyFileSync(join(REPO, f), join(dir, f)); }
  const vero = readFileSync(join(REPO, 'src', 'shared', 'patchNotes.js'), 'utf8');
  const blocco = `{\n      version: '9.9.10', date: '2026-11-02',\n      features: [],\n      fixes: [${righe.map((r) => JSON.stringify(r)).join(', ')}],\n    },\n    `;
  const i = vero.indexOf('{', vero.indexOf('const NOTES = ['));
  mkdirSync(join(dir, 'src', 'shared'), { recursive: true });
  writeFileSync(join(dir, 'src', 'shared', 'patchNotes.js'), vero.slice(0, i) + blocco + vero.slice(i));
  return dir;
}

for (const righe of [['Prima riga della versione nuova.'], []]) {
  test(`r1 con ${righe.length} righe nel blocco in cima la prova sulla riscrittura resta verde`, () => {
    const dir = conBloccoInCima(righe);
    try {
      const r = spawnSync(process.execPath, ['--test', '--test-name-pattern', 'la riscrittura prende il posto', join(dir, 'tests', 'unit', 'releaseNovita.test.mjs')], { encoding: 'utf8', cwd: dir });
      expect(r.status, `${r.stdout}\n${r.stderr}`.split('\n').filter((l) => /not ok|Expected|actual|expected/.test(l)).slice(0, 8).join('\n')).toBe(0);
    } finally { togliCartella(dir); }
  });
}
