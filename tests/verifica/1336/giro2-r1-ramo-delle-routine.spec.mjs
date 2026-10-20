// Verifica #1336 giro 2: il cancello del server scrive nelle parti della pratica il ramo del lavoro, che per un lavoro
// delle routine è `worker/<id>-<ora>`. Se le regole non accettano quella forma, l'owner non aggiorna più la pratica.
// Provato anche con l'emulatore Firestore: con quel ramo stella e archiviazione dell'owner sono rifiutate.
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REGOLE = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'firestore.rules');

test('r1 il ramo che il cancello del server scrive per un lavoro delle routine passa la forma delle parti', () => {
  const regole = readFileSync(REGOLE, 'utf8');
  const corpo = /function localMergesValido\(d\) \{([\s\S]*?)\n\s*\}/.exec(regole);
  expect(corpo, 'localMergesValido non trovata').toBeTruthy();
  const forma = /localMerges\.ramo\.matches\('([^']+)'\)/.exec(corpo[1]);
  // Senza un vincolo sul nome del ramo il caso non si pone.
  if (!forma) return;
  expect(new RegExp(forma[1]).test('worker/iVNEfxYql13VQmk9ARAN-20261018T164901Z')).toBe(true);
});
