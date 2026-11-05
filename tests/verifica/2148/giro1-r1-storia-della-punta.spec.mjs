// Verifica #2148 giro 1: i rossi rifatti sulla punta di main devono vedere la stessa storia git della prima corsa,
// altrimenti un test che ha bisogno della storia si salta, il suo file esce verde e il feedback non nasce.
// Si clona come fa il checkout della punta (profondità letta dal flusso) e si cerca un commit che un unit usa.

import { test, expect } from '@playwright/test';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import yaml from 'js-yaml';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
// Uno dei due commit di #500 che il conto delle prove chiede alla storia (si salta se non c'è).
const COMMIT_DELLA_STORIA = '10ffd0cd752e';

function checkoutDellaPunta() {
  const flusso = yaml.load(readFileSync(join(APP_ROOT, '.github', 'workflows', 'suite.yml'), 'utf8'));
  const lavoro = flusso.jobs['unit-windows-punta'];
  expect(lavoro, 'il lavoro che rifà i rossi sulla punta').toBeTruthy();
  const passo = lavoro.steps.find((s) => String(s.uses || '').startsWith('actions/checkout'));
  expect(passo, 'il checkout della punta').toBeTruthy();
  return passo.with || {};
}

test('r1 la punta rifà i rossi con la storia che aveva la prima corsa', () => {
  test.skip(spawnSync('git', ['cat-file', '-e', `${COMMIT_DELLA_STORIA}^{commit}`], { cwd: APP_ROOT }).status !== 0,
    'questo clone non ha la storia di #500');
  const opzioni = checkoutDellaPunta();
  // actions/checkout: senza fetch-depth la profondità è 1; 0 vuol dire tutta la storia.
  const profondita = opzioni['fetch-depth'] === undefined ? 1 : Number(opzioni['fetch-depth']);
  const dir = join(cartellaTemporanea(), `verifica-2148-${process.pid}-${Date.now()}`);
  try {
    const args = ['clone', '-q', '--no-checkout'];
    if (profondita > 0) args.push('--depth', String(profondita));
    args.push(pathToFileURL(APP_ROOT).href, dir);
    execFileSync('git', args, { stdio: 'ignore' });
    const vista = spawnSync('git', ['cat-file', '-e', `${COMMIT_DELLA_STORIA}^{commit}`], { cwd: dir }).status === 0;
    expect(vista, 'sulla punta il test del conto delle prove si salterebbe ed uscirebbe verde senza provare niente').toBe(true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
