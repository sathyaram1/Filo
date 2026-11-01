// Verifica #1959 giro 4, r3 (parte dell'app): un feedback aperto dal manutentore con una priorità che non è un numero
// si rifiuta prima del server, invece di nascere a 0. La parte del giudice sta nelle prove del server.
import { test, expect } from '@playwright/test';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

test('r3 --priorita che non è un intero da 0 a 3 si rifiuta', async () => {
  const { controlliLocali } = await import(pathToFileURL(resolve(REPO, 'scripts', 'manutentore.mjs')).href);
  const passate = ['alta', '', '7', '2.5'].filter((p) => !controlliLocali('feedback', ['feedback', 'Le schede sul telefono', '-', '--priorita', p]));
  expect(passate, 'priorità malformate accettate').toEqual([]);
});
