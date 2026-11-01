// Verifica #1959 giro 2, r4: una riga che promette qualcosa al futuro senza dire su quale lavoro non deve passare il
// controllo del redattore, qualunque parola usi.
import { test, expect } from '@playwright/test';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

test('r4 le promesse non dichiarate si riconoscono anche con altre parole', async () => {
  const M = await import(pathToFileURL(resolve(REPO, 'scripts', 'manutentore.mjs')).href);
  const blocco = { version: '0.2.256', features: ['Le schede si trascinano fra le finestre.'], fixes: [] };
  const passate = [
    'Verrà aggiunto il supporto ai PDF.',
    'Lavoriamo per portare le schede sul telefono.',
    'Domani arriva la chat condivisa.',
  ].filter((riga) => M.controllaNovita({ versione: '0.2.256', features: [riga] }, { blocco, schede: [] }).ok);
  expect(passate, 'promesse fuori dalla rosa che passano il controllo').toEqual([]);
});
