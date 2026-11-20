// #2619.5 giro 1 — la cartella degli hook spostata dal repository (core.hooksPath) e il file di impostazioni incluso
// dalla configurazione dell'utente sono quelli che git legge davvero: una copia lì sopra vale quanto la redirezione.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { mkdirSync, writeFileSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { cartellaTemporanea, togliCartella } from '../../helpers/percorsi.mjs';

const require = createRequire(import.meta.url);
require('../../../src/shared/cmdClassify.js');
const C = globalThis.SN_CMD_CLASSIFY;

// Come il main risponde al classificatore: lo stato sul disco e la sonda di git.
const esiste = (p) => {
  try { return statSync(p).isDirectory() ? 'cartella' : 'file'; } catch (e) {
    return e && (e.code === 'ENOENT' || e.code === 'ENOTDIR') ? null : 'ignoto';
  }
};

let radice;
test.beforeAll(() => {
  radice = cartellaTemporanea('verifica-2619-5-');
  const casa = join(radice, 'casa');
  const repo = join(casa, 'progetto');
  mkdirSync(join(repo, '.githooks'), { recursive: true });
  execFileSync('git', ['init', '-q', repo]);
  execFileSync('git', ['config', 'core.hooksPath', '.githooks'], { cwd: repo });
  writeFileSync(join(casa, '.gitconfig'), '[include]\n\tpath = ~/.gitconfig-lavoro\n');
});
test.afterAll(() => togliCartella(radice));

const ctx = () => {
  const casa = join(radice, 'casa');
  return { cwd: join(casa, 'progetto'), home: casa, win: process.platform === 'win32', maiuscole: process.platform !== 'linux', esiste, gitLancia: () => '' };
};

test('r1 copiare o spostare un hook nella cartella degli hook scelta dal repository vale quanto scriverlo con la redirezione', () => {
  const c = ctx();
  expect(C.classify('echo x > .githooks/pre-commit', c)).toBe(3);
  for (const cmd of ['cp evil.sh .githooks/pre-commit', 'mv evil.sh .githooks/pre-commit', 'cp evil.sh .githooks/']) {
    expect(C.classify(cmd, c), cmd).toBe(3);
  }
});

test('r1 copiare sopra il file di impostazioni che la configurazione dell\'utente include vale quanto scriverlo con la redirezione', () => {
  const c = ctx();
  expect(C.classify('echo x >> ~/.gitconfig-lavoro', c)).toBe(3);
  for (const cmd of ['cp evil.cfg ~/.gitconfig-lavoro', 'mv evil.cfg ~/.gitconfig-lavoro']) {
    expect(C.classify(cmd, c), cmd).toBe(3);
  }
});
