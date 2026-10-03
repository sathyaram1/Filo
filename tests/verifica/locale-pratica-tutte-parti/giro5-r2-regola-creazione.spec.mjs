// Prova del giro 5 (verifica locale) sul lavoro «la pratica si chiude quando tutte le parti sono su main».
// Rilievo 2: la creazione di un feedback da admin non controlla la forma delle parti, e un documento nato con le parti
// malformate non si scrive più dalla Gestione. Sull'emulatore: create 200, poi ogni aggiornamento dell'owner 403.

import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

test('la creazione admin dei feedback controlla la forma delle parti come fa col segno locale e col sì dell’owner', () => {
  const regole = readFileSync(resolve(ROOT, 'firestore.rules'), 'utf8');
  const creazione = regole.split('\n').find((r) => /allow create: if isAdmin\(\) && localOnlyValido/.test(r));
  expect(creazione, 'la regola di creazione admin dei feedback').toBeTruthy();
  expect(creazione).toContain('localApprovalValido');
  expect(creazione).toContain('localMergesValido');
});
