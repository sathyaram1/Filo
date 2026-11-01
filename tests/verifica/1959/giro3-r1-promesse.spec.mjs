// Verifica #1959 giro 3, r1: una riga che promette qualcosa senza dire su quale lavoro non deve passare il controllo
// del redattore, qualunque forma usi (terza volta che la famiglia torna: le parole elencate non bastano).
import { test, expect } from '@playwright/test';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

test('r1 le promesse non dichiarate si riconoscono anche senza le parole dell\'elenco', async () => {
  const M = await import(pathToFileURL(resolve(REPO, 'scripts', 'manutentore.mjs')).href);
  const blocco = { version: '0.2.256', features: ['Le schede si trascinano fra le finestre.'], fixes: [] };
  const passate = [
    'Tra poco potrai allegare i PDF.',
    'Stiamo per portare la chat sul telefono.',
    'Potremo leggere i PDF nel prossimo giro.',
    'Il supporto ai PDF è quasi pronto.',
    'I PDF sono il prossimo passo.',
    'Tra qualche giorno anche i PDF.',
  ].filter((riga) => M.controllaNovita({ versione: '0.2.256', features: [riga] }, { blocco, schede: [] }).ok);
  expect(passate, 'promesse fuori dalla rosa che passano il controllo').toEqual([]);
});
