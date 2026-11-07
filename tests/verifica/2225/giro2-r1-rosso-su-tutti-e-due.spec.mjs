// Verifica #2225 giro 2: un test rosso sulla fusione sia su Linux sia su Windows non è un rosso «solo di Windows».
// La firma [Windows] dice a chi riallinea di correggerlo perché su Linux sarebbe verde: qui su Linux è rosso.
import { test, expect } from '@playwright/test';
import { pathToFileURL } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

test('r1 un rosso di tutti e due i sistemi esce una volta, senza la firma di Windows', async () => {
  const { unisciParti } = await import(pathToFileURL(join(ROOT, 'scripts', 'unit-fusione-azione.mjs')).href);
  const ramo = 'a'.repeat(40);
  const main = 'b'.repeat(40);
  const campo = (rossi) => JSON.stringify({ ramo, main, esito: 'rosso_sulla_fusione', mainSha: main, rossi });
  const rosso = 'tests/unit/x.test.mjs › fa y';
  const solo = 'tests/unit/z.test.mjs › import di un percorso';
  const out = unisciParti({
    ramo, main,
    parti: [
      { nome: 'linux', risultato: 'success', campo: campo([rosso]) },
      { nome: 'windows', risultato: 'success', campo: campo([rosso, solo]) },
    ],
  });
  expect(out.esito).toBe('rosso_sulla_fusione');
  expect(out.rossi).toContain(rosso);
  expect(out.rossi).toContain(`${solo} [Windows]`);
  expect(out.rossi).not.toContain(`${rosso} [Windows]`);
});
