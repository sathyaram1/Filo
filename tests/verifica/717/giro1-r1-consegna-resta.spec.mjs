// #717 giro 1: dopo i controlli sul passaggio dei compiti alle routine la temporanea deve tornare com'era.
// Gira i tre file di prova con una temporanea tutta loro e conta cosa ci resta dentro.

import { test, expect } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';

test('i controlli del passaggio dei compiti non lasciano cartelle nella temporanea', () => {
  test.setTimeout(240_000);
  const base = cartellaTemporanea('filo-717-');
  const tmp = join(base, 'tmp');
  mkdirSync(tmp);
  try {
    const env = { ...process.env, TMPDIR: tmp, TEMP: tmp, TMP: tmp };
    delete env.NODE_TEST_CONTEXT;
    const r = spawnSync(process.execPath, ['--test',
      'tests/unit/dispatch.test.mjs', 'tests/unit/dispatchCornice.test.mjs', 'tests/unit/consegnaFile.test.mjs'],
    { env, encoding: 'utf8', cwd: process.cwd() });
    expect(r.status, r.stdout.slice(-2000)).toBe(0);
    const resti = readdirSync(tmp).filter((n) => n.startsWith('filo-'));
    expect(resti, 'cartelle rimaste nella temporanea dopo una corsa verde').toEqual([]);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});
