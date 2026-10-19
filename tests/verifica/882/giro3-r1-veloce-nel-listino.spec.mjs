// #882 giro 3 (riallineamento con la modalità veloce di main): cambiare il moltiplicatore della modalità veloce è un
// cambio di prezzi, quindi la sentinella del listino deve diventare rossa finché la versione non cambia.
// Prova su una copia del repo (script e sentinella): il moltiplicatore di Opus 5.5 passa da 2 a 3.

import { test, expect } from '@playwright/test';
import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';

const RADICE = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

function copia(altera) {
  const dove = cartellaTemporanea('filo-882-g3-');
  cpSync(join(RADICE, 'scripts'), join(dove, 'scripts'), { recursive: true });
  cpSync(join(RADICE, 'tests', 'helpers'), join(dove, 'tests', 'helpers'), { recursive: true });
  mkdirSync(join(dove, 'tests', 'unit'), { recursive: true });
  cpSync(join(RADICE, 'tests', 'unit', 'sessionReport.test.mjs'), join(dove, 'tests', 'unit', 'sessionReport.test.mjs'));
  cpSync(join(RADICE, 'package.json'), join(dove, 'package.json'));
  const file = join(dove, 'scripts', 'session-report.mjs');
  const prima = readFileSync(file, 'utf8');
  const dopo = altera(prima);
  writeFileSync(file, dopo);
  return { dove, cambiato: prima !== dopo };
}

const sentinella = (dove) => spawnSync(process.execPath, ['--test', '--test-name-pattern=versione del listino', join('tests', 'unit', 'sessionReport.test.mjs')], {
  cwd: dove, encoding: 'utf8', env: { ...process.env, NODE_PATH: join(RADICE, 'node_modules') },
});

test('r1 con il moltiplicatore veloce cambiato e la stessa versione del listino, la sentinella è rossa', () => {
  const intatta = copia((s) => s);
  const controllo = sentinella(intatta.dove);
  expect(controllo.status, `la copia intatta deve passare:\n${controllo.stdout}\n${controllo.stderr}`).toBe(0);
  expect(controllo.stdout).toMatch(/# pass [1-9]/);

  const alterata = copia((s) => s.replace(/(VELOCE\s*=\s*Object\.freeze\(\{\s*opus:\s*Object\.freeze\(\{\s*'5-5':\s*)2/, '$13'));
  expect(alterata.cambiato, 'il moltiplicatore veloce di Opus 5.5 non trovato nel listino').toBe(true);
  const r = sentinella(alterata.dove);
  expect(r.status, `prezzo veloce cambiato senza nuova versione del listino, ma la sentinella passa:\n${r.stdout}`).not.toBe(0);
});
