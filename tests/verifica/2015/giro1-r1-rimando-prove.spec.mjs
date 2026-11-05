// Verifica #2015 giro 1: l'intestazione del modulo della chiave di classe rimanda alle sue prove; il rimando deve
// portare a un file che c'è, se no chi tocca l'ordine delle chiavi non trova la sentinella.
import { test, expect } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

test('r1 le prove nominate dall\'intestazione della chiave di classe esistono', () => {
  const testa = readFileSync(join(ROOT, 'scripts', 'lib', 'chiave-di-classe.mjs'), 'utf8').split('\n').slice(0, 3).join('\n');
  const nominati = [...testa.matchAll(/tests\/unit\/[\w.-]+\.test\.mjs/g)].map((m) => m[0]);
  expect(nominati.length).toBeGreaterThan(0);
  expect(nominati.filter((f) => !existsSync(join(ROOT, f)))).toEqual([]);
});
