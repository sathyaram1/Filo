// Una prova scritta adesso con un aiuto accanto deve dare il prima anche su main, dove né lei né l'aiuto ci sono.
import { test, expect } from '@playwright/test';
import { spawnSync } from 'node:child_process';

test('r1 lo strumento del prima e dopo tiene le immagini di main anche per una prova con un aiuto scritto adesso', () => {
  test.setTimeout(10 * 60 * 1000);
  const r = spawnSync(process.execPath, ['scripts/spec-su-main.mjs', 'tests/verifica/2384.1/giro1-r1-con-aiuto.spec.mjs'], { encoding: 'utf8' });
  const uscita = `${r.stdout}\n${r.stderr}`;
  expect(uscita, uscita).toMatch(/Immagini del ramo \(il dopo\)/);
  expect(uscita, uscita).toMatch(/Immagini di main \(il prima\)/);
});
