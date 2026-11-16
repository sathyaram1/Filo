// Verifica #2551 giro 1: finish:check sceglie gli spec che usano un file di supporto cambiato anche quando il file
// non è un modulo JS importato (un aiuto in Python lanciato da un aiuto JS, un documento di prova, un file letto da new URL).
import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { specDellaScelta } from '../../../scripts/finish-local.mjs';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));

test('r1 l\'aiuto in Python dei gesti veri lancia gli spec che lo usano', () => {
  const { specs } = specDellaScelta({ changed: ['tests/helpers/gestiVeri.py'], base: 'HEAD', root: ROOT });
  expect(specs).toContain('tests/gesti-veri');
});

test('r1 il documento PDF di prova lancia lo spec della lettura documenti', () => {
  const { specs } = specDellaScelta({ changed: ['tests/fixtures/documenti/documento-con-testo.pdf'], base: 'HEAD', root: ROOT });
  expect(specs).toContain('tests/lettura-documenti');
});

test('r1 il preload letto da new URL lancia lo spec che lo inietta', () => {
  // La base è prima dell'ultima modifica vera del preload: con base HEAD il file non cambia e la scelta lo scarta.
  const { specs } = specDellaScelta({ changed: ['src/preload/page-preload.js'], base: '9e4257200d^', root: ROOT });
  expect(specs).toContain('tests/fingerprint-incognito');
});
