// Verifica locale «unit-a-gruppi», giro 1: con file di prova che tutti insieme superano la riga di comando di
// Windows, gli unit partono lo stesso, contano ogni file e danno un esito unico, rosso se un gruppo è rosso.
// Niente Filo aperto: è uno strumento da riga di comando.
import { test, expect } from '@playwright/test';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';

const ROOT = resolve(process.cwd());
const N = 70;

function cartellaLunga(rossoIn = -1) {
  const base = cartellaTemporanea('unit-lunghi-');
  let dir = base;
  for (let i = 0; i < 4; i++) dir = join(dir, `cartella-di-lavoro-con-un-nome-molto-lungo-come-un-worktree-${i}`);
  mkdirSync(dir, { recursive: true });
  for (let i = 0; i < N; i++) {
    const nome = `prova-${String(i).padStart(3, '0')}-${'nome-lungo-di-un-file-di-prova-'.repeat(3)}.test.mjs`;
    const corpo = i === rossoIn ? 'assert.equal(1, 2)' : 'assert.ok(true)';
    writeFileSync(join(dir, nome), `import test from 'node:test'; import assert from 'node:assert';\ntest('caso-${i}', () => { ${corpo}; });\n`);
  }
  return base;
}

function lancia(dir) {
  const { FILO_UNIT_TETTO_RIGA: _t, ...env } = process.env;
  const r = spawnSync(process.execPath, ['scripts/run-unit-tests.mjs'], {
    cwd: ROOT, env: { ...env, FILO_UNIT_DIR: dir }, encoding: 'utf8', maxBuffer: 1 << 28,
  });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
}

test.setTimeout(300_000);

test('tutti verdi: partono senza ENAMETOOLONG, a gruppi, e il verdetto unico è verde con ogni file contato', () => {
  const dir = cartellaLunga();
  try {
    const r = lancia(dir);
    expect(r.out).not.toMatch(/ENAMETOOLONG/);
    expect(r.out).toMatch(/\[test:unit\] \d+ file in [2-9] gruppi/);
    expect(r.out).toContain(`${N} test, ${N} passati, 0 falliti`);
    expect(r.out).toMatch(/\[test:unit\] verde:/);
    expect(r.status).toBe(0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('un rosso nell’ultimo gruppo fa rosso l’esito e il test rosso è elencato col suo nome', () => {
  const dir = cartellaLunga(N - 2);
  try {
    const r = lancia(dir);
    expect(r.status).not.toBe(0);
    expect(r.out).toContain(`${N} test, ${N - 1} passati, 1 fallito`);
    expect(r.out).toMatch(/✖ .*prova-068-.*caso-68/);
    expect(r.out).toMatch(/\[test:unit\] ROSSO:/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
