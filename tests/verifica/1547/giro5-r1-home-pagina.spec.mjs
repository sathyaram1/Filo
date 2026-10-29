// #1547 giro 5: i contatori della home e delle pagine, arrivati su main, si creano solo con l'identità anonima,
// e il loro banco di prova dell'invio dà a Filo un'identità finta (senza, chiede quella vera a Google).
import { test, expect } from '@playwright/test';
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

test('r1 la raccolta dei contatori della home e delle pagine rifiuta la creazione senza identità', () => {
  const regole = readFileSync(join(APP_ROOT, 'firestore.rules'), 'utf8');
  const inizio = regole.search(/^ {4}match \/contatori-home-pagina\/\{/m);
  expect(inizio, 'la raccolta dei contatori della home e delle pagine non c’è nelle regole').toBeGreaterThan(-1);
  const resto = regole.slice(inizio + 1);
  const blocco = resto.slice(0, resto.search(/^ {4}match /m));
  const create = [...blocco.matchAll(/allow create: if ([^;]+);/g)].map((m) => m[1].trim());
  expect(create).toEqual(['request.auth != null && contatoriHomePagina(request.resource.data)']);
});

test('r1 il banco di prova dell’invio dei contatori della home dà a Filo un’identità finta', () => {
  const banco = join(APP_ROOT, 'tests', 'unit', 'contatoriHomePagina.test.mjs');
  expect(existsSync(banco), 'manca il banco di prova dei contatori della home').toBe(true);
  expect(readFileSync(banco, 'utf8')).toMatch(/idToken\s*:/);
});
