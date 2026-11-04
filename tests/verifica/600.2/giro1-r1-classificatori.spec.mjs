// Verifica #600.2, giro 1: i file che decidono se un comando o un collegamento chiede l'OK
// devono lanciare le prove nell'app che li esercitano, come il punto centrale dei livelli.
import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { specsForChangedFiles } from '../../../scripts/finish-local.mjs';

const ROOT = resolve(process.cwd());
const tracciati = execFileSync('git', ['ls-files', 'tests/*.spec.mjs'], { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean);
const scelti = (f) => specsForChangedFiles([f], tracciati).filter((s) => tracciati.includes(`${s}.spec.mjs`));

test('r1 il classificatore dei comandi lancia le prove del terminale', () => {
  expect(scelti('src/shared/cmdClassify.js')).toContain('tests/filo-terminal-command');
});

test('r1 il freno sui collegamenti lancia le prove dell\'esfiltrazione', () => {
  expect(scelti('src/shared/urlExfil.js')).toContain('tests/filo-naviga-exfil');
});
