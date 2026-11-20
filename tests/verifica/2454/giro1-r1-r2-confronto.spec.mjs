// Prove del giro 1 di #2454: lo strumento di confronto ramo/main lanciato davvero, sui materiali committati accanto.
import { test, expect } from '@playwright/test';
import { spawnSync } from 'node:child_process';

const DIR = 'tests/verifica/2454';

function confronta(...specs) {
  const env = { ...process.env, FILO_2454_FIXTURE: '1' };
  for (const k of Object.keys(env)) if (/^(TEST_|PW_|PLAYWRIGHT_)/.test(k)) delete env[k];
  const r = spawnSync(process.execPath, ['scripts/spec-su-main.mjs', ...specs.map((s) => `${DIR}/${s}`)], { encoding: 'utf8', env, timeout: 280_000 });
  const out = `${r.stdout || ''}\n${r.stderr || ''}`;
  // Il verdetto sta dopo il riepilogo finale «▸ Ramo …, main …:».
  return out.slice(out.lastIndexOf('▸ Ramo '));
}

test('r1 un caso rosso solo sul ramo non diventa «c\'era già su main» perché un altro caso dello stesso file è rosso anche lì', () => {
  test.setTimeout(300_000);
  const verdetto = confronta('giro1-r1-fixture-casi.spec.mjs');
  expect(verdetto).toContain('giro1-r1-fixture-casi.spec.mjs');
  expect(verdetto).not.toMatch(/c'era già su main/);
  expect(verdetto).toMatch(/solo sul ramo|rotto il ramo|rotto dal ramo/);
});

test('r2 uno spec copiato che su main non si carica non toglie il confronto agli altri spec della stessa corsa', () => {
  test.setTimeout(300_000);
  const verdetto = confronta('giro1-r2-fixture-verde.spec.mjs', 'giro1-r2-fixture-aiuto.spec.mjs');
  const riga = verdetto.split('\n').find((l) => l.includes('giro1-r2-fixture-verde.spec.mjs')) || '';
  expect(riga).toMatch(/main verde/);
});
