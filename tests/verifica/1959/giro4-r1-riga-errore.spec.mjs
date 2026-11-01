// Verifica #1959 giro 4, r1: lo strumento fallito si registra con la riga che dice perché, anche per le prove di
// logica (uscita TAP o spec) e per un errore di node: mai il nome di una prova passata o la posizione nel sorgente.
import { test, expect } from '@playwright/test';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

test('r1 la riga d\'errore di un comando fallito è quella del fallimento', async () => {
  const { rigaErrore } = await import(pathToFileURL(resolve(REPO, 'scripts', 'session-report.mjs')).href);
  const casi = [
    ['Exit code 1\n\n> filo@0.9.0 test:unit\n> node scripts/run-unit-tests.mjs\n\nTAP version 13\n# Subtest: senza transcript: mai un errore\nok 1 - senza transcript: mai un errore\n# Subtest: la somma\nnot ok 2 - la somma\n  error: |-\n    Expected values to be strictly equal:', /la somma/],
    ['Exit code 1\n✔ il rilascio non perde errore (0.9ms)\n✖ la somma (1.2ms)\n  AssertionError [ERR_ASSERTION]: Expected', /la somma|AssertionError/],
    ['Exit code 1\n[eval]:1\nx()\n^\n\nReferenceError: x is not defined\n    at [eval]:1:1', /ReferenceError: x is not defined/],
  ];
  const sbagliate = casi.map(([uscita, attesa]) => rigaErrore(uscita)).filter((r, i) => !casi[i][1].test(r));
  expect(sbagliate, 'righe registrate che non dicono il fallimento').toEqual([]);
});
